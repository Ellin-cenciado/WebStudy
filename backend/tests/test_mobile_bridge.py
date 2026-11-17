from __future__ import annotations

import importlib.util
import json
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

    def test_config_payload_round_trips_vacation_and_recovery(self) -> None:
        from datetime import date

        from webstudy.core.vacation import Vacation

        config = Config(
            vacation=Vacation(
                enabled=True,
                start=date(2026, 12, 20),
                end=date(2027, 1, 5),
            ),
            max_debt_seconds=6 * 60 * 60,
            reset_cooldown_days=14,
        )
        payload = self.bridge._config_payload(config)
        self.assertEqual(payload["vacation"]["start"], "2026-12-20")
        self.assertEqual(payload["vacation"]["end"], "2027-01-05")
        self.assertEqual(payload["max_debt_hours"], 6)
        self.assertEqual(payload["reset_cooldown_days"], 14)

        restored = self.bridge._config_from_payload(payload, config)
        self.assertEqual(restored.vacation, config.vacation)
        self.assertEqual(restored.max_debt_seconds, config.max_debt_seconds)
        self.assertEqual(restored.reset_cooldown_days, 14)

    def test_vacation_notification_and_snapshot(self) -> None:
        from datetime import date

        from webstudy.core.vacation import Vacation

        self.service.tracker.vacation = Vacation(
            enabled=True,
            start=date(2026, 10, 12),
            end=date(2026, 10, 12),
        )
        payload = self.bridge._notification_payload(self.service)
        self.assertEqual(payload["title"], "Vacation")
        self.assertTrue(payload["is_vacation"])
        self.assertTrue(payload["is_free_day"])

        snapshot = self.bridge._snapshot_payload(self.service)["snapshot"]
        self.assertTrue(snapshot["is_vacation"])
        self.assertEqual(snapshot["day_kind"], "vacation")
        self.assertEqual(snapshot["required_seconds"], 0)

    def test_recovery_payload(self) -> None:
        payload = self.bridge._recovery_payload(self.service)
        self.assertEqual(payload["debt_seconds"], 0)
        self.assertFalse(payload["can_reset"])
        self.assertEqual(payload["cooldown_days"], 30)

    def test_dispatch_recovery_and_reset_debt(self) -> None:
        self.bridge._service = self.service
        self.addCleanup(lambda: setattr(self.bridge, "_service", None))

        recovery = json.loads(self.bridge.dispatch("recovery", "{}"))
        self.assertTrue(recovery["ok"])
        self.assertEqual(recovery["data"]["debt_seconds"], 0)

        self.clock.set_wall(
            datetime(2026, 10, 13, 10, 0, tzinfo=TZ)
        )
        self.service.tick()
        result = json.loads(self.bridge.dispatch("resetDebt", "{}"))
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["reset"]["forgiven_seconds"], 4 * 60 * 60)
        self.assertFalse(result["data"]["recovery"]["can_reset"])
        self.assertTrue(
            any(event["kind"] == "debt_reset" for event in result["data"]["events"])
        )
        self.assertEqual(result["data"]["state"]["snapshot"]["debt_seconds"], 0)


if __name__ == "__main__":
    unittest.main()
