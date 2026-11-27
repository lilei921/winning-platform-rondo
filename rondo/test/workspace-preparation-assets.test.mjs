import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const multica = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(multica, path), "utf8");
const skills = JSON.parse(read("workspace-config/provisioning.json"));

test("native-workspace is the single preparation Skill for its three consumers", () => {
  assert.ok(!skills.managed_skills.includes("workspace-preparation"));
  assert.ok(skills.managed_skills.includes("native-workspace"));
  assert.deepEqual(
    skills.agents.filter(agent => agent.skills?.includes("native-workspace")).map(agent => agent.name).sort(),
    ["Bug Fix Agent", "Engineer", "Workitem Analyst"],
  );
  const skill = read("skills/native-workspace/SKILL.md");
  assert.match(skill, /^---\r?\nname: native-workspace\r?\n/);
  for (const operation of [
    "multica repo checkout <root-url> --ref <resource-ref>", "rondo runtime check-checkout",
    "multica repo checkout <business-url> --ref <resource-ref>", "multica repo checkout <business-url> --ref <ref>", "analysis.source.branch",
  ]) assert.ok(skill.includes(operation), operation);
});

test("workspace preparation is owned by one Skill; delivery contracts remain in their owners", () => {
  const bugAgent = read("agents/bug-fix-agent/instructions.md");
  assert.ok(bugAgent.includes("native-workspace"));
  assert.ok(!bugAgent.includes("multica repo checkout"));

  const bug = read("skills/pull-request/SKILL.md");
  // Sync 会发布包内附带的 Markdown，历史副本也可能把旧准备命令带回运行环境。
  const bugDir = join(multica, "skills", "pull-request");
  for (const file of readdirSync(bugDir, { recursive: true }).filter(path => path.endsWith(".md"))) {
    assert.doesNotMatch(readFileSync(join(bugDir, file), "utf8"), /rondo dev prepare/, file);
  }
  assert.ok(bug.includes("rondo repo fetch"));
  assert.ok(bug.includes("rondo repo push"));
  assert.ok(bug.includes("rondo pr prepare"));

  const spec = read("skills/spec-preparation/SKILL.md");
  assert.ok(spec.includes("openspec schema which") && spec.includes("cwd"));
  const analysis = read("skills/analysis-publish/SKILL.md");
  assert.ok(analysis.includes("rondo openspec validate") && analysis.includes("rondo openspec submit-review"));
  const dev = read("agents/engineer/instructions.md");
  assert.ok(dev.includes("rondo openspec read") && dev.includes("pull-request"));
  assert.doesNotMatch(dev, /rondo change update-progress|--change-ref/);
  const native = read("skills/native-workspace/SKILL.md");
  assert.doesNotMatch(native, /rondo dev prepare|--change-ref/);
  assert.ok(bugAgent.includes("pull-request"));
  assert.match(dev, /rondo openspec publish/);
  assert.doesNotMatch(bug, /rondo openspec publish/);
  assert.ok(bug.includes("rondo pr resume"));
  assert.ok(bug.includes("rondo pr materialize"));
  assert.ok(!skills.managed_skills.includes("bug-delivery") && !skills.managed_skills.includes("change-development"));
  assert.ok(!readdirSync(bugDir,{recursive:true}).includes("config/repo-registry.json"));
});

test("read-only repository investigation uses current Project Resources", () => {
  const explorer = read("skills/codebase-explorer/SKILL.md");
  assert.match(explorer, /Project Resource.*label/);
  assert.match(explorer, /multica project resource list/);
  assert.doesNotMatch(explorer, /repo-context\.yaml/);
  const native = read("skills/native-workspace/SKILL.md").split("## 只读业务仓")[1].split("## 研发业务仓")[0];
  assert.match(native, /Project Resource/);
  assert.doesNotMatch(native, /repo-context\.yaml/);
});
