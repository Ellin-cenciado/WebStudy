"""Production ASGI entry point for ``uvicorn webstudy.main:app``."""

from __future__ import annotations

from .api.app import create_app
from .env import load_env_file

load_env_file()

app = create_app()
