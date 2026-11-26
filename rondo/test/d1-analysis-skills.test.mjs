import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const SKILLS = fileURLToPath(new URL("../../skills/", import.meta.url));
const ARCHIVED_SKILLS = fileURLToPath(new URL("../../archive/skills-2026-11-24/", import.meta.url));
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

test("D1 workspace sync renders analysis-publish config in dry-run and local-only modes", (t) => {
  const root = join(fixture(t), "中文 工作区");
  const shared = join(root, "workspace-config");
  const skill = join(root, "skills", "analysis-publish");
  const workspaceSkill = join(root, "skills", "native-workspace");
  const tools = join(root, "tools");
  const docs = join(root, "docs", "config");
  mkdirSync(join(shared, "workspaces"), { recursive: true });
  mkdirSync(skill, { recursive: true });
  mkdirSync(workspaceSkill, { recursive: true });
  mkdirSync(tools, { recursive: true });
  mkdirSync(docs, { recursive: true });
  // 使用真实的 registry 查询工具，验证独立仓库的 Python → Rondo 渲染链路。
  writeFileSync(join(docs, "repo-context.yaml"), JSON.stringify({ repos: [
    { repo_id: "root", repo_type: "root-workspace", repo_path: ".", responsibility: "root", keywords: [], not_responsible_for: [] },
    { repo_id: "app", repo_type: "backend", repo_path: "业务 应用", repo_url: "http://tfs.test/tfs/C/P/_git/app", default_target_branch: "main", responsibility: "业务应用", keywords: [], not_responsible_for: [] },
  ] }));
  copyFileSync(new URL("../../tools/repo_registry.py", import.meta.url), join(tools, "repo_registry.py"));
  writeFileSync(join(shared, "repo-registry.base.json"), JSON.stringify({
    runtime: { multica_cli: "multica", rondo: "rondo" },
    delivery: { app: { tfs_repo: "app" } },
  }));
  writeFileSync(join(shared, "workspaces", "d1pilot.json"), JSON.stringify({
    workspace_id: "ws-pilot",
    multica_profile: "private", multica_server_url: "https://private.example",
    skills: { "analysis-publish": "skill-id", "native-workspace": "workspace-skill-id" },
  }));
  const env = { MULTICA_REPO_ROOT: root, PYTHONUTF8: "0", PYTHONIOENCODING: "cp936" };
  const localConfig = join(skill, "config", "repo-registry.json");
  const preview = run(["workspace", "sync", "--workspace", "d1pilot", "--skill", "analysis-publish", "--dry-run"], env);
  assert.equal(preview.code, 0, preview.stderr);
  assert.equal(preview.body.result, "PASS");
  assert.ok(preview.body.rendered.includes("analysis-publish/config/repo-registry.json"));
  assert.equal(existsSync(localConfig), false, "dry-run must not write config");

  const rendered = run(["workspace", "sync", "--workspace", "d1pilot", "--skill", "analysis-publish", "--local-only"], env);
  assert.equal(rendered.code, 0, rendered.stderr);
  const cfg = JSON.parse(readFileSync(localConfig, "utf8"));
  assert.equal(cfg.runtime.workspace_id, "ws-pilot");
  assert.equal(cfg.runtime.delivery_squad_id, undefined);
  assert.equal(cfg.registry.app.default_target_branch, "main");
  assert.equal(cfg.runtime.multica_profile, "private");
  assert.equal(cfg.runtime.multica_server_url, "https://private.example");
  assert.equal(cfg.registry.app.repo_path, "业务 应用");
  assert.equal(cfg.registry.app.repo_url, "http://tfs.test/tfs/C/P/_git/app");

  const workspaceRendered = run(["workspace", "sync", "--workspace", "d1pilot", "--skill", "native-workspace", "--local-only"], env);
  assert.equal(workspaceRendered.code, 0, workspaceRendered.stderr);
  assert.deepEqual(workspaceRendered.body.rendered, []);
  assert.equal(existsSync(join(workspaceSkill, "config", "repo-registry.json")), false);
});

test("D1 workspace sync refuses missing registry base rather than guessing a registry", (t) => {
  const root = fixture(t);
  const shared = join(root, "workspace-config");
  mkdirSync(join(shared, "workspaces"), { recursive: true });
  mkdirSync(join(root, "skills", "analysis-publish"), { recursive: true });
  writeFileSync(join(shared, "workspaces", "badpilot.json"), JSON.stringify({
    workspace_id: "ws-pilot", skills: { "analysis-publish": "skill-id" },
  }));
  const r = run(["workspace", "sync", "--workspace", "badpilot", "--skill", "analysis-publish", "--dry-run"],
    { MULTICA_REPO_ROOT: root });
  assert.equal(r.code, 3);
  assert.equal(r.body.result, "UNKNOWN");
  assert.match(r.body.reason, /repo-registry base 不存在/);
});

test("D2 skill contracts: archive legacy and bind composable Analyst methods", () => {
  const manifest = JSON.parse(readFileSync(join(SKILLS, "..", "workspace-config", "provisioning.json"), "utf8"));
  const analyst = manifest.agents.find((a) => a.name === "Workitem Analyst");
  assert.deepEqual(analyst.skills, [
    "codebase-explorer", "bug-analysis", "requirement-analysis", "spec-preparation",
    "analysis-publish", "native-workspace",
  ]);
  assert.equal(manifest.managed_skills.includes("workitem-analysis"), false);
  assert.ok(manifest.agents.every((agent) => !(agent.skills ?? []).includes("workitem-analysis")));
  for (const name of ["bug-analysis", "requirement-analysis", "spec-preparation"]) {
    assert.ok(manifest.managed_skills.includes(name));
    assert.ok(analyst.skills.includes(name));
  }
  assert.equal(existsSync(join(SKILLS, "workitem-analysis", "SKILL.md")), false, "retired Skill must leave the active directory");
  assert.ok(existsSync(join(ARCHIVED_SKILLS, "workitem-analysis", "SKILL.md")), "retired Skill must be archived");
  // 归档旧文件无需文字标记；是否参与执行由上面的受管清单和实际 Agent 绑定决定。
  assert.deepEqual(
    manifest.agents.find((agent) => agent.name === "Wayfinder Agent").skills,
    ["codebase-explorer"],
  );
  const spec = FRONT("spec-preparation");
  for (const expected of [
    "root_repo",
    "--tfs-id <tfs.id>", "--change-ref <stable-id>", "同时传入",
    "cwd", "openspec schema which", "implicit",
    "openspec status", "openspec instructions", "openspec new change", "Conditional Design", "skip_specs", "specs/**/*.md",
    "x-repositories", "docs/config/repo-context.yaml",
  ]) assert.ok(spec.includes(expected), "spec-preparation missing: " + expected);
  assert.ok(!spec.includes("新建并绑定 Agent"));
  assert.ok(!spec.includes("config/repo-registry.json"), "spec preparation commands do not consume registry config");
  assert.ok(!existsSync(join(SKILLS, "spec-preparation", "config", "repo-registry.json")), "unused registry attachment must not be shipped");
  assert.equal(manifest.managed_skills.includes("workitem-triage"), false);
  assert.ok(manifest.agents.every(agent => !(agent.skills ?? []).includes("workitem-triage")));
  assert.equal(existsSync(join(SKILLS, "workitem-triage", "SKILL.md")), false);
  // Current Schema / Artifact Instructions own authoring rules, not an archived Skill reference.
  assert.ok(!existsSync(join(SKILLS, "spec-preparation", "references", "tasks-md-authoring-contract.md")));
  assert.ok(existsSync(join(ARCHIVED_SKILLS, "workitem-analysis", "references", "tasks-md-authoring-contract.md")));
  assert.match(spec, /当前 Artifact Instruction \/ Template/);
  const publish = FRONT("analysis-publish");
  assert.match(publish, /rondo analysis publish --issue/);
  assert.ok(!publish.includes("--mode requirement"), "source type is resolved by CLI");
  assert.match(publish, /无需手工 Git Add、Commit、Push 或例行预校验/);
  assert.match(FRONT("bug-analysis"), /替代根因/);
});
