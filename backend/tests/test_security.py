"""Regression coverage for path, state, scheduling, and admission boundaries."""

from __future__ import annotations

import os
import stat
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch


# The backend creates its data directory during import. Keep every test's data
# in a temporary directory rather than touching a developer's default /data.
APP_DATA_DIR = tempfile.mkdtemp(prefix="rclone-desk-security-tests-")
os.environ["APP_DATA"] = APP_DATA_DIR

from fastapi import HTTPException  # noqa: E402

from backend import main  # noqa: E402


class SecurityRegressionTests(unittest.TestCase):
    def setUp(self) -> None:
        main.OPERATIONS.clear()
        main.CANCEL_EVENTS.clear()
        main.CONFIG_USERS = 0
        self.data = Path(APP_DATA_DIR)
        self.source = main.TEST_ROOT / "source"
        self.destination = main.TEST_ROOT / "destination"
        self.source.mkdir(parents=True, exist_ok=True)
        self.destination.mkdir(parents=True, exist_ok=True)
        main.secure_write(
            main.CONFIG,
            "[source]\ntype = local\n\n[destination]\ntype = local\n",
        )
        main.save_state(
            {
                "local_roots": {
                    "source": str(self.source.resolve()),
                    "destination": str(self.destination.resolve()),
                },
                "jobs": [],
            }
        )

    def test_safe_relative_rejects_parent_traversal_and_control(self) -> None:
        for path in ("../secret", "folder/../../secret", "bad\x00name", "bad\x7fname"):
            with self.subTest(path=repr(path)), self.assertRaises(HTTPException):
                main.safe_relative(path)

    def test_safe_relative_preserves_colons_in_cloud_filenames(self) -> None:
        self.assertEqual(main.safe_relative("reports/2026:Q4.txt"), "reports/2026:Q4.txt")

    def test_safe_remote_rejects_leading_dash(self) -> None:
        with self.assertRaises(HTTPException):
            main.safe_remote("-config")
        self.assertEqual(main.safe_remote("remote_1.test"), "remote_1.test")

    def test_confined_remote_rejects_symlink_escape(self) -> None:
        outside = self.data / "outside"
        outside.mkdir(exist_ok=True)
        (self.source / "escape").symlink_to(outside, target_is_directory=True)

        with self.assertRaises(HTTPException):
            main.remote_path("source", "escape/secret.txt")

    def test_alias_to_same_storage_cannot_overlap(self) -> None:
        alias_root = self.source / "nested"
        alias_root.mkdir(exist_ok=True)
        main.secure_write(
            main.CONFIG,
            "[source]\ntype = local\n\n[alias]\ntype = alias\nremote = source:nested\n\n"
            "[destination]\ntype = local\n",
        )
        values = main.state()
        values["local_roots"]["alias"] = str(alias_root.resolve())
        main.save_state(values)

        with self.assertRaises(HTTPException):
            main.ensure_separate_locations("alias", "folder", "source", "nested/folder/child")

    def test_impossible_february_31_cron_is_bounded(self) -> None:
        after = datetime(2025, 1, 1, tzinfo=timezone.utc)
        self.assertIsNone(main.next_cron_run("0 0 31 2 *", after))

    def test_leap_day_cron_finds_next_leap_year(self) -> None:
        after = datetime(2025, 1, 1, tzinfo=timezone.utc)
        self.assertEqual(
            main.next_cron_run("0 0 29 2 *", after),
            "2028-02-29T00:00:00+00:00",
        )

    def test_cron_day_and_weekday_are_or_and_sunday_seven_is_supported(self) -> None:
        monday_not_first = datetime(2025, 1, 6, 0, 0, tzinfo=timezone.utc)
        sunday = datetime(2025, 1, 5, 0, 0, tzinfo=timezone.utc)
        self.assertTrue(main.cron_matches("0 0 1 * 1", monday_not_first))
        self.assertTrue(main.cron_matches("0 0 * * 7", sunday))

    def test_secure_write_keeps_replacement_file_private(self) -> None:
        target = self.data / "private.txt"
        main.secure_write(target, "private")
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)

    def test_parallel_job_creation_preserves_every_job(self) -> None:
        count = 24
        barrier = threading.Barrier(count)
        errors: list[BaseException] = []

        def create(index: int) -> None:
            try:
                item = main.JobInput(
                    name=f"job-{index}",
                    source_remote="source",
                    source_path=f"file-{index}",
                    destination_remote="destination",
                    destination_path=f"file-{index}",
                )
                barrier.wait(timeout=5)
                main.create_job(item)
            except BaseException as exc:
                errors.append(exc)

        threads = [threading.Thread(target=create, args=(index,)) for index in range(count)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)

        self.assertFalse([thread.name for thread in threads if thread.is_alive()])
        self.assertEqual(errors, [])
        self.assertEqual(len(main.state()["jobs"]), count)

    def test_concurrent_duplicate_job_run_is_rejected(self) -> None:
        job = main.create_job(
            main.JobInput(
                name="copy",
                source_remote="source",
                source_path="file",
                destination_remote="destination",
                destination_path="file",
            )
        )
        entered_start = threading.Event()
        allow_start_to_finish = threading.Event()
        results: list[object] = []

        def fake_start(*_args, **_kwargs):
            entered_start.set()
            if not allow_start_to_finish.wait(timeout=5):
                raise AssertionError("test did not release the mocked operation start")
            return {"id": "operation"}

        def run() -> None:
            try:
                results.append(main.run_job(job["id"], main.RunInput()))
            except BaseException as exc:
                results.append(exc)

        with patch.object(main, "start_operation", side_effect=fake_start):
            first = threading.Thread(target=run)
            first.start()
            self.assertTrue(entered_start.wait(timeout=5))
            second = threading.Thread(target=run)
            second.start()
            allow_start_to_finish.set()
            first.join(timeout=5)
            second.join(timeout=5)

        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        self.assertEqual(len(results), 2)
        failures = [result for result in results if isinstance(result, HTTPException)]
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0].status_code, 409)

    def test_batch_queue_rejection_does_not_admit_a_partial_batch(self) -> None:
        for index in range(main.MAX_PENDING_OPERATIONS - 1):
            operation_id = f"existing-{index}"
            main.OPERATIONS[operation_id] = {"id": operation_id, "status": "queued"}
            main.CANCEL_EVENTS[operation_id] = threading.Event()

        initial_ids = set(main.OPERATIONS)
        with patch.object(main.EXECUTOR, "submit") as submit:
            with self.assertRaises(HTTPException) as raised:
                main.start_operations([("one", ["copy", "a", "b"], None), ("two", ["copy", "c", "d"], None)])

        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(set(main.OPERATIONS), initial_ids)
        self.assertEqual(len(main.CANCEL_EVENTS), len(initial_ids))
        submit.assert_not_called()

    def test_config_edit_is_rejected_while_a_remote_operation_uses_config(self) -> None:
        item = main.ConfigInput(content="[source]\ntype = local\n")
        with patch.object(main, "normalize_config_passwords", return_value=item.content):
            with main.config_use(), self.assertRaises(HTTPException) as raised:
                main.put_config(item)

        self.assertEqual(raised.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
