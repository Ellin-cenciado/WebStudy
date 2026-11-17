"""FastAPI application and HTTP transport for the WebStudy engine."""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Callable

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .. import __version__
from ..core.clock import Clock, SystemClock
from ..service import RecoveryCooldownError, StudyService
from ..storage import config as config_mod
from ..storage import paths
from ..study_prep.errors import StudyPrepError
from ..study_prep.manager import StudyPrepManager
from ..study_prep.models import ChecklistImportRequest, ChecklistImportResult
from ..study_prep.providers import LLMProvider, provider_from_env
from .commands import publish_state, run_command
from .lock import InstanceLock, InstanceLockError
from .schemas import (
    ConfigResponse,
    ConfigUpdate,
    ItemCreateRequest,
    ItemResponse,
    ItemUpdateRequest,
    NameRequest,
    RecoveryResponse,
    ResetDebtResponse,
    SubjectRequest,
    SubjectResponse,
)
from .serializers import (
    config_from_update,
    config_response,
    event_response,
    recovery_response,
    state_response,
    stats_response,
)
from .stream import Broadcaster, event_stream
from .study_prep import router as study_prep_router

log = logging.getLogger("webstudy.api")


def _default_frontend_dist() -> Path | None:
    configured = os.environ.get("WEBSTUDY_FRONTEND_DIST")
    if configured:
        return Path(configured).expanduser()
    candidate = Path(__file__).resolve().parents[3] / "frontend" / "dist"
    return candidate if candidate.exists() else None


async def _tick_loop(app: FastAPI) -> None:
    interval = app.state.tick_interval
    while True:
        await asyncio.sleep(interval)
        service = app.state.service
        if service is None:
            continue
        try:
            async with app.state.lock:
                revision_before = service.checklist_revision()
                events = service.tick()
                state = state_response(service).model_dump(mode="json")
                checklist = None
                if service.checklist_revision() != revision_before:
                    checklist = service.checklist_data()
            await app.state.broadcaster.publish("state", state)
            if checklist is not None:
                await app.state.broadcaster.publish("checklist", checklist)
            for event in events:
                await app.state.broadcaster.publish(
                    "event", event_response(event).model_dump(mode="json")
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("tick failed")


def create_app(
    *,
    config_path: Path | None = None,
    state_file: Path | None = None,
    history_file: Path | None = None,
    checklist_file: Path | None = None,
    clock: Clock | None = None,
    service: StudyService | None = None,
    persist: bool = True,
    tick_interval: float = 1.0,
    enable_tick_loop: bool = True,
    enable_lock: bool = True,
    lock_file: Path | None = None,
    frontend_dist: Path | None = None,
    study_prep_dir: Path | None = None,
    study_prep_provider_factory: Callable[[], LLMProvider | None] | None = None,
) -> FastAPI:
    config_target = Path(config_path).expanduser() if config_path else paths.config_path()
    state_target = Path(state_file).expanduser() if state_file else paths.state_path()
    history_target = (
        Path(history_file).expanduser()
        if history_file
        else state_target.parent / "history.db"
    )
    checklist_target = (
        Path(checklist_file).expanduser()
        if checklist_file
        else state_target.parent / "checklist.json"
    )
    lock_target = (
        Path(lock_file).expanduser()
        if lock_file
        else state_target.parent / paths.lock_path().name
    )
    study_prep_target = (
        Path(study_prep_dir).expanduser()
        if study_prep_dir
        else state_target.parent / "study-prep"
    )
    provider_factory = study_prep_provider_factory or provider_from_env
    dist = Path(frontend_dist).expanduser() if frontend_dist else _default_frontend_dist()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        owns_service = app.state.service is None
        instance_lock: InstanceLock | None = None
        tick_task: asyncio.Task | None = None
        try:
            if enable_lock:
                instance_lock = InstanceLock(lock_target)
                instance_lock.acquire()
            if app.state.service is None:
                config = config_mod.load(config_target)
                if persist and not config_target.exists():
                    config_mod.save(config, config_target)
                app.state.service = StudyService(
                    config,
                    app.state.clock,
                    state_file=state_target,
                    history_file=history_target,
                    checklist_file=checklist_target,
                    persist=persist,
                )
            app.state.lock = asyncio.Lock()
            app.state.broadcaster = Broadcaster()
            if owns_service and app.state.service.config.auto_start:
                app.state.service.start()
            await app.state.study_prep.start()
            if enable_tick_loop:
                tick_task = asyncio.create_task(_tick_loop(app))
            yield
        finally:
            if tick_task is not None:
                tick_task.cancel()
                try:
                    await tick_task
                except asyncio.CancelledError:
                    pass
            await app.state.study_prep.shutdown()
            if owns_service and app.state.service is not None:
                app.state.service.pause()
                app.state.service.close()
            if instance_lock is not None:
                instance_lock.release()

    app = FastAPI(
        title="WebStudy",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.service = service
    app.state.clock = clock or SystemClock()
    app.state.config_path = config_target
    app.state.tick_interval = tick_interval
    app.state.lock = asyncio.Lock()
    app.state.broadcaster = Broadcaster()
    app.state.frontend_dist = dist
    app.state.study_prep = StudyPrepManager(
        study_prep_target, provider_factory=provider_factory
    )

    @app.exception_handler(ValueError)
    async def _value_error_handler(_request: Request, exc: ValueError) -> JSONResponse:
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @app.exception_handler(StudyPrepError)
    async def _study_prep_error_handler(
        _request: Request, exc: StudyPrepError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "detail": exc.message,
                "code": exc.code,
                "hint": exc.hint,
            },
        )

    @app.exception_handler(InstanceLockError)
    async def _lock_error_handler(
        _request: Request, exc: InstanceLockError
    ) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.get("/api/state")
    async def get_state(request: Request):
        async with request.app.state.lock:
            return state_response(request.app.state.service)

    @app.get("/api/checklist")
    async def get_checklist(request: Request):
        async with request.app.state.lock:
            return request.app.state.service.checklist_data()

    @app.post("/api/checklist/import", response_model=ChecklistImportResult)
    async def import_checklist(request: Request, body: ChecklistImportRequest):
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
        return await run_command(
            request.app, lambda service: service.import_plan(payload)
        )

    @app.get("/api/config", response_model=ConfigResponse)
    async def get_config(request: Request):
        return config_response(request.app.state.service.config)

    @app.put("/api/config", response_model=ConfigResponse)
    async def update_config(request: Request, update: ConfigUpdate):
        service = request.app.state.service
        new_config = config_from_update(update, service.config)
        config_mod.save(new_config, request.app.state.config_path)
        async with request.app.state.lock:
            service.reload_config(new_config)
            state = state_response(service).model_dump(mode="json")
        await request.app.state.broadcaster.publish("state", state)
        return config_response(new_config)

    @app.get("/api/stats")
    async def get_stats(request: Request, days: int = Query(default=30, ge=1, le=365)):
        async with request.app.state.lock:
            return stats_response(request.app.state.service, days)

    @app.get("/api/recovery", response_model=RecoveryResponse)
    async def get_recovery(request: Request):
        async with request.app.state.lock:
            return recovery_response(request.app.state.service)

    @app.post("/api/recovery/reset", response_model=ResetDebtResponse)
    async def reset_debt(request: Request):
        service = request.app.state.service
        async with request.app.state.lock:
            status = service.recovery()
            if not status.can_reset:
                if status.next_reset_on is not None:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            "Next debt reset available on "
                            f"{status.next_reset_on.isoformat()}."
                        ),
                    )
                raise HTTPException(
                    status_code=400, detail="There is no carried debt to reset."
                )
            try:
                outcome = service.reset_debt()
            except RecoveryCooldownError as exc:
                raise HTTPException(status_code=409, detail=str(exc)) from exc
            events = service.take_pending_events()
            state = state_response(service).model_dump(mode="json")
            recovery = recovery_response(service)
        await request.app.state.broadcaster.publish("state", state)
        for event in events:
            await request.app.state.broadcaster.publish(
                "event", event_response(event).model_dump(mode="json")
            )
        return ResetDebtResponse(
            forgiven_seconds=outcome.forgiven_seconds,
            recovery=recovery,
        )

    @app.post("/api/session/start", status_code=204)
    async def start_session(request: Request):
        await run_command(request.app, lambda service: service.start())
        return Response(status_code=204)

    @app.post("/api/session/pause", status_code=204)
    async def pause_session(request: Request):
        await run_command(request.app, lambda service: service.pause())
        return Response(status_code=204)

    @app.post("/api/session/skip-phase", status_code=204)
    async def skip_phase(request: Request):
        await run_command(request.app, lambda service: service.skip_phase())
        return Response(status_code=204)

    @app.post("/api/subjects", response_model=SubjectResponse, status_code=201)
    async def add_subject(request: Request, body: SubjectRequest):
        subject_id = await run_command(
            request.app, lambda service: service.add_subject(body.name)
        )
        return SubjectResponse(id=subject_id)

    @app.patch("/api/subjects/{subject_id}", status_code=204)
    async def rename_subject(request: Request, subject_id: str, body: NameRequest):
        async with request.app.state.lock:
            request.app.state.service.rename_subject(subject_id, body.name)
        await publish_state(request.app)
        return Response(status_code=204)

    @app.delete("/api/subjects/{subject_id}", status_code=204)
    async def remove_subject(request: Request, subject_id: str):
        await run_command(
            request.app, lambda service: service.remove_subject(subject_id)
        )
        return Response(status_code=204)

    @app.post("/api/subjects/{subject_id}/select", status_code=204)
    async def select_subject(request: Request, subject_id: str):
        await run_command(
            request.app, lambda service: service.select_subject(subject_id)
        )
        return Response(status_code=204)

    @app.post("/api/subjects/{subject_id}/reset", status_code=204)
    async def reset_subject(request: Request, subject_id: str):
        await run_command(
            request.app, lambda service: service.reset_subject(subject_id)
        )
        return Response(status_code=204)

    @app.post("/api/subjects/{subject_id}/uncheck-last", status_code=204)
    async def uncheck_last(request: Request, subject_id: str):
        await run_command(
            request.app, lambda service: service.uncheck_last_item(subject_id)
        )
        return Response(status_code=204)

    @app.post(
        "/api/subjects/{subject_id}/items",
        response_model=ItemResponse,
        status_code=201,
    )
    async def add_item(request: Request, subject_id: str, body: ItemCreateRequest):
        item_id = await run_command(
            request.app,
            lambda service: service.add_item(
                subject_id, body.text, body.duration_seconds
            ),
        )
        return ItemResponse(id=item_id)

    @app.patch("/api/items/{item_id}", status_code=204)
    async def update_item(request: Request, item_id: str, body: ItemUpdateRequest):
        if body.text is None and body.duration_seconds is None:
            raise HTTPException(status_code=400, detail="nothing to update")
        async with request.app.state.lock:
            if body.text is not None:
                request.app.state.service.rename_item(item_id, body.text)
            if body.duration_seconds is not None:
                request.app.state.service.set_item_duration(
                    item_id, body.duration_seconds
                )
        await publish_state(request.app)
        return Response(status_code=204)

    @app.delete("/api/items/{item_id}", status_code=204)
    async def remove_item(request: Request, item_id: str):
        await run_command(
            request.app, lambda service: service.remove_item(item_id)
        )
        return Response(status_code=204)

    @app.post("/api/items/{item_id}/check", status_code=204)
    async def check_item(request: Request, item_id: str):
        await run_command(
            request.app, lambda service: service.check_item(item_id)
        )
        return Response(status_code=204)

    @app.get("/api/stream")
    async def stream(request: Request):
        return StreamingResponse(
            event_stream(
                request,
                request.app.state.service,
                request.app.state.broadcaster,
                request.app.state.lock,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    app.include_router(study_prep_router)

    if dist is not None and dist.is_dir():
        assets = dist / "assets"
        if assets.is_dir():
            app.mount("/assets", StaticFiles(directory=assets), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa(full_path: str):
            if full_path.startswith("api/") or full_path == "api":
                raise HTTPException(status_code=404)
            target = (dist / full_path).resolve()
            if target.is_file() and dist.resolve() in target.parents:
                return FileResponse(target)
            return FileResponse(dist / "index.html")

    return app
