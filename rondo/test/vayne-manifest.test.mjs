import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const manifest = JSON.parse(read("workspace-config/provisioning.json"));

test("Vayne 独立供给，Autopilot 只登记调度说明", () => {
  const agent = manifest.agents.find(a => a.name === "Vayne");
  assert.equal(agent?.dir, "vayne-agent");
  assert.deepEqual(agent.skills, []);
  assert.notEqual(manifest.squad.leader, agent.name);
  assert.ok(!manifest.squad.members.some(m => m.name === agent.name));
  const autopilot = manifest.autopilots.find(a => a.agent === agent.name);
  assert.equal(autopilot.mode, "run_only");
  assert.match(autopilot.schedule_note, /\*\/10 8-9,17-18/);
  assert.match(autopilot.schedule_note, /0 10,19/);
  assert.match(read("agents/vayne-agent/instructions.md"), /rondo runtime reconcile/);
  assert.ok(read(autopilot.prompt_file).trim());
});
