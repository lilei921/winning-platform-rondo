import test from "node:test";
import assert from "node:assert/strict";
import { parseAnalysisSource, sameAnalysisSource, analysisArtifactPath, locateTaskRefs } from "./source.js";

const source = { repo_url: "https://tfs.example/tfs/C/P/_git/R", branch: "feature/a", commit: "a".repeat(40), change_ref: "fix-101" };

test("来源必须完整且与 Issue Change 一致，禁止凭据和非 TFS 地址", () => {
  assert.deepEqual(parseAnalysisSource(JSON.stringify(source), "fix-101"), source);
  for (const value of [undefined, {}, { ...source, commit: "main" }, { ...source, branch: "" },
    { ...source, repo_url: "https://user:secret@tfs.example/tfs/C/P/_git/R" },
    { ...source, repo_url: "https://tfs.example/other" }]) {
    assert.throws(() => parseAnalysisSource(value, "fix-101"));
  }
  assert.throws(() => parseAnalysisSource(source, "other"));
});

test("固定来源身份由仓库、branch、commit 和 Change 共同决定", () => {
  assert.equal(sameAnalysisSource(source, { ...source }), true);
  for (const field of ["repo_url", "branch", "commit", "change_ref"] as const) {
    assert.equal(sameAnalysisSource(source, { ...source, [field]: "different" }), false);
  }
});

test("读取路径仅限当前 Change，阻止穿越及编码路径", () => {
  assert.equal(analysisArtifactPath(source, "specs/a/spec.md"), "/openspec/changes/fix-101/specs/a/spec.md");
  for (const path of ["../tasks.md", "/tasks.md", "a\\tasks.md", "%2e%2e/tasks.md", "a//b", "a/./b", "tasks.md?x=1"]) {
    assert.throws(() => analysisArtifactPath(source, path));
  }
});

test("任务编号精确匹配，重复编号不得派发", () => {
  assert.deepEqual(locateTaskRefs("- [ ] 1.1 中文任务\n  验收说明\n- [x] 1.10 已完成\n", ["1.1"]), []);
  assert.deepEqual(locateTaskRefs("- [ ] 1.10 任务\n", ["1.1"]), ["1.1"]);
  assert.throws(() => locateTaskRefs("- [ ] 1.1 A\n- [x] 1.1 B\n", ["1.1"]), /重复/);
});

test("保持既有可读任务编号兼容，不强制纯数字格式", () => {
  assert.deepEqual(locateTaskRefs("- [ ] T1 任务\n- [x] FIX-2. 修复\n", ["T1", "FIX-2"]), []);
  assert.throws(() => locateTaskRefs("- [ ] T1 A\n- [x] T1 B\n", ["T1"]), /重复/);
});
