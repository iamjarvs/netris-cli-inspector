#!/usr/bin/env python3
"""Standalone smoke test for cli_inspector.inventory against a live Netris controller."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cli_inspector.config import load_config
from cli_inspector.inventory import (
    InventoryError,
    build_client,
    get_relevant_write_logs,
    group_by_role,
    list_all_switches,
    list_sites,
)


def main() -> int:
    cfg = load_config()
    try:
        client = build_client(cfg)
    except InventoryError as exc:
        print(f"FAILED to build client: {exc}")
        return 1

    print(f"Connected to {cfg['netris_url']} as {cfg['netris_username']}\n")

    print("=== Sites ===")
    sites = list_sites(client)
    for site in sites:
        print(f"  {site.name} (id={site.id}) has_hardware={site.has_hardware}")

    print("\n=== Switches by role ===")
    devices = list_all_switches(client)
    grouped = group_by_role(devices)
    for role, group in sorted(grouped.items()):
        print(f"-- {role} ({len(group)}) --")
        for d in group:
            print(f"  {d.name:24s} site={d.site_name:16s} mgmt={d.mgmt_address:16s} status={d.status}")

    print(f"\nTotal switches: {len(devices)}")

    print("\n=== Recent write logs (last 24h) ===")
    since = int(time.time()) - 24 * 3600
    logs = get_relevant_write_logs(client, since)
    print(f"Count: {len(logs)}")
    for entry in logs[:5]:
        print(f"  {entry.get('createdAt')} {entry.get('method'):6s} {entry.get('url')} user={entry.get('user')}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
