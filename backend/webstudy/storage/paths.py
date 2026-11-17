"""Filesystem locations following the XDG base directory spec.

The default app directory intentionally remains ``simplestudy`` so the web
backend can pick up existing config, state, checklist, and history files. Use
``WEBSTUDY_CONFIG_DIR`` / ``WEBSTUDY_STATE_DIR`` for side-by-side development or
tests.
"""

from __future__ import annotations

import os
from pathlib import Path

APP_DIR = "simplestudy"


def _base(env_var: str, fallback: str) -> Path:
    value = os.environ.get(env_var)
    if value:
        return Path(value).expanduser()
    return Path.home() / fallback


def _override(env_var: str) -> Path | None:
    value = os.environ.get(env_var)
    return Path(value).expanduser() if value else None


def config_dir() -> Path:
    override = _override("WEBSTUDY_CONFIG_DIR")
    if override is not None:
        return override
    return _base("XDG_CONFIG_HOME", ".config") / APP_DIR


def state_dir() -> Path:
    override = _override("WEBSTUDY_STATE_DIR")
    if override is not None:
        return override
    return _base("XDG_STATE_HOME", ".local/state") / APP_DIR


def config_path() -> Path:
    return config_dir() / "config.toml"


def state_path() -> Path:
    return state_dir() / "state.json"


def checklist_path() -> Path:
    return state_dir() / "checklist.json"


def history_path() -> Path:
    return state_dir() / "history.db"


def lock_path() -> Path:
    return state_dir() / "webstudy.lock"


def log_path() -> Path:
    return state_dir() / "webstudy.log"


def study_prep_path() -> Path:
    """Directory holding study-prep runs, extracted text, and source uploads."""
    return state_dir() / "study-prep"


def ensure_dirs() -> None:
    config_dir().mkdir(parents=True, exist_ok=True)
    state_dir().mkdir(parents=True, exist_ok=True)
