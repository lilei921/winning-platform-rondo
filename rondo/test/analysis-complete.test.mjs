import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, delimiter } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analysisTfsFixture } from "./analysis-tfs-fixture.mjs";
import { changeEvidenceDigest, metadataEvidenceDigest } from "../dist/commands/analysis/gate-evidence.js";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const MOCK = fileURLToPath(new URL("./mock-multica.cjs", import.meta.url));
const CHANGE = "c-test";
const FACTS = {
  change_kind: "corrective", change_ref: CHANGE,
  verify_agent: { recommendation: "not_required", reason: "按变更范围验证即可", focus_refs: ["proposal.md"] },
};
const PROPOSAL = "# Proposal\n\n## Problem\n- Expected Behavior: expected\n- Actual Behavior: actual\n\n## Root Cause\nconfirmed cause\n\n## Fix Strategy\nrestore behavior\n\n## Regression Scope\nregression verification\n";

function git(cwd, ...args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, "git " + args.join(" ") + ": " + r.stderr);
  return r.stdout.trim();
}
function runCli(args, env = {}, cwd) {
  const cp = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", cwd,
    env: { ...process.env, ...env },
  });
  assert.equal(cp.error, undefined);
  let body;
  try { body = JSON.parse(cp.stdout); }
  catch { assert.fail("CLI did not return JSON: " + cp.stdout + "\n" + cp.stderr); }
  return { exit: cp.status, body, stderr: cp.stderr };
}
function fixture(t, requirement = true) {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "rondo-fileless-gate-")));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const remote = join(home, "remote.git"); mkdirSync(remote);
  git(remote, "init", "--bare");
  const root = join(home, "root");
  const change = join(root, "openspec", "changes", CHANGE);
  mkdirSync(change, { recursive: true });
  writeFileSync(join(change, ".openspec.yaml"), "schema: corrective-change\nx-repositories: [root]\n");
  writeFileSync(join(change, "proposal.md"), PROPOSAL);
  writeFileSync(join(change, "tasks.md"), "- [ ] 1.1 Fix and 验证 regression\n");
  git(root, "init"); git(root, "branch", "-M", "dev");
  git(root, "-c", "user.email=test@example.invalid", "-c", "user.name=Test", "commit", "--allow-empty", "-m", "init");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-u", "origin", "dev");

  chmodSync(MOCK, 0o755);
  const config = join(home, "registry.json");
  writeFileSync(config, JSON.stringify({ runtime: {
    multica_cli: MOCK, workspace_id: "ws-test",
    multica_profile: "private", multica_server_url: "https://private.example",
  } }));
  const metadata = {
    "tfs.type": requirement ? "需求" : "Bug", "tfs.id": "261056",
    "analysis.change_kind": "corrective", "analysis.change_ref": CHANGE,
    "analysis.verify_agent.recommendation": FACTS.verify_agent.recommendation,
    "analysis.verify_agent.reason": FACTS.verify_agent.reason,
    "analysis.verify_agent.focus_refs": JSON.stringify(FACTS.verify_agent.focus_refs),
  };
  const statePath = join(home, "state.json");
  writeFileSync(statePath, JSON.stringify({ status: "in_progress", metadata }));
  const factsPath = join(home, "facts.json");
  writeFileSync(factsPath, JSON.stringify(FACTS));

  const tfs = analysisTfsFixture(t, home, { remote }, { requirementOrigin: requirement });
  if (requirement) {
    mkdirSync(join(root, "docs", "config"), { recursive: true });
    mkdirSync(join(root, "openspec", "schemas"), { recursive: true });
    writeFileSync(join(root, "docs", "config", "repo-context.yaml"),
      "repos:\n  - repo_id: root\n    repo_url: " + tfs.repoUrl + "\n");
    writeFileSync(join(root, "openspec", "schemas", ".gitkeep"), "");
    git(root, "add", "docs/config/repo-context.yaml", "openspec/schemas/.gitkeep");
    git(root, "-c", "user.email=test@example.invalid", "-c", "user.name=Test", "commit", "-m", "mapping");
    git(root, "push", "origin", "dev");
  }

  const bin = join(home, "bin"); mkdirSync(bin);
  const executable = join(bin, process.platform === "win32" ? "openspec.cmd" : "openspec");
  const report = join(bin, "report.json");
  writeFileSync(report, JSON.stringify({ root: { path: root, source: "nearest" },
    items: [{ id: CHANGE, type: "change", valid: true, issues: [] }] }));
  writeFileSync(executable, process.platform === "win32"
    ? '@echo off\r\nif not "%~1"=="validate" exit /b 64\r\ntype "%~dp0report.json"\r\n'
    : '#!/bin/sh\n[ "$1" = validate ] || exit 64\ncat "$(dirname "$0")/report.json"\n');
  chmodSync(executable, 0o755);

  const env = { ...tfs.env, PATH: bin + delimiter + tfs.env.PATH,
    MOCK_STATE: statePath, MOCK_ROOT_REPO: root,
    MOCK_EXPECT_PROFILE: "private", MOCK_EXPECT_SERVER: "https://private.example",
    ...(requirement ? { RONDO_WORKSPACE_BRANCH: "dev" } : {}) };
  const args = ["--issue", "issue-1", "--openspec-root", root,
    "--workspace-id", "ws-test", "--registry-config", config, "--multica", MOCK];
  const gate = () => runCli(["analysis", "validate", ...args], env);
  const complete = () => runCli(["analysis", "complete",
    "--issue", "issue-1", "--facts", factsPath,
    "--workspace-id", "ws-test", "--registry-config", config, "--multica", MOCK,
    "--root-repo", root, ...(requirement ? ["--mode", "requirement"] : [])], env);
  const stage = () => runCli(["analysis", "stage", "--issue", "issue-1", "--facts", factsPath,
    "--workspace-id", "ws-test", "--registry-config", config, "--multica", MOCK], env);
  const state = () => JSON.parse(readFileSync(statePath, "utf8"));
  const setState = data => writeFileSync(statePath, JSON.stringify(data));
  return { home, root, change, remote, report, tfs, env, gate, complete, stage, state, setState, factsPath, metadata };
}

test("Stage → Preview → Complete: final Gate and fixed Git Contract; native Human Review; no Gate file", t => {
  const f = fixture(t);
  assert.equal(f.stage().exit, 0);
  const preview = f.gate();
  assert.equal(preview.exit, 0, JSON.stringify(preview));
  assert.equal(preview.body.metadata_digest, metadataEvidenceDigest(f.state().metadata));
  assert.equal(preview.body.change_digest, changeEvidenceDigest(f.change, f.state().metadata, undefined, true));
  assert.equal(existsSync(join(f.change, "logs", "analysis-gate-result.json")), false);
  const result = f.complete();
  assert.equal(result.exit, 0, JSON.stringify(result));
  const source = JSON.parse(f.state().metadata["analysis.source"]);
  assert.equal(source.commit, git(f.remote, "rev-parse", "dev"));
  assert.equal(git(f.remote, "show", source.commit + ":openspec/changes/" + CHANGE + "/proposal.md"), PROPOSAL.trim());
  assert.equal(f.state().metadata["analysis.gate.result"], "PASS");
  assert.equal(f.state().status, "analysis_review");
  const comments = f.state().comments["issue-1"];
  assert.equal(comments.length, 1);
  for (const phrase of ["目标", "方案", "影响范围", "验证建议", "重要风险", source.commit, "PASS"]) {
    assert.match(comments[0].content, new RegExp(phrase));
  }
  assert.equal(existsSync(join(f.change, "logs", "analysis-gate-result.json")), false);
  assert.equal(existsSync(join(f.change, "analysis-handoff.json")), false);
});

test("旧 metadata PASS/调用方自报 PASS 都不能绕过最终真实 Gate", t => {
  const f = fixture(t);
  const st = f.state(); st.metadata["analysis.gate.result"] = "PASS"; f.setState(st);
  writeFileSync(f.factsPath, JSON.stringify({ ...FACTS, gate: { result: "PASS" } }));
  writeFileSync(join(f.change, "proposal.md"), "# Invalid proposal\n");
  const result = f.complete();
  assert.equal(result.exit, 2, JSON.stringify(result));
  assert.match(result.body.reason, /Expected|Root Cause|Fix Strategy|Regression Scope|acceptance_contract/);
  assert.equal(f.state().metadata["analysis.source"], undefined);
  assert.equal(f.state().status, "in_progress");
});

test("Preview 成功后正文改变，Complete 必须检查当前新正文而非旧 PASS", t => {
  const f = fixture(t);
  assert.equal(f.gate().exit, 0);
  writeFileSync(join(f.change, "tasks.md"), "- [ ] 1.1 no verification description\n");
  const fail = f.complete();
  assert.equal(fail.exit, 2, JSON.stringify(fail));
  assert.equal(f.state().metadata["analysis.source"], undefined);
  writeFileSync(join(f.change, "tasks.md"), "- [ ] 1.1 Fix and 验证 regression\n");
  const success = f.complete();
  assert.equal(success.exit, 0, JSON.stringify(success));
});

test("OpenSpec 独立 CLI 未确认通过，不能持久化 Gate PASS 或 Human Review", t => {
  const f = fixture(t);
  writeFileSync(f.report, JSON.stringify({ root: { path: dirname(f.root), source: "nearest" },
    items: [{ id: CHANGE, type: "change", valid: true, issues: [] }] }));
  const result = f.complete();
  assert.equal(result.exit, 3, JSON.stringify(result));
  assert.match(result.body.reason, /openspec validate|Root/);
  assert.equal(f.state().metadata["analysis.source"], undefined);
});

test("Git clean filter 修改工程正文，固定 Commit 不匹配时必须阻断", t => {
  const f = fixture(t);
  writeFileSync(join(f.change, "proposal.md"), PROPOSAL.replace("restore behavior", "APPROVED"));
  writeFileSync(join(f.change, ".gitattributes"), "proposal.md filter=review-test\n");
  git(f.root, "config", "filter.review-test.clean", "sed s/APPROVED/REWRITTEN/g");
  const result = f.complete();
  assert.notEqual(result.exit, 0);
  assert.equal(f.state().metadata["analysis.source"], undefined);
});

test("Human Review 重放只读取固定 Git Commit，不再追随共享 HEAD；Comment 不重复", t => {
  const f = fixture(t);
  assert.equal(f.complete().exit, 0);
  const saved = f.state().metadata["analysis.source"];
  git(f.root, "-c", "user.email=test@example.invalid", "-c", "user.name=Test", "commit", "--allow-empty", "-m", "unrelated HEAD");
  writeFileSync(join(f.change, "proposal.md"), "local WIP unrelated to approved review");
  const replay = f.complete();
  assert.equal(replay.exit, 0, JSON.stringify(replay));
  assert.equal(f.state().metadata["analysis.source"], saved);
  assert.equal(f.state().comments["issue-1"].length, 1);
});

test("Source 写入后状态切换失败，重试只复用等价远端 Contract", t => {
  const f = fixture(t);
  f.env.MOCK_FAIL_STATUS = "1";
  const first = f.complete();
  assert.equal(first.exit, 3, JSON.stringify(first));
  const source = f.state().metadata["analysis.source"];
  assert.ok(source);
  delete f.env.MOCK_FAIL_STATUS;
  const second = f.complete();
  assert.equal(second.exit, 0, JSON.stringify(second));
  assert.equal(f.state().metadata["analysis.source"], source);
});

test("Status 成功但响应丢失，重放校验固定来源并补齐 Issue Summary", t => {
  const f = fixture(t);
  f.env.MOCK_STATUS_RESPONSE_LOST = "1";
  assert.equal(f.complete().exit, 3);
  assert.equal(f.state().status, "analysis_review");
  delete f.env.MOCK_STATUS_RESPONSE_LOST;
  assert.equal(f.complete().exit, 0);
  assert.equal(f.state().comments["issue-1"].length, 1);
});

test("Requirement 必须使用 requirement 模式，禁止误选 legacy", t => {
  const f = fixture(t);
  const result = runCli(["analysis", "complete", "--issue", "issue-1",
    "--facts", f.factsPath, "--workspace-id", "ws-test", "--registry-config", join(f.home, "registry.json"),
    "--multica", MOCK, "--root-repo", f.root], f.env);
  assert.equal(result.exit, 2);
  assert.match(result.body.reason, /--mode requirement/);
});
