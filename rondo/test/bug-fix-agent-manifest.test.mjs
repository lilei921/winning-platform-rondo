import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const multica = repoRoot;
const manifest = JSON.parse(readFileSync(resolve(multica, "workspace-config/provisioning.json"), "utf8"));

test("Bug Fix Agent is managed independently of Delivery Squad", () => {
  const agent = manifest.agents.find((a) => a.dir === "bug-fix-agent");
  assert.ok(agent, "bug-fix-agent must be provisioned");
  assert.equal(agent.name, "Bug Fix Agent");
  assert.ok(!manifest.squad.members.some((m) => m.name === agent.name));
  assert.notEqual(manifest.squad.leader, agent.name);
  assert.ok(agent.skills.includes("codebase-explorer"));
  assert.ok(agent.skills.includes("diagnosing-bugs"));
  assert.ok(agent.skills.includes("pull-request"));
  assert.ok(agent.skills.includes("native-workspace"));
  for (const skill of ["bug-analysis", "backend-engineering", "frontend-engineering", "development-execution"]) {
    assert.ok(!agent.skills.includes(skill), `Bug Fix Agent must not bind legacy ${skill}`);
  }
  assert.ok(agent.skills.every((skill) => ["codebase-explorer", "diagnosing-bugs", "pull-request", "native-workspace"].includes(skill)));
  assert.match(readFileSync(resolve(multica, "skills/diagnosing-bugs/SKILL.md"), "utf8"), /name: diagnosing-bugs/);
  for (const skill of agent.skills) assert.ok(manifest.managed_skills.includes(skill));
  for (const file of ["instructions.md", "description.md", "README.md"]) {
    assert.ok(readFileSync(resolve(multica, "agents/bug-fix-agent", file), "utf8").length > 0);
  }
});
