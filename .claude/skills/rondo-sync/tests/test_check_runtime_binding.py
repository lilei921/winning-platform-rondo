"""runtime 绑定校验回归：多 runtime 分散绑定允许，失效/离线仍需告警。"""
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import check_workspaces as check  # noqa: E402

MANIFEST = {
    "project": {"title": "P"},
    "agents": [
        {"name": "A", "skills": []},
        {"name": "B", "skills": []},
    ],
    "managed_skills": [],
    "squad": {"name": "S", "leader": "L", "members": []},
}


class RuntimeBindingCheckTests(unittest.TestCase):
    def findings(self, agents, runtimes):
        def fake_run_json(args, workspace_id=None):
            if args[:4] == ["multica", "workspace", "mcp", "list"]:
                return []
            if args[:2] == ["multica", "repo"]:
                return []
            if args[:3] == ["multica", "project", "list"]:
                return [{"id": "p1", "title": "P"}]
            if args[:4] == ["multica", "project", "resource", "list"]:
                return []
            if args[:3] == ["multica", "agent", "list"]:
                return agents
            if args[:3] == ["multica", "runtime", "list"]:
                return runtimes
            if args[:2] in (["multica", "skill"], ["multica", "squad"], ["multica", "autopilot"]):
                return []
            raise AssertionError(args)

        exp = check.Expectation(MANIFEST, "winning-lilei")
        with patch.object(check, "run_json", side_effect=fake_run_json):
            return check.check_workspace("winning-lilei", "ws-1", exp, {})

    def test_multiple_online_runtimes_are_allowed(self):
        agents = [
            {"id": "a1", "name": "A", "runtime_id": "r1", "custom_env_key_count": 3},
            {"id": "a2", "name": "B", "runtime_id": "r2", "custom_env_key_count": 3},
        ]
        runtimes = [
            {"id": "r1", "name": "local", "status": "online"},
            {"id": "r2", "name": "server", "status": "online"},
        ]
        runtime_findings = [f for f in self.findings(agents, runtimes) if f[1] == "runtime"]
        self.assertEqual(runtime_findings, [])

    def test_stale_binding_still_fails(self):
        agents = [{"id": "a1", "name": "A", "runtime_id": "missing", "custom_env_key_count": 3}]
        findings = self.findings(agents, [{"id": "r1", "status": "online"}])
        self.assertTrue(any(level == "FAIL" and dim == "runtime" for level, dim, _ in findings))

    def test_offline_runtime_still_warns(self):
        agents = [{"id": "a1", "name": "A", "runtime_id": "r1", "custom_env_key_count": 3}]
        findings = self.findings(agents, [{"id": "r1", "name": "local", "status": "offline"}])
        self.assertTrue(any(level == "WARN" and dim == "runtime" for level, dim, _ in findings))


if __name__ == "__main__":
    unittest.main()
