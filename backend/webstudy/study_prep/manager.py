"""Async job manager for study-prep runs.

A run is created by the HTTP layer, persisted immediately, and queued. One
worker processes runs in order so a local Ollama instance is never hit with
several generation jobs at once. Progress is written to ``run.json`` on every
pipeline checkpoint, which also makes the history and status endpoints cheap.
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import suppress
from pathlib import Path
from typing import Callable, Protocol

from .errors import (
    RunAlreadyActive,
    RunAlreadyImported,
    RunNotFound,
    RunNotReady,
    StudyPrepError,
    UploadError,
)
from .models import RunError, RunOptions, RunResult, RunSummary, SourceSummary, utc_now
from .pipeline import StudyPrepPipeline
from .providers import LLMProvider, provider_from_env
from .sources import kind_for_filename
from .store import RunStore

log = logging.getLogger("webstudy.study_prep")

MAX_FILES = 10
MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_TOTAL_BYTES = 200 * 1024 * 1024
MAX_ROUGH_NOTES_CHARS = 400_000

_READ_CHUNK = 1024 * 1024
_SUFFIXES = {"pdf": ".pdf", "pptx": ".pptx", "md": ".md"}


class AsyncUpload(Protocol):
    filename: str | None

    async def read(self, size: int = -1) -> bytes: ...


def _sanitize_filename(filename: str | None) -> str:
    raw = (filename or "").replace("\\", "/").split("/")[-1].strip()
    if not raw:
        raise UploadError("Every uploaded file needs a file name.")
    stem, suffix = os.path.splitext(raw)
    if len(raw) > 200:
        raw = stem[: max(1, 200 - len(suffix))] + suffix
    return raw


def _default_title(filenames: list[str], notes: str) -> str:
    for filename in filenames:
        stem = Path(filename).stem.replace("_", " ").replace("-", " ").strip()
        if stem:
            return stem[:120]
    for line in notes.splitlines():
        candidate = line.strip().lstrip("#").strip()
        if candidate:
            return candidate[:120]
    return "Study notes"


class StudyPrepManager:
    def __init__(
        self,
        root: Path,
        *,
        provider_factory: Callable[[], LLMProvider | None] = provider_from_env,
        max_files: int = MAX_FILES,
        max_file_bytes: int = MAX_FILE_BYTES,
        max_total_bytes: int = MAX_TOTAL_BYTES,
    ) -> None:
        self.store = RunStore(root)
        self.provider_factory = provider_factory
        self.max_files = max_files
        self.max_file_bytes = max_file_bytes
        self.max_total_bytes = max_total_bytes
        self._runs: dict[str, RunSummary] = {}
        self._queue: asyncio.Queue[str] | None = None
        self._worker: asyncio.Task[None] | None = None
        self._current_task: asyncio.Task[RunResult] | None = None
        self._current_id: str | None = None
        self._cancelled: set[str] = set()
        self._closed = False
        self.import_lock = asyncio.Lock()

    # -- lifecycle ------------------------------------------------------

    async def start(self) -> None:
        if self._worker is not None:
            return
        self._closed = False
        self.store.mark_interrupted()
        self._queue = asyncio.Queue()
        self._worker = asyncio.create_task(
            self._worker_loop(), name="webstudy-study-prep"
        )

    async def shutdown(self) -> None:
        self._closed = True
        worker = self._worker
        if worker is not None:
            worker.cancel()
            with suppress(asyncio.CancelledError):
                await worker
        self._worker = None
        self._queue = None
        # Anything still queued or running (for example a run interrupted by a
        # process signal) is now stale.
        self.store.mark_interrupted()

    # -- run creation ---------------------------------------------------

    async def create_run(
        self,
        *,
        rough_notes: str,
        options: RunOptions,
        uploads: list[AsyncUpload],
    ) -> RunSummary:
        if self._closed or self._queue is None:
            raise StudyPrepError(
                "The study-prep worker is not running.",
                hint="Restart the WebStudy backend.",
            )
        if len(uploads) > self.max_files:
            raise UploadError(
                f"Upload at most {self.max_files} source files at a time."
            )
        notes = rough_notes.strip()
        if not uploads and not notes:
            raise UploadError(
                "Add rough notes, at least one source file, or both."
            )
        if len(rough_notes) > MAX_ROUGH_NOTES_CHARS:
            raise UploadError(
                f"Rough notes are limited to {MAX_ROUGH_NOTES_CHARS:,} characters."
            )

        prepared: list[tuple[str, str, AsyncUpload]] = []
        for upload in uploads:
            filename = _sanitize_filename(upload.filename)
            kind = kind_for_filename(filename)
            if kind is None:
                raise UploadError(
                    f"{filename!r} is not supported. Upload PDF, PPTX, or Markdown files.",
                    hint="DOCX, images, and scanned files are not supported yet.",
                )
            prepared.append((filename, kind, upload))

        run_id = f"sp{os.urandom(6).hex()}"
        self.store.ensure_run(run_id)
        sources: list[SourceSummary] = []
        total_bytes = 0
        try:
            for index, (filename, kind, upload) in enumerate(prepared, start=1):
                source_id = f"s{index}"
                stored_name = f"{source_id}{_SUFFIXES[kind]}"
                destination = self.store.source_path(run_id, stored_name)
                size = await self._write_upload(
                    upload,
                    destination,
                    filename=filename,
                    already_written=total_bytes,
                )
                total_bytes += size
                sources.append(
                    SourceSummary(
                        id=source_id,
                        filename=filename,
                        kind=kind,
                        size_bytes=size,
                        status="pending",
                    )
                )
            if notes:
                self.store.save_rough_notes(run_id, rough_notes)

            now = utc_now()
            summary = RunSummary(
                id=run_id,
                title=_default_title([item[0] for item in prepared], rough_notes),
                status="queued",
                stage="queued",
                progress=0,
                stage_detail="Queued for preparation…",
                created_at=now,
                updated_at=now,
                options=options.model_copy(),
                sources=sources,
            )
            self.store.save_summary(summary)
        except BaseException:
            self.store.delete(run_id)
            raise

        self._runs[run_id] = summary
        self._queue.put_nowait(run_id)
        return summary

    async def _write_upload(
        self,
        upload: AsyncUpload,
        destination: Path,
        *,
        filename: str,
        already_written: int,
    ) -> int:
        part = destination.with_name(destination.name + ".part")
        size = 0
        try:
            with open(part, "wb") as handle:
                while True:
                    chunk = await upload.read(_READ_CHUNK)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > self.max_file_bytes:
                        raise UploadError(
                            f"{filename!r} is larger than "
                            f"{self.max_file_bytes // (1024 * 1024)} MB."
                        )
                    if already_written + size > self.max_total_bytes:
                        raise UploadError(
                            f"The uploads are larger than "
                            f"{self.max_total_bytes // (1024 * 1024)} MB in total."
                        )
                    handle.write(chunk)
                handle.flush()
                os.fsync(handle.fileno())
            if size == 0:
                raise UploadError(f"{filename!r} is empty.")
            os.replace(part, destination)
            return size
        finally:
            if part.exists():
                with suppress(OSError):
                    part.unlink()

    # -- reads ----------------------------------------------------------

    def get(self, run_id: str) -> RunSummary | None:
        cached = self._runs.get(run_id)
        if cached is not None:
            return cached
        try:
            summary = self.store.load_summary(run_id)
        except ValueError:
            return None
        if summary is not None:
            self._runs[run_id] = summary
        return summary

    def require(self, run_id: str) -> RunSummary:
        summary = self.get(run_id)
        if summary is None:
            raise RunNotFound(
                "That study-prep run does not exist.",
                hint="It may have been deleted.",
            )
        return summary

    def list_runs(self) -> list[RunSummary]:
        merged = {summary.id: summary for summary in self.store.list_summaries()}
        for run_id, summary in self._runs.items():
            try:
                if self.store.run_dir(run_id).is_dir():
                    merged[run_id] = summary
            except ValueError:
                continue
        return sorted(
            merged.values(),
            key=lambda summary: (summary.created_at, summary.id),
            reverse=True,
        )

    def result(self, run_id: str) -> RunResult:
        summary = self.require(run_id)
        if summary.status != "ready" or not summary.has_result:
            raise RunNotReady(
                "The notes and plan are not ready yet.",
                hint="Wait for the run to finish or retry it if it failed.",
            )
        result = self.store.load_result(run_id)
        if result is None:
            raise RunNotReady(
                "The result file is missing.",
                hint="Retry the run to regenerate the notes and plan.",
            )
        return result

    # -- mutations ------------------------------------------------------

    async def cancel(self, run_id: str) -> RunSummary:
        summary = self.require(run_id)
        if summary.status == "queued":
            self._mark_cancelled(summary)
            return summary
        if summary.status != "running":
            raise StudyPrepError(
                "Only a queued or running run can be cancelled."
            )
        self._cancelled.add(run_id)
        self._mark_cancelled(summary)
        task = self._current_task
        if task is not None and not task.done():
            task.cancel()
        return summary

    def retry(self, run_id: str) -> RunSummary:
        summary = self.require(run_id)
        if summary.status in {"queued", "running"}:
            raise RunAlreadyActive("That study-prep run is already active.")
        if summary.status == "ready":
            raise StudyPrepError(
                "That study-prep run is already ready.",
                hint="Delete it and create a new run to regenerate its notes.",
            )
        if summary.imported_at is not None:
            raise RunAlreadyImported(
                "That study-prep run has already been imported.",
                hint="Create a new run if you need a fresh plan.",
            )
        if self._queue is None:
            raise StudyPrepError(
                "The study-prep worker is not running.",
                hint="Restart the WebStudy backend.",
            )

        summary.status = "queued"
        summary.stage = "queued"
        summary.progress = 0
        summary.stage_detail = "Queued for preparation…"
        summary.error = None
        summary.has_result = False
        summary.warnings = []
        summary.total_duration_seconds = None
        summary.item_count = None
        summary.subject_count = None
        summary.sources = [
            source for source in summary.sources if source.id != "rough"
        ]
        for source in summary.sources:
            source.status = "pending"
            source.error = None
            source.warnings = []
        self._cancelled.discard(run_id)
        self.store.save_summary(summary)
        self._runs[run_id] = summary
        self._queue.put_nowait(run_id)
        return summary

    async def delete(self, run_id: str) -> None:
        summary = self.require(run_id)
        if summary.status == "running":
            await self.cancel(run_id)
            await self._wait_idle(run_id)
        elif summary.status == "queued":
            self._mark_cancelled(summary)
        self._runs.pop(run_id, None)
        self.store.delete(run_id)

    def mark_imported(self, run_id: str) -> RunSummary:
        summary = self.require(run_id)
        if summary.imported_at is not None:
            raise RunAlreadyImported(
                "That study-prep run has already been imported.",
                hint="Delete it and create a new run to import its checklist again.",
            )
        if summary.status != "ready":
            raise RunNotReady("Only a ready run can be imported.")
        summary.imported_at = utc_now()
        self.store.save_summary(summary)
        return summary

    # -- worker ---------------------------------------------------------

    async def _worker_loop(self) -> None:
        assert self._queue is not None
        while True:
            run_id = await self._queue.get()
            try:
                summary = self.get(run_id)
                if summary is None or summary.status != "queued":
                    continue
                provider = self.provider_factory()
                if provider is None:
                    self._fail(
                        summary,
                        code="provider_not_configured",
                        message="No language model is configured.",
                        hint=(
                            "Set WEBSTUDY_LLM_MODEL (and optionally "
                            "WEBSTUDY_LLM_BASE_URL), then restart the backend "
                            "and retry the run."
                        ),
                    )
                    continue
                await self._execute(summary, provider)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("study-prep worker failed for run %s", run_id)
            finally:
                self._queue.task_done()

    async def _execute(
        self, summary: RunSummary, provider: LLMProvider
    ) -> None:
        run_id = summary.id
        summary.status = "running"
        summary.stage = "extracting"
        summary.progress = 0
        summary.stage_detail = "Starting…"
        summary.error = None
        self.store.save_summary(summary)

        pipeline = StudyPrepPipeline(
            store=self.store,
            provider=provider,
            summary=summary,
            on_change=self._on_change,
        )
        task: asyncio.Task[RunResult] = asyncio.create_task(pipeline.run())
        self._current_task = task
        self._current_id = run_id
        try:
            await task
            if run_id in self._cancelled:
                summary.status = "cancelled"
                summary.stage = "cancelled"
                summary.has_result = False
                self.store.save_summary(summary)
        except asyncio.CancelledError:
            task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await task
            if self._closed:
                self._mark_interrupted(summary)
                raise
            if run_id not in self._cancelled and summary.status == "running":
                self._mark_interrupted(summary)
        except StudyPrepError as exc:
            if run_id not in self._cancelled:
                self._fail(
                    summary,
                    code=exc.code,
                    message=exc.message,
                    hint=exc.hint,
                )
        except Exception as exc:  # pragma: no cover - defensive
            log.exception("study-prep pipeline failed for run %s", run_id)
            if run_id not in self._cancelled:
                self._fail(
                    summary,
                    code="internal_error",
                    message="Study preparation failed unexpectedly.",
                    hint=str(exc)[:300],
                )
        finally:
            self._cancelled.discard(run_id)
            self._current_task = None
            self._current_id = None

    async def _on_change(self) -> None:
        run_id = self._current_id
        if run_id is None:
            return
        summary = self._runs.get(run_id)
        if summary is not None:
            self.store.save_summary(summary)

    async def _wait_idle(self, run_id: str) -> None:
        for _ in range(200):
            if self._current_id != run_id:
                return
            await asyncio.sleep(0.05)
        log.warning("study-prep run %s did not stop in time", run_id)

    # -- state helpers --------------------------------------------------

    def _mark_cancelled(self, summary: RunSummary) -> None:
        summary.status = "cancelled"
        summary.stage = "cancelled"
        summary.progress = 0
        summary.stage_detail = "Cancelled."
        summary.error = None
        summary.has_result = False
        self.store.save_summary(summary)

    def _mark_interrupted(self, summary: RunSummary) -> None:
        summary.status = "interrupted"
        summary.stage = "interrupted"
        summary.stage_detail = "The backend stopped before this run finished."
        summary.error = RunError(
            code="interrupted",
            message="The run was interrupted by a backend restart.",
            hint="Retry the run to continue.",
        )
        summary.has_result = False
        self.store.save_summary(summary)

    def _fail(
        self,
        summary: RunSummary,
        *,
        code: str,
        message: str,
        hint: str | None = None,
    ) -> None:
        summary.status = "failed"
        summary.stage = "failed"
        summary.stage_detail = message
        summary.error = RunError(code=code, message=message, hint=hint)
        summary.has_result = False
        self.store.save_summary(summary)
