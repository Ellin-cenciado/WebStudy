from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from webstudy.api.app import create_app
from webstudy.core.clock import FakeClock
from webstudy.core.schedule import SECONDS_PER_HOUR

TZ = timezone(timedelta(hours=2))
MONDAY = (2026, 10, 12)


def at(ymd=MONDAY, hour=10, minute=0) -> datetime:
    return datetime(*ymd, hour, minute, tzinfo=TZ)


class ApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.clock = FakeClock(at())
        self.app = create_app(
            config_path=self.tmp / "config.toml",
            state_file=self.tmp / "state.json",
            history_file=self.tmp / "history.db",
            checklist_file=self.tmp / "checklist.json",
            clock=self.clock,
            persist=False,
            enable_tick_loop=False,
            enable_lock=False,
        )
        self.client = TestClient(self.app)
        self.client.__enter__()

    def tearDown(self) -> None:
        self.client.__exit__(None, None, None)
        self._tmp.cleanup()

    def test_health_and_initial_state(self) -> None:
        health = self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["status"], "ok")

        response = self.client.get("/api/state")
        self.assertEqual(response.status_code, 200)
        state = response.json()
        self.assertEqual(state["snapshot"]["logical_day"], "2026-10-12")
        self.assertEqual(state["snapshot"]["weekday"], "monday")
        self.assertEqual(state["snapshot"]["day_kind"], "carried")
        self.assertEqual(
            state["snapshot"]["required_seconds"], 4 * SECONDS_PER_HOUR
        )
        self.assertFalse(state["snapshot"]["running"])
        self.assertEqual(state["checklist"]["revision"], 0)

    def test_config_round_trip_and_free_day(self) -> None:
        config = self.client.get("/api/config").json()
        self.assertEqual(config["boundary"], "04:00")
        self.assertEqual(config["schedule"]["monday"]["mode"], "carried")
        self.assertFalse(config["vacation"]["enabled"])
        self.assertEqual(config["max_debt_hours"], 12)
        self.assertEqual(config["reset_cooldown_days"], 30)

        config["schedule"]["monday"] = {"mode": "free", "quota_minutes": 240}
        response = self.client.put("/api/config", json=config)
        self.assertEqual(response.status_code, 200)
        saved = response.json()
        self.assertEqual(saved["schedule"]["monday"]["mode"], "free")
        self.assertEqual(saved["schedule"]["monday"]["quota_minutes"], 0)

        state = self.client.get("/api/state").json()
        self.assertTrue(state["snapshot"]["is_free_day"])
        self.assertEqual(state["snapshot"]["required_seconds"], 0)
        self.assertEqual(state["snapshot"]["remaining_seconds"], 0)

    def test_vacation_config_and_state(self) -> None:
        config = self.client.get("/api/config").json()
        config["vacation"] = {
            "enabled": True,
            "start": "2026-10-12",
            "end": "2026-10-12",
        }
        response = self.client.put("/api/config", json=config)
        self.assertEqual(response.status_code, 200)
        saved = response.json()
        self.assertTrue(saved["vacation"]["enabled"])
        self.assertEqual(saved["vacation"]["start"], "2026-10-12")

        state = self.client.get("/api/state").json()
        self.assertTrue(state["snapshot"]["is_vacation"])
        self.assertTrue(state["snapshot"]["is_free_day"])
        self.assertEqual(state["snapshot"]["day_kind"], "vacation")
        self.assertEqual(state["snapshot"]["required_seconds"], 0)

    def test_recovery_and_reset_cooldown(self) -> None:
        self.clock.set_wall(
            datetime(2026, 10, 13, 10, 0, tzinfo=TZ)
        )
        self.app.state.service.tick()

        recovery = self.client.get("/api/recovery").json()
        self.assertEqual(recovery["debt_seconds"], 4 * SECONDS_PER_HOUR)
        self.assertTrue(recovery["can_reset"])
        self.assertIsNone(recovery["next_reset_on"])

        response = self.client.post("/api/recovery/reset")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["forgiven_seconds"], 4 * SECONDS_PER_HOUR)
        self.assertFalse(payload["recovery"]["can_reset"])
        self.assertEqual(
            payload["recovery"]["next_reset_on"], "2026-11-12"
        )

        state = self.client.get("/api/state").json()
        self.assertEqual(state["snapshot"]["debt_seconds"], 0)

        second = self.client.post("/api/recovery/reset")
        self.assertEqual(second.status_code, 409)

    def test_config_validation(self) -> None:
        invalid = self.client.get("/api/config").json()
        invalid["boundary"] = "not-a-time"
        self.assertEqual(self.client.put("/api/config", json=invalid).status_code, 422)

        missing_schedule = self.client.get("/api/config").json()
        del missing_schedule["schedule"]
        self.assertEqual(
            self.client.put("/api/config", json=missing_schedule).status_code, 422
        )

    def test_checklist_crud_and_check_item(self) -> None:
        subject_response = self.client.post(
            "/api/subjects", json={"name": "Mathematics"}
        )
        self.assertEqual(subject_response.status_code, 201)
        subject_id = subject_response.json()["id"]

        first = self.client.post(
            f"/api/subjects/{subject_id}/items",
            json={"text": "Algebra", "duration_seconds": 600},
        )
        self.assertEqual(first.status_code, 201)
        second = self.client.post(
            f"/api/subjects/{subject_id}/items",
            json={"text": "Geometry", "duration_seconds": 600},
        )
        self.assertEqual(second.status_code, 201)

        checklist = self.client.get("/api/checklist").json()
        self.assertEqual(checklist["active_subject_id"], subject_id)
        self.assertEqual(len(checklist["subjects"]), 1)
        self.assertEqual(len(checklist["subjects"][0]["items"]), 2)

        first_id = first.json()["id"]
        second_id = second.json()["id"]

        self.client.post("/api/session/start")
        self.clock.advance(300)
        self.app.state.service.tick()

        state = self.client.get("/api/state").json()
        self.assertEqual(state["snapshot"]["elapsed_seconds"], 300)
        self.assertEqual(state["checklist"]["active_item_id"], first_id)
        self.assertEqual(state["checklist"]["remaining_seconds"], 300)

        response = self.client.post(f"/api/items/{first_id}/check")
        self.assertEqual(response.status_code, 204)
        checklist = self.client.get("/api/checklist").json()
        algebra, geometry = checklist["subjects"][0]["items"]
        self.assertTrue(algebra["checked"])
        self.assertEqual(algebra["carry_out_seconds"], 300)
        self.assertEqual(geometry["carry_in_seconds"], 300)
        self.assertEqual(
            geometry["base_seconds"]
            + geometry["carry_in_seconds"]
            - geometry["elapsed_seconds"],
            900,
        )
        self.assertEqual(checklist["revision"], 4)

        state = self.client.get("/api/state").json()
        self.assertEqual(state["checklist"]["active_item_id"], second_id)

    def test_item_update_and_remove(self) -> None:
        subject_id = self.client.post(
            "/api/subjects", json={"name": "History"}
        ).json()["id"]
        item_id = self.client.post(
            f"/api/subjects/{subject_id}/items",
            json={"text": "Chapter 1", "duration_seconds": 600},
        ).json()["id"]

        response = self.client.patch(
            f"/api/items/{item_id}",
            json={"text": "Chapter 2", "duration_seconds": 1200},
        )
        self.assertEqual(response.status_code, 204)
        checklist = self.client.get("/api/checklist").json()
        item = checklist["subjects"][0]["items"][0]
        self.assertEqual(item["text"], "Chapter 2")
        self.assertEqual(item["base_seconds"], 1200)

        self.assertEqual(self.client.delete(f"/api/items/{item_id}").status_code, 204)
        checklist = self.client.get("/api/checklist").json()
        self.assertEqual(checklist["subjects"][0]["items"], [])

    def test_invalid_ids_and_validation_errors(self) -> None:
        response = self.client.post("/api/items/no-such-item/check")
        self.assertEqual(response.status_code, 400)
        self.assertIn("unknown item", response.json()["detail"])

        response = self.client.post("/api/subjects", json={"name": "   "})
        self.assertEqual(response.status_code, 400)
        self.assertIn("must not be empty", response.json()["detail"])

        response = self.client.post(
            "/api/subjects", json={"name": "x" * 201}
        )
        self.assertEqual(response.status_code, 422)

    def test_stats_empty_without_history(self) -> None:
        response = self.client.get("/api/stats")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["days"], [])
        self.assertEqual(payload["summary"]["streak"], 0)
        self.assertEqual(payload["summary"]["debt_seconds"], 0)

    def test_subject_selection_and_reset(self) -> None:
        first = self.client.post(
            "/api/subjects", json={"name": "First"}
        ).json()["id"]
        second = self.client.post(
            "/api/subjects", json={"name": "Second"}
        ).json()["id"]
        item_id = self.client.post(
            f"/api/subjects/{second}/items",
            json={"text": "Task", "duration_seconds": 600},
        ).json()["id"]

        self.assertEqual(
            self.client.post(f"/api/subjects/{second}/select").status_code, 204
        )
        self.client.post(f"/api/items/{item_id}/check")
        self.client.post(f"/api/subjects/{second}/uncheck-last")
        checklist = self.client.get("/api/checklist").json()
        self.assertFalse(checklist["subjects"][1]["items"][0]["checked"])

        self.assertEqual(
            self.client.post(f"/api/subjects/{first}/select").status_code, 204
        )
        checklist = self.client.get("/api/checklist").json()
        self.assertEqual(checklist["active_subject_id"], first)
        self.assertEqual(
            self.client.post(f"/api/subjects/{second}/reset").status_code, 204
        )


class InstanceLockTest(unittest.TestCase):
    def test_second_instance_is_rejected(self) -> None:
        from webstudy.api.lock import InstanceLock, InstanceLockError

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "webstudy.lock"
            first = InstanceLock(path)
            second = InstanceLock(path)
            first.acquire()
            try:
                with self.assertRaises(InstanceLockError):
                    second.acquire()
            finally:
                first.release()
            second.acquire()
            second.release()


if __name__ == "__main__":
    unittest.main()
