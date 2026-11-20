"""Delivery Issue reconcile 与创建校验测试。"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

from reconcile_workitem import _validate_created_delivery, reconcile_one
from tfs_sync_common import MulticaClient, RuntimeContext, SyncError


def runtime_context(tmp: Path) -> RuntimeContext:
    return RuntimeContext(
        collection="WN_Data_Platform",
        project_ref="demo",
        project_id="project-1",
        delivery_squad_ref="Delivery Squad",
        delivery_squad_id="squad-1",
        multica_bin="multica",
        timeout=30,
        work_dir=tmp,
    )


def raw_item(changed_at: str = "2026-09-21T05:00:00Z") -> dict:
    return {
        "id": 12345,
        "fields": {
            "System.WorkItemType": "Requirement",
            "System.Title": "Delivery issue test",
            "System.ChangedDate": changed_at,
            "System.State": "Active",
        },
    }


def source_metadata(changed_at: str = "2026-09-21T05:00:00Z") -> dict:
    return {
        "source": "tfs",
        "tfs.collection": "WN_Data_Platform",
        "tfs.id": "12345",
        "tfs.changed_at": changed_at,
        "tfs.type": "Requirement",
    }


class CreationValidationTests(unittest.TestCase):
    def test_created_delivery_passes(self):
        issue = {
            "id": "issue-1",
            "status": "backlog",
            "assignee_id": "squad-1",
            "assignee_type": "squad",
            "metadata": source_metadata(),
        }
        result = _validate_created_delivery(
            issue,
            expected_squad_id="squad-1",
            expected_collection="WN_Data_Platform",
            expected_tfs_id="12345",
        )
        self.assertEqual(result["result"], "PASS")

    def test_wrong_squad_fails(self):
        issue = {
            "id": "issue-1",
            "status": "backlog",
            "assignee_id": "agent-1",
            "assignee_type": "agent",
            "metadata": source_metadata(),
        }
        result = _validate_created_delivery(
            issue,
            expected_squad_id="squad-1",
            expected_collection="WN_Data_Platform",
            expected_tfs_id="12345",
        )
        self.assertEqual(result["result"], "FAIL")
        codes = {r["code"] for r in result["reasons"]}
        self.assertIn("DELIVERY_ASSIGNEE_MISMATCH", codes)
        self.assertIn("DELIVERY_ASSIGNEE_TYPE_MISMATCH", codes)


class ReconcileTests(unittest.TestCase):
    def test_missing_delivery_dry_run_would_create_backlog(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            client = Mock()
            client.list_by_metadata.return_value = []
            client.search_issues.return_value = []
            result = reconcile_one(
                raw_item(),
                client=client,
                ctx=runtime_context(Path(tmpdir)),
                run_dir=Path(tmpdir),
                apply=False,
            )
        self.assertEqual(result["delivery_action"], "WOULD_CREATE")
        self.assertEqual(result["delivery_status"], "backlog")
        self.assertEqual(
            result["creation_validation"]["result"], "WOULD_VALIDATE_AFTER_CREATE"
        )
        client.create_issue.assert_not_called()
        client.assign_issue.assert_not_called()

    def test_existing_started_issue_is_not_reassigned(self):
        issue = {
            "id": "issue-1",
            "status": "in_progress",
            "assignee_id": "engineer-1",
            "assignee_type": "agent",
            "project_id": "project-1",
            "metadata": source_metadata(),
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            client = Mock()
            client.list_by_metadata.return_value = [issue]
            client.get_issue.return_value = issue
            result = reconcile_one(
                raw_item(),
                client=client,
                ctx=runtime_context(Path(tmpdir)),
                run_dir=Path(tmpdir),
                apply=True,
            )
        self.assertEqual(result["delivery_action"], "NOOP")
        self.assertEqual(result["creation_validation"]["result"], "NOT_APPLICABLE")
        client.assign_issue.assert_not_called()
        client.update_issue.assert_not_called()

    def test_existing_backlog_issue_keeps_current_assignee(self):
        issue = {
            "id": "issue-1",
            "status": "backlog",
            "assignee_id": "someone-else",
            "assignee_type": "agent",
            "project_id": "project-1",
            "metadata": source_metadata("2026-09-20T05:00:00Z"),
        }
        updated = {**issue, "metadata": source_metadata("2026-09-21T05:00:00Z")}
        with tempfile.TemporaryDirectory() as tmpdir:
            client = Mock()
            client.list_by_metadata.return_value = [issue]
            client.get_issue.side_effect = [issue, updated]
            result = reconcile_one(
                raw_item(),
                client=client,
                ctx=runtime_context(Path(tmpdir)),
                run_dir=Path(tmpdir),
                apply=True,
            )
        self.assertEqual(result["delivery_action"], "UPDATED")
        self.assertEqual(result["creation_validation"]["result"], "NOT_APPLICABLE")
        client.assign_issue.assert_not_called()
        client.update_issue.assert_called_once()

    def test_creation_recovery_completes_initialization(self):
        candidate = {
            "id": "issue-1",
            "title": "[TFS #12345] Delivery issue test",
            "status": "backlog",
            "project_id": "project-1",
            "metadata": {},
        }
        completed = {
            **candidate,
            "assignee_id": "squad-1",
            "assignee_type": "squad",
            "metadata": source_metadata(),
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            client = Mock()
            client.list_by_metadata.return_value = []
            client.search_issues.return_value = [candidate]
            client.get_issue.side_effect = [candidate, completed]
            result = reconcile_one(
                raw_item(),
                client=client,
                ctx=runtime_context(Path(tmpdir)),
                run_dir=Path(tmpdir),
                apply=True,
            )
        self.assertEqual(result["delivery_action"], "RECOVERED_CREATE")
        self.assertEqual(result["creation_validation"]["result"], "PASS")
        client.set_metadata_many.assert_called_once()
        client.assign_issue.assert_called_once_with("issue-1", "squad-1")
        client.create_issue.assert_not_called()


class SquadResolutionTests(unittest.TestCase):
    def test_resolve_squad_by_exact_id(self):
        client = MulticaClient("multica")
        client.run = Mock(return_value={"squads": [{"id": "squad-1", "name": "Delivery Squad"}]})
        self.assertEqual(client.resolve_squad("squad-1"), "squad-1")

    def test_duplicate_squad_name_is_rejected(self):
        client = MulticaClient("multica")
        client.run = Mock(
            return_value={
                "squads": [
                    {"id": "squad-1", "name": "Delivery Squad"},
                    {"id": "squad-2", "name": "Delivery Squad"},
                ]
            }
        )
        with self.assertRaises(SyncError) as exc:
            client.resolve_squad("Delivery Squad")
        self.assertEqual(exc.exception.code, "SQUAD_RESOLVE_FAILED")


if __name__ == "__main__":
    unittest.main()
