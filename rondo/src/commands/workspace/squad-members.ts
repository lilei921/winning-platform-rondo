/** Squad Roster 的期望配置与实际成员差异；不负责执行平台写入。 */
export interface SquadMemberSpec {
  name: string;
  role: string;
}

export interface SquadMemberCurrent {
  member_id: string;
  member_type: string;
  role?: string | null;
}

export interface SquadMemberChange extends SquadMemberSpec {
  memberId: string;
  kind: "add" | "set-role";
}

/** 在执行任何平台写入前检查成员配置。 */
export function validateSquadMembers(raw: unknown, agentNames: Set<string>): string[] {
  if (!Array.isArray(raw)) return ["squad.members 必须为数组"];
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const member of raw) {
    if (!member || typeof member !== "object" || Array.isArray(member)) {
      problems.push("squad.members 的每个成员必须包含 name 和 role");
      continue;
    }
    const { name, role } = member as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim() || name !== name.trim()) {
      problems.push("squad member name 必须为非空且无首尾空格的字符串");
      continue;
    }
    if (seen.has(name)) problems.push(`squad member ${name} 重复登记`);
    seen.add(name);
    if (!agentNames.has(name)) problems.push(`squad member ${name} 不在 manifest.agents`);
    if (typeof role !== "string" || !role.trim()) {
      problems.push(`squad member ${name} 缺少非空 role`);
    }
  }
  return problems;
}

/** 仅处理已解析 Agent ID 的成员；dry-run 下尚未创建的 Agent 留待正式供给。 */
export function planSquadMemberChanges(
  expected: SquadMemberSpec[],
  agentIds: Record<string, string>,
  current: SquadMemberCurrent[],
): SquadMemberChange[] {
  const byAgentId = new Map<string, SquadMemberCurrent>(
    current.filter(m => m.member_type === "agent").map(m => [m.member_id, m]),
  );
  const changes: SquadMemberChange[] = [];
  for (const member of expected) {
    const memberId = agentIds[member.name];
    if (!memberId) continue;
    const actual = byAgentId.get(memberId);
    if (!actual) {
      changes.push({ ...member, memberId, kind: "add" });
    } else if ((actual.role ?? "").trim() !== member.role.trim()) {
      changes.push({ ...member, memberId, kind: "set-role" });
    }
  }
  return changes;
}
