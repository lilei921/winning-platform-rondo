"""TFS Sync 确定性客户端与批次结果测试。"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

from tfs_sync_common import MulticaClient, SyncError, string_metadata_filter

_sync_run_spec = importlib.util.spec_from_file_location("sync_run", SCRIPT_DIR / "sync-run.py")
sync_run = importlib.util.module_from_spec(_sync_run_spec)
assert _sync_run_spec and _sync_run_spec.loader
_sync_run_spec.loader.exec_module(sync_run)


class MetadataFilterTests(unittest.TestCase):
    def test_numeric_tfs_id_preserves_json_string_through_cli_boundary(self):
        client = MulticaClient("multica")
        completed = subprocess.CompletedProcess(
            args=[], returncode=0, stdout=json.dumps({"issues": []}), stderr=""
        )
        with patch("tfs_sync_common.subprocess.run", return_value=completed) as run:
            client.list_by_metadata([("tfs.id", "221943")])

        command = run.call_args.args[0]
        value = command[command.index("--metadata") + 1]
        self.assertEqual(value, '"tfs.id=""221943"""')
        self.assertEqual(value, string_metadata_filter("tfs.id", "221943"))


class RetryTests(unittest.TestCase):
    def test_retryable_read_retries_network_error_then_returns_json(self):
        failed = subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr="Could not reach the Multica server"
        )
        succeeded = subprocess.CompletedProcess(
            args=[], returncode=0, stdout=json.dumps({"issues": []}), stderr=""
        )
        client = MulticaClient("multica", read_retry_attempts=1, read_retry_base_delay_seconds=0)
        with patch("tfs_sync_common.subprocess.run", side_effect=[failed, succeeded]) as run:
            result = client.list_by_metadata([("source", "tfs")])

        self.assertEqual(result, [])
        self.assertEqual(run.call_count, 2)

    def test_write_is_not_blindly_retried_after_network_error(self):
        failed = subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr="Could not reach the Multica server"
        )
        client = MulticaClient("multica", read_retry_attempts=3, read_retry_base_delay_seconds=0)
        with patch("tfs_sync_common.subprocess.run", return_value=failed) as run:
            with self.assertRaises(SyncError):
                client.run(["issue", "create"])

        self.assertEqual(run.call_count, 1)


class SummaryContractTests(unittest.TestCase):
    def test_partial_failure_is_not_reported_as_completed(self):
        self.assertEqual(sync_run.summary_result({"failed": 0}), "COMPLETED")
        self.assertEqual(sync_run.summary_result({"failed": 1}), "PARTIAL_FAILURE")

    def test_creation_validation_failure_counts_as_item_failure(self):
        counts = sync_run.aggregate(
            [
                {
                    "tfs_id": "12345",
                    "delivery_action": "CREATED",
                    "creation_validation": {
                        "result": "FAIL",
                        "reasons": [{"code": "DELIVERY_ASSIGNEE_MISMATCH"}],
                    },
                    "errors": [],
                }
            ]
        )
        self.assertEqual(counts["failed"], 1)
        self.assertEqual(counts["conflicts"], 1)



class SkillLayoutTests(unittest.TestCase):
    def test_default_config_is_under_config_directory(self):
        config_path = sync_run.default_config()
        self.assertEqual(config_path.parent.name, "config")
        self.assertEqual(config_path.name, "config.toml")
        self.assertTrue(config_path.exists())

if __name__ == "__main__":
    unittest.main()
