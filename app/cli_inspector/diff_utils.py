"""Shared rendering helpers used by both the CLI and the web backend:
a quote-stripped "relaxed JSON" pretty-printer (Junos-set-config style --
structure without the quote-mark clutter) and a side-by-side diff row
builder, as an alternative to a plain unified diff.
"""

from __future__ import annotations

import difflib
import re
from typing import Any

_SSH_NOISE_PATTERNS = [
    re.compile(r"^Warning: Permanently added .* to the list of known hosts\.?$"),
    re.compile(r"^Welcome to NVIDIA Cumulus \(R\) Linux \(R\)$"),
]


def clean_error_text(raw: str) -> str:
    """Strips the SSH connection banner (host-key warning + Cumulus MOTD --
    both land in stderr on every single nested-SSH call since we use
    UserKnownHostsFile=/dev/null, so they show up on every error too) so the
    actual nv/vtysh error message is what the user sees, not noise glued to
    the front of it. Falls back to the raw text if cleaning would empty it.
    """
    if not raw:
        return raw
    lines = [line for line in raw.splitlines() if not any(p.match(line.strip()) for p in _SSH_NOISE_PATTERNS)]
    cleaned = "\n".join(line for line in lines if line.strip()).strip() or raw.strip()
    if "Unknown revision" in cleaned:
        cleaned += (
            "\n\nThis revision is no longer resident on the switch -- NVUE prunes its own "
            "revision history over time, even though `nv config history` keeps listing it. "
            "Only the git archive keeps long-term history; check the archive snapshot list "
            "for this device instead."
        )
    return cleaned


def _needs_quotes(s: str) -> bool:
    return s == "" or any(c in s for c in ':{}[],"\n') or s.strip() != s


def _scalar(value: Any) -> str:
    if isinstance(value, str):
        return f'"{value}"' if _needs_quotes(value) else value
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    return str(value)


def dumps_relaxed(obj: Any, indent: int = 0) -> str:
    pad = "  " * indent
    inner_pad = "  " * (indent + 1)

    if isinstance(obj, dict):
        if not obj:
            return "{}"
        lines = ["{"]
        for key, value in obj.items():
            key_str = key if not _needs_quotes(str(key)) else f'"{key}"'
            lines.append(f"{inner_pad}{key_str}: {dumps_relaxed(value, indent + 1)}")
        lines.append(f"{pad}}}")
        return "\n".join(lines)

    if isinstance(obj, list):
        if not obj:
            return "[]"
        lines = ["["]
        for value in obj:
            lines.append(f"{inner_pad}{dumps_relaxed(value, indent + 1)}")
        lines.append(f"{pad}]")
        return "\n".join(lines)

    return _scalar(obj)


def side_by_side(text_a: str, text_b: str) -> list[dict]:
    lines_a = text_a.splitlines()
    lines_b = text_b.splitlines()
    matcher = difflib.SequenceMatcher(None, lines_a, lines_b)
    rows = []
    for op, a1, a2, b1, b2 in matcher.get_opcodes():
        left_chunk = lines_a[a1:a2]
        right_chunk = lines_b[b1:b2]
        if op == "equal":
            for left, right in zip(left_chunk, right_chunk):
                rows.append({"type": "equal", "left": left, "right": right})
        elif op == "replace":
            for i in range(max(len(left_chunk), len(right_chunk))):
                rows.append({
                    "type": "replace",
                    "left": left_chunk[i] if i < len(left_chunk) else None,
                    "right": right_chunk[i] if i < len(right_chunk) else None,
                })
        elif op == "delete":
            for left in left_chunk:
                rows.append({"type": "delete", "left": left, "right": None})
        elif op == "insert":
            for right in right_chunk:
                rows.append({"type": "insert", "left": None, "right": right})
    return rows


def unified_diff(text_a: str, text_b: str, name_a: str = "a", name_b: str = "b") -> str:
    lines = difflib.unified_diff(
        text_a.splitlines(), text_b.splitlines(), fromfile=name_a, tofile=name_b, lineterm=""
    )
    return "\n".join(lines)


from dataclasses import dataclass, field


@dataclass
class DeviceDiffResult:
    device: str
    added_lines: list[str] = field(default_factory=list)
    removed_lines: list[str] = field(default_factory=list)
    raw_diff: str = ""
    is_changed: bool = False

    @property
    def summary(self) -> str:
        if not self.is_changed:
            return "No changes"
        return f"+{len(self.added_lines)} added / -{len(self.removed_lines)} removed"


def parse_config_changes(
    device: str, old_text: str, new_text: str, name_old: str = "previous", name_new: str = "current"
) -> DeviceDiffResult:
    """Analyzes differences between two switch configs (commands format) and returns
    structured added and removed lines along with the raw unified diff.
    """
    diff_text = unified_diff(old_text, new_text, name_a=name_old, name_b=name_new)
    if not diff_text.strip():
        return DeviceDiffResult(device=device, is_changed=False)

    added = []
    removed = []
    for line in diff_text.splitlines():
        if line.startswith("+++") or line.startswith("---") or line.startswith("@@"):
            continue
        if line.startswith("+"):
            added.append(line[1:].strip())
        elif line.startswith("-"):
            removed.append(line[1:].strip())

    is_changed = bool(added or removed)
    return DeviceDiffResult(
        device=device,
        added_lines=added,
        removed_lines=removed,
        raw_diff=diff_text,
        is_changed=is_changed,
    )


def parse_device_context(config_text: str) -> dict:
    """Extracts device network topology context from NVUE configuration commands:
    - Default VRF loopback IP (interface lo)
    - BGP router-id and ASN
    - List of VRFs with loopback IPs, VNIs, VLANs, and active service bindings (e.g. DHCP relay)
    - Bidirectional VLAN <-> VRF mapping
    """
    if not config_text:
        return {
            "default_loopback": "",
            "router_id": "",
            "asn": "",
            "vrfs": [],
            "vlan_to_vrf": {},
        }

    # Default VRF Loopback IP
    default_lo = ""
    m_lo = re.search(r"^nv set interface lo ipv4 address (\S+)", config_text, re.M)
    if m_lo:
        default_lo = m_lo.group(1)

    # BGP Router-ID & ASN
    router_id = ""
    asn = ""
    m_rid = re.search(r"^nv set vrf default router bgp router-id (\S+)", config_text, re.M)
    if m_rid:
        router_id = m_rid.group(1)
    m_asn = re.search(r"^nv set (?:vrf default )?router bgp autonomous-system (\S+)", config_text, re.M)
    if m_asn:
        asn = m_asn.group(1)

    # Extract all VRF names (excluding default)
    vrf_names = set(re.findall(r"^nv set vrf (Vrf_\w+)", config_text, re.M))
    vrfs: dict[str, dict] = {}
    for v in sorted(vrf_names):
        vrfs[v] = {
            "name": v,
            "loopback": "",
            "vni": "",
            "vlans": [],
            "services": [],
        }
        m_vlo = re.search(rf"^nv set vrf {v} loopback ip address (\S+)", config_text, re.M)
        if m_vlo:
            vrfs[v]["loopback"] = m_vlo.group(1)
        m_vni = re.search(rf"^nv set vrf {v} evpn vni (\S+)", config_text, re.M)
        if m_vni:
            vrfs[v]["vni"] = m_vni.group(1)

    # Map VLAN IP addresses (handling lists e.g. nv set interface vlan2,4,6,8,11 ipv4 address 192.168.7.254/21)
    vlan_ips: dict[str, str] = {}
    for m in re.finditer(r"^nv set interface (\S+) ipv4 address (\S+)", config_text, re.M):
        intfs_str, ip = m.group(1), m.group(2)
        prefix = "vlan" if intfs_str.startswith("vlan") else ""
        for p in intfs_str.split(","):
            p = p.strip()
            if p.startswith("vlan"):
                vlan_ips[p] = ip
            elif p.isdigit() and prefix:
                vlan_ips[f"{prefix}{p}"] = ip

    # Extract VLAN to VRF bindings and services
    vlan_to_vrf: dict[str, str] = {}
    for line in config_text.splitlines():
        # nv set interface vlan6 vrf Vrf_101
        m_vlan = re.match(r"^nv set interface (vlan\d+) vrf (Vrf_\w+)", line)
        if m_vlan:
            vlan_name, vrf_name = m_vlan.group(1), m_vlan.group(2)
            vlan_to_vrf[vlan_name] = vrf_name
            if vrf_name in vrfs:
                ip = vlan_ips.get(vlan_name, "")
                vrfs[vrf_name]["vlans"].append({"vlan": vlan_name, "ip": ip})

        # DHCP relay
        m_dhcp = re.match(r"^nv set service dhcp-relay (Vrf_\w+) server-group \S+ server (\S+)", line)
        if m_dhcp:
            vrf_name, srv = m_dhcp.group(1), m_dhcp.group(2)
            if vrf_name in vrfs:
                m_down = re.search(rf"^nv set service dhcp-relay {vrf_name} downstream-interface (\S+)", config_text, re.M)
                down_if = m_down.group(1) if m_down else ""
                vrfs[vrf_name]["services"].append({
                    "type": "DHCP Relay",
                    "server": srv,
                    "downstream": down_if,
                })

    return {
        "default_loopback": default_lo,
        "router_id": router_id,
        "asn": asn,
        "vrfs": list(vrfs.values()),
        "vlan_to_vrf": vlan_to_vrf,
    }

