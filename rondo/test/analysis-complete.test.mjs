import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, delimiter } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ANALYSIS_GATE_CHECKS, changeEvidenceDigest, metadataEvidenceDigest } from "../dist/commands/analysis/gate-evidence.js";

import { analysisTfsFixture } from "./analysis-tfs-fixture.mjs";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const MOCK = fileURLToPath(new URL("./mock-multica.cjs", import.meta.url));
const CHANGE_REF = "c-test";
const TFS_ID = "261056";

const FACTS = {
  change_kind: "corrective",
  change_ref: CHANGE_REF,
  verify_agent: { recommendation: "not_required", reason: "纯配置修正", focus_refs: ["openspec/changes/c-test/proposal.md"] },
  gate: { result: "PASS", reasons_ref: `openspec/changes/${CHANGE_REF}/logs/analysis-gate-result.json` },
};

/** 生成可复核的 Gate evidence；完整 Gate 本身在独立 OpenSpec CLI 集成测试中执行。 */
function writeGateEvidence(rootRepo, overrides = {}, metadata = draftMetadata()) {
  const changeDir = join(rootRepo, "openspec", "changes", CHANGE_REF);
  const logs = join(changeDir, "logs");
  mkdirSync(logs, { recursive: true });
  const evidence = {
    result: "PASS", tool_version: "fixture",
    issue_id: "issue-1", workspace_id: "ws-test",
    change_ref: CHANGE_REF, change_kind: "corrective", schema: "corrective-change",
    change_digest: changeEvidenceDigest(changeDir, metadata, undefined, overrides.digest_eol === "lf"),
    metadata_digest: metadataEvidenceDigest(metadata),
    checks: ANALYSIS_GATE_CHECKS.map(name => ({ name, result: "PASS", reasons: [] })),
    reasons: [],
    ...overrides,
  };
  writeFileSync(join(logs, "analysis-gate-result.json"), JSON.stringify(evidence));
}

/** complete 要求 priorMeta 已含 stage 写入的 draft 段（与 facts 一致）。 */
function draftMetadata() {
  return {
    "tfs.type": "Bug",
    "tfs.id": TFS_ID,
    "analysis.change_kind": FACTS.change_kind,
    "analysis.change_ref": FACTS.change_ref,
    "analysis.verify_agent.recommendation": FACTS.verify_agent.recommendation,
    "analysis.verify_agent.reason": FACTS.verify_agent.reason,
    "analysis.verify_agent.focus_refs": JSON.stringify(FACTS.verify_agent.focus_refs),
  };
}

function runCli(args, env = {}, cwd) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", cwd, env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path")), PATH: process.env.PATH, ...env },
  });
  assert.equal(result.error, undefined, result.error?.message);
  let body;
  try { body = JSON.parse(result.stdout); }
  catch { assert.fail("CLI did not produce JSON: " + result.stdout + "\n" + result.stderr); }
  return { exit: result.status, body, stderr: result.stderr };
}

function git(cwd, ...args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * fixture：bare remote + 根仓（git 仓，origin 已推送 dev 分支，含 openspec/changes/<ref>/）。
 * 桩 multica 经 MOCK_STATE 持有 Issue status/metadata；MOCK_ROOT_REPO 供 project resource list 回指根仓。
 * seededCommit=true 时预置一个已提交未推送的 Change 文件以外的初始状态（首测另行写入）。
 */
function fixture(t, requirement = false) {
  // realpathSync.native：Windows tmpdir 返回 8.3 短名，CLI 侧经 git --show-toplevel 归一为长名
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "skill-flow-analysis-complete-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const remote = join(dir, "remote.git");
  mkdirSync(remote);
  git(remote, "init", "--bare");

  const rootRepo = join(dir, "root-repo");
  mkdirSync(join(rootRepo, "openspec", "changes", CHANGE_REF), { recursive: true });
  writeFileSync(join(rootRepo, "openspec", "changes", CHANGE_REF, ".openspec.yaml"), "schema: corrective-change\nx-repositories: [root]\n");
  writeFileSync(join(rootRepo, "openspec", "changes", CHANGE_REF, "tasks.md"), "- [ ] 1.1 验证 Fix\n");
  git(rootRepo, "init");
  git(rootRepo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init");
  git(rootRepo, "branch", "-M", "dev");
  git(rootRepo, "remote", "add", "origin", remote);
  git(rootRepo, "push", "origin", "dev");

  chmodSync(MOCK, 0o755);
  const config = join(dir, "registry.json");
  writeFileSync(config, JSON.stringify({
    runtime: { multica_cli: MOCK, workspace_id: "ws-test", multica_profile: "private", multica_server_url: "https://private.example" },
  }));

  const factsPath = join(dir, "facts.json");
  writeFileSync(factsPath, JSON.stringify(FACTS));

  const statePath = join(dir, "state.json");
  writeFileSync(statePath, JSON.stringify({ status: "in_progress", metadata: draftMetadata() }));

  const tfs = analysisTfsFixture(t, dir, { remote }, { requirementOrigin: requirement });
  const env = { ...tfs.env, MOCK_STATE: statePath, MOCK_ROOT_REPO: rootRepo, MOCK_EXPECT_PROFILE: "private", MOCK_EXPECT_SERVER: "https://private.example" };
  if (requirement) {
    env.RONDO_WORKSPACE_BRANCH = "dev";
    mkdirSync(join(rootRepo, "openspec", "schemas"), { recursive: true });
    mkdirSync(join(rootRepo, "docs", "config"), { recursive: true });
    writeFileSync(join(rootRepo, "docs", "config", "repo-context.yaml"), `repos:\n  - repo_id: root\n    repo_url: ${tfs.repoUrl}\n`);
    git(rootRepo, "config", "user.name", "Analyst");
    git(rootRepo, "config", "user.email", "analyst@example.invalid");
    writeFileSync(join(rootRepo, "openspec/schemas/.gitkeep"), "");
    writeFileSync(join(rootRepo, "openspec/changes/.gitkeep"), "");
    git(rootRepo, "add", "docs/config/repo-context.yaml", "openspec/schemas/.gitkeep", "openspec/changes/.gitkeep");
    git(rootRepo, "commit", "-m", "root mapping");
    git(rootRepo, "push", "origin", "dev");
    writeFileSync(statePath, JSON.stringify({ status: "in_progress", metadata: { ...draftMetadata(), "tfs.type": "需求" } }));
  }
  const run = () => runCli([
    "analysis", "complete",
    "--issue", "issue-1", "--facts", factsPath,
    "--registry-config", config, "--workspace-id", "ws-test",
    "--multica", MOCK, "--root-repo", rootRepo, ...(requirement ? ["--mode", "requirement"] : []),
  ], env);
  const state = () => JSON.parse(readFileSync(statePath, "utf8"));
  const setState = (next) => writeFileSync(statePath, JSON.stringify(next));
  const setStatus = (s) => { const cur = state(); cur.status = s; setState(cur); };
  return { rootRepo, remote, run, state, setState, setStatus, factsPath, config, env, tfs };
}

test("Requirement Analysis 只登记可从配置分支回读的已提交 Gate 版本", t => {
  const f = fixture(t, true);
  const path = "openspec/changes/" + CHANGE_REF;
  const change = join(f.rootRepo, path);
  git(f.rootRepo, "config", "core.autocrlf", "true");
  writeFileSync(join(change, "proposal.md"), "approved proposal\r\n");
  writeGateEvidence(f.rootRepo, { digest_eol: "lf" }, f.state().metadata);
  writeFileSync(join(f.rootRepo, "shared.txt"), "other work");
  git(f.rootRepo, "add", path, "shared.txt");
  git(f.rootRepo, "commit", "-m", "mixed local work");
  const local = git(f.rootRepo, "rev-parse", "HEAD");
  writeFileSync(join(change, "proposal.md"), "draft after gate\n");
  writeFileSync(join(change, "design.md"), "untracked after gate\n");

  const result = f.run();
  assert.equal(result.exit, 0, JSON.stringify(result));
  const source = JSON.parse(f.state().metadata["analysis.source"]);
  assert.equal(source.branch, "dev");
  assert.equal(source.commit, git(f.remote, "rev-parse", "dev"));
  assert.notEqual(source.commit, local);
  assert.equal(git(f.remote, "show", source.commit + ":" + path + "/proposal.md"), "approved proposal");
  assert.equal(git(f.remote, "ls-tree", "-r", "--name-only", source.commit, "--", "shared.txt", path + "/design.md"), "");
  assert.equal(git(f.rootRepo, "rev-parse", "HEAD"), local);
  assert.equal(readFileSync(join(change, "proposal.md"), "utf8"), "draft after gate\n");
  assert.ok(f.tfs.state().requests.some(r => r.query["versionDescriptor.version"] === source.commit));
});

test("等价的 TFS 映射、Fetch 和 Push URL 各自按真实路径认证并登记可读版本", t => {
  const f = fixture(t, true);
  f.env.MOCK_GIT_FETCH_URL = f.tfs.repoUrl.replace("/P/", "/p/");
  f.env.MOCK_GIT_PUSH_URL = f.tfs.repoUrl.replace("/_git/R", "/_git/r");
  const prepared = runCli(["runtime", "prepare-root", "--root-repo", f.rootRepo], f.env);
  assert.equal(prepared.exit, 0, JSON.stringify(prepared.body));
  const path = "openspec/changes/" + CHANGE_REF;
  writeFileSync(join(f.rootRepo, path, "proposal.md"), "approved");
  writeGateEvidence(f.rootRepo, {}, f.state().metadata);
  git(f.rootRepo, "add", path);
  git(f.rootRepo, "commit", "-m", "reviewed Change");
  const completed = f.run();
  assert.equal(completed.exit, 0, JSON.stringify(completed.body));
  const source = JSON.parse(f.state().metadata["analysis.source"]);
  assert.equal(source.repo_url, f.env.MOCK_GIT_PUSH_URL);
  assert.equal(source.commit, git(f.remote, "rev-parse", "dev"));
  assert.equal(f.state().status, "analysis_review");
});

test("Requirement Analysis 在 push 前拒绝未经 Gate 的远端新增规范", t => {
  const f = fixture(t, true);
  const path = "openspec/changes/" + CHANGE_REF;
  const other = join(dirname(f.rootRepo), "other");
  git(dirname(f.rootRepo), "clone", "-b", "dev", f.remote, other);
  const newSpec = join(other, path, "specs", "scope");
  mkdirSync(newSpec, { recursive: true });
  writeFileSync(join(newSpec, "spec.md"), "concurrent spec\n");
  git(other, "add", path);
  git(other, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "remote new spec");
  git(other, "push", "origin", "dev");
  const remote = git(f.remote, "rev-parse", "dev");

  writeFileSync(join(f.rootRepo, path, "proposal.md"), "approved proposal\n");
  writeGateEvidence(f.rootRepo, {}, f.state().metadata);
  git(f.rootRepo, "add", path);
  git(f.rootRepo, "commit", "-m", "local Gate");
  const result = f.run();
  assert.equal(result.exit, 2, JSON.stringify(result));
  assert.match(result.body.reason, /Gate/);
  assert.equal(git(f.remote, "rev-parse", "dev"), remote);
  assert.equal(f.state().metadata["analysis.source"], undefined);
});

test("08-B Requirement 持久根仓拒绝无 --mode requirement 的 Analysis 发布", t => {
  const f=fixture(t);
  const existing=f.state();
  existing.metadata["tfs.type"]="需求";
  f.setState(existing);
  for (const config of [{ RONDO_WORKSPACE_PATH: f.rootRepo }, { RONDO_WORKSPACE_BRANCH: "dev" }]) {
    const result = runCli(["analysis", "complete", "--issue", "issue-1", "--facts", f.factsPath,
      "--registry-config", f.config, "--workspace-id", "ws-test", "--multica", MOCK, "--root-repo", f.rootRepo],
      { ...f.env, ...config });
    assert.equal(result.exit, 2);
    assert.match(result.body.reason, /--mode requirement/);
  }
  assert.equal(git(f.rootRepo,"log","-1","--format=%s"),"init");
});

test("真实 Stage → Validate → Complete：Gate PASS 必须含当前 Metadata Digest", (t) => {
  const { rootRepo, env, config, factsPath, state, setState, run } = fixture(t);
  const change = join(rootRepo, "openspec", "changes", CHANGE_REF);
  writeFileSync(join(change, "proposal.md"),
    "Expected Behavior\nActual Behavior\nRoot Cause\nFix Strategy\nRegression Scope\n");
  writeFileSync(join(change, "tasks.md"), "- [ ] 1.1 Fix and 验证 the regression\n");

  // A minimal deterministic OpenSpec runner only for the CLI boundary; Stage, Gate,
  // Git commit/push and Multica state transition are all executed for real.
  const binDir = join(dirname(rootRepo), "bin");
  mkdirSync(binDir);
  const openspec = join(binDir, process.platform === "win32" ? "openspec.cmd" : "openspec");
  const reportFile = join(binDir, "validation.json");
  writeFileSync(openspec, process.platform === "win32"
    ? '@echo off\r\nif not "%~1"=="validate" exit /b 64\r\ntype "%~dp0validation.json"\r\n'
    : '#!/bin/sh\n[ "$1" = validate ] || exit 64\ncat "$(dirname "$0")/validation.json"\n');
  chmodSync(openspec, 0o755);
  const runtime = { ...env, PATH: binDir + delimiter + env.PATH };
  const { gate: _gate, ...draft } = FACTS;
  writeFileSync(factsPath, JSON.stringify(draft));
  const before = state();
  delete before.metadata["analysis.change_kind"];
  setState(before);

  const stage = runCli(["analysis", "stage", "--issue", "issue-1",
    "--facts", factsPath, "--workspace-id", "ws-test",
    "--registry-config", config, "--multica", MOCK], runtime);
  assert.equal(stage.exit, 0, JSON.stringify(stage.body));
  assert.equal(state().metadata["analysis.change_kind"], "corrective");
  const resultFile = join(change, "logs", "analysis-gate-result.json");
  const invalidOut = join(dirname(rootRepo), "outside-gate.json");
  const invalid = runCli(["analysis", "validate", "--issue", "issue-1",
    "--openspec-root", rootRepo, "--workspace-id", "ws-test",
    "--registry-config", config, "--multica", MOCK, "--out", invalidOut], runtime, dirname(rootRepo));
  assert.equal(invalid.exit, 2, JSON.stringify(invalid.body));
  assert.match(invalid.body.reasons.join(" "), /Gate --out/);
  assert.equal(existsSync(invalidOut), false);

  // Relative output must resolve from the explicit root, not the process cwd.
  const validate = () => runCli(["analysis", "validate", "--issue", "issue-1",
    "--openspec-root", rootRepo, "--workspace-id", "ws-test",
    "--registry-config", config, "--multica", MOCK,
    "--out", "openspec/changes/" + CHANGE_REF + "/logs/analysis-gate-result.json"], runtime, dirname(rootRepo));
  const root = { path: rootRepo, source: "nearest" };
  const item = { id: CHANGE_REF, type: "change", valid: true, issues: [] };
  for (const unbound of [
    { root: { ...root, path: dirname(rootRepo) }, items: [item] },
    { root, items: [{ ...item, id: "other-change" }] },
    { root, items: [{ ...item, type: "spec" }] },
  ]) {
    writeFileSync(reportFile, JSON.stringify(unbound));
    const rejected = validate();
    assert.equal(rejected.exit, 3, JSON.stringify(rejected.body));
    assert.equal(rejected.body.checks.find(c => c.name === "openspec_validate")?.result, "UNKNOWN");
  }
  writeFileSync(reportFile, JSON.stringify({ root, items: [item] }));
  const gate = validate();
  assert.equal(gate.exit, 0, JSON.stringify(gate.body));
  assert.equal(gate.body.result, "PASS");
  assert.equal(gate.body.metadata_digest, metadataEvidenceDigest(state().metadata));
  assert.match(gate.body.metadata_digest, /^[0-9a-f]{64}$/);
  assert.equal(gate.body.change_digest, changeEvidenceDigest(change));
  assert.equal(gate.body.checks.length, ANALYSIS_GATE_CHECKS.length);
  assert.equal(JSON.parse(readFileSync(resultFile, "utf8")).metadata_digest, gate.body.metadata_digest);

  writeFileSync(factsPath, JSON.stringify(FACTS));
  const completed = run();
  assert.equal(completed.exit, 0, JSON.stringify(completed.body));
  assert.equal(completed.body.status, "analysis_review");
  assert.equal(completed.body.root_commit.pushed, true);
  assert.equal(state().metadata["analysis.gate.result"], "PASS");
});

test("stage 将 change_kind 写入并回读 Multica Issue Metadata", (t) => {
  const { factsPath, config, env, state, setState } = fixture(t);
  const before = state();
  delete before.metadata["analysis.change_kind"];
  setState(before);
  assert.equal(state().metadata["analysis.change_kind"], undefined);
  const { gate, ...draft } = FACTS;
  writeFileSync(factsPath, JSON.stringify(draft));
  const r = runCli([
    "analysis", "stage", "--issue", "issue-1",
    "--facts", factsPath, "--registry-config", config, "--workspace-id", "ws-test",
    "--multica", MOCK,
  ], env);
  assert.equal(r.exit, 0, JSON.stringify(r.body));
  assert.equal(state().metadata["analysis.change_kind"], "corrective");
  assert.ok(r.body.metadata_keys.includes("analysis.change_kind"));
  assert.equal(state().metadata["analysis.route"], undefined);
});

test("stage 缺少 change_kind 时拒绝写入 Metadata", (t) => {
  const { factsPath, config, env, state } = fixture(t);
  const { gate, change_kind, ...draft } = FACTS;
  writeFileSync(factsPath, JSON.stringify(draft));
  const r = runCli([
    "analysis", "stage", "--issue", "issue-1",
    "--facts", factsPath, "--registry-config", config, "--workspace-id", "ws-test",
    "--multica", MOCK,
  ], env);
  assert.equal(r.exit, 2, JSON.stringify(r.body));
  assert.match(r.body.reason, /change_kind/);
  assert.equal(state().metadata["analysis.gate.result"], undefined);
});

test("stage 能覆盖原有错误分类且失败写入不会伪装 PASS", (t) => {
  const { factsPath, config, env, state, setState } = fixture(t);
  const { gate, ...draft } = FACTS;
  writeFileSync(factsPath, JSON.stringify(draft));
  const original = state();
  original.metadata["analysis.change_kind"] = "intentional";
  setState(original);
  const command = ["analysis", "stage", "--issue", "issue-1", "--facts", factsPath,
    "--registry-config", config, "--workspace-id", "ws-test", "--multica", MOCK];
  const failed = runCli(command, { ...env, MOCK_FAIL_METADATA_KEY: "analysis.change_kind" });
  assert.notEqual(failed.exit, 0);
  assert.equal(state().metadata["analysis.change_kind"], "intentional");
  const passed = runCli(command, env);
  assert.equal(passed.exit, 0, JSON.stringify(passed.body));
  assert.equal(state().metadata["analysis.change_kind"], "corrective");
});

test("complete 拒绝仅凭 Facts 声称 Gate PASS 而缺少真实 Gate Result", (t) => {
  const { rootRepo, run, state } = fixture(t);
  writeFileSync(join(rootRepo, "openspec", "changes", CHANGE_REF, "proposal.md"), "# proposal\\n");
  const result = run();
  assert.equal(result.exit, 3, JSON.stringify(result.body));
  assert.equal(state().status, "in_progress");
  assert.equal(state().metadata["analysis.gate.result"], undefined);
});

test("complete 拒绝外部 Issue、失败检查项与已过期 Change 的 Gate Result", (t) => {
  const { rootRepo, run, state } = fixture(t);
  const proposal = join(rootRepo, "openspec", "changes", CHANGE_REF, "proposal.md");
  writeFileSync(proposal, "# proposal\\n");

  writeGateEvidence(rootRepo, { issue_id: "foreign-issue" });
  const foreign = run();
  assert.equal(foreign.exit, 2, JSON.stringify(foreign.body));
  assert.match(foreign.body.reason, /issue_id/);

  writeGateEvidence(rootRepo, { checks: [{ name: "identity", result: "PASS" }] });
  const incomplete = run();
  assert.equal(incomplete.exit, 2, JSON.stringify(incomplete.body));
  assert.match(incomplete.body.reason, /checks/);

  writeGateEvidence(rootRepo);
  writeFileSync(proposal, "# proposal changed after Gate\\n");
  const stale = run();
  assert.equal(stale.exit, 2, JSON.stringify(stale.body));
  assert.match(stale.body.reason, /工件已变化/);
  assert.equal(state().status, "in_progress");
  assert.equal(state().metadata["analysis.gate.result"], undefined);
});

test("首次分析：Change 提交并推送成功后才进入 analysis_review", (t) => {
  const { rootRepo, run, state, tfs } = fixture(t);
  writeFileSync(join(rootRepo, "openspec", "changes", CHANGE_REF, "proposal.md"), "# proposal\n");
  writeGateEvidence(rootRepo);

  const r = run();
  assert.equal(r.exit, 0, JSON.stringify(r.body));
  assert.equal(r.body.result, "PASS");
  assert.equal(r.body.status, "analysis_review");
  assert.equal(r.body.root_commit.branch, "dev");
  assert.equal(r.body.root_commit.committed, 1);
  assert.equal(r.body.root_commit.pushed, true);
  assert.deepEqual(JSON.parse(state().metadata["analysis.source"]), {
    repo_url: tfs.repoUrl, branch: "dev", commit: git(rootRepo, "rev-parse", "HEAD"), change_ref: CHANGE_REF,
  });
  assert.equal(r.body.root_commit.commit, git(rootRepo, "rev-parse", "HEAD"));

  // 提交已到达远端，message 含 change_ref / issue / tfs id
  assert.equal(git(rootRepo, "rev-list", "origin/dev..HEAD", "--count"), "0");
  const subject = git(rootRepo, "log", "-1", "--format=%s");
  assert.match(subject, /^analysis: c-test \(issue-1 \/ tfs 261056\)$/);
  // 远端确实可见该提交
  const remoteHead = git(rootRepo, "rev-parse", "origin/dev");
  assert.equal(remoteHead, git(rootRepo, "rev-parse", "HEAD"));

  assert.equal(state().status, "analysis_review");
  assert.equal(state().metadata["analysis.gate.result"], "PASS");
  assert.equal(state().metadata["analysis.change_kind"], "corrective");
});

test("审核重放保留原 commit，本地工件与 HEAD 前进不会覆盖已发布来源", t => {
  const f = fixture(t);
  const proposal = join(f.rootRepo, "openspec", "changes", CHANGE_REF, "proposal.md");
  writeFileSync(proposal, "# approved\n");
  writeGateEvidence(f.rootRepo);
  assert.equal(f.run().exit, 0);
  const saved = f.state().metadata["analysis.source"];
  git(f.rootRepo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "later");
  writeFileSync(proposal, "# local WIP\n");
  const replay = f.run();
  assert.equal(replay.exit, 0, JSON.stringify(replay));
  assert.equal(replay.body.root_commit.commit, JSON.parse(saved).commit);
  assert.equal(f.state().metadata["analysis.source"], saved);
});

test("审核重跑必须核对固定版本 Gate，不能只凭同名 tasks.md 放行", t => {
  const f = fixture(t);
  writeFileSync(join(f.rootRepo, "openspec", "changes", CHANGE_REF, "proposal.md"), "# approved\n");
  writeGateEvidence(f.rootRepo);
  assert.equal(f.run().exit, 0);
  const modified = structuredClone(FACTS);
  modified.verify_agent.reason = "未被 Gate 审核的新事实";
  writeFileSync(f.factsPath, JSON.stringify(modified));
  const st = f.state(); st.metadata["analysis.verify_agent.reason"] = modified.verify_agent.reason; f.setState(st);
  const result = f.run();
  assert.equal(result.exit, 2, JSON.stringify(result));
  assert.match(result.body.reason, /Gate/);
});

test("来源已落账但状态切换失败，重跑必须复用原来源而非新的 HEAD", t => {
  const f = fixture(t);
  writeFileSync(join(f.rootRepo, "openspec", "changes", CHANGE_REF, "proposal.md"), "# approved\n");
  writeGateEvidence(f.rootRepo);
  f.env.MOCK_FAIL_STATUS = "1";
  assert.equal(f.run().exit, 3);
  const source = f.state().metadata["analysis.source"];
  assert.ok(source);
  git(f.rootRepo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "unrelated");
  const remoteBefore = git(f.rootRepo, "rev-parse", "origin/dev");
  delete f.env.MOCK_FAIL_STATUS;
  const result = f.run();
  assert.equal(result.exit, 0, JSON.stringify(result));
  assert.equal(f.state().metadata["analysis.source"], source);
  assert.equal(git(f.rootRepo, "rev-parse", "origin/dev"), remoteBefore, "恢复不得顺带推送新 HEAD");
});

test("Git clean filter 改写审核工件时，不能把工作树 Gate 绑定到不同正文的 commit", t => {
  const f = fixture(t);
  const dir = join(f.rootRepo, "openspec", "changes", CHANGE_REF);
  writeFileSync(join(dir, "proposal.md"), "APPROVED\n");
  writeFileSync(join(dir, ".gitattributes"), "proposal.md filter=review-test\n");
  git(f.rootRepo, "config", "filter.review-test.clean", "sed s/APPROVED/REWRITTEN/g");
  writeGateEvidence(f.rootRepo);
  const result = f.run();
  assert.notEqual(result.exit, 0, JSON.stringify(result));
  assert.equal(f.state().metadata["analysis.source"], undefined);
  assert.equal(f.state().status, "in_progress");
});

test("状态成功但响应丢失后，可从固定远端 Gate 恢复，不依赖本地 Gate", t => {
  const f = fixture(t);
  const dir = join(f.rootRepo, "openspec", "changes", CHANGE_REF);
  writeFileSync(join(dir, "proposal.md"), "# approved\n");
  writeGateEvidence(f.rootRepo);
  f.env.MOCK_STATUS_RESPONSE_LOST = "1";
  assert.equal(f.run().exit, 3);
  assert.equal(f.state().status, "analysis_review");
  const source = f.state().metadata["analysis.source"];
  delete f.env.MOCK_STATUS_RESPONSE_LOST;
  rmSync(join(dir, "logs", "analysis-gate-result.json"));
  assert.equal(f.run().exit, 0);
  assert.equal(f.state().metadata["analysis.source"], source);
});

test("来源核验期间 Issue 被阻塞时，不得重新发布 analysis_review", t => {
  const f = fixture(t);
  writeFileSync(join(f.rootRepo, "openspec", "changes", CHANGE_REF, "proposal.md"), "# approved\n");
  writeGateEvidence(f.rootRepo);
  f.env.MOCK_STATUS_ON_ISSUE_READ = "2";
  const result = f.run();
  assert.equal(result.exit, 3, JSON.stringify(result));
  assert.equal(f.state().status, "blocked");
  assert.equal(f.state().metadata["analysis.source"], undefined);
});

test("旧审核记录缺少来源时拒绝猜测，重新获准分析后可正常建立来源", t => {
  const f = fixture(t);
  writeFileSync(join(f.rootRepo, "openspec", "changes", CHANGE_REF, "proposal.md"), "# approved\n");
  writeGateEvidence(f.rootRepo);
  const old = f.state();
  old.status = "analysis_review";
  old.metadata["analysis.gate.result"] = "PASS";
  old.metadata["analysis.gate.reasons_ref"] = FACTS.gate.reasons_ref;
  f.setState(old);
  assert.equal(f.run().exit, 3);
  assert.equal(f.state().metadata["analysis.source"], undefined);
  f.setStatus("in_progress");
  assert.equal(f.run().exit, 0);
  assert.ok(f.state().metadata["analysis.source"]);
});

test("远端读取失败或来源写入失败均不进入 analysis_review，可恢复重跑", t => {
  const f = fixture(t);
  writeFileSync(join(f.rootRepo, "openspec", "changes", CHANGE_REF, "proposal.md"), "# proposal\n");
  writeGateEvidence(f.rootRepo);
  f.tfs.update(s => { s.status = 403; });
  assert.equal(f.run().exit, 3);
  assert.equal(f.state().status, "in_progress");
  assert.equal(f.state().metadata["analysis.source"], undefined);
  f.tfs.update(s => { delete s.status; });
  f.env.MOCK_FAIL_METADATA_KEY = "analysis.source";
  assert.equal(f.run().exit, 3);
  assert.equal(f.state().status, "in_progress");
  delete f.env.MOCK_FAIL_METADATA_KEY;
  assert.equal(f.run().exit, 0);
  assert.ok(f.state().metadata["analysis.source"]);
});

test("push 冲突触发真实 rebase 后，记录最终 SHA 而非 rebase 前 SHA", t => {
  const f = fixture(t);
  const other = join(dirname(f.rootRepo), "other");
  mkdirSync(other);
  git(other, "clone", "--branch", "dev", f.remote, ".");
  writeFileSync(join(other, "other.txt"), "independent change\n");
  git(other, "add", "other.txt");
  git(other, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "concurrent");
  git(other, "push", "origin", "dev");
  writeFileSync(join(f.rootRepo, "openspec", "changes", CHANGE_REF, "proposal.md"), "# proposal\n");
  writeGateEvidence(f.rootRepo);
  const result = f.run();
  assert.equal(result.exit, 0, JSON.stringify(result));
  assert.match(result.stderr, /rebase/);
  const source = JSON.parse(f.state().metadata["analysis.source"]);
  assert.equal(source.commit, git(f.rootRepo, "rev-parse", "HEAD"));
  assert.equal(source.commit, git(other, "--git-dir", f.remote, "rev-parse", "dev"));
  assert.equal(readFileSync(join(f.rootRepo, "other.txt"), "utf8"), "independent change\n");
});

test("收口期间来源被其他流程更新时停止，保留新事实", t => {
  const f = fixture(t);
  writeFileSync(join(f.rootRepo, "openspec", "changes", CHANGE_REF, "proposal.md"), "# proposal\n");
  writeGateEvidence(f.rootRepo);
  const concurrent = JSON.stringify({ repo_url: f.tfs.repoUrl, branch: "dev", commit: "b".repeat(40), change_ref: CHANGE_REF });
  f.env.MOCK_DRIFT_ANALYSIS_SOURCE = concurrent;
  const result = f.run();
  assert.equal(result.exit, 3, JSON.stringify(result));
  assert.match(result.body.reason, /停止覆盖/);
  assert.equal(f.state().metadata["analysis.source"], concurrent);
  assert.equal(f.state().status, "in_progress");
});

test("返工：状态重置后再次 complete 产生第二个提交并推送", (t) => {
  const { rootRepo, run, setStatus } = fixture(t);
  const proposal = join(rootRepo, "openspec", "changes", CHANGE_REF, "proposal.md");
  writeFileSync(proposal, "# proposal v1\n");
  writeGateEvidence(rootRepo);
  assert.equal(run().exit, 0);
  const firstHead = git(rootRepo, "rev-parse", "HEAD");

  // Human 退回：Delivery Lead 重置 in_progress（02 §6.2），Analyst 定向修订后再次收口
  setStatus("in_progress");
  writeFileSync(proposal, "# proposal v2（返工修订）\n");
  writeGateEvidence(rootRepo); // 返工后必须重新获得与新工件一致的 Gate 结果
  const r = run();
  assert.equal(r.exit, 0, JSON.stringify(r.body));
  assert.equal(r.body.result, "PASS");
  assert.equal(r.body.root_commit.committed, 2); // 返工更新 proposal 与对应 Gate 结果
  assert.equal(r.body.root_commit.pushed, true);

  assert.notEqual(git(rootRepo, "rev-parse", "HEAD"), firstHead);
  assert.equal(git(rootRepo, "rev-list", "origin/dev..HEAD", "--count"), "0");
  assert.equal(git(rootRepo, "rev-list", "--count", "HEAD"), "3"); // init + 首次 + 返工
});

test("push 失败：UNKNOWN 退出 3，状态保持 in_progress，本地 Commit 保留", (t) => {
  const { rootRepo, run, state } = fixture(t);
  writeFileSync(join(rootRepo, "openspec", "changes", CHANGE_REF, "proposal.md"), "# proposal\n");
  writeGateEvidence(rootRepo);
  // 移除 origin：rev-list origin/dev..HEAD 无法解析 → 推送链路不可确认
  git(rootRepo, "remote", "remove", "origin");

  const r = run();
  assert.equal(r.exit, 3, JSON.stringify(r.body));
  assert.equal(r.body.result, "UNKNOWN");

  // 本地提交保留（恢复时只补 push），但状态未进入 analysis_review、gate metadata 未写
  assert.match(git(rootRepo, "log", "-1", "--format=%s"), /^analysis: c-test/);
  assert.equal(state().status, "in_progress");
  assert.equal(state().metadata["analysis.gate.result"], undefined);
});

test("幂等重放：无新改动跳过提交，rev-list=0 跳过 push，仍正常收口", (t) => {
  const { rootRepo, run, setStatus } = fixture(t);
  writeFileSync(join(rootRepo, "openspec", "changes", CHANGE_REF, "proposal.md"), "# proposal\n");
  writeGateEvidence(rootRepo);
  assert.equal(run().exit, 0);
  const head = git(rootRepo, "rev-parse", "HEAD");

  // metadata 写失败/中断后的重放：状态退回 in_progress，Change 无新改动
  setStatus("in_progress");
  const r = run();
  assert.equal(r.exit, 0, JSON.stringify(r.body));
  assert.equal(r.body.result, "PASS");
  assert.equal(r.body.root_commit.committed, "skipped_no_changes");
  assert.equal(r.body.root_commit.pushed, true);
  assert.equal(git(rootRepo, "rev-parse", "HEAD"), head); // 未产生新提交
});
