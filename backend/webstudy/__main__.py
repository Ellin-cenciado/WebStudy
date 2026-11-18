"""Command-line entry point for the WebStudy backend."""

from __future__ import annotations

import argparse
import os
from pathlib import Path


def _watch_parent(parent_pid: int) -> None:
    """Stop the backend when the Electron shell disappears.

    This covers a shell crash in addition to the normal SIGTERM shutdown path,
    so an orphaned backend cannot keep the state-directory lock forever.
    """
    import signal
    import time

    while True:
        time.sleep(2.0)
        try:
            os.kill(parent_pid, 0)
        except ProcessLookupError:
            os.kill(os.getpid(), signal.SIGTERM)
            return
        except PermissionError:
            continue


def _start_parent_watchdog() -> None:
    value = os.environ.get("WEBSTUDY_PARENT_PID")
    if not value or os.name == "nt":
        return
    try:
        parent_pid = int(value)
    except ValueError:
        return
    if parent_pid <= 1 or parent_pid == os.getpid():
        return

    import threading

    threading.Thread(
        target=_watch_parent,
        args=(parent_pid,),
        name="webstudy-parent-watch",
        daemon=True,
    ).start()


def main(argv: list[str] | None = None) -> int:
    import uvicorn

    from .env import load_env_file

    load_env_file()

    parser = argparse.ArgumentParser(
        prog="webstudy", description="Run the WebStudy web backend"
    )
    parser.add_argument("--host", default=os.environ.get("WEBSTUDY_HOST", "127.0.0.1"))
    parser.add_argument(
        "--port", type=int, default=int(os.environ.get("WEBSTUDY_PORT", "8000"))
    )
    parser.add_argument("--config", type=Path, default=None, help="path to config.toml")
    parser.add_argument(
        "--state-dir",
        type=Path,
        default=None,
        help="state directory (default: ~/.local/state/simplestudy)",
    )
    parser.add_argument(
        "--frontend-dist",
        type=Path,
        default=None,
        help="built frontend directory",
    )
    parser.add_argument(
        "--timeout-graceful-shutdown",
        type=float,
        default=3.0,
        help=(
            "seconds to wait for open connections before forcing shutdown "
            "(default: 3; SSE clients keep a connection open)"
        ),
    )
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args(argv)

    if args.state_dir is not None:
        os.environ["WEBSTUDY_STATE_DIR"] = str(args.state_dir.expanduser())
    if args.frontend_dist is not None:
        os.environ["WEBSTUDY_FRONTEND_DIST"] = str(args.frontend_dist.expanduser())

    logging_level = "debug" if args.verbose else "info"
    from .storage import paths

    paths.ensure_dirs()

    from .api.app import create_app

    app = create_app(config_path=args.config)
    _start_parent_watchdog()
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level=logging_level,
        timeout_graceful_shutdown=args.timeout_graceful_shutdown,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
