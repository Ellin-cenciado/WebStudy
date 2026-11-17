"""Shared state-mutation helpers for the HTTP transport."""

from __future__ import annotations

from typing import Any, Callable

from fastapi import FastAPI

from ..events import Event
from ..service import StudyService
from .serializers import event_response, state_response


async def run_command(app: FastAPI, action: Callable[[StudyService], Any]) -> Any:
    """Run a mutating service call, then broadcast the resulting state."""
    service = app.state.service
    async with app.state.lock:
        revision_before = service.checklist_revision()
        outcome = action(service)
        events: list[Event] = []
        value = outcome
        if isinstance(outcome, list):
            events = outcome
            value = None
        state = state_response(service).model_dump(mode="json")
        checklist = None
        if service.checklist_revision() != revision_before:
            checklist = service.checklist_data()

    await app.state.broadcaster.publish("state", state)
    if checklist is not None:
        await app.state.broadcaster.publish("checklist", checklist)
    for event in events:
        await app.state.broadcaster.publish(
            "event", event_response(event).model_dump(mode="json")
        )
    return value


async def publish_state(app: FastAPI) -> None:
    """Broadcast the current state and checklist without mutating anything."""
    async with app.state.lock:
        state = state_response(app.state.service).model_dump(mode="json")
        checklist = app.state.service.checklist_data()
    await app.state.broadcaster.publish("state", state)
    await app.state.broadcaster.publish("checklist", checklist)
