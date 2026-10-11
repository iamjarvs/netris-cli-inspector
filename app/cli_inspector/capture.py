"""One place that knows how to capture a device's *configuration* and
*intent* and store both in the archive. The CLI menu, the web dashboard and
the watcher all go through here, so a snapshot always means the same thing:
applied config (flat commands + JSON tree) and the Netris intent file.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import re

from . import archive
from .catalog import INTENT_PATH
from .diff_utils import clean_error_text
from .executor import SwitchExecutor

# One cheap SSH call per switch per poll: the newest `nv config history` row's
# revision, then a hash of the Netris intent file. The revision tells watchers
# the *configuration* moved; the hash tells them the *intent* moved.
SENTINEL_COMMAND = (
    "nv config history | sed -n 3p | awk '{print $1}'; "
    f"sha256sum {INTENT_PATH} 2>/dev/null | cut -d' ' -f1"
)
_SHA_RE = re.compile(r"^[0-9a-f]{64}$")


def parse_sentinel(stdout: str) -> tuple[Optional[str], Optional[str]]:
    """-> (revision, intent_sha256); either may be None if the switch didn't report it."""
    rev = sha = None
    for line in (l.strip() for l in (stdout or "").splitlines()):
        if not line:
            continue
        if _SHA_RE.match(line):
            sha = line
        elif rev is None:
            rev = line
    return rev, sha


def sync_intent(
    executor: SwitchExecutor,
    archive_dir: str,
    pairs: list[tuple[str, str]],
    current_shas: dict[str, Optional[str]],
    trigger: str,
    site: Optional[str] = None,
    revisions: Optional[dict[str, Optional[str]]] = None,
) -> dict[str, bool]:
    """Archives the intent of every switch whose live intent hash differs from
    the archived copy (or that has none yet). Compared against the archive
    rather than remembered in memory, so a restart or a missed poll can't lose
    a change. Returns device -> whether a new commit was made."""
    stale = [(n, a) for n, a in pairs if current_shas.get(n) and archive.intent_sha256(archive_dir, n) != current_shas[n]]
    if not stale:
        return {}
    archive.ensure_archive_repo(archive_dir)
    fetched = executor.get_intent_many(stale)
    out: dict[str, bool] = {}
    for name, _addr in stale:
        res = fetched[name]
        if not (res.ok and res.stdout.strip()):
            continue  # retried on the next poll
        meta = {"timestamp": datetime.now(timezone.utc).isoformat(), "trigger": trigger}
        if site:
            meta["site"] = site
        rev = (revisions or {}).get(name)
        if rev:
            meta.update({"on_box_rev": rev, "on_box_user": "", "on_box_message": "newest on-box revision at capture"})
        out[name] = archive.snapshot_intent(archive_dir, name, res.stdout, meta)
    return out


@dataclass
class CaptureResult:
    device: str
    config_changed: bool = False
    intent_changed: bool = False
    config_ok: bool = False
    intent_ok: bool = False
    error: Optional[str] = None

    @property
    def changed(self) -> bool:
        return self.config_changed or self.intent_changed

    @property
    def failed(self) -> bool:
        return not (self.config_ok or self.intent_ok)


def _unwrap_json(raw: str) -> Optional[dict]:
    """`nv config show -o json` is [{"header": ...}, {"set": {tree}}]."""
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if isinstance(parsed, list) and len(parsed) > 1 and isinstance(parsed[1], dict) and "set" in parsed[1]:
        return parsed[1]["set"]
    return parsed


def capture_many(
    executor: SwitchExecutor,
    archive_dir: str,
    pairs: list[tuple[str, str]],
    trigger: str,
    site: Optional[str] = None,
    on_box: Optional[dict[str, dict]] = None,
) -> dict[str, CaptureResult]:
    """Pulls applied config (commands + json) and the intent file from every
    device in `pairs` and archives whichever actually changed.

    `on_box` optionally maps device -> {"on_box_rev", "on_box_user",
    "on_box_message"}, recorded in the commit messages.
    """
    archive.ensure_archive_repo(archive_dir)
    on_box = on_box or {}

    config_res = executor.get_full_config_commands_many(pairs)
    json_res = executor.get_full_config_json_many(pairs)
    intent_res = executor.get_intent_many(pairs)

    results: dict[str, CaptureResult] = {}
    for name, _addr in pairs:
        meta = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "trigger": trigger,
            **({"site": site} if site else {}),
            **on_box.get(name, {}),
        }
        out = CaptureResult(device=name)
        errors = []

        cfg = config_res[name]
        if cfg.ok:
            config_json = _unwrap_json(json_res[name].stdout) if json_res[name].ok else None
            out.config_ok = True
            out.config_changed = archive.snapshot_device(archive_dir, name, cfg.stdout, meta, config_json=config_json)
        else:
            errors.append(f"config: {clean_error_text(cfg.error or cfg.stderr)}")

        intent = intent_res[name]
        # An empty file means the cat misbehaved, not that intent is blank --
        # never overwrite good history with nothing.
        if intent.ok and intent.stdout.strip():
            out.intent_ok = True
            out.intent_changed = archive.snapshot_intent(archive_dir, name, intent.stdout, meta)
        else:
            errors.append(f"intent: {clean_error_text(intent.error or intent.stderr) or 'empty file'}")

        out.error = "; ".join(errors) or None
        results[name] = out
    return results
