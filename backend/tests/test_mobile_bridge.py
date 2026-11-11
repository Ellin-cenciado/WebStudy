from __future__ import annotations

import importlib.util
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from webstudy.core.clock import FakeClock
from webstudy.service import StudyService
from webstudy.storage.config import Config

TZ = timezone(timedelta(hours=2))
MONDAY = (2026, 10, 12)


def at(hour: int = 10, minute: int = 0) -> datetime:
    return datetime(*MONDAY, hour, minute, tzinfo=TZ)


def load_bridge():
    path = (
        Path(__file__).resolve().parents[2]
        / "mobile"
        / "android"
        / "app"
        / "src"
        / "main"
        / "python"
        / "webstudy_bridge.py"
    )
    spec = importlib.util.spec_from_file_location("webstudy_bridge_test", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MobileBridgeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.bridge = load_bridge()
        self.bridge._drain_events()
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.clock = FakeClock(at())
        self.service = StudyService(
            Config(),
            self.clock,
            state_file=self.root / "state.json",
            history_file=self.root / "history.db",
            checklist_file=self.root / "checklist.json",
            persist=False,
        )
        self.addCleanup(self.service.close)
        self.addCleanup(self._tmp.cleanup)

    def test_notification_payload_tracks_study_break_and_pause(self) -> None:
        self.service.start()
        self.clock.advance(60)
        self.service.tick()
        payload = self.bridge._notification_payload(self.service)
        self.assertEqual(payload["title"], "Studying")
        self.assertTrue(payload["running"])
        self.assertEqual(payload["remaining_seconds"], 39 * 60)

        self.clock.advance(40 * 60)
        self.service.tick()
        payload = self.bridge._notification_payload(self.service)
        self.assertEqual(payload["title"], "Break")
        self.assertEqual(payload["phase"], "break")

        self.service.pause()
        payload = self.bridge._notification_payload(self.service)
        self.assertEqual(payload["title"], "Study timer paused")
        self.assertFalse(payload["running"])

    def test_poll_can_leave_events_for_a_foreground_client(self) -> None:
        self.service.start()
        self.clock.advance(40 * 60)
        first = self.bridge._poll_payload(self.service, drain_events=False)
        self.assertTrue(any(event["kind"] == "phase" for event in first["events"]))

        second = self.bridge._poll_payload(self.service, drain_events=False)
        self.assertEqual(len(second["events"]), len(first["events"]))

        drained = self.bridge._poll_payload(self.service, drain_events=True)
        self.assertEqual(len(drained["events"]), len(first["events"]))

        after = self.bridge._poll_payload(self.service, drain_events=False)
        self.assertEqual(after["events"], [])


if __name__ == "__main__":
    unittest.main()
