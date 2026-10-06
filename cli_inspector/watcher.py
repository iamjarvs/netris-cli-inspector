"""Watcher daemon and standalone CLI entry point.
Continuously monitors Netris Controller API writes and switch fabric configs,
identifies affected devices, and reviews per-device new/removed configuration.
"""

from __future__ import annotations

import argparse
import sys
from typing import Optional

from .config import load_config
from .executor import SwitchExecutor
from .inventory import build_client, list_all_switches, list_sites
from .watch_mode import WatchEngine


def _resolve_devices(client, executor, site_filter: Optional[str] = None):
    devices = [d for d in list_all_switches(client) if d.mgmt_address]
    sites = list_sites(client)
    site_map = {s.name.lower(): s.id for s in sites}

    if site_filter:
        target_id = site_map.get(site_filter.lower())
        if target_id is not None:
            devices = [d for d in devices if d.site_id == target_id]
        else:
            devices = [d for d in devices if site_filter.lower() in d.site_name.lower()]

    # Filter to sites with hardware
    reachable_site_ids = {s.id for s in sites if s.has_hardware}
    return [d for d in devices if d.site_id in reachable_site_ids]


def run(
    site_name: Optional[str] = None,
    poll_interval: int = 10,
    interactive: bool = True,
):
    cfg = load_config()
    client = build_client(cfg)
    executor = SwitchExecutor(
        cfg["ssh_jump_host"],
        cfg["ssh_jump_port"],
        cfg["ssh_jump_user"],
        cfg["ssh_switch_user"],
    )

    try:
        devices = _resolve_devices(client, executor, site_filter=site_name)
        if not devices:
            print(f"[watcher] No reachable devices found" + (f" for site '{site_name}'" if site_name else ""))
            return

        engine = WatchEngine(
            cfg=cfg,
            client=client,
            executor=executor,
            site_name=site_name or (devices[0].site_name if devices else "Fabric"),
            devices=devices,
            poll_interval=poll_interval,
            interactive=interactive,
        )
        engine.run()
    finally:
        executor.close()


def main():
    parser = argparse.ArgumentParser(
        description="Monitor switch configurations live for changes and review diffs per device."
    )
    parser.add_argument("--site", type=str, default=None, help="Filter to a specific Netris site (e.g. Datacenter-A)")
    parser.add_argument("--poll", type=int, default=10, help="Polling interval in seconds (default: 10)")
    parser.add_argument(
        "--daemon",
        action="store_true",
        help="Run continuously in non-interactive streaming mode (no prompts on detected diffs)",
    )
    args = parser.parse_args()

    is_interactive = not args.daemon and sys.stdin.isatty()
    run(site_name=args.site, poll_interval=args.poll, interactive=is_interactive)


if __name__ == "__main__":
    main()
