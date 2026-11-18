"""Optional environment-file loading for local AI configuration.

The backend is configured through environment variables so the same engine can
run in the browser, desktop shell, and tests. Asking users to export a dozen
variables before every launch is unfriendly, so the launcher also reads one
simple ``KEY=VALUE`` file:

    ~/.config/simplestudy/webstudy.env

Real environment variables always win. Set ``WEBSTUDY_ENV_FILE`` to use another
path. The file is intentionally parsed without third-party dependencies and
does not expand shell syntax.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from .storage.paths import config_dir

_ENV_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def default_env_file() -> Path:
    return config_dir() / "webstudy.env"


def env_file_path() -> Path:
    override = os.environ.get("WEBSTUDY_ENV_FILE", "").strip()
    if override:
        return Path(override).expanduser()
    return default_env_file()


def _parse_value(raw: str) -> str:
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        quote = value[0]
        value = value[1:-1]
        if quote == '"':
            value = (
                value.replace("\\n", "\n")
                .replace("\\r", "\r")
                .replace("\\t", "\t")
                .replace('\\"', '"')
                .replace("\\$", "$")
                .replace("\\`", "`")
                .replace("\\\\", "\\")
            )
    return value


def load_env_file(path: Path | None = None) -> Path | None:
    """Load ``KEY=VALUE`` pairs from *path* without overriding real env vars.

    Returns the file that was read, or ``None`` when it does not exist. Blank
    lines, comments, ``export`` prefixes, and quoted values are supported.
    Invalid lines and keys are ignored so a typo cannot stop the app from
    starting.
    """
    target = path if path is not None else env_file_path()
    try:
        text = target.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError):
        return None

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("export "):
            stripped = stripped[len("export ") :].lstrip()
        key, separator, raw_value = stripped.partition("=")
        key = key.strip()
        if not separator or not _ENV_KEY.match(key):
            continue
        if key in os.environ:
            continue
        os.environ[key] = _parse_value(raw_value)

    return target
