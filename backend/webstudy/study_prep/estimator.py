"""Deterministic study-time estimates and task splitting."""

from __future__ import annotations

from .models import SourceRef

DEPTH_FACTORS = {"quick": 0.75, "balanced": 1.0, "deep": 1.3}
UNIT_OVERHEAD_MINUTES = {"pdf": 0.25, "pptx": 0.5, "md": 0.15, "notes": 0.15}
MAX_TASK_MINUTES = 60
MIN_TASK_MINUTES = 10


def estimate_section_minutes(
    *,
    source_words: int,
    unit_count: int,
    kind: str,
    note_words: int,
    difficulty: int,
    exam_scope: bool,
    depth: str,
) -> int:
    reading_minutes = source_words / 170.0
    structure_minutes = unit_count * UNIT_OVERHEAD_MINUTES.get(kind, 0.25)
    notes_minutes = note_words / 120.0
    base = max(reading_minutes + structure_minutes, notes_minutes)
    difficulty_factor = 0.8 + 0.1 * max(1, min(5, difficulty))
    scope_factor = 1.0 if exam_scope else 0.55
    minutes = base * DEPTH_FACTORS.get(depth, 1.0) * difficulty_factor * scope_factor
    minutes *= 1.12
    return max(MIN_TASK_MINUTES, int(round(minutes / 5.0) * 5))


def split_minutes(minutes: int) -> list[int]:
    if minutes <= MAX_TASK_MINUTES:
        return [max(MIN_TASK_MINUTES, minutes)]
    parts = max(2, (minutes + MAX_TASK_MINUTES - 1) // MAX_TASK_MINUTES)
    base = max(1, minutes // parts)
    result = [base] * parts
    result[-1] += minutes - sum(result)
    return [max(MIN_TASK_MINUTES, part) for part in result]


def scale_minutes(minutes: list[int], target_minutes: int | None) -> tuple[list[int], str | None]:
    total = sum(minutes)
    if target_minutes is None or total <= 0:
        return minutes, None
    if target_minutes >= total:
        if target_minutes > total * 1.15:
            return (
                minutes,
                "The target is above the automatic estimate; the plan was not padded with busywork.",
            )
        return minutes, None
    factor = max(0.6, target_minutes / total)
    scaled = [
        max(MIN_TASK_MINUTES, int(round((minute * factor) / 5.0) * 5))
        for minute in minutes
    ]
    if sum(scaled) > target_minutes * 1.15:
        return (
            scaled,
            "The target is below the shortest workable plan. Durations were reduced, "
            "but reaching it exactly would mean dropping topics.",
        )
    return scaled, None


def task_text(
    *,
    language: str,
    section_title: str,
    refs: list[SourceRef],
    exam_scope: bool,
    part: int,
    parts: int,
) -> str:
    title = create_placeholder(section_title)
    displays = [ref.display for ref in refs[:2]]
    if language == "es":
        if displays:
            body = f"Estudiar «{title}»: leer {', '.join(displays)} y resumir los puntos clave"
        else:
            body = f"Estudiar «{title}»: repasar las notas y sintetizar los puntos clave"
        if not exam_scope:
            body = "Opcional — " + body
        if parts > 1:
            body += f" (parte {part}/{parts})"
    else:
        if displays:
            body = f"Study “{title}”: read {', '.join(displays)} and summarize the key points"
        else:
            body = f"Study “{title}”: review the notes and summarize the key points"
        if not exam_scope:
            body = "Optional — " + body
        if parts > 1:
            body += f" (part {part}/{parts})"
    return body[:500]


def create_placeholder(title: str) -> str:
    cleaned = " ".join(title.split()).strip()
    return cleaned or "Study topic"


def group_refs_display(refs: list[SourceRef]) -> str:
    return "; ".join(ref.display for ref in refs)
