"""SSH execution layer: reaches every switch by nesting a second SSH hop
through the jump host, using the jump host's own already-trusted key for the
final hop. No key is ever distributed to a switch, and no password is stored
for the jump host — key-based auth already works for this environment.
"""

from __future__ import annotations

import shlex
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Optional

import paramiko


class ExecutorError(RuntimeError):
    pass


@dataclass
class ExecResult:
    device: str
    ok: bool
    stdout: str = ""
    stderr: str = ""
    exit_status: Optional[int] = None
    error: Optional[str] = None


@dataclass
class ConfigRevision:
    rev_id: str
    apply_date: str
    rev_type: str
    user: str
    message: str


# NVUE's own floor -- passing anything lower fails inside NVUE itself.
NVUE_MIN_MAX_REVISIONS = 10
NVUE_MAX_MAX_REVISIONS = 100_000
NVUE_DEFAULT_MAX_REVISIONS = 100


@dataclass
class RevisionSettingStatus:
    device: str
    ok: bool
    configured: Optional[int] = None  # value in /etc/default/nvued (or the implicit default)
    running: Optional[int] = None  # value actually in the live nvued process's environment
    service_active: Optional[bool] = None
    error: Optional[str] = None


@dataclass
class RevisionApplyResult:
    device: str
    ok: bool
    previous: Optional[int] = None
    requested: Optional[int] = None
    verified: Optional[int] = None  # value read back from the restarted process's own environment
    service_active: Optional[bool] = None
    error: Optional[str] = None


def _parse_kv(stdout: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in stdout.splitlines():
        if "=" in line:
            key, _, value = line.partition("=")
            out[key.strip()] = value.strip()
    return out


# Both scripts read the *running* daemon's actual environment via /proc, not
# just the env file -- the file can be edited without a restart, so only the
# live process's environment proves what NVUE is actually enforcing.
_GET_MAX_REVISIONS_SCRIPT = r"""
FILE=/etc/default/nvued
CONFIGURED=$(sudo grep -E '^[[:space:]]*NVUE_MAX_REVISIONS=' "$FILE" 2>/dev/null | tail -1 | sed -E 's/^[[:space:]]*NVUE_MAX_REVISIONS=([0-9]+).*/\1/')
if [ -z "$CONFIGURED" ]; then CONFIGURED=100; fi
PID=$(systemctl show nvued -p MainPID --value 2>/dev/null || echo 0)
RUNNING=""
if [ -n "$PID" ] && [ "$PID" != "0" ]; then
  RUNNING=$(sudo cat /proc/$PID/environ 2>/dev/null | tr '\0' '\n' | grep '^NVUE_MAX_REVISIONS=' | sed 's/^NVUE_MAX_REVISIONS=//')
fi
if [ -z "$RUNNING" ]; then RUNNING=100; fi
ACTIVE=$(systemctl is-active nvued 2>/dev/null || echo unknown)
echo "CONFIGURED=$CONFIGURED"
echo "RUNNING=$RUNNING"
echo "ACTIVE=$ACTIVE"
""".strip()

_SET_MAX_REVISIONS_SCRIPT_TEMPLATE = r"""
set -e
FILE=/etc/default/nvued
PREV=$(sudo grep -E '^[[:space:]]*NVUE_MAX_REVISIONS=' "$FILE" 2>/dev/null | tail -1 | sed -E 's/^[[:space:]]*NVUE_MAX_REVISIONS=([0-9]+).*/\1/')
if [ -z "$PREV" ]; then PREV=100; fi
if sudo grep -qE '^[[:space:]]*NVUE_MAX_REVISIONS=' "$FILE" 2>/dev/null; then
  sudo sed -i -E "s/^[[:space:]]*NVUE_MAX_REVISIONS=.*/NVUE_MAX_REVISIONS=___VALUE___/" "$FILE"
elif sudo grep -qE '^[[:space:]]*#[[:space:]]*NVUE_MAX_REVISIONS=' "$FILE" 2>/dev/null; then
  sudo sed -i -E "s/^[[:space:]]*#[[:space:]]*NVUE_MAX_REVISIONS=.*/NVUE_MAX_REVISIONS=___VALUE___/" "$FILE"
else
  printf 'NVUE_MAX_REVISIONS=%s\n' "___VALUE___" | sudo tee -a "$FILE" > /dev/null
fi
sudo systemctl restart nvued
for i in 1 2 3 4 5 6 7 8; do
  sleep 1
  STATE=$(systemctl is-active nvued 2>/dev/null || true)
  if [ "$STATE" = "active" ]; then break; fi
done
ACTIVE=$(systemctl is-active nvued 2>/dev/null || echo unknown)
PID=$(systemctl show nvued -p MainPID --value 2>/dev/null || echo 0)
ACTUAL=""
if [ -n "$PID" ] && [ "$PID" != "0" ]; then
  ACTUAL=$(sudo cat /proc/$PID/environ 2>/dev/null | tr '\0' '\n' | grep '^NVUE_MAX_REVISIONS=' | sed 's/^NVUE_MAX_REVISIONS=//')
fi
if [ -z "$ACTUAL" ]; then ACTUAL=100; fi
echo "RESULT_PREV=$PREV"
echo "RESULT_ACTIVE=$ACTIVE"
echo "RESULT_ACTUAL=$ACTUAL"
""".strip()


class SwitchExecutor:
    def __init__(
        self,
        jump_host: str,
        jump_port: int,
        jump_user: str,
        switch_user: str = "cumulus",
        max_workers: int = 12,
        timeout: int = 20,
    ):
        self.jump_host = jump_host
        self.jump_port = jump_port
        self.jump_user = jump_user
        self.switch_user = switch_user
        self.timeout = timeout
        self._local = threading.local()
        self._pool = ThreadPoolExecutor(max_workers=max_workers)

    def _jump_client(self) -> paramiko.SSHClient:
        client = getattr(self._local, "client", None)
        if client is not None:
            return client
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            self.jump_host,
            port=self.jump_port,
            username=self.jump_user,
            look_for_keys=True,
            allow_agent=True,
            timeout=self.timeout,
        )
        self._local.client = client
        return client

    def test_jump_connection(self) -> tuple[bool, str]:
        try:
            self._jump_client()
            return True, ""
        except Exception as e:
            return False, str(e)

    def close(self) -> None:
        client = getattr(self._local, "client", None)
        if client is not None:
            try:
                client.close()
            finally:
                self._local.client = None
        self._pool.shutdown(wait=False)

    def exec_on_jump(self, command: str, timeout: Optional[int] = None) -> ExecResult:
        """Executes a command directly on the jump host itself."""
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                jump = self._jump_client()
            except Exception as e:
                last_error = e
                self._local.client = None
                if attempt == 0:
                    time.sleep(1)
                    continue
                return ExecResult(device="jump_host", ok=False, error=f"jump host connection failed: {e}")

            try:
                stdin, stdout, stderr = jump.exec_command(command, timeout=timeout or self.timeout)
                stdin.close()
                out = stdout.read().decode("utf-8", errors="replace")
                err = stderr.read().decode("utf-8", errors="replace")
                status = stdout.channel.recv_exit_status()
                return ExecResult(device="jump_host", ok=(status == 0), stdout=out, stderr=err, exit_status=status)
            except Exception as e:
                last_error = e
                self._local.client = None
                if attempt == 0:
                    time.sleep(1)
                    continue
                return ExecResult(device="jump_host", ok=False, error=str(e))
        return ExecResult(device="jump_host", ok=False, error=str(last_error))

    def exec_on_device(self, device: str, mgmt_address: str, command: str, timeout: Optional[int] = None) -> ExecResult:
        # A fresh jump-host SSH handshake occasionally gets reset when many
        # worker threads all dial in at once (observed live: 5/18 in one
        # batch under 12-way concurrency, all against an otherwise-healthy
        # jump host) -- one retry with a fresh connection clears this up
        # reliably, so bulk fleet-wide operations don't report false
        # per-device failures from a transient jump-host hiccup.
        conn_timeout = max(1, min(timeout, 8)) if timeout else 8
        remote_cmd = (
            f"ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "
            f"-o BatchMode=yes -o ConnectTimeout={conn_timeout} "
            f"{self.switch_user}@{mgmt_address} {shlex.quote(command)}"
        )
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                jump = self._jump_client()
            except Exception as e:
                last_error = e
                self._local.client = None
                if attempt == 0:
                    time.sleep(1)
                    continue
                return ExecResult(device=device, ok=False, error=f"jump host connection failed: {e}")

            try:
                stdin, stdout, stderr = jump.exec_command(remote_cmd, timeout=timeout or self.timeout)
                stdin.close()
                out = stdout.read().decode("utf-8", errors="replace")
                err = stderr.read().decode("utf-8", errors="replace")
                status = stdout.channel.recv_exit_status()
                return ExecResult(device=device, ok=(status == 0), stdout=out, stderr=err, exit_status=status)
            except Exception as e:
                last_error = e
                self._local.client = None  # discard a possibly-broken connection before retrying
                if attempt == 0:
                    time.sleep(1)
                    continue
                return ExecResult(device=device, ok=False, error=str(e))
        return ExecResult(device=device, ok=False, error=str(last_error))

    def exec_many(
        self, targets: list[tuple[str, str]], command: str, timeout: Optional[int] = None
    ) -> dict[str, ExecResult]:
        futures = {
            self._pool.submit(self.exec_on_device, name, addr, command, timeout): name
            for name, addr in targets
        }
        results: dict[str, ExecResult] = {}
        for future in futures:
            name = futures[future]
            results[name] = future.result()
        return results

    # -- NVUE-specific helpers ------------------------------------------------

    def nv_show(self, device: str, mgmt_address: str, args: str, as_json: bool = True) -> ExecResult:
        fmt = " -o json" if as_json else ""
        return self.exec_on_device(device, mgmt_address, f"nv show {args}{fmt}")

    def nv_show_many(
        self, targets: list[tuple[str, str]], args: str, as_json: bool = True
    ) -> dict[str, ExecResult]:
        fmt = " -o json" if as_json else ""
        return self.exec_many(targets, f"nv show {args}{fmt}")

    def get_full_config_commands(self, device: str, mgmt_address: str) -> ExecResult:
        return self.exec_on_device(device, mgmt_address, "nv config show -r applied -o commands")

    def get_full_config_commands_many(self, targets: list[tuple[str, str]]) -> dict[str, ExecResult]:
        return self.exec_many(targets, "nv config show -r applied -o commands")

    def get_full_config_json(self, device: str, mgmt_address: str) -> ExecResult:
        return self.exec_on_device(device, mgmt_address, "nv config show -r applied -o json")

    def get_full_config_json_many(self, targets: list[tuple[str, str]]) -> dict[str, ExecResult]:
        return self.exec_many(targets, "nv config show -r applied -o json")

    def get_config_text_for_rev(self, device: str, mgmt_address: str, rev: str) -> ExecResult:
        return self.exec_on_device(device, mgmt_address, f"nv config show -r {shlex.quote(rev)} -o commands")

    def get_config_json_for_rev(self, device: str, mgmt_address: str, rev: str) -> ExecResult:
        return self.exec_on_device(device, mgmt_address, f"nv config show -r {shlex.quote(rev)} -o json")

    def get_config_history(self, device: str, mgmt_address: str, limit: int = 20) -> ExecResult:
        return self.exec_on_device(device, mgmt_address, "nv config history")

    def get_live_revision_ids(self, device: str, mgmt_address: str) -> ExecResult:
        """`nv config history` keeps listing every revision it ever recorded,
        long after NVUE's own count-based pruning (NVUE_MAX_REVISIONS) has
        deleted the underlying git commit -- that's what produces "Unknown
        revision" errors on old-looking-valid rows. /var/lib/nvue/meta/ holds
        exactly the still-fetchable revisions (confirmed live: it tracks the
        same rolling window nvued actually enforces), so listing it is a
        cheap, accurate way to tell which history rows are pruned.
        """
        return self.exec_on_device(device, mgmt_address, "sudo ls -1 /var/lib/nvue/meta 2>/dev/null", timeout=15)

    def get_config_diff(
        self, device: str, mgmt_address: str, rev_a: str, rev_b: str = "applied", fmt: str = "commands"
    ) -> ExecResult:
        return self.exec_on_device(
            device, mgmt_address, f"nv config diff {shlex.quote(rev_a)} {shlex.quote(rev_b)} -o {fmt}"
        )

    # -- NVUE_MAX_REVISIONS retention setting ---------------------------------
    # This lives outside NVUE's own `nv set`-managed config tree entirely --
    # it's an env var read by the nvued daemon from /etc/default/nvued at
    # startup, so changing it means editing that file and restarting the
    # service. Never touches NVUE's own config/revision history.

    def get_max_revisions(self, device: str, mgmt_address: str) -> RevisionSettingStatus:
        result = self.exec_on_device(device, mgmt_address, _GET_MAX_REVISIONS_SCRIPT, timeout=15)
        if not result.ok:
            return RevisionSettingStatus(device=device, ok=False, error=result.error or result.stderr)
        kv = _parse_kv(result.stdout)
        try:
            return RevisionSettingStatus(
                device=device,
                ok=True,
                configured=int(kv["CONFIGURED"]),
                running=int(kv["RUNNING"]),
                service_active=kv.get("ACTIVE") == "active",
            )
        except (KeyError, ValueError):
            return RevisionSettingStatus(device=device, ok=False, error=f"unexpected output: {result.stdout!r}")

    def get_max_revisions_many(self, targets: list[tuple[str, str]]) -> dict[str, RevisionSettingStatus]:
        futures = {self._pool.submit(self.get_max_revisions, name, addr): name for name, addr in targets}
        return {futures[f]: f.result() for f in futures}

    def set_max_revisions(self, device: str, mgmt_address: str, value: int) -> RevisionApplyResult:
        if not (NVUE_MIN_MAX_REVISIONS <= value <= NVUE_MAX_MAX_REVISIONS):
            return RevisionApplyResult(
                device=device, ok=False, requested=value,
                error=f"value must be between {NVUE_MIN_MAX_REVISIONS} and {NVUE_MAX_MAX_REVISIONS} (NVUE itself floors it at {NVUE_MIN_MAX_REVISIONS})",
            )
        script = _SET_MAX_REVISIONS_SCRIPT_TEMPLATE.replace("___VALUE___", str(value))
        result = self.exec_on_device(device, mgmt_address, script, timeout=45)
        if not result.ok:
            return RevisionApplyResult(device=device, ok=False, requested=value, error=result.error or result.stderr)
        kv = _parse_kv(result.stdout)
        try:
            previous = int(kv["RESULT_PREV"])
            verified = int(kv["RESULT_ACTUAL"])
        except (KeyError, ValueError):
            return RevisionApplyResult(device=device, ok=False, requested=value, error=f"unexpected output: {result.stdout!r}")
        active = kv.get("RESULT_ACTIVE") == "active"
        success = active and verified == value
        return RevisionApplyResult(
            device=device,
            ok=success,
            previous=previous,
            requested=value,
            verified=verified,
            service_active=active,
            error=None if success else f"nvued restarted but did not come up with the requested value (service_active={active}, running_value={verified})",
        )

    def set_max_revisions_many(self, targets: list[tuple[str, str]], value: int) -> dict[str, RevisionApplyResult]:
        futures = {self._pool.submit(self.set_max_revisions, name, addr, value): name for name, addr in targets}
        return {futures[f]: f.result() for f in futures}


def parse_live_revision_ids(raw: str) -> set[str]:
    """Numeric entries in /var/lib/nvue/meta/ -- excludes the alias entries
    ('applied', 'empty', 'startup') since those aren't numbered revisions.
    """
    return {line.strip() for line in raw.splitlines() if line.strip().isdigit()}


def parse_config_history(raw: str) -> list[ConfigRevision]:
    revisions: list[ConfigRevision] = []
    for line in raw.splitlines():
        line = line.rstrip()
        if not line or line.startswith("Rev ID") or set(line.replace(" ", "")) <= {"-"}:
            continue
        if line.startswith("Welcome to"):
            continue
        parts = line.split(None, 4)
        if len(parts) < 4:
            continue
        rev_id, apply_date, rev_type, user = parts[0], parts[1], parts[2], parts[3]
        message = parts[4].strip() if len(parts) > 4 else ""
        revisions.append(ConfigRevision(rev_id, apply_date, rev_type, user, message))
    return revisions
