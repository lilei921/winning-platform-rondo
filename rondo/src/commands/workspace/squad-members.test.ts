import assert from "node:assert/strict";
import { test } from "node:test";
import { planSquadMemberChanges, validateSquadMembers } from "./squad-members.js";

const analyst = { name: "Workitem Analyst", role: "负责需求与 Bug 分析、研发准备" };
const engineer = { name: "Backend Engineer", role: "负责后端服务实现与开发侧验证" };
const agentIds = { "Workitem Analyst": "agent-1", "Backend Engineer": "agent-2" };

test("manifest members require named, nonempty roles and known agents", () => {
  assert.deepEqual(validateSquadMembers([analyst, engineer], new Set(Object.keys(agentIds))), []);
  const problems = validateSquadMembers([
    analyst,
    { name: "Workitem Analyst", role: "duplicate" },
    { name: "Unknown", role: "owner" },
    { name: "Backend Engineer", role: " " },
    { name: " Noncanonical", role: "owner" },
  ], new Set(Object.keys(agentIds)));
  assert.ok(problems.some(s => s.includes("重复登记")));
  assert.ok(problems.some(s => s.includes("不在 manifest.agents")));
  assert.ok(problems.some(s => s.includes("缺少非空 role")));
  assert.ok(problems.some(s => s.includes("无首尾空格")));
  assert.ok(validateSquadMembers(["Backend Engineer"], new Set(Object.keys(agentIds))).length > 0);
  assert.deepEqual(validateSquadMembers(null, new Set()), ["squad.members 必须为数组"]);
});

test("new member uses the configured role, not the generic member label", () => {
  assert.deepEqual(planSquadMemberChanges([analyst], agentIds, []), [
    { ...analyst, memberId: "agent-1", kind: "add" },
  ]);
});

test("existing member with a stale role is updated in place", () => {
  assert.deepEqual(planSquadMemberChanges([analyst], agentIds, [
    { member_id: "agent-1", member_type: "agent", role: "member" },
  ]), [{ ...analyst, memberId: "agent-1", kind: "set-role" }]);
});

test("unchanged member is a no-op; human member does not impersonate agent", () => {
  assert.deepEqual(planSquadMemberChanges([analyst], agentIds, [
    { member_id: "agent-1", member_type: "agent", role: analyst.role },
  ]), []);
  assert.deepEqual(planSquadMemberChanges([analyst], agentIds, [
    { member_id: "agent-1", member_type: "member", role: analyst.role },
  ]), [{ ...analyst, memberId: "agent-1", kind: "add" }]);
});

test("a member without a resolved Agent ID is deferred", () => {
  assert.deepEqual(planSquadMemberChanges([analyst], {}, []), []);
});
