"""Project Resource label 供给回归：只使用临时目录与命令替身，不连接 Multica。"""
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
import provision_project_resource_labels as labels  # noqa: E402

WS_ID = "ws-1"
PROJECT_ID = "p-1"
URL_A = "https://example.invalid/_git/alpha"
URL_B = "https://example.invalid/_git/beta"
YAML = """repos:
  - repo_url: {url_a}
    repo_path: alpha
    label: alpha-label
  - repo_url: {url_b}
    repo_path: beta
    label: beta-label
""".format(url_a=URL_A, url_b=URL_B)


class ProjectResourceLabelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        (self.root / "workspace-config").mkdir()
        (self.root / "workspace-config/provisioning.json").write_text(json.dumps({
            "project": {"title": "df"},
            "workspace_groups": {"bi": {
                "workspaces": ["winning-bi"], "project": {"title": "bi"},
            }},
        }), encoding="utf-8")
        (self.root / "docs/config").mkdir(parents=True)
        (self.root / labels.LABELS_REL).write_text(YAML, encoding="utf-8")
        self.resources = []
        self.writes = []
        self.projects = [{"id": PROJECT_ID, "title": "bi"}]

    def fake_json(self, args, env=None):
        if args[:3] == ["multica", "workspace", "list"]:
            return [{"id": WS_ID, "slug": "winning-bi", "name": "winning-bi"}]
        if args[:3] == ["multica", "project", "list"]:
            return self.projects
        if args[:4] == ["multica", "project", "resource", "list"]:
            # 回读时返回已被 mock 写入更新的资源列表。
            return [dict(r) for r in self.resources]
        raise AssertionError(f"非预期只读命令：{args}")

    def fake_write(self, args, env=None):
        self.writes.append((list(args), dict(env or {})))
        label = args[args.index("--label") + 1]
        target = next(r for r in self.resources if r["id"] == args[5])
        target["label"] = label
        return subprocess.CompletedProcess(args, 0, "", "")

    def run_main(self, *argv):
        output = io.StringIO()
        with patch.object(sys, "argv", [
            "provision_project_resource_labels.py", "winning-bi",
            "--repo-root", str(self.root), *argv,
        ]), \
                patch.object(labels, "run_cli_json", side_effect=self.fake_json), \
                patch.object(labels, "run_cli", side_effect=self.fake_write), \
                contextlib.redirect_stdout(output):
            try:
                labels.main()
                code = 0
            except SystemExit as exc:
                code = exc.code
        return code, output.getvalue()

    def resource(self, rid, url, label=None, rtype="github_repo"):
        return {
            "id": rid, "resource_type": rtype, "label": label,
            "resource_ref": {"url": url, "ref": "dev"},
        }

    def test_load_label_map_rejects_duplicate_url_with_different_label(self):
        path = self.root / labels.LABELS_REL
        path.write_text(YAML.replace("beta-label", "other-label").replace(URL_B, URL_A),
                        encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "不同 label"):
            labels.load_label_map(self.root)

    def test_resource_url_ignores_non_github_repo(self):
        self.assertEqual(labels.resource_url(self.resource("1", URL_A)), URL_A)
        self.assertEqual(labels.resource_url(self.resource("2", "/local/path", rtype="local_directory")), "")

    def test_aligns_all_matching_resources_and_reads_back(self):
        self.resources = [
            self.resource("r1", URL_A),
            self.resource("r2", URL_B, "手写旧 label"),
        ]
        code, out = self.run_main()
        self.assertEqual(code, 0)
        self.assertEqual(len(self.writes), 2)
        self.assertIn("--label", self.writes[0][0])
        self.assertEqual(self.writes[0][0][-1], "alpha-label")
        self.assertEqual(self.writes[1][0][-1], "beta-label")
        self.assertEqual(self.writes[0][1]["MULTICA_WORKSPACE_ID"], WS_ID)
        self.assertIn("已设置 2", out)

    def test_same_label_writes_nothing(self):
        self.resources = [self.resource("r1", URL_A, "alpha-label")]
        code, out = self.run_main()
        self.assertEqual(code, 0)
        self.assertEqual(self.writes, [])
        self.assertIn("[SKIP] alpha", out)

    def test_unmatched_resource_is_ignored(self):
        self.resources = [self.resource("r1", "https://example.invalid/_git/other")]
        code, out = self.run_main()
        self.assertEqual(code, 0)
        self.assertEqual(self.writes, [])
        self.assertIn("[INFO]", out)

    def test_dry_run_never_writes(self):
        self.resources = [self.resource("r1", URL_A)]
        code, out = self.run_main("--dry-run")
        self.assertEqual(code, 0)
        self.assertEqual(self.writes, [])
        self.assertIn("[DRY ]", out)

    def test_missing_project_fails_before_writes(self):
        self.projects = []
        self.resources = [self.resource("r1", URL_A)]
        code, _ = self.run_main()
        self.assertNotEqual(code, 0)
        self.assertEqual(self.writes, [])


if __name__ == "__main__":
    unittest.main()
