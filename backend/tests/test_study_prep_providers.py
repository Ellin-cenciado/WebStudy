from __future__ import annotations

import json
import os
import unittest
from dataclasses import replace
from unittest.mock import patch

import httpx

from webstudy.study_prep.errors import ProviderError
from webstudy.study_prep.providers import (
    LLMConfig,
    OpenAICompatibleProvider,
)


def config(**overrides) -> LLMConfig:
    base = LLMConfig(
        base_url="http://fake.invalid/v1",
        model="fake",
        api_key="",
        context_tokens=16_384,
        max_output_tokens=2_500,
        timeout_seconds=30,
        provider="openai-compatible",
    )
    return replace(base, **overrides)


def completion(
    *,
    content: str = "",
    reasoning: str = "",
    finish_reason: str = "stop",
) -> httpx.Response:
    message: dict = {"role": "assistant", "content": content}
    if reasoning:
        message["reasoning_content"] = reasoning
    return httpx.Response(
        200,
        json={
            "choices": [
                {
                    "index": 0,
                    "message": message,
                    "finish_reason": finish_reason,
                }
            ]
        },
    )


class LLMConfigTests(unittest.TestCase):
    def test_reads_reasoning_effort_from_env(self) -> None:
        with patch.dict(
            os.environ,
            {
                "WEBSTUDY_LLM_MODEL": "qwen/qwen3.5-9b",
                "WEBSTUDY_LLM_REASONING_EFFORT": " NONE ",
            },
            clear=True,
        ):
            loaded = LLMConfig.from_env()
        self.assertEqual(loaded.reasoning_effort, "none")

    def test_reasoning_effort_defaults_to_empty(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            loaded = LLMConfig.from_env()
        self.assertEqual(loaded.reasoning_effort, "")


class OpenAICompatibleProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_retries_without_reasoning_when_content_is_empty(self) -> None:
        payloads: list[dict] = []

        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content)
            payloads.append(payload)
            if payload.get("reasoning_effort") == "none":
                return completion(content='{"ok": true}')
            return completion(
                reasoning="A long chain of thought.",
                finish_reason="length",
            )

        provider = OpenAICompatibleProvider(
            config(),
            transport=httpx.MockTransport(handler),
        )
        result = await provider.complete_json(system="system", prompt="prompt")

        self.assertEqual(result, {"ok": True})
        self.assertEqual(len(payloads), 2)
        self.assertNotIn("reasoning_effort", payloads[0])
        self.assertEqual(payloads[1]["reasoning_effort"], "none")

    async def test_reports_reasoning_exhaustion_clearly(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return completion(
                reasoning="A long chain of thought.",
                finish_reason="length",
            )

        provider = OpenAICompatibleProvider(
            config(reasoning_effort="none"),
            transport=httpx.MockTransport(handler),
        )
        with self.assertRaises(ProviderError) as caught:
            await provider.complete_json(system="system", prompt="prompt")

        self.assertIn("entire output budget on reasoning", caught.exception.message)
        self.assertIn(
            "WEBSTUDY_LLM_REASONING_EFFORT=none",
            caught.exception.hint or "",
        )

    async def test_strips_reasoning_effort_when_provider_rejects_it(self) -> None:
        payloads: list[dict] = []

        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content)
            payloads.append(payload)
            if "reasoning_effort" in payload:
                return httpx.Response(
                    400,
                    json={"error": {"message": "unknown field reasoning_effort"}},
                )
            return completion(content='{"ok": true}')

        provider = OpenAICompatibleProvider(
            config(reasoning_effort="none"),
            transport=httpx.MockTransport(handler),
        )
        result = await provider.complete_json(system="system", prompt="prompt")

        self.assertEqual(result, {"ok": True})
        self.assertEqual(len(payloads), 3)
        self.assertNotIn("reasoning_effort", payloads[-1])

    async def test_empty_response_without_reasoning_keeps_generic_hint(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return completion()

        provider = OpenAICompatibleProvider(
            config(reasoning_effort="none"),
            transport=httpx.MockTransport(handler),
        )
        with self.assertRaises(ProviderError) as caught:
            await provider.complete_json(system="system", prompt="prompt")

        self.assertEqual(
            caught.exception.message,
            "The language model returned an empty response.",
        )


if __name__ == "__main__":
    unittest.main()
