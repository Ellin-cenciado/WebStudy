"""Pydantic request/response models for the WebStudy HTTP API."""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from ..core.schedule import WEEKDAY_NAMES
from ..storage.config import format_boundary, parse_boundary

DayMode = Literal["carried", "optional", "free"]


class SnapshotResponse(BaseModel):
    logical_day: date
    weekday: str
    day_kind: str
    debt_seconds: int
    elapsed_seconds: int
    required_seconds: int
    remaining_seconds: int
    optional_goal_seconds: int
    optional_done_seconds: int
    phase: str
    phase_elapsed_seconds: int
    phase_length_seconds: int
    phase_remaining_seconds: int
    running: bool
    day_complete: bool
    is_free_day: bool
    is_vacation: bool


class ChecklistSummaryResponse(BaseModel):
    active_subject_id: str = ""
    active_item_id: str = ""
    remaining_seconds: int = 0
    overrun_seconds: int = 0
    rest_remaining_seconds: int = 0
    revision: int = 0


class StateResponse(BaseModel):
    server_time: str
    snapshot: SnapshotResponse
    checklist: ChecklistSummaryResponse


class EventResponse(BaseModel):
    kind: str
    summary: str
    body: str
    urgent: bool = False
    params: dict[str, Any] = Field(default_factory=dict)


class WeekdaySetting(BaseModel):
    mode: DayMode = "carried"
    quota_minutes: int = Field(default=240, ge=0, le=24 * 60)

    @field_validator("quota_minutes")
    @classmethod
    def free_days_have_no_quota(cls, value: int, info):
        if info.data.get("mode") == "free":
            return 0
        return value


class VacationSettings(BaseModel):
    enabled: bool = False
    start: date | None = None
    end: date | None = None

    @model_validator(mode="after")
    def chronological_range(self) -> "VacationSettings":
        if self.start is not None and self.end is not None:
            if self.start > self.end:
                raise ValueError("vacation start must not be after end")
        return self


class ConfigResponse(BaseModel):
    boundary: str
    auto_start: bool
    study_minutes: int
    break_minutes: int
    notifications: bool
    schedule: dict[str, WeekdaySetting]
    vacation: VacationSettings
    max_debt_hours: int
    reset_cooldown_days: int

    @classmethod
    def from_config(cls, config) -> "ConfigResponse":
        return cls(
            boundary=format_boundary(config.boundary),
            auto_start=config.auto_start,
            study_minutes=config.study_seconds // 60,
            break_minutes=config.break_seconds // 60,
            notifications=config.notifications,
            schedule={
                name: WeekdaySetting(
                    mode=config.schedule.days[index].kind.value,
                    quota_minutes=config.schedule.days[index].quota_seconds // 60,
                )
                for index, name in enumerate(WEEKDAY_NAMES)
            },
            vacation=VacationSettings(
                enabled=config.vacation.enabled,
                start=config.vacation.start,
                end=config.vacation.end,
            ),
            max_debt_hours=config.max_debt_seconds // (60 * 60),
            reset_cooldown_days=config.reset_cooldown_days,
        )


class ConfigUpdate(BaseModel):
    boundary: str = "04:00"
    auto_start: bool = False
    study_minutes: int = Field(default=40, ge=1, le=240)
    break_minutes: int = Field(default=10, ge=1, le=120)
    notifications: bool = True
    schedule: dict[str, WeekdaySetting]
    vacation: VacationSettings = Field(default_factory=VacationSettings)
    max_debt_hours: int = Field(default=12, ge=0, le=24 * 7)
    reset_cooldown_days: int = Field(default=30, ge=1, le=365)

    @field_validator("boundary")
    @classmethod
    def valid_boundary(cls, value: str) -> str:
        parse_boundary(value)
        return value

    @field_validator("schedule")
    @classmethod
    def all_weekdays(cls, value: dict[str, WeekdaySetting]):
        missing = [name for name in WEEKDAY_NAMES if name not in value]
        if missing:
            raise ValueError(f"missing weekdays: {', '.join(missing)}")
        unknown = [name for name in value if name not in WEEKDAY_NAMES]
        if unknown:
            raise ValueError(f"unknown weekdays: {', '.join(unknown)}")
        return value


class RecoveryResponse(BaseModel):
    debt_seconds: int
    cooldown_days: int
    last_reset_on: date | None
    next_reset_on: date | None
    can_reset: bool


class ResetDebtResponse(BaseModel):
    forgiven_seconds: int
    recovery: RecoveryResponse


class DayRowResponse(BaseModel):
    logical_date: date
    weekday: str
    day_kind: str
    quota_seconds: int
    debt_in_seconds: int
    required_seconds: int
    elapsed_seconds: int
    debt_out_seconds: int
    optional_goal_seconds: int
    optional_done_seconds: int
    study_seconds: int
    break_seconds: int
    completed: bool


class StatsSummaryResponse(BaseModel):
    streak: int
    completed: int
    total: int
    debt_seconds: int


class StatsResponse(BaseModel):
    summary: StatsSummaryResponse
    days: list[DayRowResponse]


class NameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class SubjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ItemCreateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    duration_seconds: int = Field(default=0, ge=0, le=24 * 60 * 60)


class ItemUpdateRequest(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=500)
    duration_seconds: int | None = Field(default=None, ge=1, le=24 * 60 * 60)


class ItemResponse(BaseModel):
    id: str


class SubjectResponse(BaseModel):
    id: str
