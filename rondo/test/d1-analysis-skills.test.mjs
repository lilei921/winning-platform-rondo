import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const SKILLS = fileURLToPath(new URL("../../skills/", import.meta.url));
const FRONT = (name) => readFileSync(join(SKILLS, name, "SKILL.md"), "utf8");

function fixture(t) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "rondo-d1-skill-")));
  t.after(() => {
    assert.equal(dirname(dir), realpathSync.native(tmpdir()));
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function run(args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", env: { ...process.env, ...env },
  });
  assert.equal(r.error, undefined, r.error?.message);
  let body;
  try { body = JSON.parse(r.stdout); } catch { assert.fail("invalid JSON: " + r.stdout + "\n" + r.stderr); }
  return { code: r.status, body, stderr: r.stderr };
}

function change(root, name, schema = "intentional-change", archive = false) {
  const dir = join(root, "openspec", "changes", ...(archive ? ["archive"] : []), name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".openspec.yaml"), "schema: " + schema + "\n");
  return dir;
}

test("D1 identity: stale change_ref + tfs.id reuses the existing active Change", (t) => {
  const root = fixture(t);
  change(root, "feature-1234");
  const r = run(["change", "resolve-identity", "--openspec-root", root, "--change-ref", "stale-1234",
    "--tfs-id", "1234", "--expect-schema", "intentional-change"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.body.result, "ACTIVE_FOUND");
  assert.equal(r.body.change_ref, "feature-1234");
  assert.equal(r.body.schema, "intentional-change");

  // Without the source identity, a stale ref cannot recover the existing Change.
  const noTfs = run(["change", "resolve-identity", "--openspec-root", root,
    "--change-ref", "stale-1234", "--expect-schema", "intentional-change"]);
  assert.equal(noTfs.code, 0);
  assert.equal(noTfs.body.result, "NOT_FOUND");
});

test("D1 identity: duplicate, archived, wrong Schema and unknown remain safe", (t) => {
  const root = fixture(t);
  change(root, "a-1234");
  change(root, "b-1234");
  const conflict = run(["change", "resolve-identity", "--openspec-root", root, "--tfs-id", "1234"]);
  assert.equal(conflict.code, 2);
  assert.equal(conflict.body.result, "CONFLICT");

  const archivedRoot = fixture(t);
  change(archivedRoot, "2026-11-06-old-2222", "corrective-change", true);
  const archived = run(["change", "resolve-identity", "--openspec-root", archivedRoot, "--tfs-id", "2222"]);
  assert.equal(archived.code, 0);
  assert.equal(archived.body.result, "ARCHIVED_FOUND");

  const wrong = run(["change", "resolve-identity", "--openspec-root", root, "--change-ref", "a-1234",
    "--expect-schema", "corrective-change"]);
  assert.equal(wrong.code, 2);
  assert.equal(wrong.body.result, "INVALID");

  const missing = run(["change", "resolve-identity", "--openspec-root", root, "--tfs-id", "9999"]);
  assert.equal(missing.code, 0);
  assert.equal(missing.body.result, "NOT_FOUND");
});

test("D1 workspace sync renders spec-preparation config in dry-run and local-only modes", (t) => {
  const root = fixture(t);
  const shared = join(root, "projects", "multica", "skills", "_shared");
  const skill = join(root, "projects", "multica", "skills", "spec-preparation");
  const workspaceSkill = join(root, "projects", "multica", "skills", "workspace-preparation");
  const tools = join(root, "tools");
  const docs = join(root, "docs", "config");
  mkdirSync(join(shared, "workspaces"), { recursive: true });
  mkdirSync(skill, { recursive: true });
  mkdirSync(workspaceSkill, { recursive: true });
  mkdirSync(tools, { recursive: true });
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(docs, "repo-context.yaml"), "# fixture\n");
  writeFileSync(join(tools, "repo_registry.py"), [
    "import json",
    "print(json.dumps({'contract_version':'repo-registry-result/v1','operation':'list','status':'ok','errors':[],",
    "'repos':[{'repo_id':'root','repo_type':'root-workspace','repo_path':'.','responsibility':'root',",
    "'keywords':[],'not_responsible_for':[]},",
    "{'repo_id':'app','repo_type':'application','repo_path':'app','repo_url':'http://tfs.test/tfs/C/P/_git/app','responsibility':'business',",
    "'keywords':[],'not_responsible_for':[]}] }))",
  ].join("\n") + "\n");
  writeFileSync(join(shared, "repo-registry.base.json"), JSON.stringify({
    runtime: { multica_cli: "multica", rondo: "rondo" },
    delivery: { app: { tfs_repo: "app", default_target_branch: "main" } },
  }));
  writeFileSync(join(shared, "workspaces", "d1pilot.json"), JSON.stringify({
    workspace_id: "ws-pilot", delivery_squad_id: "squad-pilot",
    multica_profile: "private", multica_server_url: "https://private.example",
    skills: { "spec-preparation": "skill-id", "workspace-preparation": "workspace-skill-id" },
  }));
  const env = { MULTICA_REPO_ROOT: root };
  const localConfig = join(skill, "config", "repo-registry.json");
  const preview = run(["workspace", "sync", "--workspace", "d1pilot", "--skill", "spec-preparation", "--dry-run"], env);
  assert.equal(preview.code, 0, preview.stderr);
  assert.equal(preview.body.result, "PASS");
  assert.ok(preview.body.rendered.includes("spec-preparation/config/repo-registry.json"));
  assert.equal(existsSync(localConfig), false, "dry-run must not write config");

  const rendered = run(["workspace", "sync", "--workspace", "d1pilot", "--skill", "spec-preparation", "--local-only"], env);
  assert.equal(rendered.code, 0, rendered.stderr);
  const cfg = JSON.parse(readFileSync(localConfig, "utf8"));
  assert.equal(cfg.runtime.workspace_id, "ws-pilot");
  assert.equal(cfg.runtime.delivery_squad_id, "squad-pilot");
  assert.equal(cfg.runtime.multica_profile, "private");
  assert.equal(cfg.runtime.multica_server_url, "https://private.example");
  assert.equal(cfg.registry.app.repo_path, "app");
  assert.equal(cfg.registry.app.repo_url, "http://tfs.test/tfs/C/P/_git/app");

  const workspaceRendered = run(["workspace", "sync", "--workspace", "d1pilot", "--skill", "workspace-preparation", "--local-only"], env);
  assert.equal(workspaceRendered.code, 0, workspaceRendered.stderr);
  assert.ok(workspaceRendered.body.rendered.includes("workspace-preparation/config/repo-registry.json"));
  assert.deepEqual(JSON.parse(readFileSync(join(workspaceSkill, "config", "repo-registry.json"), "utf8")), cfg);
});

test("D1 workspace sync refuses missing squad identity rather than writing fallback registry", (t) => {
  const root = fixture(t);
  const shared = join(root, "projects", "multica", "skills", "_shared");
  mkdirSync(join(shared, "workspaces"), { recursive: true });
  mkdirSync(join(root, "projects", "multica", "skills", "spec-preparation"), { recursive: true });
  writeFileSync(join(shared, "workspaces", "badpilot.json"), JSON.stringify({
    workspace_id: "ws-pilot", skills: { "spec-preparation": "skill-id" },
  }));
  const r = run(["workspace", "sync", "--workspace", "badpilot", "--skill", "spec-preparation", "--dry-run"],
    { MULTICA_REPO_ROOT: root });
  assert.equal(r.code, 3);
  assert.equal(r.body.result, "UNKNOWN");
  assert.match(r.body.reason, /delivery_squad_id/);
});

test("D2 skill contracts: retire legacy without deletion and bind composable Analyst methods", () => {
  const manifest = JSON.parse(readFileSync(join(SKILLS, "_shared", "provisioning.json"), "utf8"));
  const analyst = manifest.agents.find((a) => a.name === "Workitem Analyst");
  assert.deepEqual(analyst.skills, [
    "codebase-explorer", "bug-analysis", "requirement-analysis", "spec-preparation",
    "analysis-completion", "workspace-preparation",
  ]);
  assert.equal(manifest.managed_skills.includes("workitem-analysis"), false);
  assert.ok(manifest.agents.every((agent) => !(agent.skills ?? []).includes("workitem-analysis")));
  for (const name of ["bug-analysis", "requirement-analysis", "spec-preparation"]) {
    assert.ok(manifest.managed_skills.includes(name));
    assert.ok(analyst.skills.includes(name));
  }
  assert.ok(existsSync(join(SKILLS, "workitem-analysis", "SKILL.md")), "retired Skill must be retained");
  // 旧文件无需文字标记；是否参与执行由上面的受管清单和实际 Agent 绑定决定。
  assert.deepEqual(
    manifest.agents.find((agent) => agent.name === "Wayfinder Agent").skills,
    ["workitem-triage", "codebase-explorer"],
  );
  const spec = FRONT("spec-preparation");
  for (const expected of [
    "config/repo-registry.json", "runtime.workspace_id", "workspace-preparation", "root_repo",
    "--tfs-id <tfs.id>", "--change-ref <stable-id>", "同时传入",
    "cwd", "openspec schema which", "implicit", "Root",
    "--type change --strict --no-interactive --json", "Conditional Design", "skip_specs", "specs/**/*.md",
  ]) assert.ok(spec.includes(expected), "spec-preparation missing: " + expected);
  assert.ok(!spec.includes("新建并绑定 Agent"));
  const canonical = readFileSync(join(SKILLS, "spec-preparation", "references", "tasks-md-authoring-contract.md"), "utf8");
  const legacy = readFileSync(join(SKILLS, "workitem-analysis", "references", "tasks-md-authoring-contract.md"), "utf8");
  // D3-B：现行工程 Task 写法已不包含 TFS 工时约束；Retired 历史契约只用于追溯，
  // 不允许因修改权威 Reference 而同步覆写旧快照。
  assert.match(canonical, /工程 Task/);
  assert.match(canonical, /不强制.*预估/);
  assert.match(canonical, /不因 TFS 任务数量、6h 上限/);
  assert.match(legacy, /任务预估时长/);
  assert.notEqual(canonical, legacy);
  const review = readFileSync(join(SKILLS, "spec-preparation", "references", "contract-consistency-review.md"), "utf8");
  assert.ok(!review.includes("Workitem Analyst"));
  assert.ok(!review.includes("ai_review.verdict"));
  assert.match(FRONT("bug-analysis"), /替代根因/);
});
