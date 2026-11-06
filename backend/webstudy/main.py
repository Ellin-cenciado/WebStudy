"""Production ASGI entry point for ``uvicorn webstudy.main:app``."""

from __future__ import annotations

from .api.app import create_app

app = create_app()
