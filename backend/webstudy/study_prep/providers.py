"""Provider configuration and a small OpenAI-compatible chat client.

Ollama, LM Studio, vLLM, and OpenAI all expose the same
``/v1/chat/completions`` shape, so one adapter covers both local and remote
providers. JSON mode is attempted first and retried without it for providers
that reject it.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass
from typing import Protocol

import httpx

from .errors import InvalidModelOutput, ProviderError

DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1"
DEFAULT_CONTEXT_TOKENS = 16_384
DEFAULT_MAX_OUTPUT_TOKENS = 2_500
DEFAULT_TIMEOUT_SECONDS = 300


@dataclass(frozen=True)
class LLMConfig:
    base_url: str
    model: str
    api_key: str
    context_tokens: int
    max_output_tokens: int
    timeout_seconds: int
    provider: str
    reasoning_effort: str = ""
    opencode_base_url: str = ""
    opencode_password: str = ""
    opencode_agent: str = "study-prep"
    opencode_model: str = ""
    opencode_location: str = ""
    opencode_timeout_seconds: int = 900

    @property
    def configured(self) -> bool:
        if self.provider == "opencode":
            return bool(self.opencode_agent.strip())
        return bool(self.model.strip())

    @classmethod
    def from_env(cls) -> "LLMConfig":
        base_url = (
            os.environ.get("WEBSTUDY_LLM_BASE_URL", DEFAULT_BASE_URL).strip()
            or DEFAULT_BASE_URL
        ).rstrip("/")
        model = os.environ.get("WEBSTUDY_LLM_MODEL", "").strip()
        api_key = os.environ.get("WEBSTUDY_LLM_API_KEY", "").strip()
        provider = os.environ.get("WEBSTUDY_LLM_PROVIDER", "").strip().lower()
        reasoning_effort = (
            os.environ.get("WEBSTUDY_LLM_REASONING_EFFORT", "").strip().lower()
        )
        if not provider:
            provider = (
                "ollama"
                if "11434" in base_url or "ollama" in base_url
                else "openai-compatible"
            )
        return cls(
            base_url=base_url,
            model=model,
            api_key=api_key,
            context_tokens=_int_env("WEBSTUDY_LLM_CONTEXT_TOKENS", DEFAULT_CONTEXT_TOKENS),
            max_output_tokens=_int_env(
                "WEBSTUDY_LLM_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS
            ),
            timeout_seconds=_int_env(
                "WEBSTUDY_LLM_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS
            ),
            provider=provider,
            reasoning_effort=reasoning_effort,
            opencode_base_url=os.environ.get("WEBSTUDY_OPENCODE_BASE_URL", "").strip(),
            opencode_password=os.environ.get("WEBSTUDY_OPENCODE_PASSWORD", "").strip(),
            opencode_agent=(
                os.environ.get("WEBSTUDY_OPENCODE_AGENT", "study-prep").strip()
                or "study-prep"
            ),
            opencode_model=os.environ.get("WEBSTUDY_OPENCODE_MODEL", "").strip(),
            opencode_location=os.environ.get("WEBSTUDY_OPENCODE_LOCATION", "").strip(),
            opencode_timeout_seconds=_int_env(
                "WEBSTUDY_OPENCODE_TIMEOUT_SECONDS", 900
            ),
        )

    @property
    def char_budget(self) -> int:
        """Conservative prompt budget based on the configured context size."""
        usable_tokens = max(
            2_000, self.context_tokens - self.max_output_tokens - 1_500
        )
        return usable_tokens * 3


class LLMProvider(Protocol):
    config: LLMConfig

    async def complete_json(
        self,
        *,
        system: str,
        prompt: str,
        max_tokens: int | None = None,
        temperature: float = 0.2,
        workspace: str | None = None,
    ) -> dict:
        ...


class OpenAICompatibleProvider:
    def __init__(
        self,
        config: LLMConfig,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.config = config
        self._transport = transport

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
                "No language model is configured.",
                hint="Set WEBSTUDY_LLM_MODEL (and optionally WEBSTUDY_LLM_BASE_URL).",
            )
        last_error: Exception | None = None
        for attempt in range(2):
            repair = ""
            if last_error is not None:
                repair = (
                    "\n\nYour previous response was not valid JSON. "
                    "Return one valid JSON object only, with no markdown fences."
                )
            try:
                text = await self._request(
                    system=system,
                    prompt=prompt + repair,
                    max_tokens=max_tokens or self.config.max_output_tokens,
                    temperature=temperature,
                )
                return _parse_json(text)
            except InvalidModelOutput as exc:
                last_error = exc
                if attempt == 0:
                    continue
                raise
        raise InvalidModelOutput(
            "The language model did not return valid JSON.",
            hint="Try a larger model or a provider with JSON mode enabled.",
        )

    async def _request(
        self,
        *,
        system: str,
        prompt: str,
        max_tokens: int,
        temperature: float,
    ) -> str:
        url = f"{self.config.base_url}/chat/completions"
        headers = {"Content-Type": "application/json"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        payload: dict = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        timeout = httpx.Timeout(self.config.timeout_seconds, connect=15.0)
        client_kwargs: dict = {"timeout": timeout}
        if self._transport is not None:
            client_kwargs["transport"] = self._transport
        async with httpx.AsyncClient(**client_kwargs) as client:
            reasoning_effort = self.config.reasoning_effort
            response = await self._send_with_fallback(
                client,
                url,
                headers,
                payload,
                reasoning_effort=reasoning_effort,
            )
            if response.status_code >= 400:
                self._raise_http_error(response)

            _body, choice, content = _response_message(response)
            if content.strip():
                return content

            # Thinking models can spend the whole output budget on hidden
            # reasoning, leaving ``content`` empty. Retry once with reasoning
            # disabled when the provider reports any reasoning text.
            if (
                _reasoning_text(choice.get("message"))
                and reasoning_effort.lower() != "none"
            ):
                retry = await self._send_with_fallback(
                    client,
                    url,
                    headers,
                    payload,
                    reasoning_effort="none",
                )
                if retry.status_code < 400:
                    _body, choice, content = _response_message(retry)
                    if content.strip():
                        return content

            raise _empty_response_error(choice)

    def _raise_http_error(self, response: httpx.Response) -> None:
        detail = _response_detail(response)
        raise ProviderError(
            f"The language model request failed ({response.status_code}): {detail}",
            hint="Check WEBSTUDY_LLM_BASE_URL, WEBSTUDY_LLM_MODEL, and that Ollama or the API is running.",
        )

    async def _send_with_fallback(
        self,
        client: httpx.AsyncClient,
        url: str,
        headers: dict,
        payload: dict,
        *,
        reasoning_effort: str,
    ) -> httpx.Response:
        response = await self._send(
            client,
            url,
            headers,
            payload,
            json_mode=True,
            reasoning_effort=reasoning_effort,
        )
        if response.status_code in {400, 422}:
            # Some local servers do not implement response_format. Retry
            # without JSON mode and rely on the prompt + parser.
            response = await self._send(
                client,
                url,
                headers,
                payload,
                json_mode=False,
                reasoning_effort=reasoning_effort,
            )
        if response.status_code in {400, 422} and reasoning_effort:
            # The provider may not know reasoning_effort at all.
            response = await self._send(
                client,
                url,
                headers,
                payload,
                json_mode=False,
                reasoning_effort="",
            )
        return response

    async def _send(
        self,
        client: httpx.AsyncClient,
        url: str,
        headers: dict,
        payload: dict,
        *,
        json_mode: bool,
        reasoning_effort: str,
    ) -> httpx.Response:
        request_payload = dict(payload)
        if json_mode:
            request_payload["response_format"] = {"type": "json_object"}
        if reasoning_effort:
            request_payload["reasoning_effort"] = reasoning_effort
        return await self._post(client, url, headers, request_payload)

    async def _post(
        self,
        client: httpx.AsyncClient,
        url: str,
        headers: dict,
        payload: dict,
    ) -> httpx.Response:
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                response = await client.post(url, headers=headers, json=payload)
            except (httpx.TimeoutException, httpx.ConnectError) as exc:
                last_error = exc
                if attempt < 2:
                    await asyncio.sleep(2**attempt)
                    continue
                raise ProviderError(
                    "Could not reach the language model provider.",
                    hint="Start Ollama or check WEBSTUDY_LLM_BASE_URL and the network.",
                ) from exc
            if response.status_code in {429, 500, 502, 503, 504} and attempt < 2:
                await asyncio.sleep(2**attempt)
                continue
            return response
        if last_error is not None:
            raise ProviderError(str(last_error))
        raise ProviderError("The language model request failed.")


def provider_from_env() -> LLMProvider | None:
    config = LLMConfig.from_env()
    if not config.configured:
        return None
    if config.provider == "opencode":
        from .opencode import OpenCodeAgentProvider

        return OpenCodeAgentProvider(config)
    return OpenAICompatibleProvider(config)


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


def _parse_json(text: str) -> dict:
    value = text.strip()
    if value.startswith("```"):
        value = re.sub(r"^```(?:json)?\s*", "", value)
        value = re.sub(r"\s*```$", "", value)
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        start = value.find("{")
        end = value.rfind("}")
        if start < 0 or end <= start:
            raise InvalidModelOutput("The language model did not return a JSON object.")
        try:
            parsed = json.loads(value[start : end + 1])
        except json.JSONDecodeError as exc:
            raise InvalidModelOutput(
                f"The language model returned invalid JSON: {exc.msg}"
            ) from exc
    if not isinstance(parsed, dict):
        raise InvalidModelOutput("The language model returned JSON that is not an object.")
    return parsed


def _response_message(
    response: httpx.Response,
) -> tuple[dict, dict, str]:
    try:
        body = response.json()
        choice = body["choices"][0]
        message = choice["message"]
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise ProviderError(
            "The language model returned an unexpected response.",
            hint="Check that the configured endpoint is OpenAI-compatible.",
        ) from exc
    if not isinstance(body, dict) or not isinstance(choice, dict):
        raise ProviderError(
            "The language model returned an unexpected response.",
            hint="Check that the configured endpoint is OpenAI-compatible.",
        )
    if not isinstance(message, dict):
        raise ProviderError(
            "The language model returned an unexpected response.",
            hint="Check that the configured endpoint is OpenAI-compatible.",
        )
    content = message.get("content")
    if isinstance(content, list):
        content = "".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
        )
    if not isinstance(content, str):
        content = ""
    return body, choice, content


def _reasoning_text(message: object) -> str:
    if not isinstance(message, dict):
        return ""
    for key in ("reasoning_content", "reasoning"):
        value = message.get(key)
        if isinstance(value, str) and value.strip():
            return value
        if isinstance(value, list):
            text = "".join(
                part.get("text", "") if isinstance(part, dict) else str(part)
                for part in value
            )
            if text.strip():
                return text
    return ""


def _empty_response_error(choice: dict) -> ProviderError:
    reasoning = _reasoning_text(choice.get("message"))
    if reasoning:
        if choice.get("finish_reason") == "length":
            message = (
                "The language model used its entire output budget on reasoning "
                "and returned no answer."
            )
        else:
            message = (
                "The language model returned reasoning but no final answer."
            )
        return ProviderError(
            message,
            hint=(
                "Set WEBSTUDY_LLM_REASONING_EFFORT=none for thinking models "
                "(for example Qwen3.5 on LM Studio), or raise "
                "WEBSTUDY_LLM_MAX_OUTPUT_TOKENS."
            ),
        )
    return ProviderError(
        "The language model returned an empty response.",
        hint=(
            "Check the model name and provider settings, or raise "
            "WEBSTUDY_LLM_MAX_OUTPUT_TOKENS."
        ),
    )


def _response_detail(response: httpx.Response) -> str:
    try:
        body = response.json()
        if isinstance(body, dict):
            detail = body.get("error")
            if isinstance(detail, dict):
                return str(detail.get("message") or detail)[:500]
            if detail:
                return str(detail)[:500]
    except ValueError:
        pass
    return response.text[:500] or response.reason_phrase
