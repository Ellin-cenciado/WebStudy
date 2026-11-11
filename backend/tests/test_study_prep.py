from __future__ import annotations

import asyncio
import re
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from webstudy.api.app import create_app
from webstudy.core.clock import FakeClock
from webstudy.service import StudyService
from webstudy.storage.config import Config
from webstudy.study_prep.estimator import (
    estimate_section_minutes,
    scale_minutes,
    split_minutes,
    task_text,
)
from webstudy.study_prep.manager import StudyPrepManager
from webstudy.study_prep.models import (
    RunOptions,
    RunSummary,
    SourceRef,
    SourceSummary,
    utc_now,
)
from webstudy.study_prep.pipeline import StudyPrepPipeline
from webstudy.study_prep.providers import LLMConfig
from webstudy.study_prep.retrieval import (
    scope_focus,
    source_catalog,
    text_matches_focus,
)
from webstudy.study_prep.sources import (
    Chapter,
    ExtractedSource,
    Heading,
    extract_markdown_text,
    extract_source,
)
from webstudy.study_prep.store import RunStore

TZ = timezone(timedelta(hours=2))
MONDAY = (2026, 10, 12)


def at(hour: int = 10, minute: int = 0) -> datetime:
    return datetime(*MONDAY, hour, minute, tzinfo=TZ)


class FakeProvider:
    """Deterministic OpenAI-compatible provider used by pipeline tests."""

    config = LLMConfig(
        base_url="http://fake.invalid/v1",
        model="fake",
        api_key="",
        context_tokens=16_384,
        max_output_tokens=2_500,
        timeout_seconds=30,
        provider="openai-compatible",
    )

    def __init__(self) -> None:
        self.outline_calls = 0
        self.section_calls = 0
        self.last_outline_prompt = ""

    async def complete_json(
        self,
        *,
        system: str,
        prompt: str,
        max_tokens: int | None = None,
        temperature: float = 0.2,
    ) -> dict:
        if "Plan a study document" in prompt:
            self.outline_calls += 1
            self.last_outline_prompt = prompt
            chapter_ids = re.findall(r"CHAPTER (\S+)", prompt)
            chapters = []
            for chapter_id in chapter_ids:
                chapters.append(
                    {
                        "chapter_id": chapter_id,
                        "sections": [
                            {
                                "title": f"Topic {chapter_id}",
                                "focus": "Cover the chapter.",
                                "exam_scope": True,
                                "difficulty": 3,
                                "start_unit": 1,
                                "end_unit": 9_999,
                                "search_queries": ["key idea"],
                            }
                        ],
                    }
                )
            return {
                "title": "Cell Biology",
                "summary": "A short exam-oriented course.",
                "language": "es",
                "exam_scope": ["Everything except the appendix."],
                "key_terms": [
                    {"term": "Cell", "definition": "The basic unit of life."}
                ],
                "chapters": chapters,
            }

        self.section_calls += 1
        chunk_ids = re.findall(r"\[(c\d+)\]", prompt)
        return {
            "markdown": (
                "A clear **summary** of the material.\n\n"
                "| Concept | Meaning |\n| --- | --- |\n"
                "| Cell | Basic unit |"
            ),
            "chunk_ids": chunk_ids[:1],
        }


def make_pdf(text: str) -> bytes:
    """Build a tiny one-page, text-based PDF without extra dependencies."""
    stream = b"BT /F1 12 Tf 72 720 Td (" + text.encode("latin-1") + b") Tj ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length "
        + str(len(stream)).encode()
        + b" >>\nstream\n"
        + stream
        + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    payload = b"%PDF-1.4\n"
    offsets: list[int] = []
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(payload))
        payload += f"{index} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref_offset = len(payload)
    payload += f"xref\n0 {len(objects) + 1}\n".encode()
    payload += b"0000000000 65535 f \n"
    for offset in offsets:
        payload += f"{offset:010d} 00000 n \n".encode()
    payload += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n"
    ).encode()
    return payload


class ExtractionTest(unittest.TestCase):
    def test_markdown_chapters_and_code_fences(self) -> None:
        text = (
            "# Chapter One\n\n"
            "Intro text about the first chapter.\n\n"
            "```python\n# This is a comment, not a heading\n```\n\n"
            "## Section A\n\nMore detail.\n\n"
            "# Chapter Two\n\nSecond chapter text.\n"
        )
        source = extract_markdown_text(
            text, source_id="s1", filename="notes.md"
        )
        self.assertEqual(source.unit_count, 3)
        self.assertEqual(source.title, "Chapter One")
        self.assertEqual(
            [chapter.title for chapter in source.chapters],
            ["Chapter One", "Chapter Two"],
        )
        self.assertEqual(source.chapters[0].unit_start, 1)
        self.assertEqual(source.chapters[1].unit_start, 3)

    def test_pdf_extraction(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "biology.pdf"
            path.write_bytes(
                make_pdf(
                    "Photosynthesis converts light energy into chemical energy "
                    "in plants and algae."
                )
            )
            source = extract_source(
                path, source_id="s1", filename="biology.pdf", kind="pdf"
            )
        self.assertEqual(source.unit_count, 1)
        self.assertIn("Photosynthesis", source.units[0].text)
        self.assertEqual(source.chapters[0].unit_end, 1)

    def test_pptx_extraction_includes_tables_and_notes(self) -> None:
        from pptx import Presentation
        from pptx.util import Inches

        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "deck.pptx"
            presentation = Presentation()
            presentation.core_properties.title = "Biology deck"
            slide = presentation.slides.add_slide(
                presentation.slide_layouts[1]
            )
            slide.shapes.title.text = "Photosynthesis"
            slide.placeholders[1].text = "Light becomes chemical energy."
            slide.notes_slide.notes_text_frame.text = "Likely exam topic."
            second = presentation.slides.add_slide(
                presentation.slide_layouts[5]
            )
            second.shapes.title.text = "Comparisons"
            table = second.shapes.add_table(
                2, 2, Inches(1), Inches(1.5), Inches(5), Inches(1)
            )
            table.table.cell(0, 0).text = "Process"
            table.table.cell(0, 1).text = "Location"
            table.table.cell(1, 0).text = "Respiration"
            table.table.cell(1, 1).text = "Mitochondria"
            presentation.save(path)

            source = extract_source(
                path, source_id="s2", filename="deck.pptx", kind="pptx"
            )

        self.assertEqual(source.unit_count, 2)
        self.assertEqual(source.unit_label, "slide")
        self.assertIn("Photosynthesis", source.units[0].text)
        self.assertIn("Likely exam topic", source.units[0].text)
        self.assertIn("Mitochondria", source.units[1].text)


class ScopeCatalogTest(unittest.TestCase):
    def test_scope_focus_extracts_topic_and_ignores_instruction_words(self) -> None:
        focus = scope_focus("Entra únicamente el método ATAM")
        self.assertTrue(focus.active)
        self.assertEqual(focus.terms, ("atam",))
        self.assertTrue(
            text_matches_focus("4.6.1 The ATAM Analysis Method", focus.terms)
        )
        self.assertFalse(
            text_matches_focus("4.1 Role of Software Architecture", focus.terms)
        )
        self.assertFalse(scope_focus("No solo entra ATAM").restricted)

    def test_catalog_keeps_a_matching_heading_beyond_the_display_limit(self) -> None:
        headings = [
            Heading(title=f"4.{index} Topic {index}", unit=index, level=1)
            for index in range(1, 15)
        ]
        headings.append(
            Heading(title="4.6.1 The ATAM Analysis Method", unit=15, level=2)
        )
        source = ExtractedSource(
            id="s1",
            filename="architecture.pdf",
            kind="pdf",
            title="Software Architecture",
            unit_label="p.",
            headings=headings,
            chapters=[
                Chapter(
                    id="s1_c0",
                    title="Chapter 4. Software Architecture",
                    unit_start=1,
                    unit_end=15,
                )
            ],
        )

        catalog = source_catalog(
            [source], focus="Entra únicamente el método ATAM"
        )

        self.assertIn("EXAM FOCUS FROM ROUGH NOTES: ATAM", catalog)
        self.assertIn("* 4.6.1 The ATAM Analysis Method", catalog)

    def test_catalog_omits_unrelated_chapters_when_scope_is_explicit(self) -> None:
        source = ExtractedSource(
            id="s1",
            filename="An%20Integrated%20Approach.pdf",
            kind="pdf",
            title="An Integrated Approach",
            unit_label="p.",
            headings=[
                Heading(title="Chapter 1. Introduction", unit=1, level=0),
                Heading(title="1.1 Motivation", unit=2, level=1),
                Heading(title="Chapter 2. Software Architecture", unit=10, level=0),
                Heading(
                    title="2.2.1 The ATAM Analysis Method", unit=12, level=2
                ),
            ],
            chapters=[
                Chapter(
                    id="s1_c0",
                    title="Chapter 1. Introduction",
                    unit_start=1,
                    unit_end=9,
                ),
                Chapter(
                    id="s1_c1",
                    title="Chapter 2. Software Architecture",
                    unit_start=10,
                    unit_end=20,
                ),
            ],
        )

        catalog = source_catalog([source], focus="Only ATAM")

        self.assertIn("Chapter 2. Software Architecture", catalog)
        self.assertNotIn("Chapter 1. Introduction", catalog)
        self.assertIn("SOURCE s1 | An Integrated Approach", catalog)
        self.assertNotIn("%20", catalog)

    def test_task_text_uses_locations_not_the_source_filename(self) -> None:
        ref = SourceRef(
            source_id="s1",
            source_name=(
                "An%20Integrated%20Approach%20to%20Software%20Engineering%2C%20"
                "3rd%20ed_%20--%20Pankaj%20Jalote.pdf"
            ),
            unit_label="p.",
            unit_start=210,
            unit_end=211,
            display="An%20Integrated%20Approach pp. 210–211",
        )

        text = task_text(
            language="es",
            section_title="4.6.1 The ATAM Analysis Method",
            refs=[ref],
            exam_scope=True,
            part=1,
            parts=1,
        )

        self.assertIn("pp. 210–211", text)
        self.assertIn("ATAM", text)
        self.assertNotIn("%20", text)
        self.assertNotIn("An%20Integrated", text)

    def test_task_text_adds_a_short_source_label_for_multiple_sources(self) -> None:
        ref = SourceRef(
            source_id="s1",
            source_name="long-name.pdf",
            unit_label="slide",
            unit_start=3,
            unit_end=4,
            display="long-name.pdf slides 3–4",
        )

        text = task_text(
            language="en",
            section_title="Connectors",
            refs=[ref],
            exam_scope=True,
            part=1,
            parts=1,
            source_label="An Integrated Approach to Software Engineering",
        )

        self.assertIn("slides 3–4", text)
        self.assertIn("An Integrated Approach", text)
        self.assertNotIn("long-name.pdf", text)


class EstimatorTest(unittest.TestCase):
    def test_estimate_scales_with_source_and_difficulty(self) -> None:
        easy = estimate_section_minutes(
            source_words=4_000,
            unit_count=2,
            kind="pdf",
            note_words=200,
            difficulty=2,
            exam_scope=True,
            depth="balanced",
        )
        hard = estimate_section_minutes(
            source_words=4_000,
            unit_count=2,
            kind="pdf",
            note_words=200,
            difficulty=5,
            exam_scope=True,
            depth="balanced",
        )
        deep = estimate_section_minutes(
            source_words=4_000,
            unit_count=2,
            kind="pdf",
            note_words=200,
            difficulty=2,
            exam_scope=True,
            depth="deep",
        )
        self.assertGreater(hard, easy)
        self.assertGreater(deep, easy)
        self.assertEqual(easy % 5, 0)

    def test_split_and_scale(self) -> None:
        self.assertEqual(split_minutes(45), [45])
        self.assertTrue(all(part <= 60 for part in split_minutes(130)))
        self.assertEqual(sum(split_minutes(130)), 130)
        scaled, warning = scale_minutes([60, 60, 60], 120)
        self.assertIsNone(warning)
        self.assertLessEqual(sum(scaled), 120 * 1.15 + 15)
        self.assertTrue(all(part >= 10 for part in scaled))
        unchanged, warning = scale_minutes([60], 300)
        self.assertEqual(unchanged, [60])
        self.assertIsNotNone(warning)


class ServiceImportTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.service = StudyService(
            Config(),
            FakeClock(at()),
            state_file=self.tmp / "state.json",
            history_file=self.tmp / "history.db",
            checklist_file=self.tmp / "checklist.json",
            persist=False,
        )

    def tearDown(self) -> None:
        self.service.close()
        self._tmp.cleanup()

    def test_import_is_additive_and_bumps_revision_once(self) -> None:
        before = self.service.checklist_revision()
        result = self.service.import_plan(
            [
                {
                    "name": "Chapter 1",
                    "items": [
                        {"text": "Read pages 1-10", "duration_seconds": 600},
                        {"text": "Review notes", "duration_seconds": 300},
                    ],
                },
                {
                    "name": "Chapter 2",
                    "items": [
                        {"text": "Read pages 11-20", "duration_seconds": 900}
                    ],
                },
            ]
        )
        self.assertEqual(result["revision"], before + 1)
        self.assertEqual(result["total_items"], 3)
        self.assertEqual(result["total_seconds"], 1800)
        data = self.service.checklist_data()
        self.assertEqual([subject["name"] for subject in data["subjects"]], [
            "Chapter 1",
            "Chapter 2",
        ])
        self.assertEqual(data["active_subject_id"], data["subjects"][0]["id"])
        self.assertEqual(len(data["subjects"][0]["items"]), 2)

    def test_invalid_batch_does_not_mutate_the_checklist(self) -> None:
        before = self.service.checklist_data()
        with self.assertRaises(ValueError):
            self.service.import_plan(
                [
                    {
                        "name": "Valid",
                        "items": [
                            {"text": "Read", "duration_seconds": 600}
                        ],
                    },
                    {
                        "name": "Invalid",
                        "items": [
                            {"text": "Too short", "duration_seconds": 10}
                        ],
                    },
                ]
            )
        after = self.service.checklist_data()
        self.assertEqual(before, after)
        self.assertEqual(self.service.checklist_revision(), 0)


class StoreTest(unittest.TestCase):
    def test_mark_interrupted_uses_a_structured_error(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            store = RunStore(Path(temp))
            store.ensure_run("sp1234abcd")
            now = utc_now()
            summary = RunSummary(
                id="sp1234abcd",
                title="Interrupted",
                created_at=now,
                updated_at=now,
                options=RunOptions(),
            )
            store.save_summary(summary)
            store.mark_interrupted()
            loaded = store.load_summary("sp1234abcd")
        assert loaded is not None
        self.assertEqual(loaded.status, "interrupted")
        self.assertIsNotNone(loaded.error)
        self.assertEqual(loaded.error.code, "interrupted")


class PipelineTest(unittest.TestCase):
    def _source_text(self) -> str:
        return (
            "# The Cell\n\n"
            + (
                "The cell is the basic unit of life. It contains a nucleus and "
                "many organelles that perform specialized functions. "
            )
            * 20
            + "\n\n# The Membrane\n\n"
            + (
                "The cell membrane controls which substances enter and leave. "
                "Transport can be passive or active. "
            )
            * 20
        )

    def test_pipeline_generates_notes_and_one_subject_per_chapter(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            store = RunStore(root)
            run_id = "sp123456789abc"
            store.ensure_run(run_id)
            store.save_source_bytes(
                run_id, "s1.md", self._source_text().encode("utf-8")
            )
            store.save_rough_notes(
                run_id,
                "Los dos capítulos entran en el examen. La membrana es importante.",
            )
            now = utc_now()
            summary = RunSummary(
                id=run_id,
                title="Biology",
                created_at=now,
                updated_at=now,
                options=RunOptions(language="auto"),
                sources=[
                    SourceSummary(id="s1", filename="biology.md", kind="md")
                ],
            )
            store.save_summary(summary)

            async def on_change() -> None:
                store.save_summary(summary)

            provider = FakeProvider()
            result = asyncio.run(
                StudyPrepPipeline(
                    store=store,
                    provider=provider,
                    summary=summary,
                    on_change=on_change,
                ).run()
            )

            self.assertEqual(summary.status, "ready")
            self.assertEqual(summary.progress, 100)
            self.assertEqual(provider.outline_calls, 1)
            self.assertEqual(provider.section_calls, 2)
            self.assertEqual(len(result.plan.subjects), 2)
            self.assertEqual(
                [len(subject.items) for subject in result.plan.subjects], [1, 1]
            )
            self.assertEqual(len(result.notes.sections), 2)
            self.assertEqual(result.notes.language, "es")
            self.assertIn("| Concept | Meaning |", result.notes.markdown)
            self.assertTrue(
                all(
                    item.duration_seconds >= 60
                    for subject in result.plan.subjects
                    for item in subject.items
                )
            )
            self.assertEqual(
                result.plan.totals.duration_seconds,
                sum(
                    item.duration_seconds
                    for subject in result.plan.subjects
                    for item in subject.items
                ),
            )
            self.assertIsNotNone(store.load_result(run_id))
            self.assertTrue(summary.sources[0].chapter_count >= 2)

    def test_restricted_scope_keeps_only_matching_chapter_and_section(self) -> None:
        source_text = (
            "# Chapter 1. Introduction\n\n"
            + (
                "Software engineering covers processes, methods, and tools. "
            )
            * 12
            + "\n\n# Chapter 2. Software Architecture\n\n"
            + "Architecture describes the structure of a software system. "
            * 12
            + "\n\n## 2.1 Architecture Views\n\n"
            + "Views separate structure into components and connectors. "
            * 12
            + "\n\n## 2.2 Evaluating Architectures\n\n"
            + "Architecture evaluation identifies risks and tradeoffs. "
            * 12
            + "\n\n### 2.2.1 The ATAM Analysis Method\n\n"
            + "ATAM is the Architecture Tradeoff Analysis Method. "
            * 20
            + "\n\n## 2.3 Summary\n\n"
            + "The chapter summarized architecture and evaluation. "
            * 12
        )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            store = RunStore(root)
            run_id = "sp123456789abd"
            store.ensure_run(run_id)
            store.save_source_bytes(run_id, "s1.md", source_text.encode("utf-8"))
            store.save_rough_notes(run_id, "Entra únicamente el método ATAM")
            now = utc_now()
            summary = RunSummary(
                id=run_id,
                title="Architecture",
                created_at=now,
                updated_at=now,
                options=RunOptions(language="auto"),
                sources=[
                    SourceSummary(
                        id="s1",
                        filename="long%20encoded%20architecture%20book.md",
                        kind="md",
                    )
                ],
            )
            store.save_summary(summary)

            async def on_change() -> None:
                store.save_summary(summary)

            provider = FakeProvider()
            result = asyncio.run(
                StudyPrepPipeline(
                    store=store,
                    provider=provider,
                    summary=summary,
                    on_change=on_change,
                ).run()
            )

        self.assertIn(
            "EXAM SCOPE FOCUS FROM ROUGH NOTES: ATAM",
            provider.last_outline_prompt,
        )
        self.assertEqual(provider.section_calls, 1)
        self.assertEqual(len(result.notes.sections), 1)
        self.assertEqual(
            result.notes.sections[0].chapter_title,
            "Chapter 2. Software Architecture",
        )
        self.assertEqual(
            result.notes.sections[0].title, "2.2.1 The ATAM Analysis Method"
        )
        self.assertEqual(len(result.plan.subjects), 1)
        self.assertEqual(
            result.plan.subjects[0].chapter_title,
            "Chapter 2. Software Architecture",
        )
        self.assertEqual(len(result.plan.subjects[0].items), 1)
        item = result.plan.subjects[0].items[0]
        self.assertIn("ATAM", item.text)
        self.assertIn("section 5", item.text)
        self.assertNotIn("%20", item.text)


class StudyPrepApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.provider = FakeProvider()
        self.app = create_app(
            config_path=self.tmp / "config.toml",
            state_file=self.tmp / "state.json",
            history_file=self.tmp / "history.db",
            checklist_file=self.tmp / "checklist.json",
            clock=FakeClock(at()),
            persist=False,
            enable_tick_loop=False,
            enable_lock=False,
            study_prep_dir=self.tmp / "study-prep",
            study_prep_provider_factory=lambda: self.provider,
        )
        self.client = TestClient(self.app)
        self.client.__enter__()

    def tearDown(self) -> None:
        self.client.__exit__(None, None, None)
        self._tmp.cleanup()

    def _create_run(self, notes: str = "The cell is in the exam.") -> dict:
        response = self.client.post(
            "/api/study-prep/runs",
            data={"notes": notes, "language": "auto", "depth": "balanced"},
            files=[
                (
                    "files",
                    (
                        "biology.md",
                        (
                            "# The Cell\n\n"
                            + (
                                "The cell is the basic unit of life. "
                                "It has a nucleus and organelles. "
                            )
                            * 15
                            + "\n\n# The Membrane\n\n"
                            + (
                                "The membrane controls transport into and out of the cell. "
                            )
                            * 15
                        ).encode("utf-8"),
                        "text/markdown",
                    ),
                )
            ],
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def _wait(self, run_id: str, timeout: float = 5.0) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            response = self.client.get(f"/api/study-prep/runs/{run_id}")
            self.assertEqual(response.status_code, 200, response.text)
            summary = response.json()
            if summary["status"] not in {"queued", "running"}:
                return summary
            time.sleep(0.02)
        self.fail("study-prep run did not finish")

    def test_create_wait_result_and_import(self) -> None:
        summary = self._create_run()
        self.assertEqual(summary["status"], "queued")
        self.assertEqual(summary["sources"][0]["filename"], "biology.md")

        finished = self._wait(summary["id"])
        self.assertEqual(finished["status"], "ready", finished)
        self.assertEqual(finished["progress"], 100)
        self.assertIsNone(finished["error"])
        self.assertTrue(finished["has_result"])

        result = self.client.get(
            f"/api/study-prep/runs/{summary['id']}/result"
        )
        self.assertEqual(result.status_code, 200, result.text)
        plan = result.json()["plan"]
        self.assertEqual(len(plan["subjects"]), 2)
        self.assertTrue(
            all(
                item["duration_seconds"] >= 60
                for subject in plan["subjects"]
                for item in subject["items"]
            )
        )

        imported = self.client.post(
            f"/api/study-prep/runs/{summary['id']}/import"
        )
        self.assertEqual(imported.status_code, 200, imported.text)
        payload = imported.json()
        self.assertEqual(payload["total_items"], 2)
        self.assertEqual(payload["revision"], 1)

        checklist = self.client.get("/api/checklist").json()
        self.assertEqual(len(checklist["subjects"]), 2)
        self.assertEqual(checklist["revision"], 1)
        self.assertEqual(
            [item["text"] for item in checklist["subjects"][0]["items"]],
            [plan["subjects"][0]["items"][0]["text"]],
        )

        again = self.client.post(
            f"/api/study-prep/runs/{summary['id']}/import"
        )
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.json()["code"], "run_already_imported")

        history = self.client.get("/api/study-prep/runs").json()
        self.assertEqual(history[0]["id"], summary["id"])
        self.assertIsNotNone(history[0]["imported_at"])

    def test_import_accepts_an_edited_plan(self) -> None:
        summary = self._create_run()
        self._wait(summary["id"])
        response = self.client.post(
            f"/api/study-prep/runs/{summary['id']}/import",
            json={
                "subjects": [
                    {
                        "name": "Custom subject",
                        "items": [
                            {
                                "text": "Study the edited topic",
                                "duration_seconds": 120,
                            }
                        ],
                    }
                ]
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        checklist = self.client.get("/api/checklist").json()
        self.assertEqual(checklist["subjects"][0]["name"], "Custom subject")
        self.assertEqual(
            checklist["subjects"][0]["items"][0]["base_seconds"], 120
        )

    def test_generic_checklist_import_is_atomic(self) -> None:
        before = self.client.get("/api/checklist").json()
        response = self.client.post(
            "/api/checklist/import",
            json={
                "subjects": [
                    {
                        "name": "First chapter",
                        "items": [
                            {"text": "Read section 1", "duration_seconds": 600},
                            {"text": "Review section 1", "duration_seconds": 300},
                        ],
                    },
                    {
                        "name": "Second chapter",
                        "items": [
                            {"text": "Read section 2", "duration_seconds": 900}
                        ],
                    },
                ]
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["revision"], before["revision"] + 1)
        self.assertEqual(payload["total_items"], 3)
        self.assertEqual(payload["total_seconds"], 1800)
        after = self.client.get("/api/checklist").json()
        self.assertEqual(
            [subject["name"] for subject in after["subjects"]],
            ["First chapter", "Second chapter"],
        )
        self.assertEqual(len(after["subjects"][0]["items"]), 2)

        invalid = self.client.post(
            "/api/checklist/import",
            json={
                "subjects": [
                    {
                        "name": "Too short",
                        "items": [
                            {"text": "Impossible", "duration_seconds": 30}
                        ],
                    }
                ]
            },
        )
        self.assertEqual(invalid.status_code, 422)
        unchanged = self.client.get("/api/checklist").json()
        self.assertEqual(unchanged, after)

    def test_rejects_unsupported_files(self) -> None:
        response = self.client.post(
            "/api/study-prep/runs",
            data={"notes": ""},
            files=[
                (
                    "files",
                    (
                        "notes.docx",
                        b"not a supported source",
                        "application/vnd.openxmlformats-officedocument."
                        "wordprocessingml.document",
                    ),
                )
            ],
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("PDF, PPTX, or Markdown", response.json()["detail"])
        self.assertEqual(self.client.get("/api/study-prep/runs").json(), [])

    def test_run_fails_cleanly_without_a_provider(self) -> None:
        app = create_app(
            config_path=self.tmp / "config2.toml",
            state_file=self.tmp / "state2.json",
            history_file=self.tmp / "history2.db",
            checklist_file=self.tmp / "checklist2.json",
            clock=FakeClock(at()),
            persist=False,
            enable_tick_loop=False,
            enable_lock=False,
            study_prep_dir=self.tmp / "study-prep-2",
            study_prep_provider_factory=lambda: None,
        )
        with TestClient(app) as client:
            created = client.post(
                "/api/study-prep/runs",
                data={"notes": "Some rough notes."},
            )
            self.assertEqual(created.status_code, 201, created.text)
            run_id = created.json()["id"]
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                summary = client.get(
                    f"/api/study-prep/runs/{run_id}"
                ).json()
                if summary["status"] not in {"queued", "running"}:
                    break
                time.sleep(0.02)
            self.assertEqual(summary["status"], "failed")
            self.assertEqual(
                summary["error"]["code"], "provider_not_configured"
            )
            retried = client.post(
                f"/api/study-prep/runs/{run_id}/retry"
            )
            self.assertEqual(retried.status_code, 200, retried.text)
            self.assertEqual(retried.json()["status"], "queued")


if __name__ == "__main__":
    unittest.main()
