import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, delimiter } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analysisTfsFixture } from "./analysis-tfs-fixture.mjs";
import { sameAnalysisSource } from "../dist/commands/analysis/source.js";
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
function fixture(t, requirement = true, native = false) {
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
  git(root, "config", "user.name", "Rondo Test");
  git(root, "config", "user.email", "test@example.invalid");
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

  const taskId = "01234567-abcd-ef12-3456-abcdef123456";
  const taskBranch = "agent/workitem-analyst/abcdef123456";
  const resourcePath = join(home, ".multica", "project", "resources.json");
  if (native) {
    mkdirSync(dirname(resourcePath), { recursive: true });
    writeFileSync(resourcePath, JSON.stringify({ project_id: "project1", resources: [
      { resource_type: "github_repo", resource_ref: { url: tfs.repoUrl, ref: "dev" } },
    ] }));
    writeFileSync(join(home, ".multica", "daemon_task_context.json"), JSON.stringify({
      managed_by: "multica-daemon-task", issue_id: "issue-1", agent_id: "analyst",
    }));
    git(root, "config", "multica.checkout-mode", "isolated");
    // Match Multica isolated Checkout: branch created from raw SHA, without upstream.
    git(root, "checkout", "-b", taskBranch, git(root, "rev-parse", "HEAD"));
    writeFileSync(statePath, JSON.stringify({ status: "in_progress", metadata, runs: {
      "issue-1": [{ id: taskId, issue_id: "issue-1", agent_id: "analyst", workspace_id: "ws-test", status: "running" }],
    } }));
  }
  git(root, "add", "openspec/changes/" + CHANGE);
  git(root, "-c", "user.email=test@example.invalid", "-c", "user.name=Test", "commit", "-m", "reviewed Change contract");

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
    ...(requirement ? { RONDO_WORKSPACE_BRANCH: "dev" } : {}),
    ...(native ? { RONDO_WORKSPACE_BRANCH: "", RONDO_WORKSPACE_PATH: "", MULTICA_TASK_ID: taskId,
      MULTICA_WORKSPACE_ID: "ws-test", MULTICA_AGENT_ID: "analyst" } : {}) };
  const args = ["--issue", "issue-1", "--openspec-root", root,
    "--workspace-id", "ws-test", "--registry-config", config, "--multica", MOCK];
  const gate = () => runCli(["analysis", "validate", "--facts", factsPath, ...args], env);
  const complete = (...extra) => runCli(["analysis", "complete",
    "--issue", "issue-1", "--facts", factsPath,
    "--workspace-id", "ws-test", "--registry-config", config, "--multica", MOCK,
    "--root-repo", root, ...(requirement ? ["--mode", "requirement"] : []), ...extra], env);
  const state = () => JSON.parse(readFileSync(statePath, "utf8"));
  const setState = data => writeFileSync(statePath, JSON.stringify(data));
  return { home, root, change, remote, report, tfs, env, gate, complete, state, setState, factsPath, metadata, taskBranch, resourcePath };
}

test("Preview → Complete without Stage: final Gate and fixed Git Contract; no automatic Comment or Gate file", t => {
  const f = fixture(t);
  const before = f.state();
  f.setState({ ...before, metadata: { "tfs.type": before.metadata["tfs.type"], "tfs.id": before.metadata["tfs.id"] } });
  const preview = f.gate();
  assert.equal(preview.exit, 0, JSON.stringify(preview));
  assert.equal(preview.body.metadata_digest, metadataEvidenceDigest(before.metadata));
  assert.equal(f.state().metadata["analysis.change_ref"], undefined);
  assert.equal(preview.body.change_digest, changeEvidenceDigest(f.change, before.metadata, undefined, true));
  assert.equal(existsSync(join(f.change, "logs", "analysis-gate-result.json")), false);
  const result = f.complete();
  assert.equal(result.exit, 0, JSON.stringify(result));
  const source = JSON.parse(f.state().metadata["analysis.source"]);
  assert.deepEqual(result.body.analysis_source, source);
  assert.equal(source.commit, git(f.remote, "rev-parse", "dev"));
  assert.equal(git(f.remote, "show", source.commit + ":openspec/changes/" + CHANGE + "/proposal.md"), PROPOSAL.trim());
  assert.equal(f.state().metadata["analysis.gate.result"], "PASS");
  assert.equal(f.state().status, "analysis_review");
  assert.equal(f.state().comments?.["issue-1"]?.length ?? 0, 0);
  assert.equal(existsSync(join(f.change, "logs", "analysis-gate-result.json")), false);
  assert.equal(existsSync(join(f.change, "analysis-handoff.json")), false);
});

test("旧 metadata PASS/调用方自报 PASS 都不能绕过最终真实 Gate", t => {
  const f = fixture(t);
  const st = f.state(); st.metadata["analysis.gate.result"] = "PASS"; f.setState(st);
  writeFileSync(f.factsPath, JSON.stringify({ ...FACTS, gate: { result: "PASS" } }));
  writeFileSync(join(f.change, "proposal.md"), "");
  const result = f.complete();
  assert.equal(result.exit, 2, JSON.stringify(result));
  assert.match(result.body.reason, /acceptance_contract/);
  assert.equal(f.state().metadata["analysis.source"], undefined);
  assert.equal(f.state().status, "in_progress");
});

test("Preview 成功后正文改变，Complete 必须检查当前新正文而非旧 PASS", t => {
  const f = fixture(t);
  assert.equal(f.gate().exit, 0);
  writeFileSync(join(f.change, "tasks.md"), "no task checkbox\n");
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

test("Human Review 重放只读取固定 Git Commit，不再追随共享 HEAD 或自动新增 Comment", t => {
  const f = fixture(t);
  assert.equal(f.complete().exit, 0);
  const saved = f.state().metadata["analysis.source"];
  git(f.root, "-c", "user.email=test@example.invalid", "-c", "user.name=Test", "commit", "--allow-empty", "-m", "unrelated HEAD");
  writeFileSync(join(f.change, "proposal.md"), "local WIP unrelated to approved review");
  const replay = f.complete();
  assert.equal(replay.exit, 0, JSON.stringify(replay));
  assert.equal(f.state().metadata["analysis.source"], saved);
  assert.equal(replay.body.replayed, true);
  assert.equal(f.state().comments?.["issue-1"]?.length ?? 0, 0);
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

test("Status 成功但响应丢失，重放校验固定来源且不自动新增 Comment", t => {
  const f = fixture(t);
  f.env.MOCK_STATUS_RESPONSE_LOST = "1";
  assert.equal(f.complete().exit, 3);
  assert.equal(f.state().status, "analysis_review");
  delete f.env.MOCK_STATUS_RESPONSE_LOST;
  assert.equal(f.complete().exit, 0);
  assert.equal(f.state().comments?.["issue-1"]?.length ?? 0, 0);
});

test("Requirement 必须使用 requirement 模式，禁止误选 legacy", t => {
  const f = fixture(t);
  f.env.RONDO_WORKSPACE_BRANCH = "";
  f.env.RONDO_WORKSPACE_PATH = "";
  const result = runCli(["analysis", "complete", "--issue", "issue-1",
    "--facts", f.factsPath, "--workspace-id", "ws-test", "--registry-config", join(f.home, "registry.json"),
    "--multica", MOCK, "--root-repo", f.root], f.env);
  assert.equal(result.exit, 2);
  assert.match(result.body.reason, /--mode requirement/);
});

test("Native Analysis without Workspace variables: raw-SHA Task branch, remote advance and single Change publish", t => {
  const f = fixture(t, true, true);
  const peer = join(f.home, "peer");
  git(f.home, "clone", "-b", "dev", f.remote, peer);
  writeFileSync(join(peer, "peer.txt"), "remote advance");
  git(peer, "add", "peer.txt");
  git(peer, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "peer");
  git(peer, "push", "origin", "dev");
  writeFileSync(join(f.root, "local.txt"), "not part of Change");
  git(f.root, "add", "local.txt");
  git(f.root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "unrelated");
  const result = f.complete();
  assert.equal(result.exit, 0, JSON.stringify(result));
  const source = JSON.parse(f.state().metadata["analysis.source"]);
  assert.equal(source.branch, "dev");
  assert.equal(source.commit, git(f.remote, "rev-parse", "dev"));
  assert.equal(git(f.root, "branch", "--show-current"), f.taskBranch);
  assert.equal(git(f.remote, "show", "dev:peer.txt"), "remote advance");
  assert.equal(git(f.remote, "ls-tree", "--name-only", "dev", "local.txt"), "");
});

test("Native Analysis refuses Project/Resource/Task mismatch and conflicting target without publication", t => {
  const f = fixture(t, true, true);
  const before = git(f.remote, "rev-parse", "dev");
  const good = JSON.parse(readFileSync(f.resourcePath, "utf8"));
  for (const resource of [
    { ...good, project_id: "other" },
    { ...good, resources: [] },
    { ...good, resources: [...good.resources, ...good.resources] },
  ]) {
    writeFileSync(f.resourcePath, JSON.stringify(resource));
    assert.notEqual(f.complete().exit, 0);
    assert.equal(f.state().metadata["analysis.source"], undefined);
  }
  writeFileSync(f.resourcePath, JSON.stringify(good));
  assert.notEqual(f.complete("--target-branch", "other").exit, 0);
  const saved = f.env.MULTICA_TASK_ID;
  f.env.MULTICA_TASK_ID = "01234567-abcd-ef12-3456-000000000000";
  assert.notEqual(f.complete().exit, 0);
  f.env.MULTICA_TASK_ID = saved;
  // Another branch with the same commit is ambiguous for a raw-SHA checkout.
  git(f.root, "push", "origin", "dev:other");
  good.resources[0].resource_ref.ref = "other";
  writeFileSync(f.resourcePath, JSON.stringify(good));
  assert.notEqual(f.complete().exit, 0);
  assert.equal(git(f.remote, "rev-parse", "dev"), before);
  assert.equal(git(f.remote, "rev-parse", "other"), before);
  assert.equal(f.state().metadata["analysis.source"], undefined);
});

test("Native Analysis status failure and authorized rework keep the original publication branch", t => {
  const f = fixture(t, true, true);
  f.env.MOCK_FAIL_STATUS = "1";
  assert.equal(f.complete().exit, 3);
  const source = f.state().metadata["analysis.source"];
  assert.ok(source);
  const project = JSON.parse(readFileSync(f.resourcePath, "utf8"));
  project.resources[0].resource_ref.ref = "new-resource-branch";
  writeFileSync(f.resourcePath, JSON.stringify(project));
  delete f.env.MOCK_FAIL_STATUS;
  rmSync(f.resourcePath);
  const resumed = f.complete();
  assert.equal(resumed.exit, 0, JSON.stringify(resumed));
  assert.equal(f.state().metadata["analysis.source"], source);
  const state = f.state();
  state.status = "in_progress";
  f.setState(state);
  writeFileSync(join(f.change, "proposal.md"), PROPOSAL.replace("restore behavior", "restore validated behavior"));
  git(f.root, "add", "openspec/changes/" + CHANGE);
  git(f.root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "authorized rework");
  const reworked = f.complete();
  assert.equal(reworked.exit, 0, JSON.stringify(reworked));
  const next = JSON.parse(f.state().metadata["analysis.source"]);
  assert.equal(next.branch, "dev");
  assert.notEqual(next.commit, JSON.parse(source).commit);
});

test("Native Analysis Push succeeded but source write failed: recover on same branch and refuse changed Resource", t => {
  const f = fixture(t, true, true);
  f.env.MOCK_FAIL_METADATA_KEY = "analysis.source";
  assert.equal(f.complete().exit, 3);
  const published = git(f.remote, "rev-parse", "dev");
  assert.equal(f.state().metadata["analysis.source"], undefined);
  const project = JSON.parse(readFileSync(f.resourcePath, "utf8"));
  const before = git(f.root, "rev-parse", "dev");
  git(f.root, "push", "origin", "dev:other");
  project.resources[0].resource_ref.ref = "other";
  writeFileSync(f.resourcePath, JSON.stringify(project));
  delete f.env.MOCK_FAIL_METADATA_KEY;
  assert.notEqual(f.complete().exit, 0);
  assert.equal(git(f.remote, "rev-parse", "other"), before);
  assert.equal(git(f.remote, "rev-parse", "dev"), published);
  // Restore the original named baseline (as provided by linked platform checkout).
  git(f.root, "branch", "--set-upstream-to=origin/dev", f.taskBranch);
  project.resources[0].resource_ref.ref = "dev";
  writeFileSync(f.resourcePath, JSON.stringify(project));
  const recovered = f.complete();
  assert.equal(recovered.exit, 0, JSON.stringify(recovered));
  assert.equal(JSON.parse(f.state().metadata["analysis.source"]).commit, published);
});

test("Human approval source identity includes the fixed publication branch", () => {
  const source = { repo_url: "http://tfs.test/tfs/C/P/_git/root", branch: "master", commit: "a".repeat(40), change_ref: CHANGE };
  assert.equal(sameAnalysisSource(source, { ...source }), true);
  assert.equal(sameAnalysisSource(source, { ...source, branch: "release" }), false);
});

test("Native Analysis recovers a lost source write on the original Resource without another push", t => {
  const f = fixture(t, true, true);
  f.env.MOCK_FAIL_METADATA_KEY = "analysis.source";
  assert.equal(f.complete().exit, 3);
  const published = git(f.remote, "rev-parse", "dev");
  assert.equal(f.state().metadata["analysis.source"], undefined);
  delete f.env.MOCK_FAIL_METADATA_KEY;
  const recovered = f.complete();
  assert.equal(recovered.exit, 0, JSON.stringify(recovered));
  assert.equal(git(f.remote, "rev-parse", "dev"), published);
  assert.equal(JSON.parse(f.state().metadata["analysis.source"]).commit, published);
});

test("Current Facts replace stale analysis fields; validate is read-only and complete clears old Review", t => {
  const f = fixture(t);
  const old = f.state();
  old.metadata["analysis.change_ref"] = "stale-change";
  old.metadata["analysis.verify_agent.focus_refs"] = JSON.stringify(["./missing.md"]);
  old.metadata["analysis.ai_review.verdict"] = "APPROVED";
  f.setState(old);
  assert.equal(f.gate().exit, 0);
  assert.deepEqual(f.state(), old);
  const result = f.complete();
  assert.equal(result.exit, 0, JSON.stringify(result));
  assert.equal(f.state().metadata["analysis.change_ref"], CHANGE);
  assert.equal(f.state().metadata["analysis.ai_review.verdict"], undefined);
  assert.deepEqual(result.body.analysis_source, JSON.parse(f.state().metadata["analysis.source"]));
  assert.equal(f.complete().exit, 0);
});

test("Partial Facts write failure can resume without Stage", t => {
  const f = fixture(t);
  const old = f.state();
  old.metadata = { "tfs.type": old.metadata["tfs.type"], "tfs.id": old.metadata["tfs.id"] };
  f.setState(old);
  f.env.MOCK_FAIL_METADATA_KEY = "analysis.verify_agent.reason";
  assert.notEqual(f.complete().exit, 0);
  assert.equal(f.state().status, "in_progress");
  delete f.env.MOCK_FAIL_METADATA_KEY;
  const result = f.complete();
  assert.equal(result.exit, 0, JSON.stringify(result));
  assert.equal(f.state().status, "analysis_review");
});


test("返工 Facts 写入失败时旧 Gate PASS 不得继续生效", t => {
  const f = fixture(t);
  assert.equal(f.complete().exit, 0);
  const prior = f.state();
  prior.status = "in_progress";
  f.setState(prior);
  writeFileSync(f.factsPath, JSON.stringify({ ...FACTS, verify_agent: { ...FACTS.verify_agent, reason: "本轮复核后的新依据" } }));
  f.env.MOCK_FAIL_METADATA_KEY = "analysis.verify_agent.reason";
  assert.notEqual(f.complete().exit, 0);
  assert.equal(f.state().metadata["analysis.gate.result"], undefined);
  assert.equal(f.state().status, "in_progress");
  delete f.env.MOCK_FAIL_METADATA_KEY;
  assert.equal(f.complete().exit, 0);
  assert.equal(f.state().metadata["analysis.gate.result"], "PASS");
  assert.equal(f.state().metadata["analysis.verify_agent.reason"], "本轮复核后的新依据");
});

test("重复任务引用在最终 Gate 被拒绝，未发布审核", t => {
  const f = fixture(t);
  writeFileSync(join(f.change, "tasks.md"), "- [ ] 1.1 A\n- [ ] 1.1 B\n");
  const result = f.complete();
  assert.equal(result.exit, 2, JSON.stringify(result));
  assert.match(result.body.reason, /重复/);
  assert.equal(f.state().metadata["analysis.source"], undefined);
});


test("invalid professional Facts never reach Gate or write metadata", t => {
  const f = fixture(t);
  const before = f.state();
  writeFileSync(f.factsPath, JSON.stringify({ ...FACTS, verify_agent: { ...FACTS.verify_agent, focus_refs: [] } }));
  assert.equal(f.gate().exit, 2);
  assert.equal(f.complete().exit, 2);
  assert.deepEqual(f.state(), before);
});


test("Gate PASS 写入失败不切换审核，恢复复用固定来源", t => {
  const f = fixture(t);
  f.env.MOCK_FAIL_METADATA_KEY = "analysis.gate.result";
  assert.notEqual(f.complete().exit, 0);
  assert.equal(f.state().status, "in_progress");
  assert.equal(f.state().metadata["analysis.gate.result"], undefined);
  const source = f.state().metadata["analysis.source"];
  assert.ok(source);
  delete f.env.MOCK_FAIL_METADATA_KEY;
  f.tfs.update(s => { s.requests = []; });
  const replay = f.complete();
  assert.equal(replay.exit, 0, JSON.stringify(replay));
  assert.equal(f.state().metadata["analysis.source"], source);
  assert.equal(f.tfs.state().requests.filter(r => r.query.scopePath).length, 1);
});

test("远端契约读取仅消费必要工件及明确引用", t => {
  const f = fixture(t);
  mkdirSync(join(f.change, "logs"));
  writeFileSync(join(f.change, "logs", "debug.txt"), "unreferenced");
  git(f.root, "add", "openspec/changes/" + CHANGE);
  git(f.root, "commit", "-m", "add unreferenced log");
  const result = f.complete();
  assert.equal(result.exit, 0, JSON.stringify(result));
  const paths = f.tfs.state().requests.map(r => r.query.path).filter(Boolean);
  assert.ok(paths.some(path => path.endsWith("/proposal.md")));
  assert.ok(!paths.some(path => path.endsWith("/logs/debug.txt")));
});
