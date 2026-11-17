"""Transport-neutral service events and notification protocol.

The domain service returns events; a transport (D-Bus, HTTP/SSE, tests) decides
how to deliver them. Keeping this module free of Gio means the web backend can
run on a headless machine without GTK/PyGObject installed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


@dataclass(frozen=True)
class Event:
    """Something interesting happened in the study session."""

    kind: str  # "phase" | "day_complete" | "day_rolled" | "item_expired" | ...
    summary: str
    body: str
    urgent: bool = False
    #: Structured values used by clients to localize the message.
    params: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class Notifier(Protocol):
    def notify(self, summary: str, body: str, *, urgent: bool = False) -> None: ...


class NullNotifier:
    """Does nothing; used when notifications are delivered by the web client."""

    def notify(self, summary: str, body: str, *, urgent: bool = False) -> None:
        return None
