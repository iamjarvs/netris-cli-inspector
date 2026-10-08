"""Local configuration for cli-inspector: jump host, Netris API, archive path."""

import json
import os
from pathlib import Path
from typing import Any, Dict

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.json"

DEFAULTS: Dict[str, Any] = {
    "netris_url": "https://adam-ctl.netris.io",
    "netris_username": "netris",
    "netris_password": "",
    "ssh_jump_host": "adam-ctl.netris.io",
    "ssh_jump_port": 22,
    "ssh_jump_user": "ubuntu",
    "ssh_switch_user": "cumulus",
    "archive_dir": "~/.cli-inspector/archive",
}


class ConfigError(RuntimeError):
    pass


def load_config() -> Dict[str, Any]:
    cfg = dict(DEFAULTS)
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            cfg.update(json.load(f))
    cfg["archive_dir"] = str(Path(os.path.expanduser(cfg["archive_dir"])))
    return cfg


def save_config(cfg: Dict[str, Any]) -> None:
    on_disk = {k: v for k, v in cfg.items() if k in DEFAULTS}
    with open(CONFIG_PATH, "w") as f:
        json.dump(on_disk, f, indent=2)
    os.chmod(CONFIG_PATH, 0o600)


def config_is_complete(cfg: Dict[str, Any]) -> bool:
    return bool(cfg.get("netris_password"))
