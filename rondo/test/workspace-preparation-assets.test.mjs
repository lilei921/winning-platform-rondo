import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const multica = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(multica, path), "utf8");
const skills = JSON.parse(read("workspace-config/provisioning.json"));

test("native-workspace is the default for its three consumers; legacy preparation remains managed", () => {
  assert.ok(skills.managed_skills.includes("workspace-preparation"));
  assert.ok(skills.managed_skills.includes("native-workspace"));
  assert.deepEqual(
    skills.agents.filter(agent => agent.skills?.includes("native-workspace")).map(agent => agent.name).sort(),
    ["Bug Fix Agent", "Engineer", "Workitem Analyst"],
  );
  const skill = read("skills/native-workspace/SKILL.md");
  assert.match(skill, /^---\r?\nname: native-workspace\r?\n/);
  for (const operation of [
    "multica repo checkout <root-url> --ref <resource-ref>", "rondo runtime check-checkout",
    "multica repo checkout <business-url> --ref <resource-ref>", "rondo dev prepare --workspace native", "analysis.source.branch",
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
  assert.ok(bug.includes("rondo dev git --operation fetch"));
  assert.ok(bug.includes("rondo dev git --operation push"));
  assert.ok(bug.includes("rondo pr prepare"));

  const spec = read("skills/spec-preparation/SKILL.md");
  assert.ok(spec.includes("openspec schema which") && spec.includes("cwd"));
  const analysis = read("skills/analysis-completion/SKILL.md");
  assert.ok(analysis.includes("rondo analysis validate") && analysis.includes("rondo analysis complete"));
  const dev = read("agents/engineer/instructions.md");
  assert.ok(dev.includes("rondo analysis read") && dev.includes("pull-request"));
  assert.ok(bugAgent.includes("pull-request"));
  for (const command of ["rondo change update-progress", "rondo dev publish", "rondo bug resume"]) {
    assert.ok(bug.includes(command), command);
    assert.ok(!dev.includes(command) && !bugAgent.includes(command), command);
  }
  assert.ok(bug.includes("rondo pr materialize"));
  assert.ok(!skills.managed_skills.includes("bug-delivery") && !skills.managed_skills.includes("change-development"));
  assert.ok(!readdirSync(bugDir,{recursive:true}).includes("config/repo-registry.json"));
});
