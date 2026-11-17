"""OpenCode V2 agent provider for Study Prep.

The WebStudy backend talks to the OpenCode background service over its local
HTTP API. Mobile clients never contact OpenCode directly: they keep using the
WebStudy backend, which owns prompts, validation, and the study plan.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
from contextlib import suppress
from pathlib import Path

import httpx

from .errors import InvalidModelOutput, ProviderError
from .providers import LLMConfig, _parse_json

DEFAULT_AGENT = "study-prep"


class OpenCodeAgentProvider:
    """Run each JSON generation in a fresh, read-only OpenCode session."""

    def __init__(
        self,
        config: LLMConfig,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.config = config
        self._transport = transport
        self._base_url: str | None = None
        self._headers: dict[str, str] = {}
        self._connected = False

    async def complete_json(
        self,
        *,
        system: str,
        prompt: str,
        max_tokens: int | None = None,
        temperature: float = 0.2,
        workspace: str | None = None,
    ) -> dict:
        if not self.config.configured:
            raise ProviderError(
                "No OpenCode agent is configured.",
                hint="Set WEBSTUDY_LLM_PROVIDER=opencode and WEBSTUDY_OPENCODE_AGENT.",
            )
        last_error: InvalidModelOutput | None = None
        for attempt in range(2):
            repair = ""
            if last_error is not None:
                repair = (
                    "\n\nYour previous response was not valid JSON. "
                    "Return one valid JSON object only, with no markdown fences."
                )
            try:
                text = await self._run_once(
                    system=system,
                    prompt=prompt + repair,
                    workspace=workspace,
                )
                return _parse_json(text)
            except InvalidModelOutput as exc:
                last_error = exc
                if attempt == 0:
                    continue
                raise
        raise InvalidModelOutput("The OpenCode agent did not return valid JSON.")

    async def _run_once(
        self,
        *,
        system: str,
        prompt: str,
        workspace: str | None,
    ) -> str:
        root, temporary = self._prepare_workspace(workspace)
        session_id: str | None = None
        try:
            async with self._client() as client:
                await self._connect(client)
                payload: dict = {
                    "title": f"Study Prep {root.name}",
                    "agent": self.config.opencode_agent or DEFAULT_AGENT,
                    "location": {"directory": str(root)},
                }
                model = _model_ref(self.config.opencode_model)
                if model is not None:
                    payload["model"] = model
                created = await self._request(
                    client, "POST", "/api/session", payload
                )
                session_id = _session_id(created)
                try:
                    await self._request(
                        client,
                        "POST",
                        f"/api/session/{session_id}/prompt",
                        {"text": f"{system}\n\n---\n\n{prompt}"},
                    )
                    await self._request(
                        client,
                        "POST",
                        f"/api/experimental/session/{session_id}/wait",
                    )
                    messages = await self._request(
                        client, "GET", f"/api/session/{session_id}/message"
                    )
                    return _assistant_text(messages)
                except asyncio.CancelledError:
                    await self._interrupt_best_effort(session_id)
                    raise
        finally:
            if session_id is not None:
                with suppress(Exception):
                    await self._delete_best_effort(session_id)
            if temporary:
                shutil.rmtree(root, ignore_errors=True)

    def _client(self, timeout_seconds: float | None = None) -> httpx.AsyncClient:
        seconds = (
            timeout_seconds
            if timeout_seconds is not None
            else self.config.opencode_timeout_seconds
        )
        timeout = httpx.Timeout(seconds, connect=15.0)
        kwargs: dict = {"timeout": timeout}
        if self._transport is not None:
            kwargs["transport"] = self._transport
        return httpx.AsyncClient(**kwargs)

    async def _connect(self, client: httpx.AsyncClient) -> None:
        if self._connected:
            return
        if self._base_url is None:
            base_url = self.config.opencode_base_url or _discover_service_url()
            password = self.config.opencode_password or _read_service_password()
            self._base_url = base_url.rstrip("/")
            token = base64.b64encode(f"opencode:{password}".encode()).decode()
            self._headers = {"Authorization": f"Basic {token}"}
        try:
            response = await client.get(
                f"{self._base_url}/api/info",
                headers=self._headers,
            )
        except (httpx.TimeoutException, httpx.ConnectError) as exc:
            raise ProviderError(
                "Could not reach the OpenCode service.",
                hint=(
                    "Run opencode service start on the backend host, or set "
                    "WEBSTUDY_OPENCODE_BASE_URL and WEBSTUDY_OPENCODE_PASSWORD."
                ),
            ) from exc
        if response.status_code >= 400:
            raise _http_error(response)
        try:
            body = response.json()
        except ValueError as exc:
            raise ProviderError("OpenCode returned an invalid service response.") from exc
        version = body.get("version") if isinstance(body, dict) else None
        if isinstance(version, str) and version and not version.startswith("2."):
            raise ProviderError(
                "The OpenCode service is not V2.",
                hint="Upgrade OpenCode on the backend host.",
            )
        self._connected = True

    async def _request(
        self,
        client: httpx.AsyncClient,
        method: str,
        path: str,
        payload: dict | None = None,
    ) -> dict | None:
        await self._connect(client)
        try:
            response = await client.request(
                method,
                f"{self._base_url}{path}",
                headers=self._headers,
                json=payload,
            )
        except httpx.TimeoutException as exc:
            raise ProviderError(
                "The OpenCode request timed out.",
                hint="Increase WEBSTUDY_OPENCODE_TIMEOUT_SECONDS or check the model.",
            ) from exc
        except httpx.ConnectError as exc:
            raise ProviderError(
                "Could not reach the OpenCode service.",
                hint="Check WEBSTUDY_OPENCODE_BASE_URL and that the service is running.",
            ) from exc
        if response.status_code >= 400:
            raise _http_error(response)
        if response.status_code == 204 or not response.content:
            return None
        try:
            return response.json()
        except ValueError as exc:
            raise ProviderError("OpenCode returned an invalid response.") from exc

    def _prepare_workspace(self, workspace: str | None) -> tuple[Path, bool]:
        generated = bool(workspace)
        configured = workspace or self.config.opencode_location
        if configured:
            root = Path(configured).expanduser().resolve()
            try:
                root.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                raise ProviderError(
                    f"Could not create the OpenCode workspace: {exc}"
                ) from exc
            temporary = False
        else:
            root = Path(tempfile.mkdtemp(prefix="webstudy-opencode-"))
            temporary = True
        agent = self.config.opencode_agent.strip() or DEFAULT_AGENT
        if Path(agent).is_absolute() or ".." in Path(agent).parts:
            raise ProviderError("WEBSTUDY_OPENCODE_AGENT must be a simple agent ID.")
        agent_path = root / ".opencode" / "agents" / f"{agent}.md"
        agent_path.parent.mkdir(parents=True, exist_ok=True)
        if generated or not agent_path.exists():
            agent_path.write_text(_agent_markdown(), encoding="utf-8")
        return root, temporary

    async def _interrupt_best_effort(self, session_id: str) -> None:
        if self._base_url is None:
            return
        with suppress(Exception):
            async with self._client(timeout_seconds=10) as client:
                await client.post(
                    f"{self._base_url}/api/session/{session_id}/interrupt",
                    headers=self._headers,
                )

    async def _delete_best_effort(self, session_id: str) -> None:
        if self._base_url is None:
            return
        with suppress(Exception):
            async with self._client(timeout_seconds=10) as client:
                await client.delete(
                    f"{self._base_url}/api/session/{session_id}",
                    headers=self._headers,
                )


def _discover_service_url() -> str:
    binary = shutil.which("opencode")
    if binary is None:
        raise ProviderError(
            "OpenCode is not installed or is not on PATH.",
            hint="Set WEBSTUDY_OPENCODE_BASE_URL and WEBSTUDY_OPENCODE_PASSWORD.",
        )
    try:
        completed = subprocess.run(
            [binary, "service", "status"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ProviderError(
            "Could not discover the OpenCode service.",
            hint="Run opencode service start or set WEBSTUDY_OPENCODE_BASE_URL.",
        ) from exc
    output = f"{completed.stdout}\n{completed.stderr}"
    match = re.search(r"https?://[^\s\x1b]+", output)
    if completed.returncode != 0 or match is None:
        raise ProviderError(
            "Could not discover the OpenCode service.",
            hint="Run opencode service start or set WEBSTUDY_OPENCODE_BASE_URL.",
        )
    return match.group(0).rstrip("/")


def _read_service_password() -> str:
    config_home = os.environ.get("XDG_CONFIG_HOME", "").strip()
    base = Path(config_home) if config_home else Path.home() / ".config"
    path = base / "opencode" / "service.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ProviderError(
            "Could not read OpenCode service credentials.",
            hint=f"Set WEBSTUDY_OPENCODE_PASSWORD or check {path}.",
        ) from exc
    password = data.get("password") if isinstance(data, dict) else None
    if not isinstance(password, str) or not password:
        raise ProviderError(
            "OpenCode service credentials are missing a password.",
            hint="Set WEBSTUDY_OPENCODE_PASSWORD.",
        )
    return password


def _agent_markdown() -> str:
    # ``**`` is workspace-relative. The broad deny also keeps
    # external_directory denied, so absolute paths outside the run directory
    # are rejected even though relative reads are allowed.
    return """---
description: Generates Study Prep JSON from the current run's material
mode: primary
steps: 6
permissions:
  - action: "*"
    resource: "*"
    effect: deny
  - action: "read"
    resource: "**"
    effect: allow
  - action: "glob"
    resource: "**"
    effect: allow
  - action: "grep"
    resource: "**"
    effect: allow
---

Return only the requested JSON object. Do not edit files, run shell commands,
use the network, or read outside this run directory.
"""


def _model_ref(value: str) -> dict | None:
    value = value.strip()
    if not value:
        return None
    provider_id, separator, model = value.partition("/")
    if not separator or not provider_id or not model:
        raise ProviderError(
            "WEBSTUDY_OPENCODE_MODEL must be provider/model[#variant]."
        )
    model_id, _, variant = model.partition("#")
    reference: dict = {"providerID": provider_id, "id": model_id}
    if variant:
        reference["variant"] = variant
    return reference


def _session_id(created: dict | None) -> str:
    if isinstance(created, dict):
        data = created.get("data")
        if isinstance(data, dict) and isinstance(data.get("id"), str):
            return data["id"]
    raise ProviderError("OpenCode returned an invalid session response.")


def _message_created(message: dict) -> float:
    time = message.get("time")
    if isinstance(time, dict):
        created = time.get("created")
        if isinstance(created, (int, float)):
            return float(created)
    return 0.0


def _assistant_text(body: dict | None) -> str:
    messages = body.get("data") if isinstance(body, dict) else None
    if not isinstance(messages, list):
        raise ProviderError("OpenCode returned an invalid message response.")
    assistants = [
        message
        for message in messages
        if isinstance(message, dict) and message.get("type") == "assistant"
    ]
    assistants.sort(key=_message_created)
    for message in reversed(assistants):
        error = message.get("error")
        if error:
            raise ProviderError(
                f"The OpenCode agent failed: {_structured_error(error)}"
            )
        content = message.get("content")
        if not isinstance(content, list):
            continue
        text = "".join(
            str(part.get("text", ""))
            for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        ).strip()
        if text:
            return text
    finish = assistants[-1].get("finish") if assistants else None
    if finish == "length":
        raise ProviderError(
            "The OpenCode agent hit its output limit.",
            hint="Reduce the prompt or increase the model's output limit.",
        )
    if finish == "tool-calls":
        raise ProviderError(
            "The OpenCode agent stopped at a tool call.",
            hint="Check the study-prep agent permissions and run workspace.",
        )
    raise ProviderError(
        "The OpenCode agent returned no text.",
        hint="Check the agent and model configuration.",
    )


def _structured_error(error: object) -> str:
    if isinstance(error, str):
        return error[:500]
    if isinstance(error, dict):
        message = error.get("message")
        if isinstance(message, str):
            return message[:500]
    return json.dumps(error, default=str)[:500]


def _http_error(response: httpx.Response) -> ProviderError:
    detail = response.text[:500]
    try:
        body = response.json()
    except ValueError:
        body = None
    if isinstance(body, dict):
        message = body.get("message")
        error = body.get("error")
        if isinstance(message, str):
            detail = message[:500]
        elif isinstance(error, str):
            detail = error[:500]
        elif isinstance(error, dict) and isinstance(error.get("message"), str):
            detail = error["message"][:500]
        elif isinstance(body.get("_tag"), str):
            detail = body["_tag"]
    if response.status_code == 401:
        hint = "Check WEBSTUDY_OPENCODE_PASSWORD and the OpenCode service credentials."
    elif response.status_code == 404:
        hint = "Check WEBSTUDY_OPENCODE_AGENT and that it exists in the run workspace."
    elif response.status_code == 503:
        hint = "Start the OpenCode service with opencode service start."
    else:
        hint = "Check WEBSTUDY_OPENCODE_BASE_URL and the OpenCode service logs."
    return ProviderError(
        f"OpenCode request failed ({response.status_code}): {detail}",
        hint=hint,
    )
