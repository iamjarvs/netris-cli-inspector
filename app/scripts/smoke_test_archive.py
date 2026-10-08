"""Throwaway smoke test for cli_inspector.archive. Not part of the test suite."""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cli_inspector import archive

SAMPLE_CONFIG = """\
nv set interface eth0 ip address 10.0.0.1/24
nv set interface eth1 ip address 10.0.1.1/24
nv set system hostname leaf01
"""

CHANGED_CONFIG = """\
nv set interface eth0 ip address 10.0.0.1/24
nv set interface eth1 ip address 10.0.1.99/24
nv set system hostname leaf01
"""


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="archive_smoke_test_") as tmp_dir:
        archive_dir = str(Path(tmp_dir) / "archive")
        device = "leaf01"

        archive.ensure_archive_repo(archive_dir)
        print(f"1. ensure_archive_repo OK: {archive_dir}")

        committed = archive.snapshot_device(
            archive_dir, device, SAMPLE_CONFIG, {"trigger": "manual", "site": "lab1"}
        )
        assert committed is True, "expected first snapshot to commit"
        print("2. first snapshot committed: True (as expected)")

        committed_again = archive.snapshot_device(
            archive_dir, device, SAMPLE_CONFIG, {"trigger": "manual", "site": "lab1"}
        )
        assert committed_again is False, "expected unchanged snapshot to be a no-op"
        print("3. unchanged snapshot committed: False (as expected, no new commit)")

        history_after_noop = archive.history(archive_dir, device)
        assert len(history_after_noop) == 1, "no-op snapshot must not add a commit"
        print(f"   history length after no-op: {len(history_after_noop)} (expected 1)")

        committed_change = archive.snapshot_device(
            archive_dir,
            device,
            CHANGED_CONFIG,
            {
                "trigger": "watcher",
                "site": "lab1",
                "on_box_rev": 42,
                "on_box_user": "admin",
                "on_box_message": "updated eth1",
            },
        )
        assert committed_change is True, "expected changed snapshot to commit"
        print("4. changed snapshot committed: True (as expected)")

        hist = archive.history(archive_dir, device)
        assert len(hist) == 2, f"expected 2 history entries, got {len(hist)}"
        print(f"   history() entries: {len(hist)}")
        for entry in hist:
            print(f"   - {entry['commit'][:8]} {entry['date']} {entry['subject']}")
            if entry["body"]:
                print(f"     body: {entry['body']!r}")

        diff_text = archive.diff(archive_dir, device)
        print("   diff() output:")
        print(diff_text)
        assert "-nv set interface eth1 ip address 10.0.1.1/24" in diff_text
        assert "+nv set interface eth1 ip address 10.0.1.99/24" in diff_text
        removed_lines = [
            line for line in diff_text.splitlines() if line.startswith("-nv")
        ]
        added_lines = [
            line for line in diff_text.splitlines() if line.startswith("+nv")
        ]
        assert len(removed_lines) == 1, f"expected exactly 1 removed line, got {removed_lines}"
        assert len(added_lines) == 1, f"expected exactly 1 added line, got {added_lines}"
        print("5. diff shows exactly one changed line (as expected)")

        first_commit = hist[-1]["commit"]
        original_text = archive.show_at(archive_dir, device, first_commit)
        assert original_text == SAMPLE_CONFIG, "show_at should return original content"
        assert original_text != CHANGED_CONFIG
        print("6. show_at(first_commit) returns original content (as expected)")

        latest = archive.latest_snapshot_text(archive_dir, device)
        assert latest == CHANGED_CONFIG
        print("7. latest_snapshot_text returns current content (as expected)")

        missing = archive.latest_snapshot_text(archive_dir, "no-such-device")
        assert missing is None
        print("8. latest_snapshot_text for unknown device returns None (as expected)")

        empty_history = archive.history(archive_dir, "no-such-device")
        assert empty_history == []
        print("9. history for unknown device returns [] (as expected)")

        many_results = archive.snapshot_many(
            archive_dir,
            {"leaf01": CHANGED_CONFIG, "leaf02": SAMPLE_CONFIG},
            {"trigger": "periodic"},
            meta_by_device={"leaf02": {"site": "lab2"}},
        )
        assert many_results == {"leaf01": False, "leaf02": True}
        print("10. snapshot_many: leaf01 no-op, leaf02 new device committed (as expected)")

        print("\nALL ASSERTIONS PASSED")


if __name__ == "__main__":
    main()
