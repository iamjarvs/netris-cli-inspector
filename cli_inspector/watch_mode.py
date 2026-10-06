"""Real-time Watch Mode for CLI Inspector:
Monitors Netris Controller API writes and switch fabric configurations,
correlates product changes with device-level updates, identifies affected
devices, and presents per-device new (+) and removed (-) configuration lines.
"""

from __future__ import annotations

import sys
import time
from datetime import datetime, timezone
from typing import Optional

from rich import box
from rich.panel import Panel
from rich.text import Text

from . import archive, ui
from .diff_utils import DeviceDiffResult, parse_config_changes, parse_device_context, side_by_side, unified_diff
from .executor import SwitchExecutor
from .inventory import (
    Device,
    NetrisClient,
    build_client,
    get_relevant_write_logs,
    list_all_switches,
    list_sites,
    summarize_api_log,
)

console = ui.console


class WatchEngine:
    def __init__(
        self,
        cfg: dict,
        client: NetrisClient,
        executor: SwitchExecutor,
        site_name: Optional[str] = None,
        devices: Optional[list[Device]] = None,
        poll_interval: int = 10,
        archive_dir: Optional[str] = None,
        interactive: bool = True,
    ):
        self.cfg = cfg
        self.client = client
        self.executor = executor
        self.site_name = site_name or "All Reachable Sites"
        self.devices = devices or []
        self.poll_interval = poll_interval
        self.archive_dir = archive_dir or cfg["archive_dir"]
        self.interactive = interactive

        # Device baselines: device_name -> full config text
        self.baselines: dict[str, str] = {}
        self.last_revs: dict[str, str] = {}
        self.roles: dict[str, str] = {}
        self.pairs: list[tuple[str, str]] = []
        self.last_poll_epoch: int = int(time.time())
        self.last_events: list[dict] = []
        self.last_diff_result: Optional[dict] = None

    def initialize(self) -> None:
        """Discovers reachable devices and seeds initial baselines from the archive
        or fetches them live if not yet present in the archive.
        """
        archive.ensure_archive_repo(self.archive_dir)

        if not self.devices:
            all_switches = [d for d in list_all_switches(self.client) if d.mgmt_address]
            sites = list_sites(self.client)
            reachable_site_ids = {s.id for s in sites if s.has_hardware}
            self.devices = [d for d in all_switches if d.site_id in reachable_site_ids]

        self.roles = {d.name: d.role for d in self.devices}
        self.pairs = [(d.name, d.mgmt_address) for d in self.devices]

        # Seed baselines
        missing_baseline = []
        for d in self.devices:
            snap_text = archive.latest_snapshot_text(self.archive_dir, d.name)
            if snap_text is not None:
                self.baselines[d.name] = snap_text
            else:
                missing_baseline.append((d.name, d.mgmt_address))

        if missing_baseline:
            with console.status(
                f"[bold cyan]Establishing baseline for {len(missing_baseline)} device(s)...[/bold cyan]",
                spinner="dots",
            ):
                results = self.executor.get_full_config_commands_many(missing_baseline)
                for name, res in results.items():
                    if res.ok:
                        self.baselines[name] = res.stdout
                        meta = {
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "trigger": "watch-baseline",
                            "site": self.site_name,
                        }
                        archive.snapshot_device(self.archive_dir, name, res.stdout, meta)

        # Populate current revision IDs
        rev_res = self.executor.exec_many(self.pairs, "nv config history | sed -n 3p | awk '{print $1}'", timeout=8)
        for name, r in rev_res.items():
            if r.ok and r.stdout.strip():
                self.last_revs[name] = r.stdout.strip()

        self.last_poll_epoch = int(time.time()) - 30  # include any write in the last 30s

    def check_for_changes(self) -> tuple[list[dict], list[DeviceDiffResult], list[str]]:
        """Polls Netris API write logs and queries devices to detect config drift.
        Uses lightweight Option A revision sentinel to avoid heavy full-config dumps.
        Returns (new_api_events, changed_device_diffs, unchanged_device_names).
        """
        now_epoch = int(time.time())
        new_events: list[dict] = []

        # 1. Check Netris API logs
        try:
            raw_logs = get_relevant_write_logs(self.client, self.last_poll_epoch, now_epoch)
            for item in raw_logs:
                new_events.append(summarize_api_log(item))
        except Exception as e:
            console.print(f"[dim]Warning: API log check error: {e}[/dim]")

        self.last_poll_epoch = now_epoch
        if new_events:
            self.last_events.extend(new_events)

        # 2. Check Revision ID Sentinel across all monitored switches
        rev_results = self.executor.exec_many(self.pairs, "nv config history | sed -n 3p | awk '{print $1}'", timeout=8)

        switches_to_pull: list[tuple[str, str]] = []
        unchanged_names: list[str] = []

        for name, addr in self.pairs:
            res = rev_results.get(name)
            curr_rev = res.stdout.strip() if (res and res.ok) else None
            prev_rev = self.last_revs.get(name)
            has_baseline = name in self.baselines

            if not has_baseline or not prev_rev or (curr_rev and curr_rev != prev_rev):
                switches_to_pull.append((name, addr))
            else:
                unchanged_names.append(name)

        changed_diffs: list[DeviceDiffResult] = []

        # Determine trigger description
        trigger_desc = "watch: direct switch / manual change"
        if self.last_events:
            most_recent = self.last_events[-1]
            trigger_desc = f"Netris: {most_recent.get('summary', 'API Write')}"

        if switches_to_pull:
            results = self.executor.get_full_config_commands_many(switches_to_pull)

            for name, addr in switches_to_pull:
                res = results.get(name)
                if not res or not res.ok:
                    continue

                current_text = res.stdout
                old_text = self.baselines.get(name)
                curr_rev = rev_results.get(name).stdout.strip() if (rev_results.get(name) and rev_results.get(name).ok) else None
                if curr_rev:
                    self.last_revs[name] = curr_rev

                if old_text is None:
                    self.baselines[name] = current_text
                    unchanged_names.append(name)
                    continue

                if old_text.strip() == current_text.strip():
                    unchanged_names.append(name)
                else:
                    # Changes detected!
                    diff_result = parse_config_changes(name, old_text, current_text)
                    if diff_result.is_changed:
                        changed_diffs.append(diff_result)
                        # Update in-memory baseline
                        self.baselines[name] = current_text

                        # Snapshot to git archive
                        meta = {
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "trigger": trigger_desc,
                            "site": self.site_name,
                            "revision": curr_rev or "",
                        }
                        archive.snapshot_device(self.archive_dir, name, current_text, meta)
                    else:
                        unchanged_names.append(name)

        return new_events, changed_diffs, unchanged_names

    def run(self) -> None:
        """Main watch loop."""
        ui.print_banner(f"Watch Mode — {self.site_name}")
        self.initialize()

        ui.render_watch_header(self.site_name, len(self.devices), self.poll_interval)
        console.print(f"\n[bold green]●[/bold green] Watcher active on [bold]{len(self.devices)}[/bold] devices. Awaiting changes...\n")

        pending_product_event: Optional[dict] = None
        iteration = 0

        try:
            while True:
                iteration += 1
                new_events, changed_diffs, unchanged = self.check_for_changes()

                # Surface Netris product events immediately
                for ev in new_events:
                    ui.render_product_event_alert(ev)
                    pending_product_event = ev
                    console.print(
                        f"[bold cyan]Netris provisioning detected! Monitoring switches for NVUE config changes...[/bold cyan]\n"
                    )

                # Surface device config changes
                if changed_diffs:
                    affected_names = [d.device for d in changed_diffs]
                    trigger_label = (
                        pending_product_event.get("summary")
                        if pending_product_event
                        else "Switch CLI / Background update"
                    )

                    console.print(f"\n[bold yellow]⚡ CONFIG CHANGES DETECTED AT {datetime.now().strftime('%H:%M:%S')}[/bold yellow]")
                    ui.render_affected_devices_summary(affected_names, unchanged, trigger_label)

                    for diff in changed_diffs:
                        role = self.roles.get(diff.device, "")
                        ui.render_device_config_diff(diff, role=role, trigger=trigger_label)
                        ctx = parse_device_context(self.baselines.get(diff.device, ""))
                        ui.render_device_context_summary(ctx, device=diff.device)

                    # Save last diff for drill-down or bookmarking
                    primary_diff = changed_diffs[0]
                    self.last_diff_result = {
                        "device": primary_diff.device,
                        "source_a_desc": f"{primary_diff.device} (before change)",
                        "source_b_desc": f"{primary_diff.device} (after change)",
                        "diff_text": primary_diff.raw_diff,
                        "text_a": self.baselines.get(primary_diff.device, ""),
                        "text_b": self.baselines.get(primary_diff.device, ""),
                        "diffs": changed_diffs,
                        "trigger": trigger_label,
                    }

                    pending_product_event = None

                    # If interactive, prompt user for action
                    if self.interactive:
                        action = self._prompt_change_action(changed_diffs)
                        if action == "exit":
                            return
                        # Re-render header after user interaction
                        ui.print_banner(f"Watch Mode — {self.site_name}")
                        ui.render_watch_header(self.site_name, len(self.devices), self.poll_interval)
                        console.print(f"\n[bold green]●[/bold green] Resuming watch mode on [bold]{len(self.devices)}[/bold] devices...\n")

                time.sleep(self.poll_interval)

        except KeyboardInterrupt:
            console.print("\n[yellow]Watch mode stopped by user.[/yellow]")

    def _prompt_change_action(self, changed_diffs: list[DeviceDiffResult]) -> str:
        """Offers interactive choices when changes are detected."""
        import questionary
        from questionary import Choice, Style

        style = Style(
            [
                ("qmark", "fg:#00d7af bold"),
                ("question", "bold fg:#ffffff"),
                ("answer", "fg:#00ffff bold"),
                ("pointer", "fg:#00d7af bold"),
                ("highlighted", "fg:#00d7af bold"),
                ("selected", "fg:#00d7af"),
            ]
        )

        choices = [
            Choice("Continue watching (resume monitoring)", value="continue"),
            Choice("Clear screen and continue watching", value="clear"),
            Choice("Inspect full unified diff for a changed switch", value="view_diff"),
            Choice("Inspect side-by-side diff for a changed switch", value="side_by_side"),
            Choice("Save diff to Diff Examples (bookmark)", value="save"),
            Choice("Exit watch mode back to menu", value="exit"),
        ]

        action = questionary.select("Action:", choices=choices, style=style).ask()
        if action is None or action == "exit":
            return "exit"

        if action == "clear":
            import os
            os.system("clear")
            return "continue"

        if action in ("view_diff", "side_by_side"):
            target_device = changed_diffs[0].device
            if len(changed_diffs) > 1:
                dev_choices = [Choice(d.device, value=d.device) for d in changed_diffs]
                picked = questionary.select("Pick switch to inspect:", choices=dev_choices, style=style).ask()
                if picked:
                    target_device = picked

            target_diff = next(d for d in changed_diffs if d.device == target_device)

            if action == "view_diff":
                ui.render_diff_text(target_diff.raw_diff, title=f"Full Diff — {target_device}")
            else:
                old_text = archive.latest_snapshot_text(self.archive_dir, target_device) or ""
                # Use current in memory
                new_text = self.baselines.get(target_device, "")
                rows = side_by_side(old_text, new_text)
                ui.render_side_by_side_diff(rows, title=f"Side-by-Side Diff — {target_device}")

            questionary.press_any_key_to_continue("Press any key to resume watching...").ask()

        elif action == "save":
            label = questionary.text("Label for this saved diff:", default=f"Watch: {self.last_diff_result.get('trigger', '')[:30]}", style=style).ask()
            if label:
                dev = self.last_diff_result["device"]
                diff_id = archive.save_diff(
                    self.archive_dir,
                    dev,
                    label,
                    self.last_diff_result["source_a_desc"],
                    self.last_diff_result["source_b_desc"],
                    self.last_diff_result["diff_text"],
                )
                console.print(f"[bold green]✔ Saved as {diff_id}[/bold green]")
                questionary.press_any_key_to_continue("Press any key to resume watching...").ask()

        return "continue"
