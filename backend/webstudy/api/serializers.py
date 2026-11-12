"""Conversion from domain objects to API payloads."""

from __future__ import annotations

from datetime import timedelta

from ..core.schedule import WEEKDAY_INDEX, WEEKDAY_NAMES, DayKind, DayPolicy, Schedule
from ..core.vacation import Vacation
from ..events import Event
from ..service import StudyService
from ..storage.config import Config, parse_boundary
from .schemas import (
    ChecklistSummaryResponse,
    ConfigResponse,
    ConfigUpdate,
    DayRowResponse,
    EventResponse,
    RecoveryResponse,
    SnapshotResponse,
    StateResponse,
    StatsResponse,
    StatsSummaryResponse,
    WeekdaySetting,
)


def state_response(service: StudyService) -> StateResponse:
    snapshot = service.snapshot()
    summary = service.checklist_summary()
    return StateResponse(
        server_time=service.clock.now().isoformat(timespec="seconds"),
        snapshot=SnapshotResponse(
            logical_day=snapshot.logical_day,
            weekday=snapshot.weekday,
            day_kind=snapshot.day_kind,
            debt_seconds=snapshot.debt_seconds,
            elapsed_seconds=snapshot.elapsed_seconds,
            required_seconds=snapshot.required_seconds,
            remaining_seconds=snapshot.remaining_seconds,
            optional_goal_seconds=snapshot.optional_goal_seconds,
            optional_done_seconds=snapshot.optional_done_seconds,
            phase=snapshot.phase,
            phase_elapsed_seconds=snapshot.phase_elapsed_seconds,
            phase_length_seconds=snapshot.phase_length_seconds,
            phase_remaining_seconds=snapshot.phase_remaining_seconds,
            running=snapshot.running,
            day_complete=snapshot.day_complete,
            is_free_day=snapshot.is_free_day,
            is_vacation=snapshot.is_vacation,
        ),
        checklist=ChecklistSummaryResponse(
            active_subject_id=summary.active_subject_id,
            active_item_id=summary.active_item_id,
            remaining_seconds=summary.remaining_seconds,
            overrun_seconds=summary.overrun_seconds,
            rest_remaining_seconds=summary.rest_remaining_seconds,
            revision=summary.revision,
        ),
    )


def event_response(event: Event) -> EventResponse:
    return EventResponse(
        kind=event.kind,
        summary=event.summary,
        body=event.body,
        urgent=event.urgent,
    )


def config_response(config: Config) -> ConfigResponse:
    return ConfigResponse.from_config(config)


def config_from_update(update: ConfigUpdate, current: Config) -> Config:
    """Build a full Config, preserving settings that are not in the web UI."""
    days: dict[int, DayPolicy] = {}
    for name in WEEKDAY_NAMES:
        setting: WeekdaySetting = update.schedule[name]
        kind = DayKind(setting.mode)
        quota = 0 if kind is DayKind.FREE else setting.quota_minutes * 60
        days[WEEKDAY_INDEX[name]] = DayPolicy(quota, kind)
    return Config(
        boundary=parse_boundary(update.boundary),
        auto_start=update.auto_start,
        study_seconds=update.study_minutes * 60,
        break_seconds=update.break_minutes * 60,
        notifications=update.notifications,
        schedule=Schedule(days),
        transparency=current.transparency,
        vacation=Vacation(
            enabled=update.vacation.enabled,
            start=update.vacation.start,
            end=update.vacation.end,
        ),
        max_debt_seconds=update.max_debt_hours * 60 * 60,
        reset_cooldown_days=update.reset_cooldown_days,
    )


def recovery_response(service: StudyService) -> RecoveryResponse:
    status = service.recovery()
    return RecoveryResponse(
        debt_seconds=status.debt_seconds,
        cooldown_days=status.cooldown_days,
        last_reset_on=status.last_reset_on,
        next_reset_on=status.next_reset_on,
        can_reset=status.can_reset,
    )


def current_streak(rows) -> int:
    """Number of consecutive completed study days, ignoring free days."""
    streak = 0
    for row in sorted(rows, key=lambda r: r.logical_date, reverse=True):
        if row.day_kind in (DayKind.FREE.value, DayKind.VACATION.value):
            continue
        if row.required_seconds == 0:
            continue
        if row.completed:
            streak += 1
        else:
            break
    return streak


def compliance(rows) -> tuple[int, int]:
    relevant = [row for row in rows if row.required_seconds > 0]
    return sum(1 for row in relevant if row.completed), len(relevant)


def stats_response(service: StudyService, days: int = 30) -> StatsResponse:
    if service.history is None:
        return StatsResponse(
            summary=StatsSummaryResponse(streak=0, completed=0, total=0, debt_seconds=0),
            days=[],
        )

    rows = service.history.all_days()
    today = service.snapshot().logical_day
    cutoff = today - timedelta(days=max(1, days) - 1)
    recent = [row for row in rows if row.logical_date >= cutoff]
    completed, total = compliance(recent)
    debt = rows[-1].debt_out_seconds if rows else 0
    return StatsResponse(
        summary=StatsSummaryResponse(
            streak=current_streak(rows),
            completed=completed,
            total=total,
            debt_seconds=debt,
        ),
        days=[
            DayRowResponse(
                logical_date=row.logical_date,
                weekday=row.weekday,
                day_kind=row.day_kind,
                quota_seconds=row.quota_seconds,
                debt_in_seconds=row.debt_in_seconds,
                required_seconds=row.required_seconds,
                elapsed_seconds=row.elapsed_seconds,
                debt_out_seconds=row.debt_out_seconds,
                optional_goal_seconds=row.optional_goal_seconds,
                optional_done_seconds=row.optional_done_seconds,
                study_seconds=row.study_seconds,
                break_seconds=row.break_seconds,
                completed=row.completed,
            )
            for row in recent
        ],
    )
