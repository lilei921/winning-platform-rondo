import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeContractFiles } from "./contract-files.js";
import { deliveryCompletionGate } from "./finalize.js";

const SHA = "a".repeat(40);

/** 使用完整 Change 路径，覆盖候选仓库身份与历史证据共存。 */
function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "rondo-current-evidence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "openspec", "changes", "c-x");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "proposal.md"), "# 当前契约\n");
  writeFileSync(join(dir, "tasks.md"), "- [x] 1.1 已验证\n");
  const ev = { change_ref: "c-x", task_refs: ["1.1"],
    commits: [{ repo_path: join(root, "repo1"), sha: SHA }], contract_files: computeContractFiles(dir) };
  const md: Record<string, string> = {
    "analysis.gate.result": "PASS", "verify_agent.required": "false",
    "analysis.human_approval": JSON.stringify({ decision: "approved", by: "human", at: "2026-11-08T00:00:00Z", comment_ref: "c-0", verify_agent_required: false }),
    "dev.dispatch": JSON.stringify([{ active: true, change_ref: "c-x", task_refs: ["1.1"] }]),
    pr_prep: JSON.stringify([{ repo_key: "repo1", candidate_commit: SHA }]),
  };
  const write = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value));
  const cfg = { runtime: { multica_cli: "mock" }, registry: { repo1: { repo_path: "repo1" } } };
  return { root, dir, ev, md, write, check: () => deliveryCompletionGate(cfg, md, "in_review", dir, "c-x") };
}

test("当前有效 Evidence 覆盖同任务时，历史哈希不阻断且不改写历史", (t) => {
  const f = fixture(t);
  f.write("evidence-current.json", f.ev);
  f.write("evidence-old.json", { ...f.ev, contract_files: { algorithm: "sha256", files: { "proposal.md": "old" } } });
  const before = readFileSync(join(f.dir, "evidence-old.json"), "utf8");
  assert.doesNotThrow(f.check);
  assert.equal(readFileSync(join(f.dir, "evidence-old.json"), "utf8"), before);
});

test("只有旧哈希或缺哈希 Evidence 均不得收口", (t) => {
  const f = fixture(t);
  f.write("evidence.json", { ...f.ev, contract_files: { algorithm: "sha256", files: { "proposal.md": "old" } } });
  assert.throws(f.check, /契约文件核验不过/);
  f.write("evidence.json", { ...f.ev, contract_files: undefined });
  assert.throws(f.check, /缺 contract_files/);
});

test("无 Evidence 且派发缺失时不得空集合放行", (t) => {
  const f = fixture(t);
  delete f.md["dev.dispatch"];
  delete f.md.pr_prep;
  assert.throws(f.check, /Evidence|派发/);
});

test("相同 SHA 的其他仓 Evidence 不得覆盖当前候选", (t) => {
  const f = fixture(t);
  f.write("evidence.json", { ...f.ev, commits: [{ repo_path: join(f.root, "other"), sha: SHA }] });
  assert.throws(f.check, /候选|仓库/);
});

test("候选与契约均有效的无关 Task 不能补足 active 任务", (t) => {
  const f = fixture(t);
  f.write("evidence.json", { ...f.ev, task_refs: ["2.1"] });
  assert.throws(f.check, /Evidence|覆盖/);
});

test("其他 Change 的 active 派发与损坏派发均阻断", (t) => {
  const f = fixture(t);
  f.write("evidence.json", f.ev);
  f.md["dev.dispatch"] = JSON.stringify([{ active: true, change_ref: "other", task_refs: ["1.1"] }]);
  assert.throws(f.check, /Change|派发/);
  f.md["dev.dispatch"] = "broken";
  assert.throws(f.check, /派发|dispatch/);
});
