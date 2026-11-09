"""The study-prep pipeline: extract, map, draft, assemble, and plan."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Awaitable, Callable

from .errors import (
    InvalidModelOutput,
    SourceExtractionError,
)
from .estimator import estimate_section_minutes, scale_minutes, split_minutes, task_text
from .models import (
    KeyTerm,
    NoteSection,
    NotesDocument,
    OutlineChapter,
    OutlineResponse,
    OutlineSection,
    PlanItem,
    PlanSubject,
    PlanTotals,
    RunOptions,
    RunResult,
    RunSummary,
    SectionDraft,
    SourceRef,
    SourceSummary,
    StudyPlan,
)
from .prompts import detect_language, outline_prompt, section_prompt
from .providers import LLMProvider
from .retrieval import (
    Chunk,
    build_chunks,
    build_rough_chunks,
    format_chunks,
    select_rough_chunks,
    select_source_chunks,
    source_catalog,
    unit_phrase,
)
from .sources import Chapter, ExtractedSource, extract_source, rough_notes_source
from .store import RunStore

ProgressCallback = Callable[[], Awaitable[None]]


@dataclass
class DraftSection:
    title: str
    focus: str
    exam_scope: bool
    difficulty: int
    search_queries: list[str]
    start: int
    end: int


@dataclass
class DraftChapter:
    source: ExtractedSource
    chapter: Chapter
    sections: list[DraftSection]


class StudyPrepPipeline:
    def __init__(
        self,
        *,
        store: RunStore,
        provider: LLMProvider,
        summary: RunSummary,
        on_change: ProgressCallback,
    ) -> None:
        self.store = store
        self.provider = provider
        self.summary = summary
        self.on_change = on_change

    async def run(self) -> RunResult:
        rough_notes = self.store.load_rough_notes(self.summary.id).strip()
        sources, rough_source = await self._extract_sources(rough_notes)
        if not sources and rough_source is None:
            raise SourceExtractionError(
                "No usable source material was found.",
                hint="Upload a PDF, PPTX, or Markdown file with extractable text.",
            )

        catalog_sources = sources or ([rough_source] if rough_source else [])
        language = self._resolve_language(rough_notes, catalog_sources)
        self.summary.options.language = language
        await self._progress(
            stage="mapping",
            progress=max(20, self.summary.progress),
            detail="Mapping your notes to the source structure…",
        )

        outline = await self._build_outline(
            rough_notes=rough_notes,
            catalog_sources=catalog_sources,
            language=language,
        )
        chapters = self._normalize_outline(outline, catalog_sources)
        if not chapters:
            raise InvalidModelOutput(
                "The language model did not identify any study chapters.",
                hint="Try again, or add clearer chapter hints to the rough notes.",
            )

        self.summary.title = outline.title.strip() or self.summary.title
        await self._progress(
            stage="drafting",
            progress=30,
            detail=f"Writing notes for {sum(len(chapter.sections) for chapter in chapters)} sections…",
        )

        source_chunks = build_chunks(catalog_sources)
        rough_chunks = build_rough_chunks(rough_notes) if rough_notes else []
        sections = await self._draft_sections(
            chapters,
            source_chunks=source_chunks,
            rough_chunks=rough_chunks,
            language=language,
        )
        if not sections:
            raise InvalidModelOutput("No note sections could be generated.")

        await self._progress(
            stage="planning",
            progress=90,
            detail="Estimating study time and building the checklist plan…",
        )
        plan = self._build_plan(chapters, sections, language=language)
        notes = self._assemble_notes(
            outline=outline,
            sections=sections,
            sources=self.summary.sources,
            language=language,
        )
        result = RunResult(notes=notes, plan=plan)
        self.store.save_result(self.summary.id, result)

        self.summary.status = "ready"
        self.summary.stage = "ready"
        self.summary.progress = 100
        self.summary.stage_detail = "Notes and study plan are ready."
        self.summary.has_result = True
        self.summary.total_duration_seconds = plan.totals.duration_seconds
        self.summary.item_count = plan.totals.items
        self.summary.subject_count = plan.totals.subjects
        self.summary.error = None
        await self.on_change()
        return result

    # -- extraction -----------------------------------------------------

    async def _extract_sources(
        self, rough_notes: str
    ) -> tuple[list[ExtractedSource], ExtractedSource | None]:
        await self._progress(
            stage="extracting",
            progress=5,
            detail="Extracting text and source structure…",
        )
        extracted: list[ExtractedSource] = []
        # A retry must not keep a synthetic rough-notes source from an earlier
        # attempt; raw uploads and the rough notes are still on disk.
        self.summary.sources = [
            source for source in self.summary.sources if source.id != "rough"
        ]
        total = max(1, len(self.summary.sources))
        for index, source_summary in enumerate(self.summary.sources):
            source_summary.status = "pending"
            source_summary.error = None
            await self.on_change()
            path = self.store.source_path(
                self.summary.id,
                f"{source_summary.id}{_suffix_for_kind(source_summary.kind)}",
            )
            try:
                source = extract_source(
                    path,
                    source_id=source_summary.id,
                    filename=source_summary.filename,
                    kind=source_summary.kind,
                )
                source.stored_name = path.name
                extracted.append(source)
                source_summary.status = "ready"
                source_summary.title = source.title
                source_summary.unit_label = source.unit_label
                source_summary.unit_count = source.unit_count
                source_summary.char_count = source.char_count
                source_summary.chapter_count = len(source.chapters)
                source_summary.warnings = list(source.warnings)
                self._add_warnings(source.warnings)
            except SourceExtractionError as exc:
                source_summary.status = "error"
                source_summary.error = exc.message
                source_summary.warnings = []
                self._add_warning(f"{source_summary.filename}: {exc.message}")
            await self._progress(
                detail=f"Extracted {index + 1}/{total} sources…",
                progress=5 + int(10 * (index + 1) / total),
            )

        rough_source: ExtractedSource | None = None
        if not extracted and rough_notes.strip():
            rough_source = rough_notes_source(rough_notes)
            rough_summary = SourceSummary(
                id="rough",
                filename="Rough notes",
                kind="notes",
                title="Rough notes",
                unit_label="section",
                unit_count=rough_source.unit_count,
                char_count=rough_source.char_count,
                chapter_count=len(rough_source.chapters),
                status="ready",
            )
            self.summary.sources.append(rough_summary)
            extracted = [rough_source]
            self._add_warning(
                "No uploaded source text was usable; the notes were generated from the rough notes alone."
            )
        if not extracted:
            raise SourceExtractionError(
                "None of the uploaded sources contained extractable text.",
                hint="Check for scanned PDFs or image-only slides, then upload text-based files.",
            )
        self.store.save_sources(
            self.summary.id,
            [source for source in extracted if source.id != "rough"] or extracted,
        )
        return extracted, rough_source

    # -- outline --------------------------------------------------------

    async def _build_outline(
        self,
        *,
        rough_notes: str,
        catalog_sources: list[ExtractedSource],
        language: str,
    ) -> OutlineResponse:
        budget = self.provider.config.char_budget
        catalog_budget = min(14_000, max(3_000, budget // 2))
        catalog = source_catalog(catalog_sources, max_chars=catalog_budget)
        rough_budget = max(1_000, budget - len(catalog) - 2_500)
        rough_excerpt = rough_notes[:rough_budget]
        if len(rough_notes) > len(rough_excerpt):
            self._add_warning(
                "The rough notes were truncated for the outline step because of the model context limit."
            )
        system, prompt = outline_prompt(
            rough_notes=rough_excerpt or "(no rough notes)",
            catalog=catalog or "(no source catalog)",
            options=self.summary.options,
            language=language,
        )
        raw = await self.provider.complete_json(
            system=system,
            prompt=prompt,
            max_tokens=min(3_500, self.provider.config.max_output_tokens),
            temperature=0.2,
        )
        try:
            return OutlineResponse.model_validate(raw)
        except ValueError as exc:
            raise InvalidModelOutput(
                f"The language model returned an invalid outline: {exc}"
            ) from exc

    def _normalize_outline(
        self,
        outline: OutlineResponse,
        catalog_sources: list[ExtractedSource],
    ) -> list[DraftChapter]:
        lookup: dict[str, tuple[ExtractedSource, Chapter]] = {}
        order: dict[str, int] = {}
        for source in catalog_sources:
            for chapter in source.chapters:
                lookup[chapter.id] = (source, chapter)
                order[chapter.id] = len(order)

        grouped: dict[str, list[DraftSection]] = {}
        chapter_order: list[str] = []
        for output_chapter in outline.chapters:
            chapter_id = output_chapter.chapter_id.strip()
            if chapter_id not in lookup:
                continue
            if chapter_id not in grouped:
                grouped[chapter_id] = []
                chapter_order.append(chapter_id)
            source, _chapter = lookup[chapter_id]
            for raw_section in output_chapter.sections:
                if len(grouped[chapter_id]) >= 6:
                    break
                section = self._normalize_section(raw_section, source, lookup[chapter_id][1])
                grouped[chapter_id].append(section)

        if not grouped:
            return self._fallback_chapters(catalog_sources)

        result: list[DraftChapter] = []
        total_sections = 0
        for chapter_id in chapter_order:
            source, chapter = lookup[chapter_id]
            sections = grouped[chapter_id]
            if not sections or total_sections >= 20:
                continue
            allowed = 20 - total_sections
            sections = sections[:allowed]
            total_sections += len(sections)
            self._fill_ranges(chapter, sections)
            result.append(
                DraftChapter(source=source, chapter=chapter, sections=sections)
            )
        return result

    def _normalize_section(
        self, raw: OutlineSection, source: ExtractedSource, chapter: Chapter
    ) -> DraftSection:
        title = " ".join(raw.title.split()).strip() or chapter.title
        focus = " ".join(raw.focus.split()).strip()
        queries = [query.strip() for query in raw.search_queries if query.strip()][:5]
        start = raw.start_unit
        end = raw.end_unit
        if (
            start is None
            or end is None
            or start > end
            or start < chapter.unit_start
            or end > chapter.unit_end
        ):
            start = None
            end = None
        return DraftSection(
            title=title[:200],
            focus=focus[:600],
            exam_scope=bool(raw.exam_scope),
            difficulty=max(1, min(5, int(raw.difficulty))),
            search_queries=queries,
            start=int(start) if start is not None else chapter.unit_start,
            end=int(end) if end is not None else chapter.unit_end,
        )

    def _fill_ranges(self, chapter: Chapter, sections: list[DraftSection]) -> None:
        valid = all(
            section.start >= chapter.unit_start
            and section.end <= chapter.unit_end
            and section.start <= section.end
            for section in sections
        )
        if valid and not any(
            section.start is None or section.end is None for section in sections
        ):
            # If ranges overlap heavily, split evenly instead of double-counting.
            ranges = sorted((section.start, section.end) for section in sections)
            overlap = any(
                ranges[index][0] <= ranges[index - 1][1]
                for index in range(1, len(ranges))
            )
            if not overlap:
                return
        span = chapter.unit_end - chapter.unit_start + 1
        per_section = max(1, span // max(1, len(sections)))
        cursor = chapter.unit_start
        for index, section in enumerate(sections):
            section.start = cursor
            if index == len(sections) - 1:
                section.end = chapter.unit_end
            else:
                section.end = min(chapter.unit_end, cursor + per_section - 1)
            cursor = section.end + 1

    def _fallback_chapters(
        self, catalog_sources: list[ExtractedSource]
    ) -> list[DraftChapter]:
        candidates: list[tuple[ExtractedSource, Chapter]] = []
        for source in catalog_sources:
            for chapter in source.chapters:
                if source.text_for_range(chapter.unit_start, chapter.unit_end).strip():
                    candidates.append((source, chapter))
        if not candidates:
            return []
        selected = candidates[:10]
        if len(candidates) > 10:
            self._add_warning(
                "The outline step failed validation, so the first 10 source chapters were used."
            )
        result: list[DraftChapter] = []
        for source, chapter in selected:
            result.append(
                DraftChapter(
                    source=source,
                    chapter=chapter,
                    sections=[
                        DraftSection(
                            title=chapter.title,
                            focus="",
                            exam_scope=True,
                            difficulty=3,
                            search_queries=[chapter.title],
                            start=chapter.unit_start,
                            end=chapter.unit_end,
                        )
                    ],
                )
            )
        return result

    # -- section drafting ----------------------------------------------

    async def _draft_sections(
        self,
        chapters: list[DraftChapter],
        *,
        source_chunks: list[Chunk],
        rough_chunks: list[Chunk],
        language: str,
    ) -> list[NoteSection]:
        total = sum(len(chapter.sections) for chapter in chapters)
        done = 0
        sections: list[NoteSection] = []
        source_budget = max(5_000, int(self.provider.config.char_budget * 0.55))
        rough_budget = max(3_000, int(self.provider.config.char_budget * 0.25))
        for chapter in chapters:
            for section in chapter.sections:
                query = " ".join(
                    [section.title, section.focus, *section.search_queries]
                ).strip()
                source_selection = select_source_chunks(
                    source_chunks,
                    query,
                    source_id=chapter.source.id,
                    chapter_id=chapter.chapter.id,
                    unit_start=section.start,
                    unit_end=section.end,
                    limit=8,
                    char_budget=source_budget,
                )
                rough_selection = select_rough_chunks(
                    rough_chunks,
                    query,
                    limit=5,
                    char_budget=rough_budget,
                )
                system, prompt = section_prompt(
                    chapter_title=chapter.chapter.title,
                    section_title=section.title,
                    focus=section.focus,
                    exam_scope=section.exam_scope,
                    language=language,
                    source_excerpts=format_chunks(source_selection),
                    rough_excerpts=format_chunks(rough_selection),
                    difficulty=section.difficulty,
                )
                raw = await self.provider.complete_json(
                    system=system,
                    prompt=prompt,
                    max_tokens=min(2_500, self.provider.config.max_output_tokens),
                    temperature=0.35,
                )
                try:
                    draft = SectionDraft.model_validate(raw)
                except ValueError as exc:
                    raise InvalidModelOutput(
                        f"The language model returned an invalid section: {exc}"
                    ) from exc
                markdown = draft.markdown.strip()
                if not markdown:
                    raise InvalidModelOutput(
                        f"The language model returned an empty section for {section.title!r}."
                    )
                selected_by_id = {chunk.id: chunk for chunk in source_selection}
                used = [
                    selected_by_id[chunk_id]
                    for chunk_id in draft.chunk_ids
                    if chunk_id in selected_by_id
                ]
                if not used and source_selection:
                    used = source_selection[: min(2, len(source_selection))]
                refs = _refs_from_chunks(used)
                sections.append(
                    NoteSection(
                        id=f"sec_{len(sections) + 1}",
                        chapter_id=chapter.chapter.id,
                        chapter_title=chapter.chapter.title,
                        title=section.title,
                        exam_scope=section.exam_scope,
                        grounded=bool(refs),
                        markdown=markdown,
                        refs=refs,
                        word_count=len(re.findall(r"\w+", markdown)),
                    )
                )
                done += 1
                await self._progress(
                    progress=30 + int(55 * done / max(1, total)),
                    detail=f"Drafting notes: {done}/{total} sections…",
                )
        return sections

    # -- plan -----------------------------------------------------------

    def _build_plan(
        self,
        chapters: list[DraftChapter],
        sections: list[NoteSection],
        *,
        language: str,
    ) -> StudyPlan:
        by_chapter: dict[str, list[NoteSection]] = {}
        for section in sections:
            by_chapter.setdefault(section.chapter_id, []).append(section)

        raw_minutes: list[int] = []
        section_meta: list[tuple[DraftChapter, DraftSection, NoteSection]] = []
        cursor: dict[str, int] = {}
        for chapter in chapters:
            candidates = by_chapter.get(chapter.chapter.id, [])
            for draft_section in chapter.sections:
                position = cursor.get(chapter.chapter.id, 0)
                matching = (
                    candidates[position] if position < len(candidates) else None
                )
                cursor[chapter.chapter.id] = position + 1
                if matching is None:
                    continue
                source_words = chapter.source.words_for_range(
                    draft_section.start, draft_section.end
                )
                unit_count = max(1, draft_section.end - draft_section.start + 1)
                minutes = estimate_section_minutes(
                    source_words=source_words,
                    unit_count=unit_count,
                    kind=chapter.source.kind,
                    note_words=matching.word_count,
                    difficulty=draft_section.difficulty,
                    exam_scope=draft_section.exam_scope,
                    depth=self.summary.options.depth,
                )
                raw_minutes.append(minutes)
                section_meta.append((chapter, draft_section, matching))

        scaled, scale_warning = scale_minutes(
            raw_minutes, self.summary.options.target_minutes
        )
        plan_warnings: list[str] = []
        if scale_warning:
            plan_warnings.append(scale_warning)
            self._add_warning(scale_warning)

        subjects: list[PlanSubject] = []
        used_names: set[str] = set()
        item_number = 0
        for index, (chapter, draft_section, note_section) in enumerate(section_meta):
            subject_key = chapter.chapter.id
            subject = next(
                (candidate for candidate in subjects if candidate.chapter_id == subject_key),
                None,
            )
            if subject is None:
                name = chapter.chapter.title.strip() or chapter.source.title
                if name in used_names:
                    name = f"{name} ({chapter.source.filename})"
                used_names.add(name)
                subject = PlanSubject(
                    temp_id=f"sub_{len(subjects) + 1}",
                    name=name[:200],
                    source_id=chapter.source.id,
                    chapter_id=chapter.chapter.id,
                    chapter_title=chapter.chapter.title,
                    items=[],
                )
                subjects.append(subject)
            minutes = scaled[index] if index < len(scaled) else raw_minutes[index]
            parts = split_minutes(minutes)
            for part_index, part_minutes in enumerate(parts, start=1):
                item_number += 1
                subject.items.append(
                    PlanItem(
                        temp_id=f"item_{item_number}",
                        text=task_text(
                            language=language,
                            section_title=draft_section.title,
                            refs=note_section.refs,
                            exam_scope=draft_section.exam_scope,
                            part=part_index,
                            parts=len(parts),
                        ),
                        duration_seconds=part_minutes * 60,
                        kind="study",
                        exam_scope=draft_section.exam_scope,
                        refs=note_section.refs,
                    )
                )

        total_seconds = sum(
            item.duration_seconds for subject in subjects for item in subject.items
        )
        total_items = sum(len(subject.items) for subject in subjects)
        return StudyPlan(
            title=self.summary.title,
            subjects=subjects,
            totals=PlanTotals(
                duration_seconds=total_seconds,
                items=total_items,
                subjects=len(subjects),
            ),
            target_minutes=self.summary.options.target_minutes,
            warnings=plan_warnings,
        )

    # -- assembly -------------------------------------------------------

    def _assemble_notes(
        self,
        *,
        outline: OutlineResponse,
        sections: list[NoteSection],
        sources: list[SourceSummary],
        language: str,
    ) -> NotesDocument:
        title = outline.title.strip() or self.summary.title
        exam_scope = [
            item.strip() for item in outline.exam_scope if item.strip()
        ][:20]
        key_terms = [
            KeyTerm(term=item.term.strip(), definition=item.definition.strip())
            for item in outline.key_terms
            if item.term.strip() and item.definition.strip()
        ][:12]
        labels = (
            {
                "summary": "Resumen",
                "scope": "Alcance de examen",
                "sources": "Fuentes",
                "terms": "Términos clave",
                "refs": "Fuentes",
            }
            if language == "es"
            else {
                "summary": "Summary",
                "scope": "Exam scope",
                "sources": "Sources",
                "terms": "Key terms",
                "refs": "Sources",
            }
        )
        lines: list[str] = [f"# {title}", ""]
        if outline.summary.strip():
            lines.extend([f"> {outline.summary.strip()}", ""])
        if exam_scope:
            lines.append(f"> **{labels['scope']}**")
            lines.extend(f"> - {item}" for item in exam_scope)
            lines.append("")
        if sources:
            lines.append(f"## {labels['sources']}")
            for source in sources:
                if source.status == "error":
                    continue
                lines.append(
                    f"- **{source.filename}** — {source.kind}, "
                    f"{unit_phrase(source.unit_label, source.unit_count)}, "
                    f"{source.title}"
                )
            lines.append("")

        current_chapter = ""
        for section in sections:
            if section.chapter_title != current_chapter:
                current_chapter = section.chapter_title
                lines.extend([f"## {current_chapter}", ""])
            lines.extend([f"### {section.title}", "", section.markdown, ""])
            if section.refs:
                lines.append(
                    f"_{labels['refs']}: "
                    + "; ".join(ref.display for ref in section.refs)
                    + "_"
                )
                lines.append("")

        if key_terms:
            lines.extend([f"## {labels['terms']}", ""])
            for term in key_terms:
                lines.append(f"- **{term.term}**: {term.definition}")
            lines.append("")

        markdown = "\n".join(lines).strip() + "\n"
        return NotesDocument(
            title=title,
            language="es" if language == "es" else "en",
            summary=outline.summary.strip(),
            exam_scope=exam_scope,
            key_terms=key_terms,
            sections=sections,
            sources=[source for source in sources if source.status == "ready"],
            markdown=markdown,
            word_count=sum(section.word_count for section in sections),
        )

    # -- helpers --------------------------------------------------------

    def _resolve_language(
        self, rough_notes: str, sources: list[ExtractedSource]
    ) -> str:
        if self.summary.options.language in {"es", "en"}:
            return self.summary.options.language
        sample = rough_notes
        if not sample:
            sample = "\n".join(
                source.text_for_range(1, min(3, source.unit_count))
                for source in sources
            )
        return detect_language(sample[:30_000])

    async def _progress(
        self,
        *,
        stage: str | None = None,
        progress: int | None = None,
        detail: str | None = None,
    ) -> None:
        if stage is not None:
            self.summary.stage = stage  # type: ignore[assignment]
        if progress is not None:
            self.summary.progress = max(0, min(100, progress))
        if detail is not None:
            self.summary.stage_detail = detail
        await self.on_change()

    def _add_warning(self, message: str) -> None:
        if message and message not in self.summary.warnings:
            self.summary.warnings.append(message)

    def _add_warnings(self, messages: list[str]) -> None:
        for message in messages:
            self._add_warning(message)


def _suffix_for_kind(kind: str) -> str:
    return {"pdf": ".pdf", "pptx": ".pptx", "md": ".md"}.get(kind, "")


def _refs_from_chunks(chunks: list[Chunk]) -> list[SourceRef]:
    by_source: dict[str, list[Chunk]] = {}
    for chunk in chunks:
        by_source.setdefault(chunk.source_id, []).append(chunk)
    refs: list[SourceRef] = []
    for source_id, source_chunks in by_source.items():
        units = sorted({chunk.unit_start for chunk in source_chunks})
        if not units:
            continue
        first = source_chunks[0]
        label = first.unit_label
        grouped: list[tuple[int, int]] = []
        for unit in units:
            if grouped and unit == grouped[-1][1] + 1:
                grouped[-1] = (grouped[-1][0], unit)
            else:
                grouped.append((unit, unit))
        for start, end in grouped:
            refs.append(
                SourceRef(
                    source_id=source_id,
                    source_name=first.source_name,
                    unit_label=label,
                    unit_start=start,
                    unit_end=end,
                    display=_format_ref_display(
                        first.source_name, label, start, end
                    ),
                )
            )
    return refs


def _format_ref_display(
    source_name: str, unit_label: str, start: int, end: int
) -> str:
    if unit_label == "p.":
        location = f"p. {start}" if start == end else f"pp. {start}–{end}"
    elif unit_label == "slide":
        location = f"slide {start}" if start == end else f"slides {start}–{end}"
    else:
        location = f"section {start}" if start == end else f"sections {start}–{end}"
    return f"{source_name} {location}"
