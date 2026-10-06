"""Flask JSON API backing the web dashboard. Wraps the existing inventory,
executor, and archive modules behind a stable REST contract consumed by a
separately-built React frontend (proxied through Vite's dev server, so no
CORS handling is needed here).
"""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Optional

from flask import Flask, jsonify, request, send_from_directory

from . import archive, catalog, diff_utils
from .config import load_config
from .executor import ExecutorError, SwitchExecutor, parse_config_history, parse_live_revision_ids
from .inventory import (
    Device,
    InventoryError,
    build_client,
    get_relevant_write_logs,
    list_all_switches,
    list_sites,
    summarize_api_log,
)
from .isolation import IsolationEngine
from .menu import probe_site_reachable

DIST_DIR = Path(__file__).resolve().parent.parent / "webapp" / "dist"
app = Flask(__name__, static_folder=str(DIST_DIR) if DIST_DIR.exists() else None, static_url_path="")

cfg = load_config()
client = build_client(cfg)
executor = SwitchExecutor(
    jump_host=cfg["ssh_jump_host"],
    jump_port=cfg["ssh_jump_port"],
    jump_user=cfg["ssh_jump_user"],
    switch_user=cfg["ssh_switch_user"],
)
isolation_engine = IsolationEngine(client, executor)

CACHE_TTL = 300
_inventory_cache: dict = {"devices": None, "sites": None, "at": 0.0}
_reachability_cache: dict = {"by_site": {}, "at": {}}
_lock = threading.Lock()


def _refresh_inventory() -> tuple[list[Device], list]:
    with _lock:
        if _inventory_cache["devices"] is not None and time.time() - _inventory_cache["at"] < CACHE_TTL:
            return _inventory_cache["devices"], _inventory_cache["sites"]
        devices = list_all_switches(client)
        sites = list_sites(client)
        _inventory_cache["devices"] = devices
        _inventory_cache["sites"] = sites
        _inventory_cache["at"] = time.time()
        return devices, sites


def _devices_for_site(devices: list[Device], site_id: int) -> list[Device]:
    return [d for d in devices if d.site_id == site_id]


def _probe_site_reachable_fast(devices: list[Device], sample: int = 2, timeout: int = 3) -> bool:
    valid = [d for d in devices if d.mgmt_address][:sample]
    if not valid:
        return False
    with ThreadPoolExecutor(max_workers=min(len(valid), 4)) as pool:
        futures = [
            pool.submit(executor.exec_on_device, d.name, d.mgmt_address, "true", timeout=timeout)
            for d in valid
        ]
        for f in as_completed(futures):
            try:
                res = f.result()
                if res.ok:
                    return True
            except Exception:
                pass
    return False


def _is_reachable(site_id: int, devices: list[Device]) -> bool:
    now = time.time()
    cached_at = _reachability_cache["at"].get(site_id, 0.0)
    if now - cached_at < CACHE_TTL:
        return _reachability_cache["by_site"][site_id]
    reachable = _probe_site_reachable_fast(devices) if devices else False
    _reachability_cache["by_site"][site_id] = reachable
    _reachability_cache["at"][site_id] = now
    return reachable


def _device_dict(d: Device) -> dict:
    return {
        "name": d.name,
        "role": d.role,
        "site_id": d.site_id,
        "site_name": d.site_name,
        "mgmt_address": d.mgmt_address,
        "main_address": d.main_address,
        "tenant": d.tenant,
        "nos": d.nos,
        "status": d.status,
    }


def _pretty_or_none(text: str) -> Optional[str]:
    try:
        return diff_utils.dumps_relaxed(json.loads(text))
    except (ValueError, TypeError):
        return None


def _exec_result_dict(r) -> dict:
    return {
        "ok": r.ok,
        "stdout": r.stdout,
        "stderr": diff_utils.clean_error_text(r.stderr) if r.stderr else r.stderr,
        "exit_status": r.exit_status,
        "error": diff_utils.clean_error_text(r.error) if r.error else r.error,
        "pretty": _pretty_or_none(r.stdout),
    }


def _resolve_mgmt_address(devices: list[Device], name: str) -> Optional[str]:
    for d in devices:
        if d.name == name:
            return d.mgmt_address
    return None


def _unwrap_config_json(parsed):
    """`nv config show -o json` returns [{"header": {...}}, {"set": {<tree>}}].
    Archive JSON is already stored unwrapped and doesn't need this.
    """
    if isinstance(parsed, list) and len(parsed) > 1 and isinstance(parsed[1], dict) and "set" in parsed[1]:
        return parsed[1]["set"]
    return parsed


def _catalog_entry_dict(entry: catalog.CatalogEntry) -> dict:
    return {"id": entry.id, "label": entry.label, "command": entry.command, "source": entry.source}


def _fetch_config_text(device: str, mgmt_address: Optional[str], source_type: str, ref: str) -> str:
    if source_type == "onbox":
        if not mgmt_address:
            raise ApiError("mgmt_address is required for source_type=onbox")
        result = executor.get_config_text_for_rev(device, mgmt_address, ref)
        if not result.ok:
            raise ApiError(diff_utils.clean_error_text(result.error or result.stderr) or f"failed to fetch config from {device}", 502)
        return result.stdout

    if source_type == "archive":
        try:
            if ref == "latest":
                text = archive.latest_snapshot_text(cfg["archive_dir"], device)
                if text is None:
                    raise ApiError(f"no archived snapshot for {device}", 404)
                return text
            return archive.show_at(cfg["archive_dir"], device, ref)
        except archive.ArchiveError as e:
            raise ApiError(str(e), 404)

    raise ApiError("source_type must be 'onbox' or 'archive'")


class ApiError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@app.errorhandler(ApiError)
def handle_api_error(err: ApiError):
    return jsonify({"error": err.message}), err.status_code


@app.errorhandler(404)
def handle_404(_err):
    if not request.path.startswith("/api/") and DIST_DIR.exists():
        rel_path = request.path.lstrip("/")
        target = DIST_DIR / rel_path
        if rel_path and target.exists() and not target.is_dir():
            return send_from_directory(DIST_DIR, rel_path)
        return send_from_directory(DIST_DIR, "index.html")
    return jsonify({"error": "not found"}), 404


@app.errorhandler(405)
def handle_405(_err):
    return jsonify({"error": "method not allowed"}), 405


@app.errorhandler(Exception)
def handle_unexpected(err: Exception):
    if isinstance(err, ApiError):
        return handle_api_error(err)
    return jsonify({"error": str(err)}), 500


@app.get("/api/health")
def health():
    return jsonify({"ok": True})


@app.get("/api/sites")
def get_sites():
    devices, sites = _refresh_inventory()
    out = []
    for site in sites:
        site_devices = _devices_for_site(devices, site.id)
        out.append(
            {
                "id": site.id,
                "name": site.name,
                "has_hardware": site.has_hardware,
                "reachable": _is_reachable(site.id, site_devices),
                "device_count": len(site_devices),
            }
        )
    return jsonify({"sites": out})


@app.get("/api/devices")
def get_devices():
    devices, _sites = _refresh_inventory()
    site_id = request.args.get("site_id", type=int)
    if site_id is not None:
        devices = _devices_for_site(devices, site_id)
    return jsonify({"devices": [_device_dict(d) for d in devices]})


@app.get("/api/catalog")
def get_catalog():
    return jsonify(
        {
            "config": [_catalog_entry_dict(e) for e in catalog.CONFIG_COMMANDS],
            "show": [_catalog_entry_dict(e) for e in catalog.SHOW_COMMANDS],
        }
    )


@app.post("/api/show")
def post_show():
    body = request.get_json(force=True, silent=True) or {}
    targets = body.get("targets") or []
    command = body.get("command")
    if not targets or not command:
        raise ApiError("targets and command are required")

    devices, _sites = _refresh_inventory()
    pairs = []
    for name in targets:
        mgmt_address = _resolve_mgmt_address(devices, name)
        if not mgmt_address:
            raise ApiError(f"unknown device or missing mgmt_address: {name}")
        pairs.append((name, mgmt_address))

    results = executor.exec_many(pairs, command)
    return jsonify({"results": {name: _exec_result_dict(r) for name, r in results.items()}})


@app.post("/api/compare")
def post_compare():
    body = request.get_json(force=True, silent=True) or {}
    device_a = body.get("device_a")
    device_b = body.get("device_b")
    command = body.get("command")
    if not device_a or not device_b or not command:
        raise ApiError("device_a, device_b, and command are required")

    devices, _sites = _refresh_inventory()
    mgmt_a = _resolve_mgmt_address(devices, device_a)
    mgmt_b = _resolve_mgmt_address(devices, device_b)
    if not mgmt_a:
        raise ApiError(f"unknown device or missing mgmt_address: {device_a}")
    if not mgmt_b:
        raise ApiError(f"unknown device or missing mgmt_address: {device_b}")

    results = executor.exec_many([(device_a, mgmt_a), (device_b, mgmt_b)], command)
    result_a, result_b = results[device_a], results[device_b]
    result_a_dict = _exec_result_dict(result_a)
    result_b_dict = _exec_result_dict(result_b)

    diff_lines: list[str] = []
    side_by_side: list[dict] = []
    if result_a.ok and result_b.ok:
        text_a = result_a_dict["pretty"] or result_a.stdout
        text_b = result_b_dict["pretty"] or result_b.stdout
        diff_lines = diff_utils.unified_diff(text_a, text_b, device_a, device_b).splitlines()
        side_by_side = diff_utils.side_by_side(text_a, text_b)

    return jsonify(
        {
            "device_a": device_a,
            "result_a": result_a_dict,
            "device_b": device_b,
            "result_b": result_b_dict,
            "diff_lines": diff_lines,
            "side_by_side": side_by_side,
        }
    )


@app.get("/api/history/onbox")
def get_history_onbox():
    device = request.args.get("device")
    mgmt_address = request.args.get("mgmt_address")
    if not device:
        raise ApiError("device is required")
    if not mgmt_address:
        devices, _sites = _refresh_inventory()
        mgmt_address = _resolve_mgmt_address(devices, device)
    if not mgmt_address:
        raise ApiError(f"unknown device or missing mgmt_address: {device}")

    result = executor.get_config_history(device, mgmt_address)
    if not result.ok:
        return jsonify({"ok": False, "revisions": [], "error": diff_utils.clean_error_text(result.error or result.stderr)})

    revisions = parse_config_history(result.stdout)

    live_result = executor.get_live_revision_ids(device, mgmt_address)
    live_ids = parse_live_revision_ids(live_result.stdout) if live_result.ok else None

    def is_pruned(rev) -> bool:
        if rev.rev_id == "startup" or live_ids is None:
            return False
        return rev.rev_id not in live_ids

    return jsonify(
        {
            "ok": True,
            "revisions": [
                {
                    "rev_id": r.rev_id,
                    "apply_date": r.apply_date,
                    "rev_type": r.rev_type,
                    "user": r.user,
                    "message": r.message,
                    "pruned": is_pruned(r),
                }
                for r in revisions
            ],
            "pruned_detection_available": live_ids is not None,
            "error": None,
        }
    )


@app.get("/api/history/archive")
def get_history_archive():
    device = request.args.get("device")
    if not device:
        raise ApiError("device is required")
    limit = request.args.get("limit", default=20, type=int)
    entries = archive.history(cfg["archive_dir"], device, limit=limit)
    return jsonify({"entries": entries})


@app.post("/api/archive/snapshot")
def post_archive_snapshot():
    body = request.get_json(force=True, silent=True) or {}
    targets = body.get("targets") or []
    if not targets:
        raise ApiError("targets is required")

    devices, _sites = _refresh_inventory()
    pairs = []
    for name in targets:
        mgmt_address = _resolve_mgmt_address(devices, name)
        if not mgmt_address:
            raise ApiError(f"unknown device or missing mgmt_address: {name}")
        pairs.append((name, mgmt_address))

    archive.ensure_archive_repo(cfg["archive_dir"])
    exec_results = executor.get_full_config_commands_many(pairs)
    configs = {name: r.stdout for name, r in exec_results.items() if r.ok}
    failed = [name for name, r in exec_results.items() if not r.ok]

    meta = {"timestamp": datetime.now(timezone.utc).isoformat(), "trigger": "web-ui"}
    snap_results = archive.snapshot_many(cfg["archive_dir"], configs, meta)

    results = dict(snap_results)
    for name in failed:
        results[name] = False

    return jsonify({"results": results, "failed": failed})


@app.get("/api/archive/diff")
def get_archive_diff():
    device = request.args.get("device")
    if not device:
        raise ApiError("device is required")
    rev_a = request.args.get("rev_a")
    rev_b = request.args.get("rev_b")
    try:
        diff_text = archive.diff(cfg["archive_dir"], device, rev_a, rev_b)
    except archive.ArchiveError as e:
        raise ApiError(str(e), 404)
    return jsonify({"diff": diff_text})


@app.get("/api/archive/show")
def get_archive_show():
    device = request.args.get("device")
    rev = request.args.get("rev")
    if not device or not rev:
        raise ApiError("device and rev are required")
    try:
        content = archive.show_at(cfg["archive_dir"], device, rev)
    except archive.ArchiveError as e:
        raise ApiError(str(e), 404)
    return jsonify({"content": content})


@app.get("/api/onbox/diff")
def get_onbox_diff():
    device = request.args.get("device")
    mgmt_address = request.args.get("mgmt_address")
    if not device:
        raise ApiError("device is required")
    if not mgmt_address:
        devices, _sites = _refresh_inventory()
        mgmt_address = _resolve_mgmt_address(devices, device)
    if not mgmt_address:
        raise ApiError(f"unknown device or missing mgmt_address: {device}")

    rev_a = request.args.get("rev_a")
    rev_b = request.args.get("rev_b", "applied")
    fmt = request.args.get("fmt", "commands")
    if not rev_a:
        raise ApiError("rev_a is required")

    result = executor.get_config_diff(device, mgmt_address, rev_a, rev_b, fmt)
    if not result.ok:
        return jsonify({"ok": False, "diff": "", "error": diff_utils.clean_error_text(result.error or result.stderr)})
    return jsonify({"ok": True, "diff": result.stdout, "error": None})


@app.get("/api/config/source")
def get_config_source():
    device = request.args.get("device")
    mgmt_address = request.args.get("mgmt_address")
    source_type = request.args.get("source_type")
    ref = request.args.get("ref")
    fmt = request.args.get("format", "text")
    if not device or not source_type or not ref:
        raise ApiError("device, source_type, and ref are required")
    if fmt not in ("text", "json"):
        raise ApiError("format must be 'text' or 'json'")

    if fmt == "text":
        return jsonify({"text": _fetch_config_text(device, mgmt_address, source_type, ref)})

    if source_type == "onbox":
        if not mgmt_address:
            raise ApiError("mgmt_address is required for source_type=onbox")
        result = executor.get_config_json_for_rev(device, mgmt_address, ref)
        if not result.ok:
            raise ApiError(diff_utils.clean_error_text(result.error or result.stderr) or f"failed to fetch config from {device}", 502)
        try:
            parsed = json.loads(result.stdout)
        except (ValueError, TypeError) as e:
            raise ApiError(f"device returned invalid JSON: {e}", 502)
        unwrapped = _unwrap_config_json(parsed)
        return jsonify({"json": unwrapped, "pretty": diff_utils.dumps_relaxed(unwrapped)})

    if source_type == "archive":
        try:
            if ref == "latest":
                data = archive.latest_snapshot_json(cfg["archive_dir"], device)
                if data is None:
                    raise ApiError(f"no archived snapshot for {device}", 404)
            else:
                data = archive.show_at_json(cfg["archive_dir"], device, ref)
        except archive.ArchiveError:
            return jsonify(
                {"error": "no JSON snapshot available for this commit (taken before JSON snapshots were added)"}
            ), 404
        return jsonify({"json": data, "pretty": diff_utils.dumps_relaxed(data)})

    raise ApiError("source_type must be 'onbox' or 'archive'")


@app.get("/api/config/diff")
def get_config_diff_route():
    device = request.args.get("device")
    mgmt_address = request.args.get("mgmt_address")
    a_type = request.args.get("a_type")
    a_ref = request.args.get("a_ref")
    b_type = request.args.get("b_type")
    b_ref = request.args.get("b_ref")
    if not device or not a_type or not a_ref or not b_type or not b_ref:
        raise ApiError("device, a_type, a_ref, b_type, and b_ref are required")

    text_a = _fetch_config_text(device, mgmt_address, a_type, a_ref)
    text_b = _fetch_config_text(device, mgmt_address, b_type, b_ref)
    name_a = f"{a_type}:{a_ref}"
    name_b = f"{b_type}:{b_ref}"
    return jsonify(
        {
            "text_a": text_a,
            "text_b": text_b,
            "diff": diff_utils.unified_diff(text_a, text_b, name_a, name_b),
            "side_by_side": diff_utils.side_by_side(text_a, text_b),
        }
    )


def _revision_status_dict(s) -> dict:
    return {
        "ok": s.ok,
        "configured": s.configured,
        "running": s.running,
        "service_active": s.service_active,
        "error": diff_utils.clean_error_text(s.error) if s.error else s.error,
    }


def _revision_apply_dict(r) -> dict:
    return {
        "ok": r.ok,
        "previous": r.previous,
        "requested": r.requested,
        "verified": r.verified,
        "service_active": r.service_active,
        "error": diff_utils.clean_error_text(r.error) if r.error else r.error,
    }


def _resolve_targets(targets: list[str]) -> list[tuple[str, str]]:
    devices, _sites = _refresh_inventory()
    pairs = []
    for name in targets:
        mgmt_address = _resolve_mgmt_address(devices, name)
        if not mgmt_address:
            raise ApiError(f"unknown device or missing mgmt_address: {name}")
        pairs.append((name, mgmt_address))
    return pairs


@app.post("/api/revisions/status")
def post_revisions_status():
    body = request.get_json(force=True, silent=True) or {}
    targets = body.get("targets") or []
    if not targets:
        raise ApiError("targets is required")
    pairs = _resolve_targets(targets)
    results = executor.get_max_revisions_many(pairs)
    return jsonify({"results": {name: _revision_status_dict(r) for name, r in results.items()}})


@app.post("/api/revisions/apply")
def post_revisions_apply():
    body = request.get_json(force=True, silent=True) or {}
    targets = body.get("targets") or []
    value = body.get("value")
    if not targets:
        raise ApiError("targets is required")
    if not isinstance(value, int) or isinstance(value, bool):
        raise ApiError("value must be an integer")
    pairs = _resolve_targets(targets)
    results = executor.set_max_revisions_many(pairs, value)
    return jsonify({"results": {name: _revision_apply_dict(r) for name, r in results.items()}})


@app.post("/api/saved-diffs")
def post_saved_diff():
    body = request.get_json(force=True, silent=True) or {}
    device = body.get("device")
    label = body.get("label")
    source_a_desc = body.get("source_a_desc")
    source_b_desc = body.get("source_b_desc")
    diff_text = body.get("diff")
    text_a = body.get("text_a", "")
    text_b = body.get("text_b", "")
    if not device or not label or not source_a_desc or not source_b_desc or diff_text is None:
        raise ApiError("device, label, source_a_desc, source_b_desc, and diff are required")

    diff_id = archive.save_diff(
        cfg["archive_dir"], device, label, source_a_desc, source_b_desc, diff_text, text_a, text_b
    )
    return jsonify({"id": diff_id})


@app.get("/api/saved-diffs")
def get_saved_diffs():
    device = request.args.get("device")
    items = archive.list_saved_diffs(cfg["archive_dir"], device)
    return jsonify({"items": items})


@app.get("/api/saved-diffs/<device>/<diff_id>")
def get_saved_diff_route(device, diff_id):
    try:
        record = archive.get_saved_diff(cfg["archive_dir"], device, diff_id)
    except archive.ArchiveError as e:
        raise ApiError(str(e), 404)
    return jsonify(record)


@app.delete("/api/saved-diffs/<device>/<diff_id>")
def delete_saved_diff_route(device, diff_id):
    try:
        archive.delete_saved_diff(cfg["archive_dir"], device, diff_id)
    except archive.ArchiveError as e:
        raise ApiError(str(e), 404)
    return jsonify({"ok": True})


# -- Switch Isolation & Assurance Endpoints ------------------------------------

@app.get("/api/isolation/vpcs")
def get_isolation_vpcs():
    site_id = request.args.get("site_id", type=int)
    try:
        vpcs = isolation_engine.list_vpcs(site_id=site_id)
        return jsonify({"vpcs": vpcs})
    except Exception as e:
        raise ApiError(str(e), 500)


@app.get("/api/isolation/vpc/<int:vpc_id>")
def get_isolation_vpc(vpc_id):
    try:
        topo = isolation_engine.get_vpc_topology(vpc_id)
        return jsonify(topo)
    except Exception as e:
        raise ApiError(str(e), 500)


@app.get("/api/isolation/evidence")
def get_isolation_evidence():
    vpc_id = request.args.get("vpc_id", type=int)
    if not vpc_id:
        raise ApiError("vpc_id parameter is required", 400)
    try:
        evidence = isolation_engine.audit_hardware_tables(vpc_id)
        return jsonify(evidence)
    except Exception as e:
        raise ApiError(str(e), 500)


@app.post("/api/isolation/ping")
def post_isolation_ping():
    body = request.get_json(force=True, silent=True) or {}
    source = body.get("source")
    target_su = body.get("target_su")
    target_host = body.get("target_host")
    if not source or target_su is None or target_host is None:
        raise ApiError("source, target_su, and target_host are required", 400)
    try:
        res = isolation_engine.run_cluster_ping(source, int(target_su), int(target_host))
        return jsonify(res)
    except Exception as e:
        raise ApiError(str(e), 500)


@app.get("/api/isolation/switches")
def get_isolation_switches():
    vpc_id = request.args.get("vpc_id", default=31, type=int)
    try:
        switches = isolation_engine.list_switches_for_vpc(vpc_id)
        return jsonify({"switches": switches})
    except Exception as e:
        raise ApiError(str(e), 500)


@app.get("/api/isolation/switch-login")
def get_isolation_switch_login():
    switch = request.args.get("switch")
    mgmt_ip = request.args.get("mgmt_ip", "")
    if not switch:
        raise ApiError("switch parameter is required", 400)
    try:
        res = isolation_engine.get_switch_login_banner(switch, mgmt_ip)
        return jsonify(res)
    except Exception as e:
        raise ApiError(str(e), 500)


@app.post("/api/isolation/switch-exec")
def post_isolation_switch_exec():
    body = request.get_json(force=True, silent=True) or {}
    switch = body.get("switch")
    mgmt_ip = body.get("mgmt_ip", "")
    command = body.get("command")
    if not switch or not command:
        raise ApiError("switch and command are required", 400)
    try:
        res = isolation_engine.exec_switch_cli(switch, mgmt_ip, command)
        return jsonify(res)
    except Exception as e:
        raise ApiError(str(e), 500)


@app.post("/api/isolation/server-exec")
def post_isolation_server_exec():
    body = request.get_json(force=True, silent=True) or {}
    server = body.get("server")
    command = body.get("command")
    if not server or not command:
        raise ApiError("server and command are required", 400)
    try:
        res = isolation_engine.exec_server_cli(server, command)
        return jsonify(res)
    except Exception as e:
        raise ApiError(str(e), 500)


@app.post("/api/isolation/ping-cluster")
def post_isolation_ping_cluster():
    body = request.get_json(force=True, silent=True) or {}
    source_server = body.get("source_server")
    vpc_id = body.get("vpc_id", 31)
    if not source_server:
        raise ApiError("source_server is required", 400)
    try:
        res = isolation_engine.ping_all_cluster_hosts(source_server, int(vpc_id))
        return jsonify(res)
    except Exception as e:
        raise ApiError(str(e), 500)


@app.post("/api/isolation/ping-cross-vrf")
def post_isolation_ping_cross_vrf():
    body = request.get_json(force=True, silent=True) or {}
    source_vpc_id = body.get("source_vpc_id")
    target_vpc_ids = body.get("target_vpc_ids") or []
    source_server = body.get("source_server")
    switch = body.get("switch")
    mgmt_ip = body.get("mgmt_ip")
    if not source_vpc_id or not target_vpc_ids:
        raise ApiError("source_vpc_id and target_vpc_ids are required", 400)
    try:
        if source_server:
            res = isolation_engine.ping_tenant_isolation(
                source_server, int(source_vpc_id), [int(x) for x in target_vpc_ids]
            )
        else:
            res = isolation_engine.ping_cross_vrfs(
                int(source_vpc_id), [int(x) for x in target_vpc_ids], switch, mgmt_ip
            )
        return jsonify(res)
    except Exception as e:
        raise ApiError(str(e), 500)


@app.post("/api/isolation/ping-external")
def post_isolation_ping_external():
    body = request.get_json(force=True, silent=True) or {}
    source_vpc_id = body.get("source_vpc_id")
    targets = body.get("targets")
    switch = body.get("switch")
    mgmt_ip = body.get("mgmt_ip")
    if not source_vpc_id:
        raise ApiError("source_vpc_id is required", 400)
    try:
        res = isolation_engine.ping_external_ips(int(source_vpc_id), targets, switch, mgmt_ip)
        return jsonify(res)
    except Exception as e:
        raise ApiError(str(e), 500)


@app.post("/api/terminal/launch-iterm")
def post_launch_iterm():
    body = request.get_json(force=True, silent=True) or {}
    target = (body.get("target") or "").strip()
    ip = (body.get("ip") or "").strip()
    device_type = (body.get("device_type") or "switch").strip().lower()
    command = (body.get("command") or "").strip()

    jump_host = cfg.get("ssh_jump_host", "adam-ctl.netris.io")
    jump_user = cfg.get("ssh_jump_user", "ubuntu")
    user = "root" if device_type in ("server", "host", "compute") else cfg.get("ssh_switch_user", "cumulus")

    if not target and not ip:
        raise ApiError("target name or IP is required", 400)

    # Build the shell command to execute in the new iTerm window
    if command:
        inner_cmd = command
    else:
        inner_cmd = (
            f"shopt -s expand_aliases; source ~/.cloudsim_aliases 2>/dev/null; source ~/.bashrc 2>/dev/null; "
            f"if alias {target} &>/dev/null; then echo -e '\\033[1;32m==> Launching alias: {target}...\\033[0m'; {target}; "
            f"elif [ -n \"{ip}\" ]; then echo -e '\\033[1;32m==> Connecting to {user}@{ip}...\\033[0m'; ssh -o StrictHostKeyChecking=no {user}@{ip}; "
            f"else echo 'Device not found'; bash; fi"
        )

    ssh_cmd = f"ssh -t -o StrictHostKeyChecking=no -A {jump_user}@{jump_host} \"{inner_cmd}\""
    escaped_cmd = ssh_cmd.replace("\\", "\\\\").replace('"', '\\"')

    apple_script = f'''
tell application "iTerm2"
    activate
    try
        set newWindow to (create window with default profile)
        tell current session of newWindow
            write text "{escaped_cmd}"
        end tell
    on error
        tell current window
            create tab with default profile
            tell current session
                write text "{escaped_cmd}"
            end tell
        end tell
    end try
end tell
'''

    launched = False
    warning = None
    try:
        sub = subprocess.run(["osascript", "-e", apple_script], capture_output=True, text=True, timeout=5)
        if sub.returncode == 0:
            launched = True
        else:
            warning = sub.stderr.strip() or "osascript returned non-zero"
    except Exception as e:
        warning = str(e)

    return jsonify({
        "ok": True,
        "launched": launched,
        "command": ssh_cmd,
        "target": target,
        "warning": warning,
    })


# -- Live Watch Mode Endpoints ------------------------------------------------

@app.route("/api/watch/events", methods=["GET", "POST"])
def get_watch_events():
    since = request.args.get("since", default=None, type=int)
    if since is None and request.is_json:
        since = (request.get_json(silent=True) or {}).get("since")
    if since is None:
        since = int(time.time()) - 3600  # past hour
    try:
        raw_logs = get_relevant_write_logs(client, since)
        summaries = [summarize_api_log(item) for item in raw_logs]
        return jsonify({"events": summaries})
    except Exception as e:
        raise ApiError(str(e), 500)


_last_switch_revs: dict[str, str] = {}


@app.route("/api/devices/<device_name>/context")
def api_device_context(device_name: str):
    text = archive.latest_snapshot_text(cfg["archive_dir"], device_name)
    if not text:
        devices, _ = _refresh_inventory()
        dev = next((d for d in devices if d.name == device_name), None)
        if dev and dev.mgmt_address:
            res = executor.get_full_config_commands(dev.name, dev.mgmt_address)
            text = res.stdout if res.ok else ""
    ctx = diff_utils.parse_device_context(text or "")
    return jsonify({"device": device_name, "context": ctx})


@app.route("/api/watch/poll", methods=["GET", "POST"])
def post_watch_poll():
    body = request.get_json(force=True, silent=True) or {}
    site_id = body.get("site_id") if body.get("site_id") is not None else request.args.get("site_id", type=int)
    cursor_epoch = body.get("cursor_epoch") if body.get("cursor_epoch") is not None else request.args.get("cursor_epoch", type=int)
    now_epoch = int(time.time())

    selected_devices = body.get("selected_devices")
    if selected_devices is None and request.args.get("devices"):
        selected_devices = [d.strip() for d in request.args.get("devices").split(",") if d.strip()]

    if cursor_epoch is None or cursor_epoch <= 0:
        cursor_epoch = now_epoch - 120

    # 1. Fetch any new Netris API write logs
    new_events = []
    try:
        raw_logs = get_relevant_write_logs(client, cursor_epoch, now_epoch)
        for item in raw_logs:
            new_events.append(summarize_api_log(item))
    except Exception:
        pass

    # 2. Resolve target devices
    devices, _sites = _refresh_inventory()
    if site_id is not None:
        target_devices = _devices_for_site(devices, site_id)
    else:
        target_devices = [d for d in devices if d.mgmt_address]

    if selected_devices is not None and isinstance(selected_devices, (list, set)):
        selected_set = set(selected_devices)
        target_devices = [d for d in target_devices if d.name in selected_set]

    valid_devices = [d for d in target_devices if d.mgmt_address]
    pairs = [(d.name, d.mgmt_address) for d in valid_devices]

    if not pairs:
        return jsonify({
            "ok": True,
            "cursor_epoch": now_epoch,
            "events": new_events,
            "affected_devices": [],
            "unchanged_devices": [],
            "diffs": {},
            "site_id": site_id,
        })

    archive.ensure_archive_repo(cfg["archive_dir"])

    trigger_label = "watch: direct switch / manual change"
    if new_events:
        trigger_label = new_events[-1].get("summary", "Netris API Write")

    affected_devices = []
    unchanged_devices = []
    diffs = {}

    roles = {d.name: d.role for d in valid_devices}
    mgmt_ips = {d.name: d.mgmt_address for d in valid_devices}

    # 3. Lightweight Revision ID Sentinel check (Option A)
    # Check current applied NVUE revision ID on each switch in parallel
    rev_results = executor.exec_many(pairs, "nv config history | sed -n 3p | awk '{print $1}'", timeout=8)

    # Determine which switches need a full config pull
    switches_to_pull: list[tuple[str, str]] = []
    for name, addr in pairs:
        res = rev_results.get(name)
        curr_rev = res.stdout.strip() if (res and res.ok) else None
        prev_rev = _last_switch_revs.get(name)
        has_snapshot = archive.latest_snapshot_text(cfg["archive_dir"], name) is not None

        if not has_snapshot or (prev_rev and curr_rev and curr_rev != prev_rev):
            switches_to_pull.append((name, addr))
        elif not prev_rev and has_snapshot:
            # Baseline exists in archive; record current rev so next check detects diffs
            if curr_rev:
                _last_switch_revs[name] = curr_rev
            unchanged_devices.append(name)
        else:
            unchanged_devices.append(name)

    # Pull full config only for changed or unseeded switches
    if switches_to_pull:
        exec_results = executor.get_full_config_commands_many(switches_to_pull)
        for name, addr in switches_to_pull:
            res = exec_results.get(name)
            if not res or not res.ok:
                continue

            current_text = res.stdout
            old_text = archive.latest_snapshot_text(cfg["archive_dir"], name)
            curr_rev = rev_results.get(name).stdout.strip() if rev_results.get(name) and rev_results.get(name).ok else None
            if curr_rev:
                _last_switch_revs[name] = curr_rev

            device_context = diff_utils.parse_device_context(current_text)

            if old_text is None:
                # Seed initial snapshot
                meta = {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "trigger": "watch-baseline",
                    "site": str(site_id or "default"),
                    "revision": curr_rev or "",
                }
                archive.snapshot_device(cfg["archive_dir"], name, current_text, meta)
                unchanged_devices.append(name)
                continue

            if old_text.strip() == current_text.strip():
                unchanged_devices.append(name)
            else:
                diff_res = diff_utils.parse_config_changes(name, old_text, current_text)
                if diff_res.is_changed:
                    affected_devices.append(name)
                    # Snapshot to git archive
                    meta = {
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "trigger": trigger_label,
                        "site": str(site_id or "default"),
                        "revision": curr_rev or "",
                    }
                    archive.snapshot_device(cfg["archive_dir"], name, current_text, meta)

                    diffs[name] = {
                        "device": name,
                        "role": roles.get(name, "switch"),
                        "mgmt_address": mgmt_ips.get(name, ""),
                        "revision": curr_rev or "",
                        "summary": diff_res.summary,
                        "added_lines": diff_res.added_lines,
                        "removed_lines": diff_res.removed_lines,
                        "raw_diff": diff_res.raw_diff,
                        "side_by_side": diff_utils.side_by_side(old_text, current_text),
                        "context": device_context,
                        "trigger": trigger_label,
                    }
                else:
                    unchanged_devices.append(name)

    return jsonify({
        "ok": True,
        "cursor_epoch": now_epoch,
        "events": new_events,
        "affected_devices": affected_devices,
        "unchanged_devices": unchanged_devices,
        "diffs": diffs,
        "site_id": site_id,
    })



if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 8743))
    app.run(host="0.0.0.0", port=port, debug=False)

