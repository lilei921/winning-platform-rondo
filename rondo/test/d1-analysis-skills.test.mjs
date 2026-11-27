import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
  const r = run(["openspec", "resolve-identity", "--openspec-root", root, "--change-ref", "stale-1234",
    "--tfs-id", "1234", "--expect-schema", "intentional-change"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.body.result, "ACTIVE_FOUND");
  assert.equal(r.body.change_ref, "feature-1234");
  assert.equal(r.body.schema, "intentional-change");

  // Without the source identity, a stale ref cannot recover the existing Change.
  const noTfs = run(["openspec", "resolve-identity", "--openspec-root", root,
    "--change-ref", "stale-1234", "--expect-schema", "intentional-change"]);
  assert.equal(noTfs.code, 0);
  assert.equal(noTfs.body.result, "NOT_FOUND");
});

test("D1 identity: duplicate, archived, wrong Schema and unknown remain safe", (t) => {
  const root = fixture(t);
  change(root, "a-1234");
  change(root, "b-1234");
  const conflict = run(["openspec", "resolve-identity", "--openspec-root", root, "--tfs-id", "1234"]);
  assert.equal(conflict.code, 2);
  assert.equal(conflict.body.result, "CONFLICT");

  const archivedRoot = fixture(t);
  change(archivedRoot, "2026-11-06-old-2222", "corrective-change", true);
  const archived = run(["openspec", "resolve-identity", "--openspec-root", archivedRoot, "--tfs-id", "2222"]);
  assert.equal(archived.code, 0);
  assert.equal(archived.body.result, "ARCHIVED_FOUND");

  const wrong = run(["openspec", "resolve-identity", "--openspec-root", root, "--change-ref", "a-1234",
    "--expect-schema", "corrective-change"]);
  assert.equal(wrong.code, 2);
  assert.equal(wrong.body.result, "INVALID");

  const missing = run(["openspec", "resolve-identity", "--openspec-root", root, "--tfs-id", "9999"]);
  assert.equal(missing.code, 0);
  assert.equal(missing.body.result, "NOT_FOUND");
});

test("D1 workspace sync needs no repository mapping or generated Registry", t => {
  const root = join(fixture(t), "中文 工作区");
  const shared = join(root, "workspace-config");
  mkdirSync(join(shared, "workspaces"), { recursive: true });
  for (const name of ["analysis-publish", "native-workspace"]) mkdirSync(join(root, "skills", name), { recursive: true });
  writeFileSync(join(shared, "workspaces", "d1pilot.json"), JSON.stringify({
    workspace_id: "ws-pilot", multica_profile: "private", multica_server_url: "https://private.example",
    skills: { "analysis-publish": "skill-id", "native-workspace": "workspace-skill-id" },
  }));
  for (const name of ["analysis-publish", "native-workspace"]) {
    const result = run(["workspace", "sync-skills", "--workspace", "d1pilot", "--skill", name, "--dry-run"], { MULTICA_REPO_ROOT: root });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.body.mode, "dry-run");
    assert.equal(existsSync(join(root, "skills", name, "config", "repo-registry.json")), false);
  }
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
    "x-repositories", "winning-dps-df-dataintegration",
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
  assert.match(publish, /rondo openspec submit-review --issue/);
  assert.ok(!publish.includes("--mode requirement"), "source type is resolved by CLI");
  assert.match(publish, /无需手工 Git Add、Commit、Push 或例行预校验/);
  assert.match(FRONT("bug-analysis"), /替代根因/);
});
