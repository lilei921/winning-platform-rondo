/**
 * contract-files.ts 单元测试（rll5-replay-remediation-plan M2.1/F2）。
 *
 * 验收点：
 *  1. 归一化：CRLF/CR→LF；tasks.md 的 [x]/[X] 归一为 [ ]，非勾选项不动；其他文件不动 checkbox；
 *  2. 文件选择：proposal/tasks 必有、design 有则、specs/** 递归排序；缺 proposal/tasks → 抛错；
 *  3. verify 分类：hash_mismatch / missing_file / added_file / algorithm_mismatch；
 *  4. touchedCapabilities：specs 顶层子目录名，无 specs → []。
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeContractText, listContractFiles, computeContractFiles, verifyContractFiles, touchedCapabilities,
  type ContractFiles,
} from "./contract-files.js";

function withChange(t: TestContext, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "contract-files-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, ...rel.split("/"));
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

test("normalizeContractText: CRLF/CR→LF；tasks.md checkbox [xX]→[ ]，其他文件不动", () => {
  assert.equal(normalizeContractText("proposal.md", "a\r\nb\rc"), "a\nb\nc");
  assert.equal(normalizeContractText("tasks.md", "- [x] 1.1 done\r\n- [X] 1.2 done\n- [ ] 1.3 todo"), "- [ ] 1.1 done\n- [ ] 1.2 done\n- [ ] 1.3 todo");
  assert.equal(normalizeContractText("proposal.md", "- [x] 非 tasks.md 不归一"), "- [x] 非 tasks.md 不归一");
  assert.equal(normalizeContractText("tasks.md", "  - [x] 缩进勾选"), "  - [ ] 缩进勾选");
});

test("listContractFiles: 必选项 + design + specs 递归排序；缺必选抛错", (t) => {
  const dir = withChange(t, {
    "proposal.md": "# p",
    "tasks.md": "- [ ] 1.1 a",
    "design.md": "# d",
    "specs/cap-b/spec.md": "b",
    "specs/cap-a/spec.md": "a",
    "specs/cap-a/sub/x.md": "x",
    "specs/cap-a/note.txt": "不参与",
    "evidence.json": "{}", // 非契约文件
  });
  assert.deepEqual(listContractFiles(dir), [
    "proposal.md", "tasks.md", "design.md",
    "specs/cap-a/spec.md", "specs/cap-a/sub/x.md", "specs/cap-b/spec.md",
  ]);
  const bad = withChange(t, { "tasks.md": "- [ ] 1.1" });
  assert.throws(() => listContractFiles(bad), /契约文件缺失: proposal\.md/);
});

test("compute + verify: 全一致 ok；checkbox 变化不改变哈希", (t) => {
  const dir = withChange(t, {
    "proposal.md": "# p\r\n",
    "tasks.md": "- [x] 1.1 a\n",
    "specs/cap/spec.md": "s",
  });
  const c1 = computeContractFiles(dir);
  assert.equal(c1.algorithm, "sha256");
  assert.deepEqual(Object.keys(c1.files), ["proposal.md", "tasks.md", "specs/cap/spec.md"]);
  assert.ok(/^[0-9a-f]{64}$/.test(c1.files["tasks.md"]));
  assert.deepEqual(verifyContractFiles(dir, c1), { ok: true });
  // 勾选状态变化不改契约哈希（Progress Patch 免刷新）
  writeFileSync(join(dir, "tasks.md"), "- [ ] 1.1 a\n");
  assert.deepEqual(verifyContractFiles(dir, c1), { ok: true });
  // CRLF 变化同样不改哈希
  writeFileSync(join(dir, "proposal.md"), "# p\n");
  assert.deepEqual(verifyContractFiles(dir, c1), { ok: true });
});

test("verify: mismatch / missing / added / algorithm 分类", (t) => {
  const dir = withChange(t, { "proposal.md": "# p", "tasks.md": "- [ ] 1.1 a" });
  const base = computeContractFiles(dir);

  writeFileSync(join(dir, "proposal.md"), "# changed");
  let v = verifyContractFiles(dir, base);
  assert.equal(v.ok, false);
  assert.equal(v.kind, "hash_mismatch");
  assert.match(v.problems[0], /proposal\.md.*哈希不匹配/);

  writeFileSync(join(dir, "proposal.md"), "# p");
  v = verifyContractFiles(dir, { algorithm: "sha256", files: { ...base.files, "design.md": "0".repeat(64) } });
  assert.equal(v.ok, false);
  assert.equal(v.kind, "missing_file");

  v = verifyContractFiles(dir, { algorithm: "sha256", files: { "proposal.md": base.files["proposal.md"] } });
  assert.equal(v.ok, false);
  assert.equal(v.kind, "added_file");
  assert.match(v.problems.join(";"), /tasks\.md.*未记录/);

  v = verifyContractFiles(dir, { algorithm: "md5", files: base.files } as unknown as ContractFiles);
  assert.equal(v.ok, false);
  assert.equal(v.kind, "algorithm_mismatch");
});

test("touchedCapabilities: specs 顶层子目录；无 specs → []", (t) => {
  const dir = withChange(t, {
    "proposal.md": "p", "tasks.md": "t",
    "specs/cap-b/spec.md": "b", "specs/cap-a/spec.md": "a", "specs/lone-file.md": "f",
  });
  assert.deepEqual(touchedCapabilities(dir), ["cap-a", "cap-b"]);
  const bare = withChange(t, { "proposal.md": "p", "tasks.md": "t" });
  assert.deepEqual(touchedCapabilities(bare), []);
});
