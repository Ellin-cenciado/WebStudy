"""Vacation date ranges.

A vacation day is a no-requirement day: it never adds new debt, but existing
debt is preserved. Study time on a vacation day would still pay debt down, but
the UI treats vacation like a free day and does not start a session.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Vacation:
    """An optional date range during which the schedule is suspended."""

    enabled: bool = False
    start: date | None = None
    end: date | None = None

    def __post_init__(self) -> None:
        if self.start is not None and self.end is not None:
            if self.start > self.end:
                raise ValueError("vacation start must not be after end")

    def includes(self, day: date) -> bool:
        if not self.enabled:
            return False
        if self.start is not None and day < self.start:
            return False
        if self.end is not None and day > self.end:
            return False
        return True
