/** 契约文本归一化、归档文件指纹与 capability 清单。 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeContractText, listContractFiles, computeContractFiles, touchedCapabilities,
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

test("computeContractFiles: checkbox、换行变化不改变归档契约指纹", (t) => {
  const dir = withChange(t, {
    "proposal.md": "# p\r\n",
    "tasks.md": "- [x] 1.1 a\n",
    "specs/cap/spec.md": "s",
  });
  const c1 = computeContractFiles(dir);
  assert.equal(c1.algorithm, "sha256");
  assert.deepEqual(Object.keys(c1.files), ["proposal.md", "tasks.md", "specs/cap/spec.md"]);
  assert.ok(/^[0-9a-f]{64}$/.test(c1.files["tasks.md"]));
  assert.deepEqual(computeContractFiles(dir), c1);
  // 勾选状态变化不改契约哈希（Progress Patch 免刷新）
  writeFileSync(join(dir, "tasks.md"), "- [ ] 1.1 a\n");
  assert.deepEqual(computeContractFiles(dir), c1);
  // CRLF 变化同样不改哈希
  writeFileSync(join(dir, "proposal.md"), "# p\n");
  assert.deepEqual(computeContractFiles(dir), c1);
});

test("computeContractFiles: 契约正文或文件集合发生变化时指纹变化", (t) => {
  const dir = withChange(t, { "proposal.md": "# p", "tasks.md": "- [ ] 1.1 a" });
  const base = computeContractFiles(dir);
  writeFileSync(join(dir, "proposal.md"), "# changed");
  assert.notDeepEqual(computeContractFiles(dir), base);
  writeFileSync(join(dir, "proposal.md"), "# p");
  writeFileSync(join(dir, "design.md"), "# design");
  assert.notDeepEqual(computeContractFiles(dir), base);
  rmSync(join(dir, "design.md"));
  assert.deepEqual(computeContractFiles(dir), base);
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
