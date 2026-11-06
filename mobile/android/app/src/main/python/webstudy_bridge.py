"""Chaquopy bridge for the WebStudy Android app.

This module exposes the existing Python service to React Native without
FastAPI or Pydantic. The Kotlin native module calls ``dispatch`` on a
single-threaded executor, so all service mutations are serialised.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import timedelta
from pathlib import Path

_lock = threading.RLock()
_service = None
_pending_events: list[dict] = []
_MAX_PENDING_EVENTS = 100


def _ok(data):
    return json.dumps({"ok": True, "data": data})


def _error(message: str):
    return json.dumps({"ok": False, "error": message})


def _event_dict(event):
    return {
        "kind": event.kind,
        "summary": event.summary,
        "body": event.body,
        "urgent": event.urgent,
    }


def _queue_events(events) -> None:
    for event in events or []:
        _pending_events.append(_event_dict(event))
    if len(_pending_events) > _MAX_PENDING_EVENTS:
        del _pending_events[:-_MAX_PENDING_EVENTS]


def _drain_events() -> list[dict]:
    events = list(_pending_events)
    _pending_events.clear()
    return events


def _snapshot_payload(service):
    snapshot = service.snapshot()
    summary = service.checklist_summary()
    return {
        "server_time": service.clock.now().isoformat(timespec="seconds"),
        "snapshot": {
            "logical_day": snapshot.logical_day.isoformat(),
            "weekday": snapshot.weekday,
            "day_kind": snapshot.day_kind,
            "debt_seconds": snapshot.debt_seconds,
            "elapsed_seconds": snapshot.elapsed_seconds,
            "required_seconds": snapshot.required_seconds,
            "remaining_seconds": snapshot.remaining_seconds,
            "optional_goal_seconds": snapshot.optional_goal_seconds,
            "optional_done_seconds": snapshot.optional_done_seconds,
            "phase": snapshot.phase,
            "phase_elapsed_seconds": snapshot.phase_elapsed_seconds,
            "phase_length_seconds": snapshot.phase_length_seconds,
            "phase_remaining_seconds": snapshot.phase_remaining_seconds,
            "running": snapshot.running,
            "day_complete": snapshot.day_complete,
            "is_free_day": snapshot.is_free_day,
        },
        "checklist": {
            "active_subject_id": summary.active_subject_id,
            "active_item_id": summary.active_item_id,
            "remaining_seconds": summary.remaining_seconds,
            "overrun_seconds": summary.overrun_seconds,
            "rest_remaining_seconds": summary.rest_remaining_seconds,
            "revision": summary.revision,
        },
    }


def _poll_payload(service):
    _queue_events(service.tick())
    return {
        "state": _snapshot_payload(service),
        "checklist": service.checklist_data(),
        "events": _drain_events(),
    }


def _config_payload(config):
    return {
        "boundary": f"{config.boundary.hour:02d}:{config.boundary.minute:02d}",
        "auto_start": config.auto_start,
        "study_minutes": config.study_seconds // 60,
        "break_minutes": config.break_seconds // 60,
        "notifications": config.notifications,
        "schedule": {
            name: {
                "mode": config.schedule.days[index].kind.value,
                "quota_minutes": config.schedule.days[index].quota_seconds // 60,
            }
            for index, name in enumerate(
                (
                    "monday",
                    "tuesday",
                    "wednesday",
                    "thursday",
                    "friday",
                    "saturday",
                    "sunday",
                )
            )
        },
    }


def _config_from_payload(payload, current):
    from webstudy.core.schedule import (
        WEEKDAY_INDEX,
        WEEKDAY_NAMES,
        DayKind,
        DayPolicy,
        Schedule,
    )
    from webstudy.storage.config import Config, parse_boundary

    days = {}
    for name in WEEKDAY_NAMES:
        setting = payload.get("schedule", {}).get(name, {})
        kind = DayKind(setting.get("mode", "carried"))
        quota = 0 if kind is DayKind.FREE else int(setting.get("quota_minutes", 0)) * 60
        days[WEEKDAY_INDEX[name]] = DayPolicy(quota, kind)

    return Config(
        boundary=parse_boundary(str(payload.get("boundary", "04:00"))),
        auto_start=bool(payload.get("auto_start", False)),
        study_seconds=int(payload.get("study_minutes", 40)) * 60,
        break_seconds=int(payload.get("break_minutes", 10)) * 60,
        notifications=bool(payload.get("notifications", True)),
        schedule=Schedule(days),
        transparency=current.transparency,
    )


def _current_streak(rows, day_kind_free: str) -> int:
    streak = 0
    for row in sorted(rows, key=lambda item: item.logical_date, reverse=True):
        if row.day_kind == day_kind_free:
            continue
        if row.required_seconds == 0:
            continue
        if row.completed:
            streak += 1
        else:
            break
    return streak


def _stats_payload(service, days: int):
    if service.history is None:
        return {
            "summary": {
                "streak": 0,
                "completed": 0,
                "total": 0,
                "debt_seconds": 0,
            },
            "days": [],
        }

    from webstudy.core.schedule import DayKind
    from webstudy.core.schedule import WEEKDAY_NAMES

    rows = service.history.all_days()
    today = service.snapshot().logical_day
    cutoff = today - timedelta(days=max(1, days) - 1)
    recent = [row for row in rows if row.logical_date >= cutoff]
    relevant = [row for row in recent if row.required_seconds > 0]
    completed = sum(1 for row in relevant if row.completed)
    debt = rows[-1].debt_out_seconds if rows else 0
    return {
        "summary": {
            "streak": _current_streak(rows, DayKind.FREE.value),
            "completed": completed,
            "total": len(relevant),
            "debt_seconds": debt,
        },
        "days": [
            {
                "logical_date": row.logical_date.isoformat(),
                "weekday": row.weekday,
                "day_kind": row.day_kind,
                "quota_seconds": row.quota_seconds,
                "debt_in_seconds": row.debt_in_seconds,
                "required_seconds": row.required_seconds,
                "elapsed_seconds": row.elapsed_seconds,
                "debt_out_seconds": row.debt_out_seconds,
                "optional_goal_seconds": row.optional_goal_seconds,
                "optional_done_seconds": row.optional_done_seconds,
                "study_seconds": row.study_seconds,
                "break_seconds": row.break_seconds,
                "completed": row.completed,
            }
            for row in recent
        ],
    }


def init(home: str) -> str:
    """Initialise paths and the service. Must be called exactly once."""
    global _service
    with _lock:
        if _service is not None:
            return _ok({"version": _version()})

        home_path = Path(home)
        os.environ["WEBSTUDY_CONFIG_DIR"] = str(home_path / "config" / "simplestudy")
        os.environ["WEBSTUDY_STATE_DIR"] = str(home_path / "state" / "simplestudy")

        from webstudy import __version__
        from webstudy.service import StudyService
        from webstudy.storage import config as config_mod
        from webstudy.storage import paths

        paths.ensure_dirs()
        config_path = paths.config_path()
        config = config_mod.load(config_path)
        if not config_path.exists():
            config_mod.save(config, config_path)

        service = StudyService(config)
        if config.auto_start:
            service.start()
        _queue_events(service.tick())
        _service = service
        return _ok({"version": __version__})


def _version():
    from webstudy import __version__

    return __version__


def dispatch(method: str, payload_json: str | None = None) -> str:
    """Execute a bridge request and return a JSON envelope."""
    global _service
    try:
        payload = json.loads(payload_json) if payload_json else {}
        if not isinstance(payload, dict):
            payload = {}
        with _lock:
            if method == "init":
                return init(str(payload.get("home", "")))
            if _service is None:
                return _error("The study engine is not initialized.")

            service = _service

            if method == "poll":
                return _ok(_poll_payload(service))

            if method == "config":
                return _ok(_config_payload(service.config))

            if method == "saveConfig":
                from webstudy.storage import config as config_mod

                current = service.config
                new_config = _config_from_payload(payload, current)
                config_mod.save(new_config)
                service.reload_config(new_config)
                return _ok(_config_payload(new_config))

            if method == "stats":
                days = int(payload.get("days", 30))
                return _ok(_stats_payload(service, max(1, min(365, days))))

            if method == "start":
                service.start()
            elif method == "pause":
                service.pause()
            elif method == "skipPhase":
                service.skip_phase()
            elif method == "addSubject":
                service.add_subject(str(payload.get("name", "")))
            elif method == "renameSubject":
                service.rename_subject(
                    str(payload.get("subjectId", "")),
                    str(payload.get("name", "")),
                )
            elif method == "removeSubject":
                service.remove_subject(str(payload.get("subjectId", "")))
            elif method == "selectSubject":
                service.select_subject(str(payload.get("subjectId", "")))
            elif method == "resetSubject":
                service.reset_subject(str(payload.get("subjectId", "")))
            elif method == "uncheckLast":
                service.uncheck_last_item(str(payload.get("subjectId", "")))
            elif method == "addItem":
                service.add_item(
                    str(payload.get("subjectId", "")),
                    str(payload.get("text", "")),
                    int(payload.get("durationSeconds", 0)),
                )
            elif method == "updateItem":
                item_id = str(payload.get("itemId", ""))
                text = payload.get("text")
                duration = payload.get("durationSeconds")
                if text is None and duration is None:
                    raise ValueError("nothing to update")
                if text is not None:
                    service.rename_item(item_id, str(text))
                if duration is not None:
                    service.set_item_duration(item_id, int(duration))
            elif method == "removeItem":
                service.remove_item(str(payload.get("itemId", "")))
            elif method == "checkItem":
                _queue_events(service.check_item(str(payload.get("itemId", ""))))
            elif method == "persist":
                service._persist(force=True)
            elif method == "shutdown":
                service.close()
                _service = None
            else:
                raise ValueError(f"unknown method: {method}")

            return _ok(_poll_payload(service))
    except Exception as exc:  # pragma: no cover - surfaced to React Native
        return _error(str(exc) or exc.__class__.__name__)
