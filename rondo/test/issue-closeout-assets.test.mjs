import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const multicaRoot = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(multicaRoot, path), "utf8");

test("issue-closeout 名称、Manifest 与 Agent 绑定一致", () => {
  const manifest = JSON.parse(read("workspace-config/provisioning.json"));
  const skillDir = join(multicaRoot, "skills/issue-closeout");
  const skill = read("skills/issue-closeout/SKILL.md");
  assert.equal(skill.split("\n")[1], "name: issue-closeout");
  assert.ok(existsSync(join(skillDir, "references/remote-artifacts.md")));
  assert.ok(!existsSync(join(multicaRoot, "skills/finalize-delivery")));
  assert.ok(manifest.managed_skills.includes("issue-closeout"));
  assert.ok(!manifest.managed_skills.includes("finalize-delivery"));
  const agent = manifest.agents.find((a) => a.name === "PR Status Sync Agent");
  assert.ok(agent?.skills.includes("pr-status-sync"));
  assert.ok(agent?.skills.includes("issue-closeout"));
  assert.ok(!manifest.agents.some((a) => a.skills?.includes("finalize-delivery")));
  assert.ok(read("agents/pr-status-sync-agent/autopilot-prompt.md").includes("issue-closeout"));
  const sync = readFileSync(new URL("../src/commands/workspace/sync.ts", import.meta.url), "utf8");
  assert.ok(sync.includes('"issue-closeout"'), "Workspace Sync 应为新 Skill 渲染配置");
  assert.ok(!sync.includes('"finalize-delivery"'));
});

test("issue-closeout 保留三段 CLI 收口顺序和停止条件", () => {
  const skill = read("skills/issue-closeout/SKILL.md");
  const commands = [
    "rondo delivery finalize --phase prepare --issue",
    "rondo tfs writeback --issue",
    "rondo delivery finalize --phase complete --issue",
  ];
  const offsets = commands.map((cmd) => skill.indexOf(cmd));
  assert.ok(offsets.every((x) => x >= 0));
  assert.ok(offsets[0] < offsets[1] && offsets[1] < offsets[2]);
  assert.ok(skill.includes("FAIL") && skill.includes("UNKNOWN"));
  assert.ok(skill.includes("already=done") && skill.includes("route_archive=skipped"));
});
