import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const multica = fileURLToPath(new URL("../../../projects/multica/", import.meta.url));
const read = (path) => readFileSync(join(multica, path), "utf8");
const skills = JSON.parse(read("workspace-skills/_shared/provisioning.json"));

test("workspace-preparation is managed and bound only to its three consumers", () => {
  assert.ok(skills.managed_skills.includes("workspace-preparation"));
  assert.deepEqual(
    skills.agents.filter(agent => agent.skills?.includes("workspace-preparation")).map(agent => agent.name).sort(),
    ["Bug Fix Agent", "Engineer", "Workitem Analyst"],
  );
  const skill = read("workspace-skills/workspace-preparation/SKILL.md");
  assert.match(skill, /^---\r?\nname: workspace-preparation\r?\n/);
  for (const operation of [
    "multica repo checkout <root-url> --ref <resource-ref>", "rondo runtime check-checkout", "rondo dev prepare --mode bug",
    "rondo runtime prepare-root", "rondo dev prepare --mode requirement", "FAIL", "UNKNOWN",
  ]) assert.ok(skill.includes(operation), operation);
});

test("workspace preparation is owned by one Skill; delivery contracts remain in their owners", () => {
  const bugAgent = read("agents/bug-fix-agent/instructions.md");
  assert.ok(bugAgent.includes("workspace-preparation"));
  assert.ok(!bugAgent.includes("multica repo checkout"));

  const bug = read("workspace-skills/bug-delivery/SKILL.md");
  // Sync 会发布包内附带的 Markdown，历史副本也可能把旧准备命令带回运行环境。
  const bugDir = join(multica, "workspace-skills", "bug-delivery");
  for (const file of readdirSync(bugDir, { recursive: true }).filter(path => path.endsWith(".md"))) {
    assert.doesNotMatch(readFileSync(join(bugDir, file), "utf8"), /rondo dev prepare/, file);
  }
  assert.ok(bug.includes("rondo bug git --operation fetch"));
  assert.ok(bug.includes("rondo bug git --operation push"));
  assert.ok(bug.includes("rondo bug prepare-pr"));

  const spec = read("workspace-skills/spec-preparation/SKILL.md");
  assert.ok(spec.includes("openspec schema which") && spec.includes("cwd"));
  const analysis = read("workspace-skills/analysis-completion/SKILL.md");
  assert.ok(analysis.includes("rondo analysis validate") && analysis.includes("rondo analysis complete"));
  const dev = read("workspace-skills/change-development/SKILL.md");
  assert.ok(dev.includes("rondo dev publish") && dev.includes("rondo pr materialize"));
});
