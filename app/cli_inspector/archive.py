"""Git-backed local archive of NVUE config snapshots.

Stores one ``<device_name>.commands`` file per device in a local git repo and
commits a new revision only when the config text actually changed. This is
the authoritative long-term history for the tool: on-box NVUE revision
history is short-lived and unreliable, so this archive does not try to
mirror it, only to record whatever full-config text it is handed.
"""

import json
import re
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

RECORD_SEP = "\x1e"
FIELD_SEP = "\x1f"


class ArchiveError(RuntimeError):
    pass


def _run(archive_dir: str, args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", archive_dir, *args], capture_output=True, text=True
    )


def _run_ok(archive_dir: str, args: list[str]) -> subprocess.CompletedProcess:
    result = _run(archive_dir, args)
    if result.returncode != 0:
        raise ArchiveError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result


def ensure_archive_repo(archive_dir: str) -> None:
    Path(archive_dir).mkdir(parents=True, exist_ok=True)
    if not (Path(archive_dir) / ".git").exists():
        _run_ok(archive_dir, ["init"])
    _run_ok(archive_dir, ["config", "user.name", "cli-inspector"])
    _run_ok(archive_dir, ["config", "user.email", "cli-inspector@localhost"])


def _commit_message(device_name: str, meta: dict) -> str:
    timestamp = meta.get("timestamp") or datetime.now(timezone.utc).isoformat()
    lines = [f"snapshot: {device_name} @ {timestamp}", ""]
    lines.append(f"trigger: {meta.get('trigger', 'manual')}")
    if meta.get("site"):
        lines.append(f"site: {meta['site']}")
    if meta.get("on_box_rev") is not None:
        user = meta.get("on_box_user", "")
        message = meta.get("on_box_message", "")
        lines.append(f"on-box revision: {meta['on_box_rev']} ({user}) - {message}")
    return "\n".join(lines)


def snapshot_device(
    archive_dir: str,
    device_name: str,
    config_text: str,
    meta: dict,
    config_json: Optional[dict] = None,
) -> bool:
    """Writes <device>.commands (git-diff-friendly flat nv set/unset lines)
    and, when config_json is given, also <device>.json (the same config as a
    nested tree, for the collapsible-tree view) in the same commit. Commits
    only if either file actually changed.
    """
    relative_paths = [f"{device_name}.commands"]
    (Path(archive_dir) / relative_paths[0]).write_text(config_text)

    if config_json is not None:
        relative_paths.append(f"{device_name}.json")
        (Path(archive_dir) / relative_paths[1]).write_text(json.dumps(config_json, indent=2, sort_keys=True))

    _run_ok(archive_dir, ["add", *relative_paths])
    diff_result = _run(archive_dir, ["diff", "--cached", "--quiet", "--", *relative_paths])
    if diff_result.returncode == 0:
        return False
    if diff_result.returncode != 1:
        raise ArchiveError(
            f"git diff --cached --quiet failed: {diff_result.stderr.strip()}"
        )

    message = _commit_message(device_name, meta)
    _run_ok(archive_dir, ["commit", "-m", message])
    return True


def snapshot_many(
    archive_dir: str,
    device_configs: dict[str, str],
    meta: dict,
    meta_by_device: Optional[dict[str, dict]] = None,
    device_json: Optional[dict[str, dict]] = None,
) -> dict[str, bool]:
    meta_by_device = meta_by_device or {}
    device_json = device_json or {}
    results = {}
    for device_name, config_text in device_configs.items():
        device_meta = {**meta, **meta_by_device.get(device_name, {})}
        results[device_name] = snapshot_device(
            archive_dir, device_name, config_text, device_meta, config_json=device_json.get(device_name)
        )
    return results


def history(archive_dir: str, device_name: str, limit: int = 20) -> list[dict]:
    if not (Path(archive_dir) / ".git").exists():
        return []
    file_path = f"{device_name}.commands"
    log_format = f"%H{FIELD_SEP}%ad{FIELD_SEP}%s{FIELD_SEP}%b{RECORD_SEP}"
    result = _run(
        archive_dir,
        [
            "log",
            f"-n{limit}",
            "--follow",
            "--date=iso-strict",
            f"--format={log_format}",
            "--",
            file_path,
        ],
    )
    if result.returncode != 0:
        raise ArchiveError(f"git log failed: {result.stderr.strip()}")

    entries = []
    for record in result.stdout.split(RECORD_SEP):
        record = record.strip("\n")
        if not record:
            continue
        commit_hash, date, subject, body = record.split(FIELD_SEP)
        entries.append(
            {
                "commit": commit_hash,
                "date": date,
                "subject": subject,
                "body": body.strip("\n"),
            }
        )
    return entries


def diff(
    archive_dir: str,
    device_name: str,
    rev_a: Optional[str] = None,
    rev_b: Optional[str] = None,
) -> str:
    """Diff <device_name>.commands between two points.

    Both None: diff between the two most recent commits for the file
    (returns "" if fewer than 2 commits exist). Only rev_a given: diff from
    rev_a to the current working copy. Both given: diff between the two revs.
    """
    file_path = f"{device_name}.commands"

    if rev_a is None and rev_b is None:
        recent = history(archive_dir, device_name, limit=2)
        if len(recent) < 2:
            return ""
        rev_b, rev_a = recent[0]["commit"], recent[1]["commit"]
        args = ["diff", rev_a, rev_b, "--", file_path]
    elif rev_b is None:
        args = ["diff", rev_a, "--", file_path]
    else:
        args = ["diff", rev_a, rev_b, "--", file_path]

    result = _run(archive_dir, args)
    if result.returncode != 0:
        raise ArchiveError(f"git diff failed: {result.stderr.strip()}")
    return result.stdout


def show_at(archive_dir: str, device_name: str, rev: str) -> str:
    result = _run(archive_dir, ["show", f"{rev}:{device_name}.commands"])
    if result.returncode != 0:
        raise ArchiveError(f"git show failed: {result.stderr.strip()}")
    return result.stdout


def latest_snapshot_text(archive_dir: str, device_name: str) -> Optional[str]:
    file_path = Path(archive_dir) / f"{device_name}.commands"
    if not file_path.exists():
        return None
    return file_path.read_text()


def latest_snapshot_json(archive_dir: str, device_name: str) -> Optional[dict]:
    file_path = Path(archive_dir) / f"{device_name}.json"
    if not file_path.exists():
        return None
    return json.loads(file_path.read_text())


def show_at_json(archive_dir: str, device_name: str, rev: str) -> dict:
    result = _run(archive_dir, ["show", f"{rev}:{device_name}.json"])
    if result.returncode != 0:
        raise ArchiveError(f"git show failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


# -- Saved diffs ---------------------------------------------------------
# A user-bookmarked comparison: freezes both full texts and the diff at the
# moment it's saved, so it stays viewable even if the underlying on-box
# revision is later garbage-collected or the archive history moves on.

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(label: str) -> str:
    slug = _SLUG_RE.sub("-", label.lower()).strip("-")
    return slug or "diff"


def save_diff(
    archive_dir: str,
    device_name: str,
    label: str,
    source_a_desc: str,
    source_b_desc: str,
    diff_text: str,
    text_a: str = "",
    text_b: str = "",
) -> str:
    ensure_archive_repo(archive_dir)
    saved_dir = Path(archive_dir) / "saved-diffs" / device_name
    saved_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc)
    diff_id = f"{timestamp.strftime('%Y%m%dT%H%M%SZ')}-{_slugify(label)}-{uuid.uuid4().hex[:6]}"
    record = {
        "id": diff_id,
        "device": device_name,
        "label": label,
        "timestamp": timestamp.isoformat(),
        "source_a": source_a_desc,
        "source_b": source_b_desc,
        "diff": diff_text,
        "text_a": text_a,
        "text_b": text_b,
    }
    file_path = saved_dir / f"{diff_id}.json"
    file_path.write_text(json.dumps(record, indent=2))

    relative_path = str(file_path.relative_to(archive_dir))
    _run_ok(archive_dir, ["add", relative_path])
    _run_ok(archive_dir, ["commit", "-m", f"save diff: {device_name} — {label}"])
    return diff_id


def list_saved_diffs(archive_dir: str, device_name: Optional[str] = None) -> list[dict]:
    base = Path(archive_dir) / "saved-diffs"
    if not base.exists():
        return []
    dirs = [base / device_name] if device_name else [d for d in base.iterdir() if d.is_dir()]
    items = []
    for d in dirs:
        if not d.exists():
            continue
        for f in sorted(d.glob("*.json"), reverse=True):
            record = json.loads(f.read_text())
            items.append({k: v for k, v in record.items() if k not in ("diff", "text_a", "text_b")})
    items.sort(key=lambda r: r["timestamp"], reverse=True)
    return items


def get_saved_diff(archive_dir: str, device_name: str, diff_id: str) -> dict:
    file_path = Path(archive_dir) / "saved-diffs" / device_name / f"{diff_id}.json"
    if not file_path.exists():
        raise ArchiveError(f"no saved diff {diff_id} for {device_name}")
    return json.loads(file_path.read_text())


def delete_saved_diff(archive_dir: str, device_name: str, diff_id: str) -> None:
    relative_path = f"saved-diffs/{device_name}/{diff_id}.json"
    if not (Path(archive_dir) / relative_path).exists():
        raise ArchiveError(f"no saved diff {diff_id} for {device_name}")
    _run_ok(archive_dir, ["rm", "-q", relative_path])
    _run_ok(archive_dir, ["commit", "-m", f"remove saved diff: {device_name} — {diff_id}"])
