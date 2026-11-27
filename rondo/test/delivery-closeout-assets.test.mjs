import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const multicaRoot = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(multicaRoot, path), "utf8");

test("delivery-closeout 名称、Manifest 与 Agent 绑定一致", () => {
  const manifest = JSON.parse(read("workspace-config/provisioning.json"));
  const skillDir = join(multicaRoot, "skills/delivery-closeout");
  const skill = read("skills/delivery-closeout/SKILL.md");
  assert.equal(skill.split("\n")[1], "name: delivery-closeout");
  assert.ok(!existsSync(join(skillDir, "config/repo-registry.json")));
  assert.ok(!existsSync(join(multicaRoot, "skills/issue-closeout")));
  assert.ok(manifest.managed_skills.includes("delivery-closeout"));
  assert.ok(!manifest.managed_skills.includes("issue-closeout"));
  const agent = manifest.agents.find((a) => a.name === "PR Status Sync Agent");
  assert.ok(agent?.skills.includes("pr-status-sync"));
  assert.ok(agent?.skills.includes("delivery-closeout"));
  assert.ok(!manifest.agents.some((a) => a.skills?.includes("issue-closeout")));
  assert.ok(read("agents/pr-status-sync-agent/autopilot-prompt.md").includes("delivery-closeout"));
  const sync = readFileSync(new URL("../src/commands/workspace/sync.ts", import.meta.url), "utf8");
  assert.ok(!sync.includes('"delivery-closeout"'), "Workspace Sync 不应渲染 Closeout Registry");
  assert.ok(!sync.includes('"issue-closeout"'));
});

test("delivery-closeout 分别保留 Bug 与 Requirement 的收口命令及结果契约", () => {
  const skill = read("skills/delivery-closeout/SKILL.md");
  assert.ok(!skill.includes("--config"));
  const bug = skill.split("## Bug 收口\n")[1]?.split("## Requirement 收口\n")[0];
  const requirement = skill.split("## Requirement 收口\n")[1]?.split("## 已完成 Issue 恢复\n")[0];
  const recovery = skill.split("## 已完成 Issue 恢复\n")[1]?.split("## 结果处理\n")[0];
  const commands = (section) => (section ?? "").split("\n").filter(line => line.startsWith("rondo "));
  assert.deepEqual(commands(bug), [
    "rondo delivery finalize --phase prepare --issue <KEY>",
    "rondo workitem writeback --issue <KEY>",
    "rondo delivery finalize --phase complete --issue <KEY>",
  ]);
  assert.deepEqual(commands(requirement), [
    "rondo delivery root-prepare --issue <KEY>",
    'rondo delivery finalize --phase prepare --issue <KEY> --root-repo "<root_repo>"',
    'rondo workitem writeback --issue <KEY> --root-repo "<root_repo>" --inspect',
    'rondo workitem writeback --issue <KEY> --root-repo "<root_repo>" --task-plan "<plan.json>"',
    'rondo workitem writeback --issue <KEY> --root-repo "<root_repo>"',
    'rondo delivery finalize --phase complete --issue <KEY> --root-repo "<root_repo>"',
  ]);
  assert.deepEqual(commands(recovery), [
    "rondo delivery finalize --phase complete --issue <KEY>",
  ]);
  assert.ok(skill.includes("FAIL") && skill.includes("UNKNOWN"));
  assert.ok(skill.includes("status=prepared") && skill.includes("result=PASS"));
  assert.ok(skill.includes("already=done") && skill.includes("status=done"));
});
