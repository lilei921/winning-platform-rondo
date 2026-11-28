import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");

test("TFS Sync Agent 直接调用 Rondo，未绑定独立 Skill", () => {
  const manifest = JSON.parse(read("workspace-config/provisioning.json"));
  const agent = manifest.agents.find(a => a.name === "TFS Sync Agent");
  assert.deepEqual(agent?.skills, []);
  assert.notEqual(agent?.tfs_env, false);
  assert.ok(!manifest.managed_skills.includes("tfs-sync"));
  assert.ok(!manifest.agents.some(a => a.skills?.includes("tfs-sync")));
  assert.ok(!existsSync(new URL("skills/tfs-sync/SKILL.md", root)));
  const instructions = read("agents/tfs-sync-agent/instructions.md");
  assert.match(instructions, /^rondo workitem sync --wiql\s+/m);
  assert.match(instructions, /UNKNOWN/);
  const autopilot = manifest.autopilots.find(a => a.agent === agent.name);
  assert.equal(autopilot.mode, "run_only");
  assert.ok(!read(autopilot.prompt_file).includes("Skill"));
});

test("Workspace overlay 不再登记 tfs-sync Skill", () => {
  const directory = new URL("workspace-config/workspaces/", root);
  for (const file of readdirSync(directory).filter(name => name.endsWith(".json"))) {
    const overlay = JSON.parse(readFileSync(new URL(file, directory), "utf8"));
    assert.ok(!Object.hasOwn(overlay.skills ?? {}, "tfs-sync"), file);
  }
});
