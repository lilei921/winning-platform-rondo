"""目录迁移回归：只使用临时目录和命令替身，不连接 Multica。"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import check_workspaces as check
import provision_workspace_repos as repos
import sync_workspace as sync


class WorkspaceSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.manifest = self.root / "workspace-config/provisioning.json"
        self.manifest.parent.mkdir()
        self.manifest.write_text(json.dumps({
            "project": {"title": "df", "workspace_branch": "main"},
            "workspace_repos": [{"url": "https://example.invalid/df"}],
            "workspace_groups": {"bi": {
                "workspaces": ["winning-bi"], "project": {"title": "bi"},
                "workspace_repos": [{"url": "https://example.invalid/bi"}],
            }},
        }), encoding="utf-8")

    def test_all_entrypoints_resolve_current_layout_from_subdirectory(self):
        nested = self.root / "skills/demo"
        nested.mkdir(parents=True)
        with patch.dict(os.environ, {"MULTICA_REPO_ROOT": "obsolete-repository"}), patch.object(Path, "cwd", return_value=nested):
            self.assertEqual(sync.find_repo_root(nested), self.root)
            self.assertEqual(check.find_repo_root(), self.root)
            self.assertEqual(repos.find_repo_root(), self.root)

    def test_explicit_root_requires_manifest(self):
        for finder in (sync.find_repo_root, check.find_repo_root, repos.find_repo_root):
            self.assertEqual(finder(repo_root=str(self.root)), self.root)
        self.manifest.unlink()
        for finder in (sync.find_repo_root, check.find_repo_root, repos.find_repo_root):
            with self.assertRaisesRegex(SystemExit, "请重新输入 --repo-root"):
                finder(repo_root=str(self.root))

    def test_missing_root_requests_path_for_this_run(self):
        self.manifest.unlink()
        with patch.object(Path, "cwd", return_value=self.root), self.assertRaisesRegex(SystemExit, "请输入仓库路径：--repo-root"):
            sync.find_repo_root(start=self.root)

    def test_explicit_root_takes_precedence_over_current_directory(self):
        other = self.root / "other-repository"
        (other / "workspace-config").mkdir(parents=True)
        (other / "workspace-config/provisioning.json").write_text("{}", encoding="utf-8")
        with patch.object(Path, "cwd", return_value=other):
            self.assertEqual(sync.find_repo_root(repo_root=str(self.root)), self.root)

    def test_query_child_ignores_stale_root_without_changing_user_environment(self):
        with patch.dict(os.environ, {"MULTICA_REPO_ROOT": "obsolete-repository"}):
            with patch.object(sync.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, b"[]", b"")) as run:
                self.assertEqual(sync.run_json(["multica", "workspace", "list"], self.root), [])
                self.assertNotIn("MULTICA_REPO_ROOT", run.call_args.kwargs["env"])
                self.assertEqual(run.call_args.kwargs["cwd"], self.root)
            self.assertEqual(os.environ["MULTICA_REPO_ROOT"], "obsolete-repository")

    def test_local_build_takes_precedence_over_global_old_cli(self):
        local = self.root / "rondo/dist/index.js"
        local.parent.mkdir(parents=True)
        local.touch()
        with patch.object(sync.shutil, "which", return_value="old-rondo"):
            self.assertEqual(sync.resolve_cli(self.root), ["node", str(local)])
            local.unlink()
            self.assertEqual(sync.resolve_cli(self.root), ["old-rondo"])

    def _rondo_dir_with_package(self):
        rondo_dir = self.root / "rondo"
        rondo_dir.mkdir()
        (rondo_dir / "package.json").write_text("{}", encoding="utf-8")
        return rondo_dir

    def test_install_rondo_packs_installs_and_removes_global_ps1(self):
        rondo_dir = self._rondo_dir_with_package()
        global_dir = self.root / "global"
        global_dir.mkdir()
        ps1 = global_dir / "rondo.ps1"
        ps1.write_text("shim", encoding="utf-8")
        tarball = rondo_dir / "winning-rondo-1.2.39.tgz"
        outputs = {
            ("npm", "pack", "--silent"): tarball.name,
            ("npm", "install", "-g", str(tarball)): "changed 32 packages",
            ("npm", "prefix", "-g"): str(global_dir),
        }

        def fake_run_text(command, cwd):
            return outputs[tuple(command)]

        with patch.object(sync, "run_text", side_effect=fake_run_text) as run_text, \
                patch.object(sync.os, "name", "nt"):
            sync.install_rondo_cli(self.root)

        self.assertFalse(ps1.exists())
        commands = [call[0][0] for call in run_text.call_args_list]
        self.assertEqual(commands, [
            ["npm", "pack", "--silent"],
            ["npm", "install", "-g", str(tarball)],
            ["npm", "prefix", "-g"],
        ])
        self.assertTrue(all(call[0][1] == rondo_dir for call in run_text.call_args_list))

    def test_install_rondo_dry_run_never_runs_npm(self):
        self._rondo_dir_with_package()
        with patch.object(sync, "run_text") as run_text:
            sync.install_rondo_cli(self.root, dry_run=True)
        run_text.assert_not_called()

    def test_install_rondo_skips_ps1_cleanup_off_windows(self):
        rondo_dir = self._rondo_dir_with_package()
        tarball = rondo_dir / "winning-rondo-1.2.39.tgz"
        outputs = {
            ("npm", "pack", "--silent"): tarball.name,
            ("npm", "install", "-g", str(tarball)): "changed 32 packages",
        }

        def fake_run_text(command, cwd):
            return outputs[tuple(command)]

        with patch.object(sync, "run_text", side_effect=fake_run_text) as run_text, \
                patch.object(sync.os, "name", "posix"):
            sync.install_rondo_cli(self.root)
        self.assertEqual(run_text.call_count, 2)

    def test_resolve_command_resolves_shim_executable_on_windows(self):
        with patch.object(sync.os, "name", "nt"), \
                patch.object(sync.shutil, "which", return_value=r"C:\tools\npm.cmd"):
            self.assertEqual(sync.resolve_command(["npm", "pack"]), [r"C:\tools\npm.cmd", "pack"])

    def test_resolve_command_keeps_bare_when_unresolved_on_windows(self):
        with patch.object(sync.os, "name", "nt"), \
                patch.object(sync.shutil, "which", return_value=None):
            self.assertEqual(sync.resolve_command(["npm", "pack"]), ["npm", "pack"])

    def test_resolve_command_keeps_command_off_windows(self):
        with patch.object(sync.os, "name", "posix"):
            self.assertEqual(sync.resolve_command(["npm", "pack"]), ["npm", "pack"])

    def test_python_preflight_uses_current_interpreter_without_path_alias(self):
        with patch.object(sync.shutil, "which", return_value=None), patch.dict(sys.modules, {"yaml": object()}):
            sync.check_python()

    def test_entrypoint_help_is_utf8_under_legacy_stdio_encoding(self):
        result = subprocess.run(
            [sys.executable, sync.__file__, "--help"],
            env={**os.environ, "PYTHONUTF8": "0", "PYTHONIOENCODING": "cp936"},
            capture_output=True,
            check=True,
        )
        self.assertIn("只预演", result.stdout.decode("utf-8"))

    def test_workspace_name_resolves_canonical_slug_for_groups(self):
        with patch.object(sync, "list_workspaces", return_value=[{
            "id": "ws-bi", "name": "BI Team", "slug": "winning-bi",
        }]):
            for name in ("ws-bi", "BI Team", "winning-bi"):
                self.assertEqual(sync.resolve_workspace(name, self.root)["slug"], "winning-bi")

    def test_repo_provision_and_check_share_group_expectations(self):
        manifest = json.loads(self.manifest.read_text(encoding="utf-8"))
        for slug, title in (("winning-bi", "bi"), ("winning-admin", "df")):
            declared, _ = repos.load_declared_repos(self.root, slug)
            expectation = check.Expectation(manifest, slug)
            self.assertEqual(expectation.project_title, title)
            self.assertEqual(expectation.repo_urls, [r["url"] for r in declared])

    def run_pipeline(self, dry_run=False, fail=False):
        before = self.manifest.read_bytes()
        calls = []

        def run(command, **kwargs):
            # 子进程执行期间也不得临时改写共享 manifest。
            self.assertEqual(self.manifest.read_bytes(), before)
            self.assertFalse(sync.manifest_backup_path(self.root).exists())
            self.assertEqual(kwargs["cwd"], self.root)
            self.assertFalse(any(key.upper() == "MULTICA_REPO_ROOT" for key in kwargs["env"]))
            self.assertEqual(kwargs["env"]["RONDO_WORKSPACE_PYTHON"], sys.executable)
            self.assertEqual(kwargs["env"]["PYTHONIOENCODING"], "utf-8")
            calls.append(command)
            if fail:
                raise subprocess.CalledProcessError(3, command)

        with patch.object(sync.subprocess, "run", side_effect=run):
            code = sync.sync_workspace(
                "winning-bi", "ws-bi", "runtime", self.root, ["node", "local-cli"],
                Path("disable.py"), dry_run, False, 1, False, "测试跳过", True,
                Path("tfs.py"), True, Path("repos.py"), True,
            )
        return code, calls

    def test_explicit_empty_group_lists_do_not_fall_back_to_defaults(self):
        manifest = json.loads(self.manifest.read_text(encoding="utf-8"))
        manifest["workspace_groups"]["bi"].update({"workspace_repos": [], "mcp_servers": [], "project": {"workspace_branch": "release"}})
        manifest["mcp_servers"] = [{"name": "default-mcp"}]
        self.manifest.write_text(json.dumps(manifest), encoding="utf-8")
        self.assertEqual(repos.load_declared_repos(self.root, "winning-bi")[0], [])
        expectation = check.Expectation(manifest, "winning-bi")
        self.assertEqual(expectation.repo_urls, [])
        self.assertEqual(expectation.mcp_names, [])
        self.assertEqual(expectation.project_title, "df")

    def test_group_sync_and_preview_never_rewrite_manifest(self):
        for dry_run in (False, True):
            code, calls = self.run_pipeline(dry_run)
            self.assertEqual(code, 0)
            self.assertEqual(len(calls), 2)
            self.assertIn("--skip-workflow", calls[0])
            for command in calls:
                self.assertEqual("--dry-run" in command, dry_run)

    def test_provision_failure_stops_sync(self):
        code, calls = self.run_pipeline(fail=True)
        self.assertEqual(code, 3)
        self.assertEqual(len(calls), 1)

    def test_legacy_backup_is_preserved_in_preview_and_restored_on_write(self):
        backup = sync.manifest_backup_path(self.root)
        original = self.manifest.read_bytes()
        backup.write_bytes(original)
        self.manifest.write_text('{"project":{"title":"interrupted"}}', encoding="utf-8")
        with self.assertRaises(SystemExit):
            sync.restore_manifest_if_needed(self.root, dry_run=True)
        self.assertEqual(backup.read_bytes(), original)
        self.assertNotEqual(self.manifest.read_bytes(), original)
        sync.restore_manifest_if_needed(self.root)
        self.assertEqual(self.manifest.read_bytes(), original)
        self.assertFalse(backup.exists())


if __name__ == "__main__":
    unittest.main()
