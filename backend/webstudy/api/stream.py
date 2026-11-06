"""Server-sent event fan-out for live state updates."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from starlette.requests import Request

from ..service import StudyService
from .serializers import event_response, state_response
from .schemas import EventResponse, StateResponse


class Broadcaster:
    """A bounded fan-out queue per connected browser."""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[tuple[str, dict[str, Any]]]] = set()

    def subscribe(self) -> asyncio.Queue[tuple[str, dict[str, Any]]]:
        queue: asyncio.Queue[tuple[str, dict[str, Any]]] = asyncio.Queue(maxsize=8)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[tuple[str, dict[str, Any]]]) -> None:
        self._subscribers.discard(queue)

    async def publish(self, event: str, payload: dict[str, Any]) -> None:
        if not self._subscribers:
            return
        message = (event, payload)
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                # A slow browser should see the newest state, not a backlog.
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    queue.put_nowait(message)
                except asyncio.QueueFull:
                    pass


def format_sse(event: str, payload: dict[str, Any]) -> str:
    data = json.dumps(payload, separators=(",", ":"), default=str)
    return f"event: {event}\ndata: {data}\n\n"


async def event_stream(
    request: Request,
    service: StudyService,
    broadcaster: Broadcaster,
    lock: asyncio.Lock,
):
    """Yield the initial full state, then every broadcast until disconnect."""
    queue = broadcaster.subscribe()
    try:
        async with lock:
            state: StateResponse = state_response(service)
            checklist = service.checklist_data()
        yield "retry: 2000\n\n"
        yield format_sse("state", state.model_dump(mode="json"))
        yield format_sse("checklist", checklist)

        while True:
            if await request.is_disconnected():
                break
            try:
                event, payload = await asyncio.wait_for(queue.get(), timeout=15)
            except TimeoutError:
                # Keep proxies and browsers from treating an idle stream as dead.
                yield ": keepalive\n\n"
                continue
            yield format_sse(event, payload)
    finally:
        broadcaster.unsubscribe(queue)


def event_payloads(events) -> list[EventResponse]:
    return [event_response(event) for event in events]
