"""Interactive questionary + rich menu loop -- the primary way to use
cli-inspector. Mirrors the look and feel of the switch-isolation-cli sibling
tool: same teal/cyan custom_style, arrow-key + type-to-filter select menus,
rich panels/tables for output.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone

import questionary
from questionary import Choice, Separator, Style

from . import archive, catalog, ui
from .config import CONFIG_PATH, config_is_complete, load_config
from .diff_utils import clean_error_text, side_by_side, unified_diff
from .executor import (
    NVUE_DEFAULT_MAX_REVISIONS,
    NVUE_MAX_MAX_REVISIONS,
    NVUE_MIN_MAX_REVISIONS,
    ExecutorError,
    SwitchExecutor,
    parse_config_history,
    parse_live_revision_ids,
)
from .inventory import Device, InventoryError, Site, build_client, list_all_switches, list_sites
from .isolation import IsolationEngine, parse_su_host

console = ui.console

custom_style = Style(
    [
        ("qmark", "fg:#00d7af bold"),
        ("question", "bold fg:#ffffff"),
        ("answer", "fg:#00ffff bold"),
        ("pointer", "fg:#00d7af bold"),
        ("highlighted", "fg:#00d7af bold"),
        ("selected", "fg:#00d7af"),
        ("separator", "fg:#6c6c6c"),
        ("instruction", "fg:#8a8a8a italic"),
        ("text", "fg:#e4e4e4"),
        ("disabled", "fg:#585858 italic"),
    ]
)

BACK = "__back__"
EXIT = "__exit__"


def select(message, choices, **kwargs):
    result = questionary.select(message, choices=choices, style=custom_style, **kwargs).ask()
    return result if result is not None else BACK


def text(message, default=""):
    result = questionary.text(message, default=default, style=custom_style).ask()
    return result if result is not None else None


def confirm(message, default=True):
    result = questionary.confirm(message, default=default, style=custom_style).ask()
    return default if result is None else result


def press_any_key():
    questionary.press_any_key_to_continue("Press any key to continue...").ask()


class AppState:
    def __init__(self, cfg, client, executor):
        self.cfg = cfg
        self.client = client
        self.executor = executor
        self.all_devices: list[Device] = []
        self.sites: list[Site] = []
        self.current_site: Site | None = None
        self.site_devices: list[Device] = []
        self.last_diff: dict | None = None

    def refresh_inventory(self):
        with console.status("[bold cyan]Loading inventory from Netris...[/bold cyan]", spinner="dots"):
            self.all_devices = list_all_switches(self.client)
            self.sites = list_sites(self.client)

    def devices_for_site(self, site_id) -> list[Device]:
        return [d for d in self.all_devices if d.site_id == site_id]


def probe_site_reachable(executor: SwitchExecutor, devices: list[Device], sample: int = 2, timeout: int = 6) -> bool:
    for device in devices[:sample]:
        if not device.mgmt_address:
            continue
        result = executor.exec_on_device(device.name, device.mgmt_address, "true", timeout=timeout)
        if result.ok:
            return True
    return False


def pick_site(state: AppState) -> Site | None:
    state.refresh_inventory()
    choices = []
    with console.status("[bold cyan]Checking which sites are actually reachable...[/bold cyan]", spinner="dots"):
        for site in state.sites:
            devices = state.devices_for_site(site.id)
            if not devices:
                choices.append(Choice(f"{site.name}  (no switches in Netris)", value=site.id, disabled="no hardware"))
                continue
            reachable = probe_site_reachable(state.executor, devices)
            label = f"{site.name}  ({len(devices)} switches)"
            if reachable:
                choices.append(Choice(label, value=site.id))
            else:
                choices.append(Choice(label + "  [unreachable]", value=site.id, disabled="not reachable from this jump host"))
    choices.append(Separator("─────────────"))
    choices.append(Choice("« Back", value=BACK))

    picked = select("Pick a site to inspect:", choices, use_search_filter=True, use_jk_keys=False)
    if picked in (BACK, None):
        return None
    return next(s for s in state.sites if s.id == picked)


def pick_devices(state: AppState, prompt: str, exclude: list[str] | None = None) -> list[Device]:
    exclude = exclude or []
    pool = [d for d in state.site_devices if d.name not in exclude]
    choices = [
        Choice(f"{d.name}  [{d.role}]  {d.mgmt_address}", value=d.name) for d in pool
    ]
    choices.append(Separator("─────────────"))
    choices.append(Choice("« Back", value=BACK))
    picked = select(prompt, choices, use_search_filter=True, use_jk_keys=False)
    if picked in (BACK, None):
        return []
    return [d for d in pool if d.name == picked]


def pick_target_group(state: AppState) -> list[Device]:
    roles = sorted({d.role for d in state.site_devices})
    choices = [Choice(f"Single device", value="single")]
    for role in roles:
        count = sum(1 for d in state.site_devices if d.role == role)
        choices.append(Choice(f"All '{role}' devices ({count})", value=f"role:{role}"))
    choices.append(Choice(f"All devices in {state.current_site.name} ({len(state.site_devices)})", value="all"))
    choices.append(Separator("─────────────"))
    choices.append(Choice("« Back", value=BACK))

    picked = select("Run against:", choices)
    if picked in (BACK, None):
        return []
    if picked == "single":
        return pick_devices(state, "Pick a device:")
    if picked == "all":
        return state.site_devices
    if picked.startswith("role:"):
        role = picked.split(":", 1)[1]
        return [d for d in state.site_devices if d.role == role]
    return []


def pick_command() -> str | None:
    """Two sections, matching the web dashboard: verified Configuration
    entries (rendered as flat commands-format text in the CLI -- readable
    without needing an interactive tree, unlike the web's JSON view) and
    verified Show entries (nv show, always default auto/table format --
    never -o json, which is confirmed to outright fail on composite
    categories like 'router' and is unreadable even when it works).
    """
    choices = [Separator("── Configuration ──")]
    for entry in catalog.CONFIG_COMMANDS:
        choices.append(Choice(entry.label, value=f"__catalog__{entry.id}"))
    choices.append(Separator("── Show (live from the box) ──"))
    for entry in catalog.SHOW_COMMANDS:
        tag = "vtysh" if entry.source == "vtysh" else "nv"
        choices.append(Choice(f"{entry.label}  [{tag}]", value=f"__catalog__{entry.id}"))
    choices.append(Separator("─────────────"))
    choices.append(Choice("Custom 'nv show' arguments...", value="__custom_show__"))
    choices.append(Choice("Custom raw command...", value="__custom_raw__"))
    choices.append(Choice("« Back", value=BACK))

    picked = select("Pick a command:", choices, use_search_filter=True, use_jk_keys=False)
    if picked in (BACK, None):
        return None
    if picked == "__custom_show__":
        args = text("Arguments after 'nv show ' (e.g. 'interface swp1'):")
        if not args:
            return None
        return f"nv show {args}" + ("" if "-o" in args else "")
    if picked == "__custom_raw__":
        cmd = text("Full command to run on the switch:")
        return cmd or None
    if picked.startswith("__catalog__"):
        entry_id = picked[len("__catalog__"):]
        entry = catalog.find(entry_id)
        if entry.id == "full-config":
            return "nv config show -o commands"
        return entry.command
    return None


def flow_explore(state: AppState):
    while True:
        ui.print_banner(f"Explore — {state.current_site.name}")
        targets = pick_target_group(state)
        if not targets:
            return
        command = pick_command()
        if not command:
            continue
        pairs = [(d.name, d.mgmt_address) for d in targets]
        with console.status(f"[bold cyan]Running on {len(pairs)} device(s)...[/bold cyan]", spinner="dots"):
            results = state.executor.exec_many(pairs, command)
        ui.print_banner(f"Explore — {state.current_site.name}")
        console.print(f"[bold]$ {command}[/bold]\n")
        ui.render_show_results_many(results)
        press_any_key()


def flow_compare(state: AppState):
    while True:
        ui.print_banner(f"Compare — {state.current_site.name}")
        picked_a = pick_devices(state, "Pick the first device:")
        if not picked_a:
            return
        device_a = picked_a[0]
        picked_b = pick_devices(state, "Pick the second device:", exclude=[device_a.name])
        if not picked_b:
            continue
        device_b = picked_b[0]
        command = pick_command()
        if not command:
            continue
        show_diff = confirm("Show a diff between the two outputs too?", default=True)
        diff_style = "inline"
        if show_diff:
            diff_style = select("Diff style:", [
                Choice("Inline (unified)", value="inline"),
                Choice("Side-by-side", value="side_by_side"),
            ])
            if diff_style == BACK:
                diff_style = "inline"

        pairs = [(device_a.name, device_a.mgmt_address), (device_b.name, device_b.mgmt_address)]
        with console.status("[bold cyan]Running on both devices...[/bold cyan]", spinner="dots"):
            results = state.executor.exec_many(pairs, command)
        result_a, result_b = results[device_a.name], results[device_b.name]
        ui.print_banner(f"Compare — {state.current_site.name}")
        console.print(f"[bold]$ {command}[/bold]\n")
        ui.render_compare_panels(device_a.name, result_a, device_b.name, result_b)

        if show_diff and result_a.ok and result_b.ok:
            text_a, text_b = ui.to_display_text(result_a.stdout), ui.to_display_text(result_b.stdout)
            title = f"Diff: {device_a.name} vs {device_b.name}"
            if diff_style == "side_by_side":
                ui.render_side_by_side_diff(side_by_side(text_a, text_b), title=title, left_label=device_a.name, right_label=device_b.name)
            else:
                ui.render_diff_text(unified_diff(text_a, text_b, device_a.name, device_b.name), title=title)
            state.last_diff = {
                "device": device_a.name,
                "source_a_desc": f"{device_a.name}: {command}",
                "source_b_desc": f"{device_b.name}: {command}",
                "diff_text": unified_diff(text_a, text_b, device_a.name, device_b.name),
                "text_a": text_a,
                "text_b": text_b,
            }
        press_any_key()


def _snapshot_meta(state: AppState, trigger: str = "manual") -> dict:
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "site": state.current_site.name,
        "trigger": trigger,
    }


@dataclass
class ConfigSource:
    label: str
    source_type: str  # "onbox" | "archive"
    ref: str


def _onbox_revisions(state: AppState, device: Device):
    result = state.executor.get_config_history(device.name, device.mgmt_address)
    if not result.ok:
        ui.render_error(clean_error_text(result.error or result.stderr))
        return []
    return parse_config_history(result.stdout)


def _live_revision_ids(state: AppState, device: Device) -> set[str] | None:
    """None means detection failed/unavailable -- callers must not treat
    that as "nothing is pruned", just as "unknown", to avoid false negatives.
    """
    result = state.executor.get_live_revision_ids(device.name, device.mgmt_address)
    if not result.ok:
        return None
    return parse_live_revision_ids(result.stdout)


def _pruned_ids(revisions, live_ids: set[str] | None) -> set[str] | None:
    if live_ids is None:
        return None
    return {r.rev_id for r in revisions if r.rev_id != "startup" and r.rev_id not in live_ids}


def _source_choices(state: AppState, device: Device, revisions, pruned_ids: set[str] | None = None, hide_pruned: bool = True) -> list[ConfigSource]:
    """Fixed aliases + real numbered on-box revisions (excluding the literal
    'startup' history rows -- those are timeline bookmarks of when the
    startup file was last saved, not independently fetchable past states;
    `-r startup` always returns the box's *current* startup config, so the
    fixed alias below covers that meaning correctly) + archive snapshots.
    Pruned on-box revisions (no longer resident on the switch, even though
    `nv config history` still lists them) are hidden by default since
    picking one is guaranteed to fail with "Unknown revision".
    """
    sources = []
    for rev in revisions:
        if rev.rev_id == "startup":
            continue
        is_pruned = pruned_ids is not None and rev.rev_id in pruned_ids
        if is_pruned and hide_pruned:
            continue
        label = f"rev {rev.rev_id} — {rev.apply_date} ({rev.user})"
        if is_pruned:
            label += "  [pruned]"
        sources.append(ConfigSource(label, "onbox", rev.rev_id))
    for entry in archive.history(state.cfg["archive_dir"], device.name):
        sources.append(ConfigSource(f"archive {entry['commit'][:10]} — {entry['date']}", "archive", entry["commit"]))
    sources += [
        ConfigSource("applied (current)", "onbox", "applied"),
        ConfigSource("startup (current on-box)", "onbox", "startup"),
        ConfigSource("pending", "onbox", "pending"),
    ]
    return sources


def _fetch_source_text(state: AppState, device: Device, source: ConfigSource) -> str | None:
    if source.source_type == "onbox":
        result = state.executor.get_config_text_for_rev(device.name, device.mgmt_address, source.ref)
        if not result.ok:
            ui.render_error(clean_error_text(result.error or result.stderr))
            return None
        return result.stdout
    try:
        return archive.show_at(state.cfg["archive_dir"], device.name, source.ref)
    except archive.ArchiveError as e:
        ui.render_error(str(e))
        return None


def _pick_source(sources: list[ConfigSource], prompt: str) -> ConfigSource | None:
    choices = [Choice(s.label, value=i) for i, s in enumerate(sources)]
    choices.append(Separator("─────────────"))
    choices.append(Choice("« Back", value=BACK))
    picked = select(prompt, choices, use_search_filter=True, use_jk_keys=False)
    if picked in (BACK, None):
        return None
    return sources[picked]


def _show_diff(state: AppState, device: Device, source_a: ConfigSource, source_b: ConfigSource, title: str):
    with console.status(f"[bold cyan]Fetching {source_a.label} and {source_b.label}...[/bold cyan]"):
        text_a = _fetch_source_text(state, device, source_a)
        text_b = _fetch_source_text(state, device, source_b)
    if text_a is None or text_b is None:
        return

    view = select("View as:", [
        Choice("Diff (inline)", value="inline"),
        Choice("Diff (side-by-side)", value="side_by_side"),
        Choice("Full config — side A", value="full_a"),
        Choice("Full config — side B", value="full_b"),
        Choice("« Back", value=BACK),
    ])
    ui.print_banner(f"Config History — {state.current_site.name}")
    diff_text = unified_diff(text_a, text_b, source_a.label, source_b.label)
    if view == "full_a":
        ui.render_full_text(f"{device.name}: {source_a.label}", text_a)
    elif view == "full_b":
        ui.render_full_text(f"{device.name}: {source_b.label}", text_b)
    elif view == "side_by_side":
        ui.render_side_by_side_diff(side_by_side(text_a, text_b), title=title, left_label=source_a.label, right_label=source_b.label)
    else:
        ui.render_diff_text(diff_text, title=title)

    state.last_diff = {
        "device": device.name,
        "source_a_desc": source_a.label,
        "source_b_desc": source_b.label,
        "diff_text": diff_text,
        "text_a": text_a,
        "text_b": text_b,
    }
    press_any_key()


def flow_history(state: AppState):
    archive.ensure_archive_repo(state.cfg["archive_dir"])
    picked = pick_devices(state, "Pick a device to work with:")
    if not picked:
        return
    device = picked[0]
    hide_startup = True
    hide_pruned = True

    while True:
        ui.print_banner(f"Config History — {device.name}")
        with console.status("[bold cyan]Checking on-box revision history...[/bold cyan]", spinner="dots"):
            revisions = _onbox_revisions(state, device)
            live_ids = _live_revision_ids(state, device)
        pruned_ids = _pruned_ids(revisions, live_ids)
        table_revisions = [r for r in revisions if not (hide_startup and r.rev_id == "startup")]
        if hide_pruned and pruned_ids is not None:
            table_revisions = [r for r in table_revisions if r.rev_id not in pruned_ids]
        ui.render_config_revisions(device.name, table_revisions, pruned_ids=None if hide_pruned else pruned_ids)
        if pruned_ids is None:
            console.print("[dim]Could not determine which revisions are pruned on this device.[/dim]")
        elif hide_pruned and pruned_ids:
            console.print(f"[dim]{len(pruned_ids)} pruned revision(s) hidden.[/dim]")

        choices = [
            Choice("Refresh", value="refresh"),
            Choice(f"{'Show' if hide_startup else 'Hide'} startup entries in the table above", value="toggle_startup"),
            Choice(f"{'Show' if hide_pruned else 'Hide'} pruned revisions in the table above", value="toggle_pruned"),
            Choice("Compare current vs a revision (pick from the table)", value="vs_current"),
            Choice("Compare two sources (any revision or archive snapshot)", value="two_way"),
            Choice("View full config (no diff)", value="view_full"),
            Choice("View archive snapshot history", value="hist"),
            Choice("Snapshot this device now", value="snap_one"),
            Choice(f"Snapshot ALL devices in {state.current_site.name} now", value="snap_all"),
        ]
        if state.last_diff:
            choices.append(Choice("Save last diff...", value="save_diff"))
        choices += [
            Choice("Change device", value="change_device"),
            Separator("─────────────"),
            Choice("« Back", value=BACK),
        ]
        choice = select("Config history & snapshots:", choices)
        if choice in (BACK, None):
            return

        if choice == "refresh":
            continue

        elif choice == "toggle_startup":
            hide_startup = not hide_startup

        elif choice == "toggle_pruned":
            hide_pruned = not hide_pruned

        elif choice == "vs_current":
            sources = _source_choices(state, device, revisions, pruned_ids, hide_pruned)
            non_current = [s for s in sources if s.ref != "applied"]
            other_source = _pick_source(non_current, "Compare current (applied) against:")
            if other_source:
                # other_source is the "from" side (A) and current/applied is the
                # "to" side (B) -- so the diff reads the intuitive way: red/removed
                # is what that other source had and current doesn't anymore, green/
                # added is what's newly there since then. Passing current as A (as
                # this used to) inverts that for every historical-vs-current compare.
                _show_diff(state, device, other_source, ConfigSource("applied (current)", "onbox", "applied"),
                           title=f"{device.name}: current vs {other_source.label}")

        elif choice == "two_way":
            sources = _source_choices(state, device, revisions, pruned_ids, hide_pruned)
            source_a = _pick_source(sources, "Side A:")
            if not source_a:
                continue
            source_b = _pick_source(sources, "Side B:")
            if not source_b:
                continue
            _show_diff(state, device, source_a, source_b, title=f"{device.name}: {source_a.label} vs {source_b.label}")

        elif choice == "view_full":
            sources = _source_choices(state, device, revisions, pruned_ids, hide_pruned)
            source = _pick_source(sources, "View which source?")
            if source:
                text_ = _fetch_source_text(state, device, source)
                if text_ is not None:
                    ui.print_banner(f"Config History — {device.name}")
                    ui.render_full_text(f"{device.name}: {source.label}", text_)
                    press_any_key()

        elif choice == "hist":
            entries = archive.history(state.cfg["archive_dir"], device.name)
            ui.render_archive_history(device.name, entries)
            press_any_key()

        elif choice == "snap_one":
            with console.status(f"[bold cyan]Pulling full config from {device.name}...[/bold cyan]"):
                result = state.executor.get_full_config_commands(device.name, device.mgmt_address)
                json_result = state.executor.get_full_config_json(device.name, device.mgmt_address)
            if not result.ok:
                ui.render_error(clean_error_text(result.error or result.stderr))
            else:
                config_json = None
                if json_result.ok:
                    try:
                        parsed = json.loads(json_result.stdout)
                        config_json = parsed[1]["set"] if isinstance(parsed, list) and len(parsed) > 1 else parsed
                    except (json.JSONDecodeError, TypeError, KeyError, IndexError):
                        config_json = None
                committed = archive.snapshot_device(
                    state.cfg["archive_dir"], device.name, result.stdout, _snapshot_meta(state), config_json=config_json
                )
                ui.render_snapshot_result(device.name, committed)
            press_any_key()

        elif choice == "snap_all":
            pairs = [(d.name, d.mgmt_address) for d in state.site_devices]
            with console.status(f"[bold cyan]Pulling full config from {len(pairs)} device(s)...[/bold cyan]"):
                results = state.executor.get_full_config_commands_many(pairs)
            configs = {name: r.stdout for name, r in results.items() if r.ok}
            failed = [name for name, r in results.items() if not r.ok]
            snap_results = archive.snapshot_many(state.cfg["archive_dir"], configs, _snapshot_meta(state))
            ui.render_snapshot_summary(snap_results)
            for name in failed:
                ui.render_error(f"{name}: failed to fetch config ({clean_error_text(results[name].error or results[name].stderr)})")
            press_any_key()

        elif choice == "watch":
            flow_watch(state)

        elif choice == "save_diff":
            label = text("Label for this saved diff:")
            if label:
                diff_id = archive.save_diff(
                    state.cfg["archive_dir"], state.last_diff["device"], label,
                    state.last_diff["source_a_desc"], state.last_diff["source_b_desc"],
                    state.last_diff["diff_text"], state.last_diff["text_a"], state.last_diff["text_b"],
                )
                console.print(f"[green]Saved as {diff_id}[/green]")
                press_any_key()

        elif choice == "change_device":
            picked = pick_devices(state, "Pick a device to work with:")
            if picked:
                device = picked[0]


def flow_watch(state: AppState):
    """Launches the real-time Watch Mode: continuously monitors Netris Controller
    write calls and switch fabric configs, highlighting affected devices and showing
    the exact new and removed configuration per switch.
    """
    from .watch_mode import WatchEngine

    ui.print_banner(f"Watch Mode — {state.current_site.name}")
    console.print(
        f"[bold cyan]Starting Watch Mode for {state.current_site.name} ({len(state.site_devices)} devices)...[/bold cyan]\n"
        "[dim]This continuously monitors for Netris Controller API write activity and switch config diffs,\n"
        "showing which devices are affected and the added/removed configuration lines per switch.[/dim]\n"
    )

    poll_str = text("Poll interval in seconds (default: 10):", default="10")
    try:
        poll_interval = max(3, int((poll_str or "10").strip()))
    except (ValueError, TypeError):
        poll_interval = 10

    engine = WatchEngine(
        cfg=state.cfg,
        client=state.client,
        executor=state.executor,
        site_name=state.current_site.name,
        devices=state.site_devices,
        poll_interval=poll_interval,
        interactive=True,
    )
    engine.run()
    press_any_key()


def flow_revision_settings(state: AppState):
    """NVUE_MAX_REVISIONS lives outside NVUE's own managed config tree --
    it's an env var nvued reads from /etc/default/nvued at startup, so
    changing it means editing that file and restarting the service.
    Never touches switch config, just how much on-box revision history
    NVUE retains before pruning the oldest.
    """
    while True:
        ui.print_banner(f"Revision Retention — {state.current_site.name}")
        targets = pick_target_group(state)
        if not targets:
            return
        pairs = [(d.name, d.mgmt_address) for d in targets]

        with console.status(f"[bold cyan]Checking current NVUE_MAX_REVISIONS on {len(pairs)} device(s)...[/bold cyan]", spinner="dots"):
            statuses = state.executor.get_max_revisions_many(pairs)
        ui.print_banner(f"Revision Retention — {state.current_site.name}")
        ui.render_revision_status(statuses)

        if not confirm("Set a new NVUE_MAX_REVISIONS value for these device(s)?", default=False):
            return

        raw_value = text(
            f"New value (NVUE itself floors this at {NVUE_MIN_MAX_REVISIONS}; default is {NVUE_DEFAULT_MAX_REVISIONS}):",
            default=str(NVUE_DEFAULT_MAX_REVISIONS),
        )
        if not raw_value:
            continue
        try:
            value = int(raw_value.strip())
        except ValueError:
            ui.render_error(f"'{raw_value}' is not a valid integer.")
            press_any_key()
            continue
        if not (NVUE_MIN_MAX_REVISIONS <= value <= NVUE_MAX_MAX_REVISIONS):
            ui.render_error(f"Value must be between {NVUE_MIN_MAX_REVISIONS} and {NVUE_MAX_MAX_REVISIONS}.")
            press_any_key()
            continue

        device_names = ", ".join(d.name for d in targets)
        console.print(
            f"\n[bold yellow]About to set NVUE_MAX_REVISIONS={value} on {len(targets)} device(s):[/bold yellow] {device_names}\n"
            "[dim]This edits /etc/default/nvued and restarts the nvued service on each device -- "
            "a brief NVUE API blip only, no impact to forwarding or existing switch config.[/dim]\n"
        )
        if not confirm("Apply now?", default=False):
            continue

        with console.status(
            f"[bold cyan]Applying and restarting nvued on {len(pairs)} device(s) "
            "(this can take up to ~15s each, running in parallel)...[/bold cyan]",
            spinner="dots",
        ):
            results = state.executor.set_max_revisions_many(pairs, value)

        ui.print_banner(f"Revision Retention — {state.current_site.name}")
        ui.render_revision_apply_results(results)
        press_any_key()


def flow_diff_examples(state: AppState):
    while True:
        ui.print_banner("Diff Examples")
        items = archive.list_saved_diffs(state.cfg["archive_dir"])
        ui.render_saved_diffs(items)
        if not items:
            press_any_key()
            return

        choices = [Choice(f"{i['label']}  ({i['device']})", value=i["id"]) for i in items]
        choices.append(Separator("─────────────"))
        choices.append(Choice("« Back", value=BACK))
        picked = select("View a saved diff:", choices, use_search_filter=True, use_jk_keys=False)
        if picked in (BACK, None):
            return

        item = next(i for i in items if i["id"] == picked)
        full = archive.get_saved_diff(state.cfg["archive_dir"], item["device"], picked)
        action = select(f"{full['label']}:", [
            Choice("View inline diff", value="inline"),
            Choice("View side-by-side diff", value="side_by_side"),
            Choice("Delete this saved diff", value="delete"),
            Choice("« Back", value=BACK),
        ])
        ui.print_banner("Diff Examples")
        if action == "inline":
            ui.render_diff_text(full["diff"], title=f"{full['device']}: {full['source_a']} vs {full['source_b']}")
            press_any_key()
        elif action == "side_by_side":
            rows = side_by_side(full.get("text_a", ""), full.get("text_b", ""))
            ui.render_side_by_side_diff(rows, title=full["label"], left_label=full["source_a"], right_label=full["source_b"])
            press_any_key()
        elif action == "delete":
            archive.delete_saved_diff(state.cfg["archive_dir"], item["device"], picked)
            console.print("[yellow]Deleted.[/yellow]")
            press_any_key()


def flow_isolation(state: AppState):
    engine = IsolationEngine(state.client, state.executor)
    while True:
        ui.print_banner("Switch Isolation & Assurance")
        with console.status("[bold cyan]Querying Netris Controller for active VPCs...[/bold cyan]", spinner="dots"):
            vpcs = engine.list_vpcs()

        if not vpcs:
            console.print("[yellow]No VPCs found on controller.[/yellow]")
            press_any_key()
            return

        ui.render_vpc_list(vpcs)
        choices = [
            Choice(f"VPC-{v['id']} ({v['name']}) — {v['server_count']} nodes", value=v["id"])
            for v in vpcs
        ]
        choices.append(Separator("─────────────"))
        choices.append(Choice("« Back", value=BACK))

        picked_vpc = select("Select target VPC to audit:", choices)
        if picked_vpc in (BACK, None):
            return

        # Stage 1: VPC Architecture & Topology
        ui.print_banner(f"VPC-{picked_vpc} — Physical Fabric Topology")
        with console.status("[bold cyan]Resolving host-to-switch physical links...[/bold cyan]", spinner="dots"):
            topo = engine.get_vpc_topology(picked_vpc)
        ui.render_isolation_topology(topo)

        step1 = select("Next action:", [
            Choice("Proceed to Stage 2: Live Switch Hardware CLI Evidence ➔", value="stage2"),
            Choice("Skip to Stage 3: Cluster Ping Verification ➔", value="stage3"),
            Choice("« Return to Isolation Menu", value="back"),
        ])
        if step1 == "back":
            continue

        if step1 == "stage2":
            # Stage 2: Hardware Table Audit
            ui.print_banner(f"VPC-{picked_vpc} — Live Hardware Evidence")
            with console.status("[bold cyan]Auditing EVPN VNI & Pure VRF hardware tables on physical switches...[/bold cyan]", spinner="dots"):
                evidence = engine.audit_hardware_tables(picked_vpc)
            ui.render_isolation_evidence(evidence)

            step2 = select("\nNext action:", [
                Choice("Proceed to Stage 3: Cluster Ping Verification ➔", value="stage3"),
                Choice("« Return to Isolation Menu", value="back"),
            ])
            if step2 == "back":
                continue

        # Stage 3: Ping Verification
        ui.print_banner(f"VPC-{picked_vpc} — Ping & Isolation Verification")
        servers = topo.get("servers", [])
        if not servers:
            console.print("[yellow]This VPC has no assigned compute nodes; ping verification skipped.[/yellow]")
            press_any_key()
            continue

        source_server = servers[0]["name"]
        ping_action = select(f"Run ping verification from {source_server}:", [
            Choice("Intra-VPC Cluster Ping (RoCEv2 East-West + North-South)", value="intra"),
            Choice("Cross-VPC Isolation Drop Test (Expect packet drop)", value="cross"),
            Choice("Custom SU / Host target...", value="custom"),
            Choice("« Return to Isolation Menu", value="back"),
        ])
        if ping_action == "back":
            continue

        target_su = 0
        target_host = 1
        if ping_action == "intra":
            if len(servers) > 1:
                parsed = parse_su_host(servers[1]["name"])
                if parsed:
                    target_su, target_host = parsed
        elif ping_action == "cross":
            target_su = 1
            target_host = 0
        elif ping_action == "custom":
            su_str = text("Target SU number (e.g. 0):", default="0")
            host_str = text("Target Host number (e.g. 1):", default="1")
            try:
                target_su = int(su_str)
                target_host = int(host_str)
            except (ValueError, TypeError):
                console.print("[red]Invalid target SU or Host.[/red]")
                press_any_key()
                continue

        with console.status(f"[bold cyan]Running cluster ping from {source_server} to SU:{target_su} Host:{target_host}...[/bold cyan]", spinner="dots"):
            try:
                ping_res = engine.run_cluster_ping(source_server, target_su, target_host)
                ui.render_ping_results(ping_res)
            except Exception as e:
                console.print(f"[bold red]Ping error:[/bold red] {e}")

        press_any_key()


def flow_settings(state: AppState):
    ui.print_banner("Settings")
    masked = dict(state.cfg)
    if masked.get("netris_password"):
        masked["netris_password"] = "*" * 8
    console.print(f"Config file: [cyan]{CONFIG_PATH}[/cyan]\n")
    for key, value in masked.items():
        console.print(f"  [white]{key}[/white]: [yellow]{value}[/yellow]")
    console.print()
    with console.status("[bold cyan]Testing jump host + Netris connectivity...[/bold cyan]"):
        jump_ok, jump_error = state.executor.test_jump_connection()
    console.print(f"Jump host ({state.cfg['ssh_jump_host']}): " + ("[green]ok[/green]" if jump_ok else f"[red]{jump_error}[/red]"))
    console.print(f"Netris ({state.cfg['netris_url']}): [green]ok[/green] (already authenticated this session)")
    press_any_key()


def main():
    ui.print_banner()
    cfg = load_config()
    if not config_is_complete(cfg):
        ui.render_error(f"No Netris password configured. Edit {CONFIG_PATH} (see config.example.json) and re-run.")
        return

    try:
        with console.status("[bold cyan]Connecting to Netris controller...[/bold cyan]", spinner="dots"):
            client = build_client(cfg)
    except InventoryError as e:
        ui.render_error(str(e))
        return

    executor = SwitchExecutor(
        jump_host=cfg["ssh_jump_host"],
        jump_port=cfg["ssh_jump_port"],
        jump_user=cfg["ssh_jump_user"],
        switch_user=cfg["ssh_switch_user"],
    )
    state = AppState(cfg, client, executor)

    try:
        while True:
            ui.print_banner(state.current_site.name if state.current_site else None)
            choices = [
                Choice("Pick a site" + (f"  (current: {state.current_site.name})" if state.current_site else ""), value="site"),
            ]
            if state.current_site:
                choices += [
                    Choice("Explore / run show commands", value="explore"),
                    Choice("Compare two devices", value="compare"),
                    Choice("Config history & snapshots", value="history"),
                    Choice("Diff Examples (saved diffs)", value="diff_examples"),
                    Choice("Watch mode (live config monitor & diff reviewer)", value="watch"),
                    Choice("Adjust revision retention (NVUE_MAX_REVISIONS)", value="retention"),
                    Choice("Switch isolation & assurance", value="isolation"),
                ]
            choices += [
                Separator("─────────────"),
                Choice("Settings / connectivity test", value="settings"),
                Choice("Exit", value=EXIT),
            ]
            choice = select("Main menu:", choices)

            if choice in (EXIT, None, BACK):
                break
            if choice == "site":
                site = pick_site(state)
                if site:
                    state.current_site = site
                    state.site_devices = state.devices_for_site(site.id)
                continue
            if not state.current_site:
                continue
            if choice == "explore":
                flow_explore(state)
            elif choice == "compare":
                flow_compare(state)
            elif choice == "history":
                flow_history(state)
            elif choice == "diff_examples":
                flow_diff_examples(state)
            elif choice == "watch":
                flow_watch(state)
            elif choice == "retention":
                flow_revision_settings(state)
            elif choice == "isolation":
                flow_isolation(state)
            elif choice == "settings":
                flow_settings(state)
    except (KeyboardInterrupt, EOFError):
        pass
    finally:
        executor.close()
        console.print("\n[dim]Goodbye.[/dim]")


if __name__ == "__main__":
    main()
