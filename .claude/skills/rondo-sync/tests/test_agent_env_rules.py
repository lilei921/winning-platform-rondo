"""Vayne 不配置 TFS 三键、但需要 Runtime 策略提示的回归（不连接 Multica）。"""
import contextlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import check_workspaces as check  # noqa: E402
import provision_agent_tfs_env as tfs  # noqa: E402
from workspace_paths import MANIFEST_REL  # noqa: E402

MANIFEST = {
    "agents": [
        {"name": "Engineer", "skills": ["pull-request"]},
        {"name": "Vayne", "skills": [], "tfs_env": False,
         "runtime_policy_key": "RONDO_RUNTIME_POLICY"},
    ],
}


class AgentEnvRuleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / MANIFEST_REL).parent.mkdir(parents=True)
        (self.root / MANIFEST_REL).write_text(json.dumps(MANIFEST), encoding="utf-8")

    def test_manifest_rules_are_shared_with_check(self):
        no_tfs, keys = tfs.load_agent_env_rules(self.root)
        self.assertEqual(no_tfs, {"Vayne"})
        self.assertEqual(keys, {"Vayne": "RONDO_RUNTIME_POLICY"})
        exp = check.Expectation(MANIFEST, "winning-lilei")
        self.assertEqual(exp.no_tfs_env, {"Vayne"})
        self.assertEqual(exp.policy_keys, keys)

    def test_vayne_is_skipped_and_missing_policy_is_warned(self):
        agents = [
            {"id": "e-1", "name": "Engineer"},
            {"id": "v-1", "name": "Vayne"},
        ]
        written = {}

        def fake_cli(args, stdin_text=None, transient=False):
            if args[:3] == ["multica", "agent", "list"]:
                return subprocess.CompletedProcess(args, 0, json.dumps(agents), "")
            if args[:3] == ["multica", "runtime", "list"]:
                return subprocess.CompletedProcess(args, 0, json.dumps([
                    {"id": "primary-1", "provider": "claude"},
                    {"id": "fallback-1", "provider": "claude"},
                ]), "")
            if args[:4] == ["multica", "agent", "env", "get"]:
                aid = args[4]
                return subprocess.CompletedProcess(args, 0, json.dumps({"custom_env": written.get(aid, {})}), "")
            if args[:4] == ["multica", "agent", "env", "set"]:
                aid = args[4]
                written[aid] = json.loads(stdin_text or "{}")
                return subprocess.CompletedProcess(args, 0, "{}", "")
            raise AssertionError(args)

        out = io.StringIO()
        with patch.object(sys, "argv", ["script", "winning-lilei"]), \
                patch.object(tfs, "find_repo_root", return_value=self.root), \
                patch.object(tfs, "resolve_workspace_id", return_value=("ws-1", "winning-lilei")), \
                patch.object(tfs, "resolve_pat", return_value=("secret", "test")), \
                patch.object(tfs, "run_cli", side_effect=fake_cli), \
                contextlib.redirect_stdout(out):
            with self.assertRaises(SystemExit) as raised:
                tfs.main()
        self.assertEqual(raised.exception.code, 0)
        self.assertNotIn("v-1", written, "Vayne 不应被写入 TFS 环境变量")
        self.assertEqual(sorted(written["e-1"]), ["TFS_COLLECTION", "TFS_PAT", "TFS_URL"])
        self.assertIn("[SKIP] Vayne | manifest 声明不配置 TFS 三键", out.getvalue())
        self.assertIn("[WARN] Vayne 未配置 RONDO_RUNTIME_POLICY；由用户逐个提供主备 Runtime 后写入 workspace overlay", out.getvalue())

    def test_overlay_policy_is_written_once_and_never_overwritten(self):
        policy = {"Engineer": {
            "primary_runtime_id": "primary-1", "primary_runtime_name": "Claude (laptop)",
            "fallback_runtime_id": "fallback-1", "fallback_runtime_name": "Claude (server)",
        }}
        overlay = self.root / MANIFEST_REL.parent / "workspaces" / "winning-lilei.json"
        overlay.parent.mkdir(parents=True, exist_ok=True)
        overlay.write_text(json.dumps({"runtime_policy": policy}), encoding="utf-8")
        agents = [{"id": "v-1", "name": "Vayne"}]
        written = {}

        def invoke(existing=None):
            def fake_cli(args, stdin_text=None, transient=False):
                if args[:3] == ["multica", "agent", "list"]:
                    return subprocess.CompletedProcess(args, 0, json.dumps(agents), "")
                if args[:3] == ["multica", "runtime", "list"]:
                    return subprocess.CompletedProcess(args, 0, json.dumps([
                        {"id": "primary-1", "name": "Claude (laptop)", "provider": "claude"},
                        # 主备 Provider 可不同，仍应通过校验
                        {"id": "fallback-1", "name": "Claude (server)", "provider": "codex"},
                    ]), "")
                if args[:4] == ["multica", "agent", "env", "get"]:
                    return subprocess.CompletedProcess(args, 0, json.dumps({"custom_env": written}), "")
                if args[:4] == ["multica", "agent", "env", "set"]:
                    written.update(json.loads(stdin_text or "{}"))
                    return subprocess.CompletedProcess(args, 0, "{}", "")
                raise AssertionError(args)
            out = io.StringIO()
            with patch.object(sys, "argv", ["script", "winning-lilei"]), \
                    patch.object(tfs, "find_repo_root", return_value=self.root), \
                    patch.object(tfs, "resolve_workspace_id", return_value=("ws-1", "winning-lilei")), \
                    patch.object(tfs, "resolve_pat", return_value=("secret", "test")), \
                    patch.object(tfs, "run_cli", side_effect=fake_cli), \
                    contextlib.redirect_stdout(out):
                with self.assertRaises(SystemExit) as raised:
                    tfs.main()
            self.assertEqual(raised.exception.code, 0, out.getvalue())
            return out.getvalue()

        first = invoke()
        self.assertEqual(json.loads(written["RONDO_RUNTIME_POLICY"]), policy)
        self.assertIn("[OK  ] Vayne | 首次写入 RONDO_RUNTIME_POLICY", first)
        before = dict(written)
        second = invoke()
        self.assertEqual(written, before)
        self.assertIn("[SKIP] Vayne | RONDO_RUNTIME_POLICY 已配置，不覆盖", second)

    def test_runtime_name_must_match_id(self):
        policy = {"Engineer": {
            "primary_runtime_id": "primary-1", "primary_runtime_name": "错误名称",
            "fallback_runtime_id": "fallback-1", "fallback_runtime_name": "Claude (server)",
        }}
        runtimes = {"primary-1": "Claude (laptop)", "fallback-1": "Claude (server)"}
        problems = tfs.validate_runtime_policy(policy, runtimes, {"Vayne"})
        self.assertTrue(any("primary_runtime_name 与 Runtime ID 不匹配" in p for p in problems))


if __name__ == "__main__":
    unittest.main()
