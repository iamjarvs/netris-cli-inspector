"""Netris device/site inventory built on top of netris_client.NetrisClient."""
from __future__ import annotations

import time
import json as jsonlib
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import urllib3

from .netris_client import NetrisAPIError, NetrisClient

# UI polling/telemetry endpoints -- not actual write actions worth surfacing.
NOISE_URL_SUBSTRINGS = ("/auth", "topology/", "/graphite", "/users/options")

# Write endpoints that actually provision things onto switches.
CONFIG_RELEVANT_URL_SUBSTRINGS = (
    "/hw",
    "/server-cluster",
    "/vnet",
    "/ebgp",
    "/acl",
    "/nat",
    "/ipam",
    "/link",
    "/ports",
    "/reservation",
    "/l4lb",
)


class InventoryError(RuntimeError):
    """Wraps a NetrisAPIError (or other failure) with which call caused it."""


@dataclass
class Site:
    id: int
    name: str
    has_hardware: bool


@dataclass
class Device:
    name: str
    role: str
    site_id: int
    site_name: str
    tenant: str
    nos: str
    main_address: str
    mgmt_address: str
    status: str


def build_client(cfg: dict) -> NetrisClient:
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    try:
        return NetrisClient(
            cfg["netris_url"],
            username=cfg["netris_username"],
            password=cfg["netris_password"],
            verify=False,
        )
    except NetrisAPIError as exc:
        raise InventoryError(f"login to {cfg['netris_url']} failed: {exc}") from exc


def _ref_name(ref: Any) -> str:
    if isinstance(ref, dict):
        return ref.get("name") or ""
    if isinstance(ref, str):
        return ref
    return ""


def _ref_id(ref: Any) -> Optional[int]:
    if isinstance(ref, dict):
        return ref.get("id")
    return None


def list_all_switches(client: NetrisClient) -> List[Device]:
    devices: List[Device] = []
    page = 1
    limit = 200
    total = None
    try:
        while total is None or (page - 1) * limit < total:
            body = client.get("/api/v2/hw", params={"page": page, "limit": limit})
            items = body.get("data", []) if isinstance(body, dict) else body
            total = body.get("meta", {}).get("totalDocs") if isinstance(body, dict) else len(items)
            for item in items:
                if item.get("type") != "switch":
                    continue
                site = item.get("site")
                devices.append(
                    Device(
                        name=item.get("name", ""),
                        role=item.get("swRole", ""),
                        site_id=_ref_id(site) or 0,
                        site_name=_ref_name(site),
                        tenant=_ref_name(item.get("tenant")),
                        nos=_ref_name(item.get("nos")),
                        main_address=item.get("mainAddress") or "",
                        mgmt_address=item.get("mgmtAddress") or "",
                        status=item.get("status") or "",
                    )
                )
            if not items:
                break
            page += 1
    except NetrisAPIError as exc:
        raise InventoryError(f"GET /api/v2/hw (page {page}) failed: {exc}") from exc
    return devices


def list_sites(client: NetrisClient) -> List[Site]:
    try:
        body = client.get("/api/v2/sites")
    except NetrisAPIError as exc:
        raise InventoryError(f"GET /api/v2/sites failed: {exc}") from exc
    items = body.get("data", []) if isinstance(body, dict) else body

    switches = list_all_switches(client)
    sites_with_hw = {
        d.site_id for d in switches if d.mgmt_address
    }

    sites = []
    for item in items:
        site_id = item.get("id")
        sites.append(
            Site(
                id=site_id,
                name=item.get("name", ""),
                has_hardware=site_id in sites_with_hw,
            )
        )
    return sites


def list_switches_for_site(client: NetrisClient, site_id: int) -> List[Device]:
    return [d for d in list_all_switches(client) if d.site_id == site_id]


def group_by_role(devices: List[Device]) -> Dict[str, List[Device]]:
    groups: Dict[str, List[Device]] = {}
    for device in devices:
        groups.setdefault(device.role, []).append(device)
    return groups


def get_relevant_write_logs(
    client: NetrisClient, since_epoch: int, until_epoch: Optional[int] = None
) -> List[dict]:
    if until_epoch is None:
        until_epoch = int(time.time())
    params = {
        "start": since_epoch,
        "end": until_epoch,
        "pagination": jsonlib.dumps({"limit": 300, "offset": 0}),
        "filter": jsonlib.dumps({"method": ["POST", "PUT", "PATCH", "DELETE"]}),
        "sort": jsonlib.dumps({"sortBy": "createdAt", "order": "ASC"}),
    }
    try:
        body = client.get("/api/apilogs", params=params)
    except NetrisAPIError as exc:
        raise InventoryError(f"GET /api/apilogs failed: {exc}") from exc
    items = body.get("data", []) if isinstance(body, dict) else body

    relevant = []
    for item in items:
        url = item.get("url", "")
        if any(noise in url for noise in NOISE_URL_SUBSTRINGS):
            continue
        if any(keep in url for keep in CONFIG_RELEVANT_URL_SUBSTRINGS):
            relevant.append(item)
    return relevant


RESOURCE_TYPE_MAP = {
    "/server-cluster": "Server Cluster",
    "/vnet": "V-Net",
    "/ebgp": "eBGP Session",
    "/acl": "ACL",
    "/nat": "NAT",
    "/ipam": "IPAM",
    "/link": "Physical Link",
    "/ports": "Port Configuration",
    "/reservation": "IPAM Reservation",
    "/l4lb": "L4 Load Balancer",
    "/hw": "Hardware Inventory",
}


def summarize_api_log(log_item: dict) -> dict:
    """Parses a raw /api/apilogs entry into a structured, human-readable summary
    explaining what product resource was modified.
    """
    url = log_item.get("url", "")
    method = log_item.get("method", "WRITE")
    user = log_item.get("user") or "unknown"
    created_at = log_item.get("createdAt", "")

    # Match resource type
    res_type = "Resource"
    for endpoint, label in RESOURCE_TYPE_MAP.items():
        if endpoint in url:
            res_type = label
            break

    # Parse body if JSON
    body_data = {}
    raw_body = log_item.get("body", "")
    if isinstance(raw_body, str) and raw_body.strip():
        try:
            body_data = jsonlib.loads(raw_body)
        except Exception:
            body_data = {}
    elif isinstance(raw_body, dict):
        body_data = raw_body

    name = log_item.get("name") or body_data.get("name") or ""
    site_info = body_data.get("site")
    site_id = site_info.get("id") if isinstance(site_info, dict) else None
    vpc_info = body_data.get("vpc")
    vpc_name = vpc_info.get("name") if isinstance(vpc_info, dict) else (vpc_info if isinstance(vpc_info, str) else None)

    # Human-readable action verb
    action_verb = {
        "POST": "Created",
        "PUT": "Updated",
        "PATCH": "Modified",
        "DELETE": "Deleted",
    }.get(method, method)

    extra_parts = []
    if name:
        extra_parts.append(f"'{name}'")
    if vpc_name:
        extra_parts.append(f"VPC: {vpc_name}")
    if site_id:
        extra_parts.append(f"Site ID: {site_id}")

    details_str = f" ({', '.join(extra_parts)})" if extra_parts else ""
    summary_text = f"[{user}] {action_verb} {res_type}{details_str} via {method} {url}"

    return {
        "id": log_item.get("id", ""),
        "timestamp": created_at,
        "user": user,
        "method": method,
        "url": url,
        "resource_type": res_type,
        "resource_name": name,
        "site_id": site_id,
        "vpc_name": vpc_name,
        "action": action_verb,
        "summary": summary_text,
        "payload": body_data if body_data else (raw_body if raw_body else None),
        "raw_body": raw_body,
        "ip": log_item.get("ip", ""),
        "trace": log_item.get("trace"),
    }


