from __future__ import annotations

import tempfile
import unittest
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from webstudy.core.clock import FakeClock
from webstudy.core.pomodoro import PomodoroConfig
from webstudy.core.schedule import SECONDS_PER_HOUR, DayKind, DayPolicy, default_schedule
from webstudy.core.tracker import Tracker, TrackerState
from webstudy.core.vacation import Vacation
from webstudy.service import RecoveryCooldownError, StudyService
from webstudy.storage import config as config_mod
from webstudy.storage.config import Config

HOUR = SECONDS_PER_HOUR
TZ = timezone(timedelta(hours=2))
MONDAY = (2026, 10, 12)
TUESDAY = (2026, 10, 13)
WEDNESDAY = (2026, 10, 14)


def at(ymd, hour=10, minute=0) -> datetime:
    return datetime(*ymd, hour, minute, tzinfo=TZ)


def make_tracker(
    clock: FakeClock,
    *,
    vacation: Vacation | None = None,
    max_debt_seconds: int = 0,
    state: TrackerState | None = None,
) -> Tracker:
    return Tracker(
        clock=clock,
        schedule=default_schedule(),
        pomodoro=PomodoroConfig(),
        boundary=time(4, 0),
        state=state,
        vacation=vacation,
        max_debt_seconds=max_debt_seconds,
    )


class VacationTest(unittest.TestCase):
    def test_range_includes_only_enabled_dates(self):
        window = Vacation(
            enabled=True,
            start=date(2026, 10, 12),
            end=date(2026, 10, 14),
        )
        self.assertTrue(window.includes(date(2026, 10, 12)))
        self.assertTrue(window.includes(date(2026, 10, 13)))
        self.assertTrue(window.includes(date(2026, 10, 14)))
        self.assertFalse(window.includes(date(2026, 10, 11)))
        self.assertFalse(window.includes(date(2026, 10, 15)))
        self.assertFalse(
            Vacation(
                enabled=False,
                start=date(2026, 10, 12),
                end=date(2026, 10, 14),
            ).includes(date(2026, 10, 13))
        )

    def test_invalid_range_raises(self):
        with self.assertRaises(ValueError):
            Vacation(
                enabled=True,
                start=date(2026, 10, 14),
                end=date(2026, 10, 12),
            )

    def test_vacation_freezes_debt_without_adding_quota(self):
        clock = FakeClock(at(MONDAY))
        tracker = make_tracker(
            clock,
            vacation=Vacation(
                enabled=True,
                start=at(TUESDAY).date(),
                end=at(TUESDAY).date(),
            ),
        )
        # Monday is normal and missed, so it carries 4h debt.
        clock.set_wall(at(TUESDAY))
        tracker.sync()
        self.assertEqual(tracker.state.debt_seconds, 4 * HOUR)
        self.assertTrue(tracker.is_vacation)
        self.assertTrue(tracker.is_free_day)
        self.assertEqual(tracker.required_seconds, 0)
        self.assertEqual(tracker.policy.kind, DayKind.VACATION)

        # Tuesday vacation does not add another 4h quota.
        clock.set_wall(at(WEDNESDAY))
        tracker.sync()
        self.assertEqual(tracker.state.debt_seconds, 4 * HOUR)
        self.assertEqual(tracker.required_seconds, 8 * HOUR)  # 4h debt + Wed quota

    def test_current_vacation_day_has_no_requirement(self):
        clock = FakeClock(at(MONDAY))
        tracker = make_tracker(
            clock,
            vacation=Vacation(
                enabled=True,
                start=at(MONDAY).date(),
                end=None,
            ),
        )
        snapshot = tracker.snapshot()
        self.assertTrue(snapshot.is_vacation)
        self.assertTrue(snapshot.is_free_day)
        self.assertFalse(snapshot.day_complete)
        self.assertEqual(snapshot.required_seconds, 0)
        self.assertEqual(snapshot.day_kind, "vacation")


class DebtCeilingTest(unittest.TestCase):
    def test_settle_caps_debt_out_and_reports_forgiven(self):
        from webstudy.core.ledger import settle

        result = settle(
            DayPolicy(4 * HOUR, DayKind.CARRIED),
            date(2026, 10, 12),
            debt_in=0,
            elapsed=0,
            max_debt=2 * HOUR,
        )
        self.assertEqual(result.debt_out, 2 * HOUR)
        self.assertEqual(result.debt_forgiven, 2 * HOUR)

    def test_tracker_caps_existing_debt_on_load(self):
        clock = FakeClock(at(MONDAY))
        state = TrackerState(
            logical_day=at(MONDAY).date(),
            debt_seconds=10 * HOUR,
        )
        tracker = make_tracker(clock, max_debt_seconds=4 * HOUR, state=state)
        self.assertEqual(tracker.startup_debt_forgiven, 6 * HOUR)
        self.assertEqual(tracker.state.debt_seconds, 4 * HOUR)
        self.assertEqual(tracker.required_seconds, 8 * HOUR)

    def test_offline_rollover_applies_ceiling(self):
        clock = FakeClock(at(MONDAY))
        tracker = make_tracker(clock, max_debt_seconds=4 * HOUR)
        # Monday missed -> 4h debt; Tuesday missed would otherwise be 8h debt.
        clock.set_wall(at(TUESDAY))
        monday = tracker.sync()[0]
        clock.set_wall(at(WEDNESDAY))
        tuesday = tracker.sync()[0]
        self.assertEqual(monday.result.debt_out, 4 * HOUR)
        self.assertEqual(monday.result.debt_forgiven, 0)
        self.assertEqual(tuesday.result.debt_out, 4 * HOUR)
        self.assertEqual(tuesday.result.debt_forgiven, 4 * HOUR)
        self.assertEqual(tracker.state.debt_seconds, 4 * HOUR)


class ServiceRecoveryTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.state_file = self.tmp / "state.json"
        self.history_file = self.tmp / "history.db"
        self.checklist_file = self.tmp / "checklist.json"
        self.clock = FakeClock(at(MONDAY))

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def make_service(self, clock=None, *, config=None) -> StudyService:
        service = StudyService(
            config or Config(),
            clock or self.clock,
            state_file=self.state_file,
            history_file=self.history_file,
            checklist_file=self.checklist_file,
            persist=True,
        )
        self.addCleanup(service.close)
        return service

    def test_reset_clears_debt_and_starts_cooldown(self) -> None:
        service = self.make_service()
        self.clock.set_wall(at(TUESDAY))
        service.tick()  # settle Monday -> 4h debt
        status = service.recovery()
        self.assertEqual(status.debt_seconds, 4 * HOUR)
        self.assertTrue(status.can_reset)

        outcome = service.reset_debt()
        self.assertEqual(outcome.forgiven_seconds, 4 * HOUR)
        self.assertEqual(service.tracker.state.debt_seconds, 0)
        self.assertEqual(service.tracker.state.last_reset_day, at(TUESDAY).date())
        self.assertEqual(
            outcome.next_reset_on,
            at(TUESDAY).date() + timedelta(days=30),
        )

        status = service.recovery()
        self.assertFalse(status.can_reset)
        self.assertEqual(status.next_reset_on, outcome.next_reset_on)
        with self.assertRaises(RecoveryCooldownError):
            service.reset_debt()

    def test_reset_event_is_returned_on_next_tick(self) -> None:
        service = self.make_service()
        self.clock.set_wall(at(TUESDAY))
        service.tick()
        service.reset_debt()
        events = service.tick()
        self.assertTrue(any(event.kind == "debt_reset" for event in events))

    def test_cooldown_persists_across_service_restart(self) -> None:
        service = self.make_service()
        self.clock.set_wall(at(TUESDAY))
        service.tick()
        service.reset_debt()
        service.close()

        restarted = self.make_service()
        status = restarted.recovery()
        self.assertEqual(status.last_reset_on, at(TUESDAY).date())
        self.assertFalse(status.can_reset)

    def test_vacation_config_round_trip(self) -> None:
        original = Config(
            vacation=Vacation(
                enabled=True,
                start=date(2026, 10, 12),
                end=date(2026, 10, 14),
            ),
            max_debt_seconds=4 * HOUR,
            reset_cooldown_days=14,
        )
        restored = config_mod.loads(config_mod.dumps(original))
        self.assertEqual(restored.vacation, original.vacation)
        self.assertEqual(restored.max_debt_seconds, original.max_debt_seconds)
        self.assertEqual(restored.reset_cooldown_days, 14)


if __name__ == "__main__":
    unittest.main()
