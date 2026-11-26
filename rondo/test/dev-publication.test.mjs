import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { analysisTfsFixture } from "./analysis-tfs-fixture.mjs";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const multica = fileURLToPath(new URL("./mock-multica.cjs", import.meta.url));
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function fixture(t, { previousTasks, approvedTasks = "- [ ] 1.1 Verify\n", design, secondChange = false } = {}) {
  const work = "openspec/changes/alpha";
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rondo-dev-publication-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bare = join(dir, "remote.git"), root = join(dir, "engineer"), analyst = join(dir, "analyst");
  git(dir, "init", "--bare", bare);
  git(dir, "init", "-b", "integration", root);
  const tfs = analysisTfsFixture(t, dir, { remote: bare }, { requirementOrigin: true });
  const identify = repo => {
    git(repo, "config", "user.name", "Test");
    git(repo, "config", "user.email", "test@example.invalid");
  };
  identify(root);
  mkdirSync(join(root, "docs", "config"), { recursive: true });
  const bizUrl = tfs.repoUrl.replace(/[^/]+$/, "biz");
  writeFileSync(join(root, "docs/config/repo-context.yaml"), [
    "repos:", "  - repo_id: root", "    repo_path: .", "    repo_url: " + tfs.repoUrl,
    "  - repo_id: biz", "    repo_path: biz", "    repo_url: " + bizUrl,
    "    tfs_project: P", "    default_target_branch: integration", "",
  ].join("\n"));
  writeFileSync(join(root, "AGENTS.md"), "# Fixture\n");
  writeFileSync(join(root, ".gitignore"), "biz/\nbiz-42/\n");
  mkdirSync(join(root, "openspec", "schemas"), { recursive: true });
  writeFileSync(join(root, "openspec/schemas/.keep"), "");
  if (previousTasks) {
    mkdirSync(join(root, work), { recursive: true });
    writeFileSync(join(root, work, "tasks.md"), previousTasks);
  }
  git(root, "add", ".");
  git(root, "commit", "-m", "base");
  git(root, "remote", "add", "origin", bare);
  git(root, "push", "-u", "origin", "integration");
  git(dir, "clone", "-b", "integration", bare, analyst);
  identify(analyst);

  mkdirSync(join(analyst, work), { recursive: true });
  const proposal = "# Proposal\n";
  writeFileSync(join(analyst, work, "tasks.md"), approvedTasks);
  if (design) writeFileSync(join(analyst, work, "design.md"), design);
  writeFileSync(join(analyst, work, "proposal.md"), proposal);
  writeFileSync(join(analyst, work, ".openspec.yaml"), "schema: intentional-change\nx-repositories:\n  - biz\n");
  if (secondChange) {
    const other = "openspec/changes/beta";
    mkdirSync(join(analyst, other), { recursive: true });
    writeFileSync(join(analyst, other, ".openspec.yaml"), "schema: intentional-change\nx-repositories:\n  - biz\n");
    git(analyst, "add", other);
  }
  git(analyst, "add", work);
  git(analyst, "commit", "-m", "analysis");
  git(analyst, "push");
  const approved = git(analyst, "rev-parse", "HEAD");
  const source = { repo_url: tfs.repoUrl, branch: "integration", change_ref: "alpha", commit: approved };
  const state = join(dir, "state.json"), config = join(dir, "config.json");
  writeFileSync(config, JSON.stringify({ runtime: { multica_cli: multica, workspace_id: "ws" }, registry: { biz: {} } }));
  writeFileSync(state, JSON.stringify({
    agents: { engineer: { name: "Engineer" } }, comments: { "issue-1": [{ id: "ok" }] },
    runs: { "issue-1": [{ id: "run", issue_id: "issue-1", agent_id: "engineer", workspace_id: "ws", status: "running" }] },
    metadata: { "tfs.type": "需求", "tfs.id": "42", "analysis.gate.result": "PASS",
      "analysis.source": JSON.stringify(source), "analysis.human_approval": JSON.stringify({ decision: "approved",
        by: "reviewer", at: "2026-11-19T00:00:00Z", comment_ref: "ok", verify_agent_required: false, source }) },
  }));
  const env = { ...process.env, ...tfs.env, MOCK_STATE: state, MULTICA_TASK_ID: "run", MULTICA_AGENT_ID: "engineer",
    MULTICA_CLI_PATH: multica, MULTICA_SERVER_URL: "http://multica.test", MULTICA_WORKSPACE_ID: "ws", MULTICA_TOKEN: "fixture", MULTICA_DAEMON_PORT: "1234",
    RONDO_WORKSPACE_PATH: root, RONDO_WORKSPACE_BRANCH: "integration" };
  function runWithEnv(expected, extraEnv, ...args) {
    const proc = spawnSync(process.execPath, [cli, ...args, "--issue", "WNDF-T"], { cwd: dir, env: { ...env, ...extraEnv }, encoding: "utf8" });
    assert.equal(proc.status, expected, proc.stdout + "\n" + proc.stderr);
    return JSON.parse(proc.stdout);
  }
  const run = (expected, ...args) => runWithEnv(expected, {}, ...args);
  const publish = (expected, ...options) => run(expected, "dev", "publish", ...options);
  const metadata = () => JSON.parse(readFileSync(state, "utf8")).metadata;
  return { root, bare, analyst, work, approved, proposal, source, state, metadata, run, runWithEnv, publish, bizUrl, tfs };
}

test("Engineer 从批准 SHA 读取缺失工件，在分叉的常驻根仓独立发布并登记研发 SHA", t => {
  const { root, bare, work, approved, proposal, source, metadata, run, publish, tfs, state } = fixture(t);
  const fetched = run(0, "analysis", "read", "--file", "tasks.md");
  assert.equal(fetched.source.commit, approved);
  mkdirSync(join(root, work), { recursive: true });
  writeFileSync(join(root, work, "tasks.md"), fetched.content.replace("[ ]", "[x]"));
  writeFileSync(join(root, "shared.txt"), "local only");
  git(root, "add", ".");
  git(root, "commit", "-m", "local mixed work");
  const local = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, work, "tasks.md"), "uncommitted draft");
  const published = publish(0);
  assert.notEqual(published.commit, approved);
  assert.notEqual(published.commit, local);
  assert.equal(git(bare, "show", published.commit + ":" + work + "/proposal.md"), proposal.trim());
  assert.equal(git(bare, "diff", "--name-only", approved, published.commit), work + "/tasks.md");
  assert.equal(git(bare, "show", published.commit + ":" + work + "/tasks.md"), "- [x] 1.1 Verify");
  assert.equal(git(root, "rev-parse", "HEAD"), local);
  assert.equal(readFileSync(join(root, work, "tasks.md"), "utf8"), "uncommitted draft");
  assert.deepEqual(JSON.parse(metadata()["dev.publication"]), { analysis_source: source, commit: published.commit });
  assert.equal(metadata()["analysis.source"], JSON.stringify(source));
  assert.ok(tfs.state().requests.every(request => request.query["versionDescriptor.version"] === approved),
    "Git 发布后不得重复通过 REST 读取研发 SHA");
  const saved = readFileSync(state, "utf8");
  const legacy = JSON.parse(saved);
  legacy.metadata["dev.publication"] = JSON.stringify({ analysis_commit: approved, commit: published.commit });
  writeFileSync(state, JSON.stringify(legacy));
  assert.match(publish(3).reason, /dev\.publication.*Analysis Source/);
  assert.equal(git(bare, "rev-parse", "integration"), published.commit);
  assert.equal(metadata()["dev.publication"], legacy.metadata["dev.publication"]);
  writeFileSync(state, saved);

  writeFileSync(join(root, work, "tasks.md"), "- [x] 1.1 Different semantics\n");
  git(root, "commit", "-am", "out of approval");
  assert.match(publish(2).reason, /tasks\.md/);
  assert.equal(git(bare, "rev-parse", "integration"), published.commit);
  assert.equal(JSON.parse(metadata()["dev.publication"]).commit, published.commit);

  writeFileSync(join(root, work, "tasks.md"), "- [x] 1.1 Verify\n");
  writeFileSync(join(root, work, "evidence-biz.json"), '{"result":"PASS"}\n');
  git(root, "add", work);
  git(root, "commit", "-m", "include validation evidence");
  const rejectedEvidence = publish(2);
  assert.match(rejectedEvidence.reason, /evidence-biz\.json|研发工件|允许/);
  // The forbidden Evidence file does not generate a new publication receipt.
  assert.equal(git(bare, "rev-parse", "integration"), published.commit);
  assert.deepEqual(JSON.parse(metadata()["dev.publication"]), { analysis_source: source, commit: published.commit });
});

test("本机仍有旧 Tasks 时，依据批准编号与正文勾选并保留远端另一项进度", t => {
  const previousTasks = "- [ ] 1.1 Old task\n";
  const approvedTasks = "- [ ] 2.1 Approved task\n- [ ] 2.2 Another approved task\n";
  const { root, bare, work, approved, analyst, run, publish, metadata, source } = fixture(t, { previousTasks, approvedTasks });
  writeFileSync(join(analyst, work, "tasks.md"), approvedTasks.replace("[ ] 2.2 ", "[x] 2.2 "));
  git(analyst, "commit", "-am", "concurrent progress on another task");
  git(analyst, "push");
  const advanced = git(analyst, "rev-parse", "HEAD");
  assert.equal(readFileSync(join(root, work, "tasks.md"), "utf8"), previousTasks);
  const task = run(0, "analysis", "read", "--file", "tasks.md");
  assert.equal(task.source.commit, approved);
  assert.equal(task.content, approvedTasks);
  writeFileSync(join(root, work, "tasks.md"), task.content.replace("[ ] 2.1 ", "[x] 2.1 "));
  git(root, "commit", "-am", "mark completed approved task");
  const delivered = publish(0).commit;
  assert.equal(git(bare, "rev-parse", delivered + "^"), advanced);
  assert.equal(git(bare, "show", delivered + ":" + work + "/tasks.md"),
    approvedTasks.replace("[ ] 2.1 ", "[x] 2.1 ").replace("[ ] 2.2 ", "[x] 2.2 ").trim());
  const receipt = { analysis_source: source, commit: delivered };
  assert.deepEqual(JSON.parse(metadata()["dev.publication"]), receipt);

  // The shared local base has 2.1 checked; the remote has additionally checked adjacent 2.2.
  // A local reversal is not a new checkmark that can be folded into the remote progress.
  writeFileSync(join(root, work, "tasks.md"), approvedTasks);
  git(root, "commit", "-am", "reverse check 2.1");
  const reversal = publish(2);
  assert.match(reversal.reason, /冲突.*tasks\.md/);
  assert.equal(git(bare, "rev-parse", "integration"), delivered);
  assert.equal(git(root, "show", "HEAD:" + work + "/tasks.md"), approvedTasks.trim());

  git(analyst, "pull", "--ff-only");
  const remoteEdit = git(analyst, "show", "HEAD:" + work + "/tasks.md").replace("2.1 Approved task", "2.1 Remote wording") + "\n";
  writeFileSync(join(analyst, work, "tasks.md"), remoteEdit);
  git(analyst, "commit", "-am", "remote revises wording");
  git(analyst, "push");
  const remoteHead = git(analyst, "rev-parse", "HEAD");
  writeFileSync(join(root, work, "tasks.md"), approvedTasks.replace("2.1 Approved task", "2.1 Local wording"));
  git(root, "commit", "-am", "local revises same wording");
  const conflict = publish(2);
  assert.match(conflict.reason, /冲突.*tasks\.md/);
  assert.match(conflict.reason, /Remote wording/);
  assert.match(conflict.reason, /Local wording/);
  assert.equal(git(bare, "rev-parse", "integration"), remoteHead);
  assert.match(git(root, "show", "HEAD:" + work + "/tasks.md"), /Local wording/);
  assert.deepEqual(JSON.parse(metadata()["dev.publication"]), receipt);
});

test("Design 细化仍受批准版本约束，Evidence JSON 不再参与发布", t => {
  const design = "Use the defined validation order.\n";
  const refined = design + "Validate required fields before optional fields.\n";
  const { root, analyst, bare, work, approved, source, publish, state, metadata } = fixture(t, { design });
  git(root, "pull", "--ff-only", bare, "integration");
  writeFileSync(join(root, work, "design.md"), refined);
  git(root, "commit", "-am", "clarify validation order");
  const first = publish(0, "--minor-design").commit;
  assert.equal(git(bare, "show", first + ":" + work + "/design.md"), refined.trim());
  writeFileSync(join(root, work, "evidence-biz.json"), '{"passed":true}\n');
  git(root, "add", work);
  git(root, "commit", "-m", "add evidence only");
  const rejected = publish(2);
  assert.match(rejected.reason, /evidence-biz\.json|研发工件|允许/);
  const second = first;
  assert.deepEqual(JSON.parse(metadata()["dev.publication"]), { analysis_source: source, commit: first });
  // Isolate the next rejection from the previously rejected Evidence file.
  git(root, "rm", work + "/evidence-biz.json");
  git(root, "commit", "-m", "remove forbidden evidence");

  writeFileSync(join(root, work, "design.md"), refined + "Additional unconfirmed detail.\n");
  git(root, "commit", "-am", "different design");
  assert.match(publish(2).reason, /design\.md/);
  assert.equal(git(bare, "rev-parse", "integration"), second);

  // A new approval resets Design to its specified text. The old delivery receipt persists on the Issue.
  git(analyst, "pull", "--ff-only");
  writeFileSync(join(analyst, work, "design.md"), design);
  git(analyst, "commit", "-am", "new analysis approval");
  git(analyst, "push");
  const nextSource = { ...source, commit: git(analyst, "rev-parse", "HEAD") };
  const issueState = JSON.parse(readFileSync(state, "utf8"));
  const human = JSON.parse(issueState.metadata["analysis.human_approval"]);
  issueState.metadata["analysis.source"] = JSON.stringify(nextSource);
  issueState.metadata["analysis.human_approval"] = JSON.stringify({ ...human, source: nextSource });
  writeFileSync(state, JSON.stringify(issueState));
  git(root, "branch", "-m", "before-reapproval");
  git(root, "fetch", bare, "integration");
  git(root, "switch", "-c", "integration", "FETCH_HEAD");
  writeFileSync(join(root, work, "design.md"), refined);
  git(root, "commit", "-am", "reuse previously confirmed design");
  assert.match(publish(2).reason, /design\.md/);
  assert.equal(git(bare, "rev-parse", "integration"), nextSource.commit);
  assert.deepEqual(JSON.parse(metadata()["dev.publication"]), { analysis_source: source, commit: second });
});

test("同一批准来源的旧工作树不能覆盖更新的研发发布回执", t => {
  const { root, bare, analyst, work, source, metadata, publish } = fixture(t, {
    approvedTasks: "- [ ] 1.1 Build\n- [ ] 1.2 Verify\n",
  });
  git(root, "pull", "--ff-only", bare, "integration");
  writeFileSync(join(root, work, "tasks.md"), "- [x] 1.1 Build\n- [ ] 1.2 Verify\n");
  git(root, "commit", "-am", "complete first task");
  const first = publish(0).commit;
  git(analyst, "pull", "--ff-only");
  writeFileSync(join(analyst, work, "tasks.md"), "- [x] 1.1 Build\n- [x] 1.2 Verify\n");
  git(analyst, "commit", "-am", "complete remaining task");
  const latest = publish(0, "--root-repo", analyst).commit;
  assert.notEqual(latest, first);
  const receipt = { analysis_source: source, commit: latest };
  assert.deepEqual(JSON.parse(metadata()["dev.publication"]), receipt);
  assert.match(publish(3).reason, /防止旧回执覆盖较新的研发交付/);
  assert.equal(git(bare, "rev-parse", "integration"), latest);
  assert.deepEqual(JSON.parse(metadata()["dev.publication"]), receipt);
});

function drift(read, patch) {
  return { MOCK_METADATA_ON_ISSUE_READ: String(read), MOCK_ISSUE_METADATA_PATCH: JSON.stringify(patch) };
}

test("dev publish 拒绝来源不一致及读取期间批准变化；Push 后变化不登记回执", t => {
  const { root, bare, approved, source, state, metadata, runWithEnv, work } = fixture(t, { secondChange: true });
  const initial = readFileSync(state, "utf8");
  const approval = JSON.parse(metadata()["analysis.human_approval"]);
  const other = { ...source, change_ref: "beta" };
  const otherChange = { "analysis.source": JSON.stringify(other),
    "analysis.human_approval": JSON.stringify({ ...approval, source: other }) };
  git(root, "pull", "--ff-only", bare, "integration");
  writeFileSync(join(root, work, "tasks.md"), "- [x] 1.1 Verify\n");
  git(root, "commit", "-am", "complete approved task");
  for (const [patch, reason] of [
    [{ "analysis.source": JSON.stringify(other) }, /Change 身份.*不一致/],
    [otherChange, /批准来源在读取映射期间变化/],
    [{ "analysis.human_approval": JSON.stringify({ ...approval, at: "2026-11-20T00:00:00Z" }) }, /批准来源在读取映射期间变化/],
  ]) {
    writeFileSync(state, initial);
    assert.match(runWithEnv(3, drift(2, patch), "dev", "publish").reason, reason);
    assert.equal(git(bare, "rev-parse", "integration"), approved);
    assert.equal(metadata()["dev.publication"], undefined);
  }
  writeFileSync(state, initial);
  assert.match(runWithEnv(3, drift(3, otherChange), "dev", "publish").reason, /发布期间批准来源发生变化/);
  assert.notEqual(git(bare, "rev-parse", "integration"), approved);
  assert.equal(metadata()["dev.publication"], undefined);
});

test("Native Requirement Git 操作从 Issue 取得批准 Change，拒绝同 SHA 的其他 Change 和批准变化", t => {
  const { root, bare, source, state, metadata, runWithEnv, bizUrl } = fixture(t, { secondChange: true });
  const dir = dirname(root), hub = join(dir, "biz"), remote = join(dir, "biz.git");
  const taskId = "01234567-abcd-ef12-3456-000000000000";
  const branch = "agent/engineer/abcdef123456";
  git(root, "pull", "--ff-only", bare, "integration");
  git(root, "branch", "-m", branch);
  git(root, "config", "multica.checkout-mode", "isolated");
  mkdirSync(join(dir, ".multica"), { recursive: true });
  writeFileSync(join(dir, ".multica", "daemon_task_context.json"), JSON.stringify({
    managed_by: "multica-daemon-task", issue_id: "issue-1", agent_id: "engineer",
  }));
  git(dir, "init", "--bare", remote);
  git(dir, "init", "-b", "integration", hub);
  writeFileSync(join(hub, "code.txt"), "fixture");
  git(hub, "add", ".");
  git(hub, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture");
  git(hub, "push", remote, "HEAD:refs/heads/integration", "HEAD:refs/heads/feature/42");
  git(hub, "remote", "add", "origin", bizUrl);
  git(hub, "branch", "-m", branch);
  git(hub, "config", "multica.checkout-mode", "isolated");
  const initial = JSON.parse(readFileSync(state, "utf8"));
  initial.runs["issue-1"][0].id = taskId;
  const approval = JSON.parse(initial.metadata["analysis.human_approval"]);
  const other = { ...source, change_ref: "beta" };
  const env = { MULTICA_TASK_ID: taskId, MOCK_GIT_BUSINESS_REMOTE: remote, MOCK_GIT_BUSINESS_URL: bizUrl,
    MOCK_SYNC_CALLS_FILE: join(dir, "git-calls.jsonl") };
  const args = ["dev", "git", "--operation", "fetch", "--repo", "biz", "--root-repo", root];
  for (const [patch, reason] of [
    [{ "analysis.source": JSON.stringify(other) }, /Change 身份.*不一致/],
    [{ "analysis.source": JSON.stringify(other),
      "analysis.human_approval": JSON.stringify({ ...approval, source: other }) }, /批准来源.*变化/],
    [{ "analysis.human_approval": JSON.stringify({ ...approval, at: "2026-11-20T00:00:00Z" }) }, /批准来源在授权期间变化/],
  ]) {
    writeFileSync(state, JSON.stringify(initial));
    writeFileSync(env.MOCK_SYNC_CALLS_FILE, "");
    assert.match(runWithEnv(3, { ...env, ...drift(2, patch) }, ...args).reason, reason);
    const calls = readFileSync(env.MOCK_SYNC_CALLS_FILE, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    assert.ok(!calls.some(call => call.includes("checkout") || (call.includes("metadata") && call.includes("set"))));
    assert.equal(metadata()["verify_agent.required"], undefined);
  }
  writeFileSync(state, JSON.stringify(initial));
  const fetched = runWithEnv(0, env, ...args);
  assert.equal(fetched.result, "PASS");
  assert.equal(fetched.path, hub);
  assert.equal(fetched.branch, "feature/42");
  assert.deepEqual(metadata(), initial.metadata);
  assert.equal(metadata()["verify_agent.required"], undefined);
});

test("Native Requirement 续跑使用原根仓分支发布已提交 Tasks，保留本地 WIP", t => {
  const { root, bare, work, source, state, metadata, runWithEnv } = fixture(t);
  const dir = dirname(root), branch = "agent/engineer/abcdef123456";
  const taskId = "01234567-abcd-ef12-3456-000000000000";
  git(root, "pull", "--ff-only", bare, "integration");
  git(root, "branch", "-m", branch);
  git(root, "config", "multica.checkout-mode", "isolated");
  mkdirSync(join(dir, ".multica"), { recursive: true });
  writeFileSync(join(dir, ".multica", "daemon_task_context.json"), JSON.stringify({
    managed_by: "multica-daemon-task", issue_id: "issue-1", agent_id: "engineer",
  }));
  const current = JSON.parse(readFileSync(state, "utf8"));
  current.runs["issue-1"][0].id = taskId;
  writeFileSync(state, JSON.stringify(current));
  writeFileSync(join(root, work, "tasks.md"), "- [x] 1.1 Verify\n");
  git(root, "commit", "-am", "complete approved task");
  const local = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, "local.txt"), "keep");
  const published = runWithEnv(0, { MULTICA_TASK_ID: taskId }, "dev", "publish", "--root-repo", root);
  assert.equal(git(root, "branch", "--show-current"), branch);
  assert.equal(git(root, "rev-parse", "HEAD"), local);
  assert.equal(readFileSync(join(root, "local.txt"), "utf8"), "keep");
  assert.equal(git(bare, "show", published.commit + ":" + work + "/tasks.md"), "- [x] 1.1 Verify");
  assert.deepEqual(JSON.parse(metadata()["dev.publication"]), { analysis_source: source, commit: published.commit });
});
