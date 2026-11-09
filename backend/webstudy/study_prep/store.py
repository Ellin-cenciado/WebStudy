"""Filesystem persistence for study-prep runs.

Each run gets its own directory under ``state_dir()/study-prep`` containing the
raw uploads, the extracted page/slide text, the rough notes, the notes/plan
result, and a small JSON summary used by the history list.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from ..storage.atomic import write_bytes_atomic, write_text_atomic
from .models import RunError, RunResult, RunSummary, utc_now
from .sources import ExtractedSource

_RUN_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{3,80}$")


class RunStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def run_dir(self, run_id: str) -> Path:
        if not _RUN_ID_RE.match(run_id):
            raise ValueError("invalid study-prep run id")
        return self.root / run_id

    def ensure_run(self, run_id: str) -> Path:
        directory = self.run_dir(run_id)
        (directory / "sources").mkdir(parents=True, exist_ok=True)
        return directory

    def source_path(self, run_id: str, stored_name: str) -> Path:
        if Path(stored_name).name != stored_name:
            raise ValueError("invalid source file name")
        return self.run_dir(run_id) / "sources" / stored_name

    def save_source_bytes(self, run_id: str, stored_name: str, payload: bytes) -> None:
        path = self.source_path(run_id, stored_name)
        path.parent.mkdir(parents=True, exist_ok=True)
        write_bytes_atomic(path, payload)

    def copy_source(self, run_id: str, stored_name: str, target_run: str, target_name: str) -> None:
        source = self.source_path(run_id, stored_name)
        target = self.source_path(target_run, target_name)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)

    def save_summary(self, summary: RunSummary) -> None:
        summary.updated_at = utc_now()
        path = self.run_dir(summary.id) / "run.json"
        write_text_atomic(path, summary.model_dump_json(indent=2) + "\n")

    def load_summary(self, run_id: str) -> RunSummary | None:
        path = self.run_dir(run_id) / "run.json"
        try:
            return RunSummary.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def list_summaries(self) -> list[RunSummary]:
        summaries: list[RunSummary] = []
        if not self.root.exists():
            return summaries
        for directory in self.root.iterdir():
            if not directory.is_dir() or not _RUN_ID_RE.match(directory.name):
                continue
            summary = self.load_summary(directory.name)
            if summary is not None:
                summaries.append(summary)
        summaries.sort(key=lambda summary: summary.created_at, reverse=True)
        return summaries

    def save_sources(self, run_id: str, sources: list[ExtractedSource]) -> None:
        path = self.run_dir(run_id) / "sources.json"
        payload = json.dumps(
            [source.to_dict() for source in sources], ensure_ascii=False, indent=2
        )
        write_text_atomic(path, payload + "\n")

    def load_sources(self, run_id: str) -> list[ExtractedSource]:
        path = self.run_dir(run_id) / "sources.json"
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        if not isinstance(raw, list):
            return []
        return [
            ExtractedSource.from_dict(item)
            for item in raw
            if isinstance(item, dict)
        ]

    def save_rough_notes(self, run_id: str, notes: str) -> None:
        write_text_atomic(self.run_dir(run_id) / "rough-notes.md", notes)

    def load_rough_notes(self, run_id: str) -> str:
        try:
            return (self.run_dir(run_id) / "rough-notes.md").read_text(encoding="utf-8")
        except OSError:
            return ""

    def save_result(self, run_id: str, result: RunResult) -> None:
        path = self.run_dir(run_id) / "result.json"
        write_text_atomic(path, result.model_dump_json(indent=2) + "\n")

    def load_result(self, run_id: str) -> RunResult | None:
        path = self.run_dir(run_id) / "result.json"
        try:
            return RunResult.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def delete(self, run_id: str) -> None:
        shutil.rmtree(self.run_dir(run_id), ignore_errors=True)

    def mark_interrupted(self) -> None:
        for summary in self.list_summaries():
            if summary.status in {"queued", "running"}:
                summary.status = "interrupted"
                summary.stage = "interrupted"
                summary.progress = 0
                summary.stage_detail = "The backend restarted before this run finished."
                summary.error = RunError(
                    code="interrupted",
                    message="The run was interrupted by a backend restart.",
                    hint="Retry the run to continue.",
                )
                self.save_summary(summary)
