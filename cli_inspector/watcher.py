"""Long-running watcher: polls Netris /api/apilogs for config-relevant write
calls and snapshots the archive once activity goes quiet for a few minutes --
collapsing a whole burst of related NVUE revisions (confirmed live to span
up to ~16 minutes for one logical change) into a single, meaningful archive
commit per device. A periodic safety-net snapshot runs regardless, covering
anything that bypasses the Netris API entirely (e.g. a manual CLI change).

Run standalone: `.venv/bin/python watch.py` (or `-m cli_inspector.watcher`).
Not part of the interactive menu -- meant to be left running in its own
terminal or as a systemd unit, alongside menu.py's on-demand snapshots.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from . import archive
from .config import load_config
from .executor import SwitchExecutor
from .inventory import build_client, get_relevant_write_logs, list_all_switches, list_sites
from .menu import probe_site_reachable

POLL_INTERVAL = 15
QUIET_PERIOD = 180
SAFETY_NET_INTERVAL = 1800


def _reachable_devices(client, executor):
    devices = [d for d in list_all_switches(client) if d.mgmt_address]
    sites = list_sites(client)
    reachable_site_ids = set()
    for site in sites:
        site_devices = [d for d in devices if d.site_id == site.id]
        if site_devices and probe_site_reachable(executor, site_devices):
            reachable_site_ids.add(site.id)
    return [d for d in devices if d.site_id in reachable_site_ids]


def run(
    poll_interval: int = POLL_INTERVAL,
    quiet_period: int = QUIET_PERIOD,
    safety_net_interval: int = SAFETY_NET_INTERVAL,
):
    cfg = load_config()
    client = build_client(cfg)
    executor = SwitchExecutor(
        cfg["ssh_jump_host"], cfg["ssh_jump_port"], cfg["ssh_jump_user"], cfg["ssh_switch_user"]
    )
    archive.ensure_archive_repo(cfg["archive_dir"])

    print(f"[watcher] starting -- poll={poll_interval}s quiet={quiet_period}s safety_net={safety_net_interval}s")
    devices = _reachable_devices(client, executor)
    print(f"[watcher] watching {len(devices)} reachable device(s)")
    if not devices:
        print("[watcher] no reachable devices found, exiting")
        return

    pairs = [(d.name, d.mgmt_address) for d in devices]
    last_poll_epoch = int(time.time())
    dirty_since: float | None = None
    last_snapshot = time.time()

    def do_snapshot(trigger: str):
        nonlocal last_snapshot
        print(f"[watcher] snapshotting {len(pairs)} device(s), trigger={trigger}")
        results = executor.get_full_config_commands_many(pairs)
        configs = {name: r.stdout for name, r in results.items() if r.ok}
        failed = [name for name, r in results.items() if not r.ok]
        meta = {"timestamp": datetime.now(timezone.utc).isoformat(), "trigger": trigger}
        snap_results = archive.snapshot_many(cfg["archive_dir"], configs, meta)
        changed = sum(1 for v in snap_results.values() if v)
        print(f"[watcher] snapshot done: {changed} changed, {len(snap_results) - changed} unchanged"
              + (f", {len(failed)} failed to fetch" if failed else ""))
        last_snapshot = time.time()

    try:
        while True:
            time.sleep(poll_interval)
            now_epoch = int(time.time())
            try:
                logs = get_relevant_write_logs(client, last_poll_epoch, now_epoch)
            except Exception as e:
                print(f"[watcher] apilogs poll failed: {e}")
                logs = []
            last_poll_epoch = now_epoch

            if logs:
                print(f"[watcher] {len(logs)} relevant write call(s) detected, resetting quiet timer")
                dirty_since = time.time()

            if dirty_since is not None and (time.time() - dirty_since) >= quiet_period:
                do_snapshot("watcher")
                dirty_since = None

            if time.time() - last_snapshot >= safety_net_interval:
                do_snapshot("periodic-safety-net")
    except KeyboardInterrupt:
        print("\n[watcher] stopping.")
    finally:
        executor.close()


if __name__ == "__main__":
    run()
