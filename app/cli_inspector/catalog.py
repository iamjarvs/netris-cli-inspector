"""Curated, hand-verified command catalog. Every entry here was actually run
against a real Cumulus switch before being added -- see PLAN.md for the
sweep. Two kinds:

- "config": the device's configured intent. Rendered as a collapsible,
  quote-stripped JSON tree (nv config show has no per-area scoping flag, so
  "individual areas" means folding sections of the one fetched tree, not
  separate commands).
- "show": live operational state. Always uses NVUE's default `-o auto`
  table format (never `-o json` -- confirmed live that `-o json` outright
  fails on composite categories like `router` with "Showing 'operational' is
  not supported for this resource", while `-o auto` works everywhere and is
  the human-readable format NVUE itself defaults to). A few entries go
  straight to vtysh for operational detail NVUE's own tree doesn't expose at
  all (BGP per-neighbor session state, the kernel routing table).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class CatalogEntry:
    id: str
    label: str
    kind: str  # "config" | "show"
    command: str
    source: str  # "nv" | "vtysh"


CONFIG_COMMANDS: list[CatalogEntry] = [
    CatalogEntry("full-config", "Full configuration", "config", "nv config show -o json", "nv"),
]

SHOW_COMMANDS: list[CatalogEntry] = [
    CatalogEntry("nv-system", "System", "show", "nv show system", "nv"),
    CatalogEntry("nv-interface", "Interfaces", "show", "nv show interface", "nv"),
    CatalogEntry("nv-acl", "ACLs", "show", "nv show acl", "nv"),
    CatalogEntry("nv-bridge", "Bridge", "show", "nv show bridge", "nv"),
    CatalogEntry("nv-evpn", "EVPN (global)", "show", "nv show evpn", "nv"),
    CatalogEntry("nv-evpn-vni", "EVPN VNIs", "show", "nv show evpn vni", "nv"),
    CatalogEntry("nv-mlag", "MLAG", "show", "nv show mlag", "nv"),
    CatalogEntry("nv-nve", "NVE / VXLAN tunnels", "show", "nv show nve", "nv"),
    CatalogEntry("nv-platform", "Platform / hardware", "show", "nv show platform", "nv"),
    CatalogEntry("nv-qos", "QoS", "show", "nv show qos", "nv"),
    CatalogEntry("nv-router", "Router (global)", "show", "nv show router", "nv"),
    CatalogEntry("nv-router-bgp", "BGP (global settings)", "show", "nv show router bgp", "nv"),
    CatalogEntry("nv-service", "Services", "show", "nv show service", "nv"),
    CatalogEntry("nv-vrf", "VRFs", "show", "nv show vrf", "nv"),
    CatalogEntry("vtysh-bgp-summary", "BGP sessions (summary)", "show", "sudo vtysh -c 'show bgp summary'", "vtysh"),
    CatalogEntry("vtysh-ip-route", "IP routing table", "show", "sudo vtysh -c 'show ip route'", "vtysh"),
    CatalogEntry("vtysh-evpn-vni", "EVPN VNI table (vtysh)", "show", "sudo vtysh -c 'show evpn vni'", "vtysh"),
    CatalogEntry("vtysh-interface-brief", "Interfaces (brief, vtysh)", "show", "sudo vtysh -c 'show interface brief'", "vtysh"),
]

ALL_COMMANDS = CONFIG_COMMANDS + SHOW_COMMANDS


def find(entry_id: str) -> CatalogEntry | None:
    return next((c for c in ALL_COMMANDS if c.id == entry_id), None)
