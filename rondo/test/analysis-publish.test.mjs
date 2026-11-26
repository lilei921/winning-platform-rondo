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
const CHANGE = "c-test-261056";
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
function fixture(t, requirement = true, native = false, commitChange = true) {
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
  };
  const statePath = join(home, "state.json");
  writeFileSync(statePath, JSON.stringify({ status: "in_progress", metadata }));

  const tfs = analysisTfsFixture(t, home, { remote }, { requirementOrigin: requirement });
  {
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
  if (commitChange) {
    git(root, "add", "openspec/changes/" + CHANGE);
    git(root, "-c", "user.email=test@example.invalid", "-c", "user.name=Test", "commit", "-m", "reviewed Change contract");
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
    ...(requirement ? { RONDO_WORKSPACE_BRANCH: "dev" } : {}),
    ...(native ? { RONDO_WORKSPACE_BRANCH: "", RONDO_WORKSPACE_PATH: "", MULTICA_TASK_ID: taskId,
      MULTICA_WORKSPACE_ID: "ws-test", MULTICA_AGENT_ID: "analyst" } : {}) };
  const args = ["--issue", "issue-1", "--openspec-root", root,
    "--workspace-id", "ws-test", "--registry-config", config, "--multica", MOCK];
  const gate = (ref = CHANGE) => runCli(["analysis", "validate", "--change-ref", ref, ...args], env);
  const completeAt = (rootArg, cwd, ...extra) => runCli(["analysis", "publish",
    "--issue", "issue-1", "--change-ref", CHANGE,
    "--workspace-id", "ws-test", "--registry-config", config, "--multica", MOCK,
    "--root-repo", rootArg, ...extra], env, cwd);
  const complete = (...extra) => completeAt(root, undefined, ...extra);
  const state = () => JSON.parse(readFileSync(statePath, "utf8"));
  const setState = data => writeFileSync(statePath, JSON.stringify(data));
  return { home, root, change, remote, report, tfs, env, gate, complete, completeAt, state, setState, metadata, taskBranch, resourcePath };
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
  f.tfs.update(s => { s.requests = []; s.status = 503; });
  const calls = join(f.home, "publish-calls.jsonl");
  f.env.MOCK_SYNC_CALLS_FILE = calls;
  const result = f.complete();
  assert.equal(result.exit, 0, JSON.stringify(result));
  assert.deepEqual(f.tfs.state().requests, []);
  const commands = readFileSync(calls, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(commands.filter(a => a.includes("issue") && a.includes("get")).length, 5);
  assert.equal(commands.filter(a => a.includes("metadata") && a.includes("list")).length, 0);
  const source = JSON.parse(f.state().metadata["analysis.source"]);
  assert.deepEqual(result.body.analysis_source, source);
  assert.equal(source.commit, git(f.remote, "rev-parse", "dev"));
  assert.equal(git(f.remote, "show", source.commit + ":openspec/changes/" + CHANGE + "/proposal.md"), PROPOSAL.trim());
  assert.equal(f.state().metadata["analysis.gate.result"], "PASS");
  assert.equal(f.state().metadata["analysis.change_kind"], "corrective");
  assert.equal(f.state().metadata["analysis.verify_agent.recommendation"], undefined);
  assert.equal(f.state().metadata["analysis.ai_review.verdict"], undefined);
  assert.equal(f.state().status, "analysis_review");
  assert.equal(f.state().comments?.["issue-1"]?.length ?? 0, 0);
  assert.equal(existsSync(join(f.change, "logs", "analysis-gate-result.json")), false);
  assert.equal(existsSync(join(f.change, "analysis-handoff.json")), false);
});

test("Native Requirement publishes a new uncommitted Change and preserves unrelated WIP", t => {
  const f = fixture(t, true, true, false);
  const prefix = "openspec/changes/" + CHANGE;
  const sibling = join(f.root, "openspec", "changes", "other");
  mkdirSync(sibling, { recursive: true });
  writeFileSync(join(sibling, "proposal.md"), "unrelated staged");
  git(f.root, "add", "openspec/changes/other/proposal.md");
  writeFileSync(join(sibling, "proposal.md"), "unrelated working");
  writeFileSync(join(f.root, "local.txt"), "unrelated untracked");
  writeFileSync(join(f.change, "scratch.txt"), "unrelated temporary");
  writeFileSync(join(f.change, "notes.txt"), "unrelated staged");
  git(f.root, "add", prefix + "/notes.txt");
  writeFileSync(join(f.change, "notes.txt"), "unrelated working");
  const result = f.complete();
  assert.equal(result.exit, 0, JSON.stringify(result));
  const local = git(f.root, "rev-parse", "HEAD");
  assert.deepEqual(git(f.root, "diff-tree", "--no-commit-id", "--name-only", "-r", local).split("\n").sort(),
    [prefix + "/.openspec.yaml", prefix + "/proposal.md", prefix + "/tasks.md"].sort());
  assert.equal(git(f.root, "show", ":openspec/changes/other/proposal.md"), "unrelated staged");
  assert.equal(readFileSync(join(sibling, "proposal.md"), "utf8"), "unrelated working");
  assert.equal(readFileSync(join(f.root, "local.txt"), "utf8"), "unrelated untracked");
  assert.equal(readFileSync(join(f.change, "scratch.txt"), "utf8"), "unrelated temporary");
  assert.equal(git(f.root, "show", ":" + prefix + "/notes.txt"), "unrelated staged");
  assert.equal(readFileSync(join(f.change, "notes.txt"), "utf8"), "unrelated working");
  assert.equal(git(f.remote, "ls-tree", "-r", "--name-only", "dev", prefix + "/scratch.txt", prefix + "/notes.txt"), "");
  assert.equal(git(f.remote, "show", result.body.analysis_source.commit + ":" + prefix + "/proposal.md"), PROPOSAL.trim());
  assert.equal(git(f.remote, "ls-tree", "-r", "--name-only", "dev", "openspec/changes/other", "local.txt"), "");
  assert.equal(f.complete().exit, 0);
  assert.equal(git(f.root, "rev-parse", "HEAD"), local);
});

test("Requirement saves uncommitted edits to an existing Change before publishing", t => {
  const f = fixture(t);
  const previous = git(f.root, "rev-parse", "HEAD");
  const revised = PROPOSAL.replace("restore behavior", "restore detailed behavior");
  writeFileSync(join(f.change, "proposal.md"), revised);
  const result = f.complete();
  assert.equal(result.exit, 0, JSON.stringify(result));
  assert.notEqual(git(f.root, "rev-parse", "HEAD"), previous);
  assert.equal(git(f.remote, "show", result.body.analysis_source.commit + ":openspec/changes/" + CHANGE + "/proposal.md"), revised.trim());
});

test("Failed Gate leaves a new Change uncommitted; committed unauthorized artifacts cannot be published", t => {
  const f = fixture(t, true, true, false);
  const local = git(f.root, "rev-parse", "HEAD");
  const remote = git(f.remote, "rev-parse", "dev");
  writeFileSync(join(f.change, "tasks.md"), "no task checkbox\n");
  assert.equal(f.complete().exit, 2);
  assert.equal(git(f.root, "rev-parse", "HEAD"), local);
  writeFileSync(join(f.change, "tasks.md"), "- [ ] 1.1 Fix and 验证 regression\n");
  writeFileSync(join(f.change, "scratch.txt"), "not an analysis artifact");
  git(f.root, "add", "openspec/changes/" + CHANGE);
  git(f.root, "commit", "-m", "unauthorized committed artifact");
  const committed = git(f.root, "rev-parse", "HEAD");
  const forbidden = f.complete();
  assert.equal(forbidden.exit, 2, JSON.stringify(forbidden));
  assert.match(forbidden.body.reason, /不允许发布/);
  assert.equal(git(f.root, "rev-parse", "HEAD"), committed);
  assert.equal(git(f.remote, "rev-parse", "dev"), remote);
  assert.equal(f.state().metadata["analysis.source"], undefined);
  assert.equal(f.state().status, "in_progress");
});

test("Requirement publishes deletion of a no-longer-needed optional design, staged or unstaged", async t => {
  for (const staged of [false, true]) await t.test(staged ? "staged" : "unstaged", t => {
    const f = fixture(t);
    const path = "openspec/changes/" + CHANGE + "/design.md";
    writeFileSync(join(f.change, "design.md"), "# Design\n");
    git(f.root, "add", path);
    git(f.root, "commit", "-m", "existing design");
    git(f.root, "push", "origin", "dev");
    if (staged) git(f.root, "rm", path);
    else rmSync(join(f.change, "design.md"));
    const result = f.complete();
    assert.equal(result.exit, 0, JSON.stringify(result));
    assert.equal(git(f.root, "diff-tree", "--no-commit-id", "--name-status", "-r", "HEAD"), "D\t" + path);
    assert.equal(git(f.remote, "ls-tree", "-r", "--name-only", "dev", path), "");
  });
});

test("Requirement preserves the local commit when remote Push fails and reuses it on retry", t => {
  const f = fixture(t, true, false, false);
  const hook = join(f.remote, "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\nexit 1\n");
  chmodSync(hook, 0o755);
  const before = git(f.root, "rev-parse", "HEAD");
  const remote = git(f.remote, "rev-parse", "dev");
  const failed = f.complete();
  assert.equal(failed.exit, 3, JSON.stringify(failed));
  assert.match(failed.body.reason, /Push 未确认/);
  const saved = git(f.root, "rev-parse", "HEAD");
  assert.notEqual(saved, before);
  assert.equal(git(f.remote, "rev-parse", "dev"), remote);
  assert.equal(f.state().metadata["analysis.source"], undefined);
  rmSync(hook);
  const retry = f.complete();
  assert.equal(retry.exit, 0, JSON.stringify(retry));
  assert.equal(git(f.root, "rev-parse", "HEAD"), saved);
});

test("Requirement does not stage or commit during an ongoing Git operation", t => {
  const f = fixture(t, true, false, false);
  const before = git(f.root, "rev-parse", "HEAD");
  const marker = join(f.root, ".git", "CHERRY_PICK_HEAD");
  writeFileSync(marker, before + "\n");
  const index = git(f.root, "ls-files", "--stage");
  const blocked = f.complete();
  assert.equal(blocked.exit, 3, JSON.stringify(blocked));
  assert.match(blocked.body.reason, /Git 操作仍在进行/);
  assert.equal(git(f.root, "rev-parse", "HEAD"), before);
  assert.equal(git(f.root, "ls-files", "--stage"), index);
  assert.equal(readFileSync(marker, "utf8"), before + "\n");
});

test("Repository Scope accepts repo_id strings, not objects; diagnostics show the valid format", t => {
  const f = fixture(t, true, false, false);
  const local = git(f.root, "rev-parse", "HEAD");
  writeFileSync(join(f.change, ".openspec.yaml"), "schema: corrective-change\nx-repositories:\n  - repo_id: root\n");
  const invalid = f.complete();
  assert.equal(invalid.exit, 2, JSON.stringify(invalid));
  assert.match(invalid.body.reason, /x-repositories: \[dataintegration\]/);
  assert.equal(git(f.root, "rev-parse", "HEAD"), local);
  writeFileSync(join(f.change, ".openspec.yaml"), "schema: corrective-change\nx-repositories:\n  - root\n");
  assert.equal(f.complete().exit, 0);
});

test("Analysis Gate refuses a Change belonging to another TFS Work Item before any publication", t => {
  const f = fixture(t, true, false, false);
  const state = f.state();
  state.metadata["tfs.id"] = "26105";
  f.setState(state);
  const local = git(f.root, "rev-parse", "HEAD");
  const remote = git(f.remote, "rev-parse", "dev");
  const preview = f.gate();
  assert.equal(preview.exit, 2);
  assert.match(preview.body.reasons.join(" "), /change_ref=.*tfs.id=/);
  assert.ok(!preview.body.checks.some(c => c.name === "openspec_validate"));
  const publish = f.complete();
  assert.equal(publish.exit, 2);
  assert.match(publish.body.reason, /change_ref=.*tfs.id=/);
  assert.equal(git(f.root, "rev-parse", "HEAD"), local);
  assert.equal(git(f.remote, "rev-parse", "dev"), remote);
  assert.deepEqual(f.state(), state);
});

test("Analysis Gate refuses unregistered Repository Scope before any publication", t => {
  const f = fixture(t, true, false, false);
  writeFileSync(join(f.change, ".openspec.yaml"), "schema: corrective-change\nx-repositories: [root, nonexistent-repo]\n");
  const state = f.state();
  const local = git(f.root, "rev-parse", "HEAD");
  const remote = git(f.remote, "rev-parse", "dev");
  const preview = f.gate();
  assert.equal(preview.exit, 2);
  assert.match(preview.body.reasons.join(" "), /未登记的 repo_id: nonexistent-repo/);
  assert.ok(!preview.body.checks.some(c => c.name === "openspec_validate"));
  const publish = f.complete();
  assert.equal(publish.exit, 2);
  assert.match(publish.body.reason, /未登记的 repo_id: nonexistent-repo/);
  assert.equal(git(f.root, "rev-parse", "HEAD"), local);
  assert.equal(git(f.remote, "rev-parse", "dev"), remote);
  assert.deepEqual(f.state(), state);
});

test("Requirement rejects a scope absent from the final Git candidate despite a valid local mapping", t => {
  const f = fixture(t, true, false, false);
  const mapping = join(f.root, "docs", "config", "repo-context.yaml");
  writeFileSync(mapping, readFileSync(mapping, "utf8") + "  - repo_id: frame\n");
  writeFileSync(join(f.change, ".openspec.yaml"), "schema: corrective-change\nx-repositories: [frame]\n");
  const state = f.state();
  const remote = git(f.remote, "rev-parse", "dev");
  assert.equal(f.gate().exit, 0);
  const publish = f.complete();
  assert.equal(publish.exit, 2, JSON.stringify(publish));
  assert.match(publish.body.reason, /未登记的 repo_id: frame/);
  assert.equal(git(f.remote, "rev-parse", "dev"), remote);
  assert.deepEqual(f.state(), state);
});

test("Requirement fixed source recovery checks scope in that commit, not the working tree", t => {
  const f = fixture(t, true, false, false);
  writeFileSync(join(f.change, ".openspec.yaml"), "schema: corrective-change\nx-repositories: [frame]\n");
  git(f.root, "add", "openspec/changes/" + CHANGE);
  git(f.root, "commit", "-m", "previous incomplete publication");
  git(f.root, "push", "origin", "dev");
  const remote = git(f.remote, "rev-parse", "dev");
  const state = f.state();
  state.metadata["analysis.source"] = JSON.stringify({
    repo_url: f.tfs.repoUrl, branch: "dev", commit: remote, change_ref: CHANGE,
  });
  f.setState(state);
  const mapping = join(f.root, "docs", "config", "repo-context.yaml");
  writeFileSync(mapping, readFileSync(mapping, "utf8") + "  - repo_id: frame\n");
  assert.equal(f.gate().exit, 0);
  const publish = f.complete();
  assert.equal(publish.exit, 2, JSON.stringify(publish));
  assert.match(publish.body.reason, /未登记的 repo_id: frame/);
  assert.equal(git(f.remote, "rev-parse", "dev"), remote);
  assert.deepEqual(f.state(), state);
});

test("旧 metadata PASS 不能绕过最终真实 Gate", t => {
  const f = fixture(t);
  const st = f.state(); st.metadata["analysis.gate.result"] = "PASS"; f.setState(st);
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
  writeFileSync(join(f.root, ".git", "info", "attributes"), "openspec/changes/" + CHANGE + "/proposal.md filter=review-test\n");
  git(f.root, "config", "filter.review-test.clean", "sed s/APPROVED/REWRITTEN/g");
  const remote = git(f.remote, "rev-parse", "dev");
  const result = f.complete();
  assert.notEqual(result.exit, 0);
  assert.match(result.body.reason, /候选发布版本.*不一致/);
  assert.equal(git(f.remote, "rev-parse", "dev"), remote);
  assert.equal(f.state().metadata["analysis.source"], undefined);
});

test("Human Review 重放只消费已登记固定来源，不读取 REST 正文或追随 HEAD", t => {
  const f = fixture(t);
  assert.equal(f.complete().exit, 0);
  const saved = f.state().metadata["analysis.source"];
  f.tfs.update(s => { s.requests = []; s.status = 503; });
  git(f.root, "-c", "user.email=test@example.invalid", "-c", "user.name=Test", "commit", "--allow-empty", "-m", "unrelated HEAD");
  writeFileSync(join(f.change, "proposal.md"), "local WIP unrelated to approved review");
  const replay = f.complete();
  assert.equal(replay.exit, 0, JSON.stringify(replay));
  assert.equal(f.state().metadata["analysis.source"], saved);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.gate_reexecuted, false);
  assert.deepEqual(f.tfs.state().requests, []);
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

test("Legacy Publish 拒绝相对 RONDO_WORKSPACE_PATH，即使 cwd 是合法根仓", t => {
  const f = fixture(t, false);
  f.env.RONDO_WORKSPACE_PATH = ".";
  const result = runCli(["analysis", "publish", "--issue", "issue-1",
    "--change-ref", CHANGE, "--workspace-id", "ws-test", "--registry-config", join(f.home, "registry.json"),
    "--multica", MOCK], f.env, f.root);
  assert.equal(result.exit, 3, JSON.stringify(result));
  assert.match(result.body.reason, /绝对路径.*RONDO_WORKSPACE_PATH/);
  assert.equal(f.state().metadata["analysis.source"], undefined);
});

test("Requirement 根据 tfs.type 自动发布，旧 mode 不得覆盖来源类型", t => {
  const f = fixture(t);
  const before = f.state();
  const remote = git(f.remote, "rev-parse", "dev");
  for (const flags of [["--mode", "legacy"], ["--mode", "unknown"], ["--mode"]]) {
    const blocked = f.complete(...flags);
    assert.equal(blocked.exit, 2, JSON.stringify(blocked));
    assert.match(blocked.body.reason, /--mode.*tfs.type/);
    assert.deepEqual(f.state(), before);
    assert.equal(git(f.remote, "rev-parse", "dev"), remote);
  }
  const result = f.complete();
  assert.equal(result.exit, 0, JSON.stringify(result));
  assert.equal(f.state().status, "analysis_review");
  const replay = f.complete("--mode", "requirement");
  assert.equal(replay.exit, 0, JSON.stringify(replay));
  assert.equal(replay.body.replayed, true);
});

test("Bug 不得借旧 mode 参数进入 Requirement 发布路径", t => {
  const f = fixture(t, false);
  const before = f.state();
  const blocked = f.complete("--mode", "requirement");
  assert.equal(blocked.exit, 2, JSON.stringify(blocked));
  assert.match(blocked.body.reason, /--mode.*tfs.type/);
  assert.deepEqual(f.state(), before);
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
  const result = f.completeAt(".", f.root);
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
  writeFileSync(join(f.change, "proposal.md"), PROPOSAL.replace("restore behavior", "revised behavior"));
  const local = git(f.root, "rev-parse", "HEAD");
  const index = git(f.root, "ls-files", "--stage");
  const mismatch = f.complete();
  assert.notEqual(mismatch.exit, 0);
  assert.match(mismatch.body.reason, /初始基线/);
  assert.equal(git(f.root, "rev-parse", "HEAD"), local);
  assert.equal(git(f.root, "ls-files", "--stage"), index);
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

test("Current Change replaces stale identity; historical advice is ignored, validate is read-only", t => {
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
  assert.equal(f.state().metadata["analysis.change_kind"], "corrective");
  assert.equal(f.state().metadata["analysis.ai_review.verdict"], "APPROVED");
  assert.deepEqual(result.body.analysis_source, JSON.parse(f.state().metadata["analysis.source"]));
  assert.equal(f.complete().exit, 0);
});

test("Partial Facts write failure can resume without Stage", t => {
  const f = fixture(t);
  const old = f.state();
  old.metadata = { "tfs.type": old.metadata["tfs.type"], "tfs.id": old.metadata["tfs.id"] };
  f.setState(old);
  f.env.MOCK_FAIL_METADATA_KEY = "analysis.change_kind";
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
  writeFileSync(join(f.change, "proposal.md"), PROPOSAL + "\nRevised contract\n");
  git(f.root, "add", "openspec/changes/" + CHANGE);
  git(f.root, "-c", "user.email=test@example.invalid", "-c", "user.name=Test", "commit", "-m", "rework");
  f.env.MOCK_FAIL_METADATA_KEY = "analysis.source";
  assert.notEqual(f.complete().exit, 0);
  assert.equal(f.state().metadata["analysis.gate.result"], undefined);
  assert.equal(f.state().status, "in_progress");
  delete f.env.MOCK_FAIL_METADATA_KEY;
  assert.equal(f.complete().exit, 0);
  assert.equal(f.state().metadata["analysis.gate.result"], "PASS");
  assert.notEqual(f.state().metadata["analysis.source"], prior.metadata["analysis.source"]);
});

test("重复任务引用在最终 Gate 被拒绝，未发布审核", t => {
  const f = fixture(t);
  writeFileSync(join(f.change, "tasks.md"), "- [ ] 1.1 A\n- [ ] 1.1 B\n");
  const result = f.complete();
  assert.equal(result.exit, 2, JSON.stringify(result));
  assert.match(result.body.reason, /重复/);
  assert.equal(f.state().metadata["analysis.source"], undefined);
});


test("invalid Change ID never publishes or writes metadata", t => {
  const f = fixture(t);
  const before = f.state();
  assert.equal(f.gate("../invalid").exit, 2);
  const result = runCli(["analysis", "publish", "--issue", "issue-1", "--change-ref", "../invalid",
    "--workspace-id", "ws-test", "--registry-config", join(f.home, "registry.json"), "--multica", MOCK,
    "--root-repo", f.root, "--mode", "requirement"], f.env);
  assert.equal(result.exit, 2);
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
  f.tfs.update(s => { s.requests = []; s.status = 503; });
  const replay = f.complete();
  assert.equal(replay.exit, 0, JSON.stringify(replay));
  assert.equal(f.state().metadata["analysis.source"], source);
  assert.deepEqual(f.tfs.state().requests, []);
});

test("Requirement 发布在 REST 正文不可用时仍以 Git 候选和可达性完成", t => {
  const f = fixture(t);
  mkdirSync(join(f.change, "logs"));
  writeFileSync(join(f.change, "logs", "debug.txt"), "unreferenced");
  git(f.root, "add", "openspec/changes/" + CHANGE);
  git(f.root, "commit", "-m", "seed remote contract with historical unreferenced log");
  // This log already exists remotely; normal publication must not introduce unauthorized files.
  git(f.root, "push", "origin", "dev");
  assert.equal(git(f.remote, "show", "dev:openspec/changes/" + CHANGE + "/logs/debug.txt"), "unreferenced");
  f.tfs.update(s => { s.requests = []; s.status = 503; });
  const result = f.complete();
  assert.equal(result.exit, 0, JSON.stringify(result));
  assert.equal(f.state().status, "analysis_review");
  assert.equal(result.body.analysis_source.commit, git(f.remote, "rev-parse", "dev"));
  assert.deepEqual(f.tfs.state().requests, []);
});

test("固定来源不再位于目标分支时拒绝恢复，不调用 REST 正文", t => {
  const f = fixture(t);
  f.env.MOCK_FAIL_STATUS = "1";
  assert.equal(f.complete().exit, 3);
  const saved = JSON.parse(f.state().metadata["analysis.source"]);
  const parent = git(f.remote, "rev-parse", saved.commit + "^");
  git(f.remote, "update-ref", "refs/heads/dev", parent);
  delete f.env.MOCK_FAIL_STATUS;
  f.tfs.update(s => { s.requests = []; s.status = 503; });
  const result = f.complete();
  assert.notEqual(result.exit, 0);
  assert.match(result.body.reason, /不在原目标分支/);
  assert.equal(f.state().status, "in_progress");
  assert.equal(JSON.parse(f.state().metadata["analysis.source"]).commit, saved.commit);
  assert.deepEqual(f.tfs.state().requests, []);
});

test("Git 发布后 Issue 已被阻塞时不登记审核事实", t => {
  const f = fixture(t);
  f.env.MOCK_STATUS_ON_ISSUE_READ = "2";
  const result = f.complete();
  assert.notEqual(result.exit, 0, JSON.stringify(result));
  assert.equal(f.state().status, "blocked");
  assert.equal(f.state().metadata["analysis.source"], undefined);
  assert.equal(f.state().metadata["analysis.gate.result"], undefined);
});

test("本地硬条件失败时不执行 OpenSpec Strict Validation", t => {
  const f = fixture(t);
  // 如果错误地调用原生 CLI，它会返回不可解析结果（UNKNOWN）。
  writeFileSync(f.report, "not-json");
  writeFileSync(join(f.change, "tasks.md"), "no task checkbox\n");
  const result = f.gate();
  assert.equal(result.exit, 2, JSON.stringify(result));
  assert.equal(result.body.checks.find(c => c.name === "tasks")?.result, "FAIL");
  assert.ok(!result.body.checks.some(c => c.name === "openspec_validate" || c.name === "verify_recommendation"));
});

test("Git 发布后并发 Source 或 Facts 变化时不覆盖现有事实", async t => {
  for (const [key, value] of [
    ["analysis.source", JSON.stringify({ repo_url: "http://tfs.test/tfs/C/P/_git/root", branch: "dev", commit: "a".repeat(40), change_ref: CHANGE })],
    ["tfs.id", "999999"],
    ["analysis.change_kind", "intentional"],
  ]) {
    await t.test(key, t => {
      const f = fixture(t);
      f.env.MOCK_METADATA_ON_ISSUE_READ = "2";
      f.env.MOCK_ISSUE_METADATA_PATCH = JSON.stringify({ [key]: value });
      const result = f.complete();
      assert.notEqual(result.exit, 0, JSON.stringify(result));
      assert.equal(f.state().metadata[key], value);
      assert.equal(f.state().metadata["analysis.gate.result"], undefined);
      assert.equal(f.state().status, "in_progress");
      if (key !== "analysis.source") assert.equal(f.state().metadata["analysis.source"], undefined);
    });
  }
});

test("审核 Facts 写入后出现不一致时不得登记 Gate PASS", t => {
  const f = fixture(t);
  f.env.MOCK_METADATA_ON_ISSUE_READ = "3";
  f.env.MOCK_ISSUE_METADATA_PATCH = JSON.stringify({ "analysis.change_kind": "" });
  const result = f.complete();
  assert.notEqual(result.exit, 0, JSON.stringify(result));
  assert.equal(f.state().metadata["analysis.change_kind"], "");
  assert.equal(f.state().metadata["analysis.gate.result"], undefined);
  assert.equal(f.state().status, "in_progress");
});

test("Change Schema 无法确认时不产生依赖检查的派生 FAIL", t => {
  const f = fixture(t);
  rmSync(join(f.change, ".openspec.yaml"));
  const result = f.gate();
  assert.equal(result.exit, 3, JSON.stringify(result));
  assert.equal(result.body.checks.find(c => c.name === "change")?.result, "UNKNOWN");
  assert.ok(!result.body.checks.some(c => ["tasks", "ai_review", "acceptance_contract", "openspec_validate"].includes(c.name)));
});

test("已知独立硬条件 FAIL 优先于其他检查 UNKNOWN", t => {
  const f = fixture(t);
  rmSync(join(f.change, ".openspec.yaml"));
  const state = f.state();
  delete state.metadata["tfs.id"];
  f.setState(state);
  const result = f.gate();
  assert.equal(result.exit, 2, JSON.stringify(result));
  assert.equal(result.body.checks.find(c => c.name === "identity")?.result, "FAIL");
  assert.equal(result.body.checks.find(c => c.name === "change")?.result, "UNKNOWN");
});

test("Intentional 发布与审核重放无需自报 Review Verdict", t => {
  const f = fixture(t);
  writeFileSync(join(f.change, ".openspec.yaml"), "schema: intentional-change\nx-repositories: [root]\n");
  mkdirSync(join(f.change, "specs", "feature"), { recursive: true });
  writeFileSync(join(f.change, "specs", "feature", "spec.md"), "## ADDED Requirements\n### Requirement: Feature\nThe system SHALL support feature.\n#### Scenario: Success\n- **WHEN** invoked\n- **THEN** succeeds\n");
  git(f.root, "add", "openspec/changes/" + CHANGE);
  git(f.root, "commit", "-m", "intentional contract");
  const gate = f.gate();
  assert.equal(gate.exit, 0, JSON.stringify(gate));
  assert.equal(gate.body.change_kind, "intentional");
  assert.ok(!gate.body.checks.some(c => c.name === "ai_review"));
  const result = f.complete();
  assert.equal(result.exit, 0, JSON.stringify(result));
  assert.equal(f.state().metadata["analysis.change_kind"], "intentional");
  assert.equal(f.state().metadata["analysis.ai_review.verdict"], undefined);
  assert.equal(f.complete().body.replayed, true);
});

test("显式 --root-repo 缺值或为空时不回退环境变量", t => {
  const f = fixture(t);
  const args = ["analysis", "publish", "--mode", "requirement", "--issue", "issue-1",
    "--change-ref", CHANGE, "--workspace-id", "ws-test", "--registry-config", join(f.home, "registry.json"),
    "--multica", MOCK];
  for (const flags of [["--root-repo"], ["--root-repo", ""], ["--root-repo", "--target-branch", "dev"]]) {
    const r = spawnSync(process.execPath, [CLI, ...args, ...flags], { encoding: "utf8", cwd: f.root,
      env: { ...process.env, ...f.env, RONDO_WORKSPACE_PATH: f.root } });
    assert.equal(r.status, 64, r.stderr);
    assert.match(r.stderr, /--root-repo/);
    assert.equal(f.state().metadata["analysis.source"], undefined);
  }
});
