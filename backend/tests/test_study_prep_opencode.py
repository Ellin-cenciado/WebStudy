from __future__ import annotations

import asyncio
import base64
import json
import os
import subprocess
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import httpx

from webstudy.study_prep.errors import InvalidModelOutput, ProviderError
from webstudy.study_prep.opencode import OpenCodeAgentProvider
from webstudy.study_prep.providers import LLMConfig, provider_from_env


def config(**overrides) -> LLMConfig:
    base = LLMConfig(
        base_url="http://unused.invalid/v1",
        model="",
        api_key="",
        context_tokens=16_384,
        max_output_tokens=2_500,
        timeout_seconds=30,
        provider="opencode",
        opencode_base_url="http://opencode.test",
        opencode_password="secret",
        opencode_agent="study-prep",
        opencode_timeout_seconds=30,
    )
    return replace(base, **overrides)


def assistant_message(
    text: str = '{"ok": true}',
    *,
    content: list[dict] | None = None,
    finish: str = "stop",
    error: dict | None = None,
) -> dict:
    message: dict = {
        "id": "msg_1",
        "time": {"created": 1},
        "type": "assistant",
        "agent": "study-prep",
        "model": {"providerID": "fake", "id": "model"},
        "finish": finish,
        "content": content
        if content is not None
        else [{"type": "text", "text": text}],
    }
    if error is not None:
        message["error"] = error
    return {
        "data": [message],
        "cursor": {"previous": None, "next": None},
    }


class FakeOpenCode:
    def __init__(
        self,
        *,
        answers: list[str] | None = None,
        message: dict | None = None,
    ) -> None:
        self.answers = list(answers or ['{"ok": true}'])
        self.message = message
        self.requests: list[httpx.Request] = []
        self.sessions: list[tuple[str, dict]] = []
        self.prompts: list[str] = []
        self.deleted: list[str] = []
        self.interrupted: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path == "/api/info":
            return httpx.Response(200, json={"version": "2.2.5"})
        if path == "/api/session" and request.method == "POST":
            payload = json.loads(request.content)
            session_id = f"ses_{len(self.sessions) + 1}"
            self.sessions.append((session_id, payload))
            return httpx.Response(200, json={"data": {"id": session_id}})
        if path.endswith("/prompt"):
            payload = json.loads(request.content)
            self.prompts.append(payload["text"])
            return httpx.Response(200, json={"data": {}})
        if path.endswith("/wait"):
            return httpx.Response(204)
        if path.endswith("/message") and request.method == "GET":
            if self.message is not None:
                return httpx.Response(200, json=self.message)
            text = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
            return httpx.Response(200, json=assistant_message(text))
        if path.endswith("/interrupt"):
            self.interrupted.append(path)
            return httpx.Response(204)
        if path.startswith("/api/session/") and request.method == "DELETE":
            self.deleted.append(path.rsplit("/", 1)[-1])
            return httpx.Response(204)
        return httpx.Response(404, json={"message": "not found"})


class CancellingTransport(httpx.AsyncBaseTransport):
    def __init__(self) -> None:
        self.interrupted = False
        self.deleted = False

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/info":
            return httpx.Response(200, json={"version": "2.2.5"})
        if path == "/api/session" and request.method == "POST":
            return httpx.Response(200, json={"data": {"id": "ses_cancel"}})
        if path.endswith("/prompt"):
            return httpx.Response(200, json={"data": {}})
        if path.endswith("/wait"):
            raise asyncio.CancelledError()
        if path.endswith("/interrupt"):
            self.interrupted = True
            return httpx.Response(204)
        if request.method == "DELETE":
            self.deleted = True
            return httpx.Response(204)
        return httpx.Response(404)


class OpenCodeProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_generates_json_and_creates_read_only_agent_workspace(self) -> None:
        fake = FakeOpenCode()
        provider = OpenCodeAgentProvider(
            config(), transport=httpx.MockTransport(fake.handler)
        )
        with tempfile.TemporaryDirectory() as temp:
            result = await provider.complete_json(
                system="system rules",
                prompt="user prompt",
                workspace=temp,
            )

            agent = Path(temp) / ".opencode" / "agents" / "study-prep.md"
            self.assertTrue(agent.exists())
            content = agent.read_text(encoding="utf-8")
            self.assertIn('action: "*"', content)
            self.assertIn('effect: deny', content)
            self.assertIn('resource: "**"', content)

        self.assertEqual(result, {"ok": True})
        self.assertEqual(len(fake.sessions), 1)
        session_id, payload = fake.sessions[0]
        self.assertEqual(payload["agent"], "study-prep")
        self.assertEqual(payload["location"]["directory"], str(Path(temp).resolve()))
        self.assertNotIn("model", payload)
        self.assertIn("system rules", fake.prompts[0])
        self.assertIn("user prompt", fake.prompts[0])
        self.assertEqual(fake.deleted, [session_id])
        authorization = fake.requests[0].headers["authorization"]
        self.assertTrue(authorization.startswith("Basic "))
        decoded = base64.b64decode(authorization.split(" ", 1)[1]).decode()
        self.assertEqual(decoded, "opencode:secret")

    async def test_model_override_becomes_a_model_reference(self) -> None:
        fake = FakeOpenCode()
        provider = OpenCodeAgentProvider(
            config(opencode_model="ollama/qwen3.8:27b#high"),
            transport=httpx.MockTransport(fake.handler),
        )
        with tempfile.TemporaryDirectory() as temp:
            await provider.complete_json(
                system="system",
                prompt="prompt",
                workspace=temp,
            )

        _session_id, payload = fake.sessions[0]
        self.assertEqual(
            payload["model"],
            {
                "providerID": "ollama",
                "id": "qwen3.8:27b",
                "variant": "high",
            },
        )

    async def test_invalid_json_retries_in_a_fresh_session(self) -> None:
        fake = FakeOpenCode(answers=["not json", '{"ok": true}'])
        provider = OpenCodeAgentProvider(
            config(), transport=httpx.MockTransport(fake.handler)
        )
        with tempfile.TemporaryDirectory() as temp:
            result = await provider.complete_json(
                system="system",
                prompt="prompt",
                workspace=temp,
            )

        self.assertEqual(result, {"ok": True})
        self.assertEqual(len(fake.sessions), 2)
        self.assertEqual(len(fake.prompts), 2)
        self.assertIn("previous response was not valid JSON", fake.prompts[1])
        self.assertEqual(len(fake.deleted), 2)

    async def test_reports_reasoning_only_and_length_finishes(self) -> None:
        reasoning_only = FakeOpenCode(
            message=assistant_message(
                content=[{"type": "reasoning", "text": "thinking"}]
            )
        )
        provider = OpenCodeAgentProvider(
            config(), transport=httpx.MockTransport(reasoning_only.handler)
        )
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ProviderError) as caught:
                await provider.complete_json(
                    system="system", prompt="prompt", workspace=temp
                )
        self.assertIn("returned no text", caught.exception.message)

        truncated = FakeOpenCode(
            message=assistant_message(text="", finish="length")
        )
        provider = OpenCodeAgentProvider(
            config(), transport=httpx.MockTransport(truncated.handler)
        )
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ProviderError) as caught:
                await provider.complete_json(
                    system="system", prompt="prompt", workspace=temp
                )
        self.assertIn("output limit", caught.exception.message)

    async def test_maps_authentication_and_missing_agent_errors(self) -> None:
        def unauthorized(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                401,
                json={"message": "Authentication required"},
            )

        provider = OpenCodeAgentProvider(
            config(), transport=httpx.MockTransport(unauthorized)
        )
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ProviderError) as caught:
                await provider.complete_json(
                    system="system", prompt="prompt", workspace=temp
                )
        self.assertIn("WEBSTUDY_OPENCODE_PASSWORD", caught.exception.hint or "")

        def missing_agent(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/info":
                return httpx.Response(200, json={"version": "2.2.5"})
            return httpx.Response(404, json={"message": "Agent not found"})

        provider = OpenCodeAgentProvider(
            config(), transport=httpx.MockTransport(missing_agent)
        )
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ProviderError) as caught:
                await provider.complete_json(
                    system="system", prompt="prompt", workspace=temp
                )
        self.assertIn("WEBSTUDY_OPENCODE_AGENT", caught.exception.hint or "")

    async def test_rejects_agent_paths_outside_the_agent_directory(self) -> None:
        provider = OpenCodeAgentProvider(
            config(opencode_agent="../escape"),
            transport=httpx.MockTransport(FakeOpenCode().handler),
        )
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ProviderError):
                await provider.complete_json(
                    system="system", prompt="prompt", workspace=temp
                )

    async def test_discovers_service_url_and_reads_service_password(self) -> None:
        fake = FakeOpenCode()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            config_dir = root / "config" / "opencode"
            config_dir.mkdir(parents=True)
            (config_dir / "service.json").write_text(
                json.dumps({"password": "discovered"}), encoding="utf-8"
            )
            provider = OpenCodeAgentProvider(
                config(opencode_base_url="", opencode_password=""),
                transport=httpx.MockTransport(fake.handler),
            )
            with patch.dict(
                os.environ,
                {"XDG_CONFIG_HOME": str(root / "config")},
                clear=False,
            ), patch(
                "webstudy.study_prep.opencode.shutil.which",
                return_value="/usr/bin/opencode",
            ), patch(
                "webstudy.study_prep.opencode.subprocess.run",
                return_value=subprocess.CompletedProcess(
                    ["opencode", "service", "status"],
                    0,
                    stdout="http://127.0.0.1:49374\n",
                    stderr="",
                ),
            ):
                result = await provider.complete_json(
                    system="system",
                    prompt="prompt",
                    workspace=str(root / "workspace"),
                )

        self.assertEqual(result, {"ok": True})
        self.assertEqual(str(fake.requests[0].url), "http://127.0.0.1:49374/api/info")
        authorization = fake.requests[0].headers["authorization"]
        decoded = base64.b64decode(authorization.split(" ", 1)[1]).decode()
        self.assertEqual(decoded, "opencode:discovered")

    async def test_invalid_json_after_retry_raises(self) -> None:
        fake = FakeOpenCode(answers=["not json", "still not json"])
        provider = OpenCodeAgentProvider(
            config(), transport=httpx.MockTransport(fake.handler)
        )
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(InvalidModelOutput):
                await provider.complete_json(
                    system="system", prompt="prompt", workspace=temp
                )
        self.assertEqual(len(fake.deleted), 2)

    async def test_cancellation_interrupts_and_deletes_the_session(self) -> None:
        transport = CancellingTransport()
        provider = OpenCodeAgentProvider(config(), transport=transport)
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(asyncio.CancelledError):
                await provider.complete_json(
                    system="system", prompt="prompt", workspace=temp
                )
        self.assertTrue(transport.interrupted)
        self.assertTrue(transport.deleted)


class OpenCodeConfigTests(unittest.TestCase):
    def test_opencode_provider_is_configured_without_a_model_name(self) -> None:
        with patch.dict(
            os.environ,
            {
                "WEBSTUDY_LLM_PROVIDER": "opencode",
                "WEBSTUDY_OPENCODE_BASE_URL": "http://127.0.0.1:49374",
                "WEBSTUDY_OPENCODE_PASSWORD": "secret",
            },
            clear=True,
        ):
            loaded = LLMConfig.from_env()
            provider = provider_from_env()

        self.assertTrue(loaded.configured)
        self.assertEqual(loaded.opencode_agent, "study-prep")
        self.assertIsInstance(provider, OpenCodeAgentProvider)


if __name__ == "__main__":
    unittest.main()
