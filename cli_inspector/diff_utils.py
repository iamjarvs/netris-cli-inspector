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
