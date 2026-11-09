"""Public and model-facing schemas for study preparation."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator

LanguageChoice = Literal["auto", "es", "en"]
ResolvedLanguage = Literal["es", "en"]
Depth = Literal["quick", "balanced", "deep"]
RunStatus = Literal[
    "queued",
    "running",
    "ready",
    "failed",
    "cancelled",
    "interrupted",
]
RunStage = Literal[
    "queued",
    "extracting",
    "mapping",
    "drafting",
    "planning",
    "ready",
    "failed",
    "cancelled",
    "interrupted",
]
SourceKind = Literal["pdf", "pptx", "md", "notes"]
SourceStatus = Literal["pending", "ready", "error"]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class SourceSummary(BaseModel):
    id: str
    filename: str
    kind: SourceKind
    title: str = ""
    unit_label: str = "p."
    unit_count: int = 0
    char_count: int = 0
    chapter_count: int = 0
    size_bytes: int = 0
    status: SourceStatus = "pending"
    error: str | None = None
    warnings: list[str] = Field(default_factory=list)


class RunOptions(BaseModel):
    language: LanguageChoice = "auto"
    depth: Depth = "balanced"
    target_minutes: int | None = Field(default=None, ge=10, le=10_000)


class RunError(BaseModel):
    code: str
    message: str
    hint: str | None = None


class RunSummary(BaseModel):
    id: str
    title: str
    status: RunStatus = "queued"
    stage: RunStage = "queued"
    progress: int = 0
    stage_detail: str = ""
    created_at: str
    updated_at: str
    options: RunOptions
    sources: list[SourceSummary] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    error: RunError | None = None
    has_result: bool = False
    imported_at: str | None = None
    total_duration_seconds: int | None = None
    item_count: int | None = None
    subject_count: int | None = None


class SourceRef(BaseModel):
    source_id: str
    source_name: str
    unit_label: str = "p."
    unit_start: int
    unit_end: int
    display: str


class NoteSection(BaseModel):
    id: str
    chapter_id: str
    chapter_title: str
    title: str
    exam_scope: bool = True
    grounded: bool = False
    markdown: str
    refs: list[SourceRef] = Field(default_factory=list)
    word_count: int = 0


class KeyTerm(BaseModel):
    term: str
    definition: str


class NotesDocument(BaseModel):
    title: str
    language: ResolvedLanguage
    summary: str
    exam_scope: list[str] = Field(default_factory=list)
    key_terms: list[KeyTerm] = Field(default_factory=list)
    sections: list[NoteSection] = Field(default_factory=list)
    sources: list[SourceSummary] = Field(default_factory=list)
    markdown: str
    word_count: int = 0


class PlanItem(BaseModel):
    temp_id: str
    text: str
    duration_seconds: int = Field(ge=60, le=24 * 60 * 60)
    kind: Literal["study", "review"] = "study"
    exam_scope: bool = True
    refs: list[SourceRef] = Field(default_factory=list)


class PlanSubject(BaseModel):
    temp_id: str
    name: str
    source_id: str
    chapter_id: str
    chapter_title: str
    items: list[PlanItem] = Field(default_factory=list)


class PlanTotals(BaseModel):
    duration_seconds: int = 0
    items: int = 0
    subjects: int = 0


class StudyPlan(BaseModel):
    version: int = 1
    title: str
    subjects: list[PlanSubject] = Field(default_factory=list)
    totals: PlanTotals = Field(default_factory=PlanTotals)
    target_minutes: int | None = None
    warnings: list[str] = Field(default_factory=list)


class RunResult(BaseModel):
    notes: NotesDocument
    plan: StudyPlan


class ChecklistImportItem(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    duration_seconds: int = Field(ge=60, le=24 * 60 * 60)


class ChecklistImportSubject(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    items: list[ChecklistImportItem] = Field(min_length=1, max_length=100)


class ChecklistImportRequest(BaseModel):
    subjects: list[ChecklistImportSubject] = Field(min_length=1, max_length=20)

    @field_validator("subjects")
    @classmethod
    def clean_subjects(
        cls, value: list[ChecklistImportSubject]
    ) -> list[ChecklistImportSubject]:
        cleaned: list[ChecklistImportSubject] = []
        for subject in value:
            name = subject.name.strip()
            if not name:
                raise ValueError("subject names must not be empty")
            items = [
                item.model_copy(update={"text": item.text.strip()})
                for item in subject.items
                if item.text.strip()
            ]
            if not items:
                raise ValueError(f"subject {name!r} has no items")
            cleaned.append(subject.model_copy(update={"name": name, "items": items}))
        return cleaned


class ChecklistImportSubjectResult(BaseModel):
    id: str
    name: str
    item_ids: list[str]


class ChecklistImportResult(BaseModel):
    revision: int
    subjects: list[ChecklistImportSubjectResult]
    total_items: int
    total_seconds: int


class StudyPrepConfig(BaseModel):
    configured: bool
    provider: str
    base_url: str
    model: str
    context_tokens: int
    max_output_tokens: int
    max_files: int = 10
    max_file_bytes: int = 50 * 1024 * 1024
    max_total_bytes: int = 200 * 1024 * 1024
    message: str = ""


class OutlineSection(BaseModel):
    title: str = ""
    focus: str = ""
    exam_scope: bool = True
    difficulty: int = Field(default=3, ge=1, le=5)
    start_unit: int | None = None
    end_unit: int | None = None
    search_queries: list[str] = Field(default_factory=list)


class OutlineChapter(BaseModel):
    chapter_id: str = ""
    sections: list[OutlineSection] = Field(default_factory=list)


class OutlineResponse(BaseModel):
    title: str = ""
    summary: str = ""
    language: ResolvedLanguage = "es"
    exam_scope: list[str] = Field(default_factory=list)
    key_terms: list[KeyTerm] = Field(default_factory=list)
    chapters: list[OutlineChapter] = Field(default_factory=list)

    @field_validator("key_terms")
    @classmethod
    def limit_key_terms(cls, value: list[KeyTerm]) -> list[KeyTerm]:
        return [term for term in value if term.term.strip()][:16]


class SectionDraft(BaseModel):
    markdown: str = ""
    chunk_ids: list[str] = Field(default_factory=list)
