"""Errors raised by the study-prep subsystem."""

from __future__ import annotations


class StudyPrepError(Exception):
    status_code = 400
    code = "study_prep_error"

    def __init__(self, message: str, *, hint: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.hint = hint


class ProviderNotConfigured(StudyPrepError):
    status_code = 503
    code = "provider_not_configured"


class RunNotFound(StudyPrepError):
    status_code = 404
    code = "run_not_found"


class RunNotReady(StudyPrepError):
    status_code = 409
    code = "run_not_ready"


class RunAlreadyImported(StudyPrepError):
    status_code = 409
    code = "run_already_imported"


class RunAlreadyActive(StudyPrepError):
    status_code = 409
    code = "run_already_active"


class SourceExtractionError(StudyPrepError):
    status_code = 422
    code = "source_extraction_failed"


class ProviderError(StudyPrepError):
    status_code = 502
    code = "provider_error"


class InvalidModelOutput(StudyPrepError):
    status_code = 502
    code = "invalid_model_output"


class UploadError(StudyPrepError):
    status_code = 400
    code = "invalid_upload"
