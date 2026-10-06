#!/usr/bin/env python3
"""Comprehensive test for the Watch Mode feature in cli-inspector."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cli_inspector.diff_utils import parse_config_changes
from cli_inspector.inventory import summarize_api_log
from cli_inspector import ui

OLD_CONFIG = """\
nv set interface eth0 ip address 10.0.0.1/24
nv set interface eth1 ip address 10.0.1.1/24
nv set router bgp 65000 vrf Vrf_72
nv set system hostname leaf-pod00-su0-r0
nv set vrf Vrf_72 vni 10072
"""

NEW_CONFIG = """\
nv set interface eth0 ip address 10.0.0.1/24
nv set interface eth1 ip address 10.0.1.99/24
nv set router bgp 65000 vrf Vrf_73
nv set system hostname leaf-pod00-su0-r0
nv set vrf Vrf_73 vni 10073
nv set interface swp1 vrf Vrf_73
"""


def test_diff_parsing():
    print("--- 1. Testing parse_config_changes ---")
    res = parse_config_changes("leaf-pod00-su0-r0", OLD_CONFIG, NEW_CONFIG)
    assert res.is_changed is True, "Expected changes detected"
    print(f"Summary: {res.summary}")

    print("Added lines (new config):")
    for l in res.added_lines:
        print(f"  + {l}")
    print("Removed lines (removed config):")
    for l in res.removed_lines:
        print(f"  - {l}")

    assert "nv set vrf Vrf_73 vni 10073" in res.added_lines
    assert "nv set interface swp1 vrf Vrf_73" in res.added_lines
    assert "nv set vrf Vrf_72 vni 10072" in res.removed_lines
    assert "nv set router bgp 65000 vrf Vrf_72" in res.removed_lines
    print("✔ Diff parsing assertions passed.\n")


def test_api_log_summarizer():
    print("--- 2. Testing summarize_api_log ---")
    log_sample = {
        "id": "abc12345",
        "createdAt": "2026-09-24T08:15:30Z",
        "user": "netris",
        "method": "POST",
        "url": "/api/v2/vnet",
        "body": '{"name": "ai-fabric-frontend", "vpc": {"name": "vpc-meridian"}, "site": {"id": 8}}',
    }
    summary = summarize_api_log(log_sample)
    print("Parsed summary:", summary["summary"])
    assert summary["resource_type"] == "V-Net"
    assert summary["resource_name"] == "ai-fabric-frontend"
    assert summary["vpc_name"] == "vpc-meridian"
    assert summary["site_id"] == 8
    print("✔ API log summarizer assertions passed.\n")


def test_ui_renderers():
    print("--- 3. Testing UI Renderers ---")
    diff_res = parse_config_changes("leaf-pod00-su0-r0", OLD_CONFIG, NEW_CONFIG)
    ev = summarize_api_log({
        "createdAt": "2026-09-24T08:15:30Z",
        "user": "netris",
        "method": "POST",
        "url": "/api/v2/vnet",
        "body": '{"name": "ai-fabric-frontend", "vpc": {"name": "vpc-meridian"}}',
    })

    ui.render_watch_header("Datacenter-A", 18, 10)
    ui.render_product_event_alert(ev)
    ui.render_affected_devices_summary(["leaf-pod00-su0-r0", "leaf-pod00-su0-r1"], ["spine-0-pod00", "spine-1-pod00"])
    ui.render_device_config_diff(diff_res, role="leaf", trigger=ev["summary"])
    print("✔ UI Renderers executed without error.\n")


if __name__ == "__main__":
    test_diff_parsing()
    test_api_log_summarizer()
    test_ui_renderers()
    print("ALL TESTS PASSED SUCCESSFULLY.")
