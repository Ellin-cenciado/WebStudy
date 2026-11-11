"""HTTP transport for study preparation."""

from __future__ import annotations

from fastapi import APIRouter, File, Form, Request, Response, UploadFile
from pydantic import ValidationError

from ..study_prep.errors import RunAlreadyImported, StudyPrepError, UploadError
from ..study_prep.manager import StudyPrepManager
from ..study_prep.models import (
    ChecklistImportRequest,
    ChecklistImportResult,
    RunOptions,
    RunResult,
    RunSummary,
    StudyPrepConfig,
)
from ..study_prep.providers import LLMConfig
from .commands import run_command

router = APIRouter(prefix="/api/study-prep", tags=["study-prep"])


def _manager(request: Request) -> StudyPrepManager:
    return request.app.state.study_prep


def _target_minutes(raw: str) -> int | None:
    value = (raw or "").strip()
    if not value:
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise UploadError("Target minutes must be a whole number.") from exc


@router.get("/config", response_model=StudyPrepConfig)
async def study_prep_config(request: Request) -> StudyPrepConfig:
    manager = _manager(request)
    config = LLMConfig.from_env()
    message = (
        ""
        if config.configured
        else "Set WEBSTUDY_LLM_MODEL to enable note generation. "
        "WEBSTUDY_LLM_BASE_URL defaults to a local Ollama server."
    )
    return StudyPrepConfig(
        configured=config.configured,
        provider=config.provider,
        base_url=(
            (config.opencode_base_url or "auto-discover")
            if config.provider == "opencode"
            else config.base_url
        ),
        model=config.opencode_model or config.model,
        agent=config.opencode_agent if config.provider == "opencode" else "",
        context_tokens=config.context_tokens,
        max_output_tokens=config.max_output_tokens,
        max_files=manager.max_files,
        max_file_bytes=manager.max_file_bytes,
        max_total_bytes=manager.max_total_bytes,
        message=message,
    )


@router.post("/runs", response_model=RunSummary, status_code=201)
async def create_run(
    request: Request,
    notes: str = Form(default=""),
    language: str = Form(default="auto"),
    depth: str = Form(default="balanced"),
    target_minutes: str = Form(default=""),
    files: list[UploadFile] | None = File(default=None),
) -> RunSummary:
    try:
        options = RunOptions(
            language=language,  # type: ignore[arg-type]
            depth=depth,  # type: ignore[arg-type]
            target_minutes=_target_minutes(target_minutes),
        )
    except ValidationError as exc:
        first = exc.errors()[0] if exc.errors() else {"msg": "invalid options"}
        raise UploadError(f"Invalid study-prep options: {first['msg']}") from exc

    uploads = list(files or [])
    try:
        return await _manager(request).create_run(
            rough_notes=notes,
            options=options,
            uploads=uploads,
        )
    finally:
        for upload in uploads:
            await upload.close()


@router.get("/runs", response_model=list[RunSummary])
async def list_runs(request: Request) -> list[RunSummary]:
    return _manager(request).list_runs()


@router.get("/runs/{run_id}", response_model=RunSummary)
async def get_run(request: Request, run_id: str) -> RunSummary:
    return _manager(request).require(run_id)


@router.get("/runs/{run_id}/result", response_model=RunResult)
async def get_result(request: Request, run_id: str) -> RunResult:
    return _manager(request).result(run_id)


@router.post("/runs/{run_id}/cancel", response_model=RunSummary)
async def cancel_run(request: Request, run_id: str) -> RunSummary:
    return await _manager(request).cancel(run_id)


@router.post("/runs/{run_id}/retry", response_model=RunSummary)
async def retry_run(request: Request, run_id: str) -> RunSummary:
    return _manager(request).retry(run_id)


@router.delete("/runs/{run_id}", status_code=204)
async def delete_run(request: Request, run_id: str) -> Response:
    await _manager(request).delete(run_id)
    return Response(status_code=204)


@router.post("/runs/{run_id}/import", response_model=ChecklistImportResult)
async def import_run(
    request: Request,
    run_id: str,
    body: ChecklistImportRequest | None = None,
) -> ChecklistImportResult:
    manager = _manager(request)
    async with manager.import_lock:
        summary = manager.require(run_id)
        if summary.imported_at is not None:
            raise RunAlreadyImported(
                "That study-prep run has already been imported.",
                hint="Delete it and create a new run to import its checklist again.",
            )
        result = manager.result(run_id)
        if body is None:
            if not result.plan.subjects:
                raise StudyPrepError(
                    "The generated plan has no subjects to import."
                )
            try:
                body = ChecklistImportRequest(
                    subjects=[
                        {
                            "name": subject.name,
                            "items": [
                                {
                                    "text": item.text,
                                    "duration_seconds": item.duration_seconds,
                                }
                                for item in subject.items
                            ],
                        }
                        for subject in result.plan.subjects
                    ]
                )
            except ValidationError as exc:
                first = exc.errors()[0] if exc.errors() else {"msg": "invalid plan"}
                raise StudyPrepError(
                    f"The generated plan cannot be imported: {first['msg']}"
                ) from exc

        payload = [
            {
                "name": subject.name,
                "items": [
                    {
                        "text": item.text,
                        "duration_seconds": item.duration_seconds,
                    }
                    for item in subject.items
                ],
            }
            for subject in body.subjects
        ]
        imported = await run_command(
            request.app, lambda service: service.import_plan(payload)
        )
        manager.mark_imported(run_id)
        return ChecklistImportResult(**imported)
