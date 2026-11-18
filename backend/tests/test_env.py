from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from webstudy.env import load_env_file


class EnvFileTest(unittest.TestCase):
    def setUp(self) -> None:
        self._saved = {
            key: os.environ.get(key)
            for key in ("WEBSTUDY_LLM_MODEL", "WEBSTUDY_LLM_API_KEY", "EXPORTED")
        }
        for key in self._saved:
            os.environ.pop(key, None)
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "webstudy.env"

    def tearDown(self) -> None:
        self.directory.cleanup()
        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def write(self, text: str) -> None:
        self.path.write_text(text, encoding="utf-8")

    def test_loads_values_and_quotes(self) -> None:
        self.write(
            "\n".join(
                [
                    "# comment",
                    "WEBSTUDY_LLM_MODEL=qwen3.8:27b",
                    "WEBSTUDY_LLM_API_KEY='secret value'",
                    'EXPORTED="line one\\nline two"',
                    "",
                ]
            )
        )

        loaded = load_env_file(self.path)

        self.assertEqual(loaded, self.path)
        self.assertEqual(os.environ["WEBSTUDY_LLM_MODEL"], "qwen3.8:27b")
        self.assertEqual(os.environ["WEBSTUDY_LLM_API_KEY"], "secret value")
        self.assertEqual(os.environ["EXPORTED"], "line one\nline two")

    def test_real_environment_wins(self) -> None:
        os.environ["WEBSTUDY_LLM_MODEL"] = "from-process"
        self.write("WEBSTUDY_LLM_MODEL=from-file\n")

        load_env_file(self.path)

        self.assertEqual(os.environ["WEBSTUDY_LLM_MODEL"], "from-process")

    def test_missing_file_is_ignored(self) -> None:
        self.assertIsNone(load_env_file(self.path / "missing"))

    def test_invalid_lines_are_ignored(self) -> None:
        self.write(
            "not a pair\n1INVALID=value\nWEBSTUDY_LLM_MODEL=ok\n"
        )

        load_env_file(self.path)

        self.assertEqual(os.environ["WEBSTUDY_LLM_MODEL"], "ok")
        self.assertNotIn("1INVALID", os.environ)


if __name__ == "__main__":
    unittest.main()
