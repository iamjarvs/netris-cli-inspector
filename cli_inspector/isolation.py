"""
Netris Switch & Fabric Isolation Engine for CLI Inspector.
Provides multi-tenancy verification, physical switch hardware evidence (EVPN VNI & VRF routes),
and intra/cross-VPC ping validation across NVIDIA Cumulus switches and HGX compute nodes.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from .executor import SwitchExecutor
from .netris_client import NetrisClient

_ALIAS_RE = re.compile(r"alias (hgx-\S+)='ssh .*?root@([0-9.]+)'")
_SU_HOST_RE = re.compile(r"su(\d+)-h(\d+)")


def parse_su_host(server_name: str) -> Optional[Tuple[int, int]]:
    """Extracts (su, host) integer tuple from server name e.g. hgx-pod00-su0-h03 -> (0, 3)."""
    m = _SU_HOST_RE.search(server_name)
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


class IsolationEngine:
    def __init__(
        self,
        client: NetrisClient,
        executor: SwitchExecutor,
        ns_switch_name: str = "ns-leaf-0",
        ns_switch_ip: str = "10.3.0.1",
        ew_switch_name: str = "leaf-pod00-su0-r0",
        ew_switch_ip: str = "10.253.0.1",
    ):
        self.client = client
        self.executor = executor
        self.ns_switch_name = ns_switch_name
        self.ns_switch_ip = ns_switch_ip
        self.ew_switch_name = ew_switch_name
        self.ew_switch_ip = ew_switch_ip
        self._server_aliases: Dict[str, str] = {}

    # ------------------------------------------------------------------
    # 1. Netris Controller VPC & Topology Discovery
    # ------------------------------------------------------------------

    def list_vpcs(self) -> List[Dict[str, Any]]:
        """Returns all active VPCs enriched with clusters, member servers, and tenant info."""
        raw_vpcs = self.client.get("/api/v2/vpc").get("data", [])
        raw_clusters = self.client.get("/api/v2/server-cluster").get("data", [])

        clusters_by_vpc: Dict[int, List[Dict[str, Any]]] = {}
        for c in raw_clusters:
            cVpc = c.get("vpc") or {}
            vid = cVpc.get("id")
            if vid is not None:
                clusters_by_vpc.setdefault(vid, []).append(c)

        result: List[Dict[str, Any]] = []
        for v in raw_vpcs:
            vid = v["id"]
            matched_clusters = clusters_by_vpc.get(vid, [])
            servers: List[Dict[str, Any]] = []
            for cl in matched_clusters:
                servers.extend(cl.get("servers", []))

            tenant_name = (v.get("tenant") or {}).get("name") if isinstance(v.get("tenant"), dict) else None

            result.append({
                "id": vid,
                "name": v.get("name", f"VPC-{vid}"),
                "tenant": tenant_name,
                "server_count": len(servers),
                "servers": servers,
                "clusters": [{"id": c.get("id"), "name": c.get("name")} for c in matched_clusters],
            })

        return sorted(result, key=lambda x: x["id"])

    def get_vpc_topology(self, vpc_id: int) -> Dict[str, Any]:
        """
        Retrieves VPC metadata, associated servers, V-Nets, and physical switch port links.
        """
        raw_clusters = self.client.get("/api/v2/server-cluster").get("data", [])
        matched_cluster = next((c for c in raw_clusters if (c.get("vpc") or {}).get("id") == vpc_id), None)

        raw_vnets = self.client.get("/api/v2/vnet").get("data", [])
        vpc_vnets = [v for v in raw_vnets if (v.get("vpc") or {}).get("id") == vpc_id]

        servers = matched_cluster.get("servers", []) if matched_cluster else []
        server_names = [s["name"] for s in servers]

        raw_links = self.client.get("/api/v2/link").get("data", [])
        links_map: Dict[str, List[Dict[str, Any]]] = {s: [] for s in server_names}
        server_set = set(server_names)

        for l in raw_links:
            local = l.get("local", {})
            remote = l.get("remote", {})
            local_hw = local.get("hardware", {})
            remote_hw = remote.get("hardware", {})

            if remote_hw.get("name") in server_set and local_hw.get("type") == "switch":
                sname = remote_hw.get("name")
                sw_name = local_hw.get("name", "switch")
                sw_port = local.get("port", "")
                host_port = remote.get("port", "")
                ip = local.get("ipv4", "")
                role = "East-West (RoCE/GPU)" if "leaf-pod" in sw_name or "spine" in sw_name else "North-South"
                links_map[sname].append({
                    "switch_name": sw_name,
                    "switch_port": sw_port,
                    "host_port": host_port,
                    "ipv4": ip,
                    "fabric_role": role,
                })
            elif local_hw.get("name") in server_set and remote_hw.get("type") == "switch":
                sname = local_hw.get("name")
                sw_name = remote_hw.get("name", "switch")
                sw_port = remote.get("port", "")
                host_port = local.get("port", "")
                ip = remote.get("ipv4", "")
                role = "East-West (RoCE/GPU)" if "leaf-pod" in sw_name or "spine" in sw_name else "North-South"
                links_map[sname].append({
                    "switch_name": sw_name,
                    "switch_port": sw_port,
                    "host_port": host_port,
                    "ipv4": ip,
                    "fabric_role": role,
                })

        return {
            "vpc_id": vpc_id,
            "cluster_name": matched_cluster.get("name") if matched_cluster else None,
            "servers": servers,
            "vnets": [{"id": v.get("id"), "name": v.get("name"), "state": v.get("state")} for v in vpc_vnets],
            "server_links": links_map,
        }

    # ------------------------------------------------------------------
    # 2. Live Switch Hardware Evidence (EVPN VNI & Pure VRF FIB)
    # ------------------------------------------------------------------

    def audit_hardware_tables(self, vpc_id: int) -> Dict[str, Any]:
        """
        Executes live switch inspection:
        - North-South switch (ns-leaf-0): EVPN VNI & VRF tables via vtysh.
        - East-West switch (leaf-pod00-su0-r0): VRF routing table via vtysh.
        Tags matching tenant rows vs other tenants.
        """
        target_vrf = f"Vrf_{vpc_id}"

        # 1. Query North-South leaf for EVPN VNIs
        vni_cmd = "sudo vtysh -c 'show evpn vni'"
        vrf_cmd = "sudo vtysh -c 'show vrf'"
        res_vni = self.executor.exec_on_device(self.ns_switch_name, self.ns_switch_ip, vni_cmd)
        res_vrf = self.executor.exec_on_device(self.ns_switch_name, self.ns_switch_ip, vrf_cmd)

        vni_rows: List[Dict[str, Any]] = []
        if res_vni.ok:
            for line in res_vni.stdout.splitlines():
                line_s = line.strip()
                if not line_s or line_s.startswith("VNI") or line_s.startswith("-"):
                    continue
                parts = line_s.split()
                if len(parts) >= 6 and parts[0].isdigit():
                    vni_num = parts[0]
                    vni_type = parts[1]
                    vxlan_if = parts[2]
                    tenant_vrf = "unknown"
                    vlan = ""
                    for idx, p in enumerate(parts):
                        if p.startswith("Vrf_") or p == "default":
                            tenant_vrf = p
                            if idx + 1 < len(parts):
                                vlan = parts[idx + 1]
                            break
                    is_target = (tenant_vrf == target_vrf)
                    vni_rows.append({
                        "vni": vni_num,
                        "type": vni_type,
                        "interface": vxlan_if,
                        "tenant_vrf": tenant_vrf,
                        "vlan": vlan,
                        "is_target_vpc": is_target,
                    })

        # 2. Query East-West leaf for VRF routing table
        ew_vrf_cmd = f"sudo vtysh -c 'show ip route vrf {target_vrf}'"
        ew_global_cmd = "sudo vtysh -c 'show ip route'"
        res_ew_vrf = self.executor.exec_on_device(self.ew_switch_name, self.ew_switch_ip, ew_vrf_cmd)
        res_ew_global = self.executor.exec_on_device(self.ew_switch_name, self.ew_switch_ip, ew_global_cmd)

        route_rows: List[Dict[str, Any]] = []
        if res_ew_vrf.ok:
            for line in res_ew_vrf.stdout.splitlines():
                line_s = line.strip()
                if not line_s or line_s.startswith("Codes:") or line_s.startswith("Gateway"):
                    continue
                parts = line_s.split()
                if len(parts) >= 2 and ("." in parts[1] or "/" in parts[1]):
                    code = parts[0]
                    prefix = parts[1]
                    via = ""
                    if "via" in parts:
                        via_idx = parts.index("via")
                        if via_idx + 1 < len(parts):
                            via = parts[via_idx + 1]
                    route_rows.append({
                        "code": code,
                        "prefix": prefix,
                        "via": via,
                        "vrf": target_vrf,
                        "is_target_vpc": True,
                    })

        return {
            "vpc_id": vpc_id,
            "target_vrf": target_vrf,
            "ns_switch": {
                "name": self.ns_switch_name,
                "ip": self.ns_switch_ip,
                "vnis": vni_rows,
                "raw_vni": res_vni.stdout,
                "raw_vrf": res_vrf.stdout,
                "ok": res_vni.ok,
            },
            "ew_switch": {
                "name": self.ew_switch_name,
                "ip": self.ew_switch_ip,
                "routes": route_rows,
                "raw_vrf_routes": res_ew_vrf.stdout,
                "raw_global_routes": res_ew_global.stdout,
                "ok": res_ew_vrf.ok,
            },
        }

    # ------------------------------------------------------------------
    # 3. Host Fleet Aliases & Ping Matrix
    # ------------------------------------------------------------------

    def get_server_aliases(self) -> Dict[str, str]:
        """Resolves bash aliases for bare-metal HGX servers from the jump host."""
        if self._server_aliases:
            return self._server_aliases

        res = self.executor.exec_on_jump("grep -E '^alias hgx' ~/.cloudsim_aliases ~/.bashrc 2>/dev/null")
        mapping = {}
        for line in res.stdout.splitlines():
            m = _ALIAS_RE.search(line)
            if m:
                mapping[m.group(1)] = m.group(2)

        self._server_aliases = mapping
        return mapping

    def run_cluster_ping(
        self,
        source_server_name: str,
        target_su: int,
        target_host: int,
        timeout: int = 15,
    ) -> Dict[str, Any]:
        """
        Runs `./cluster-ping.sh <target_su> <target_host>` on source_server via jump host.
        Returns parsed results for 8 RoCEv2 rails, North-South bond0, and IPMI.
        """
        aliases = self.get_server_aliases()
        source_ip = aliases.get(source_server_name)
        if not source_ip:
            raise RuntimeError(f"No IP alias found for server {source_server_name} on jump host.")

        cmd = (
            f"ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "
            f"-o BatchMode=yes -o ConnectTimeout=10 root@{source_ip} "
            f"\"./cluster-ping.sh {target_su} {target_host}\""
        )
        res = self.executor.exec_on_jump(cmd, timeout=timeout)

        ew_rails: List[Dict[str, Any]] = []
        ns_status = "UNKNOWN"
        ns_ip = ""
        ipmi_status = "UNKNOWN"
        ipmi_ip = ""

        current_section = None
        for line in res.stdout.splitlines():
            line_s = line.strip()
            if "East-West Fabric" in line_s:
                current_section = "ew"
            elif "North-South Fabric" in line_s:
                current_section = "ns"
            elif "IPMI/BMC" in line_s:
                current_section = "ipmi"
            elif line_s.startswith("ping "):
                m = re.match(r"ping\s+(\S+)\s+\(([^)]+)\)\s*:\s*(\S+)", line_s)
                if m:
                    target_name, ip, status = m.group(1), m.group(2), m.group(3)
                    if current_section == "ew":
                        ew_rails.append({"rail": target_name, "ip": ip, "status": status})
                    elif current_section == "ns":
                        ns_status = status
                        ns_ip = ip
                    elif current_section == "ipmi":
                        ipmi_status = status
                        ipmi_ip = ip

        all_ew_ok = len(ew_rails) > 0 and all(r["status"] == "OK" for r in ew_rails)

        return {
            "source": source_server_name,
            "target": f"su{target_su}-h{target_host:02d}",
            "target_su": target_su,
            "target_host": target_host,
            "ok": res.ok,
            "ew_rails": ew_rails,
            "all_ew_ok": all_ew_ok,
            "ns_bond": {"status": ns_status, "ip": ns_ip},
            "ipmi": {"status": ipmi_status, "ip": ipmi_ip},
            "raw_output": res.stdout,
            "raw_error": res.stderr if not res.ok else None,
        }
