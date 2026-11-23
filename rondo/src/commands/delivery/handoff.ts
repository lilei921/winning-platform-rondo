/**
 * Wayfinder -> Delivery owner handoff.
 * Only deterministic routing and one native Assignment Trigger live here.
 * Admission judgement and /note publication belong to Wayfinder Agent.
 */
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { MulticaClient, type IssueRecord } from "../../clients/multica.js";

// handoff 只接受 --issue；Workspace、CLI 与身份一律来自 Runtime 环境变量，不读外部配置。
const USAGE = [
  "用法: rondo delivery handoff --issue <KEY>",
  "",
  "从 MULTICA_WORKSPACE_ID / MULTICA_SERVER_URL 定位 Workspace，",
  "MULTICA_CLI_PATH 可指定 CLI（默认 multica）。",
  "校验 MULTICA_AGENT_ID 必须是当前 Workspace 的 Wayfinder Agent；缺失或不符返回 UNKNOWN。",
].join("\n");

type TargetKind = "agent" | "squad";
interface Route { type: TargetKind; name: string; }
interface NamedObject { id: string; name: string; archived_at?: string | null; runtime_bound?: boolean; leader_id?: string; }
interface Issue extends IssueRecord { assignee_type?: string; }
interface Run {
  id: string;
  agent_id?: string;
  issue_id?: string;
  attribution?: { evidence?: { kind?: string; ref_id?: string } };
}

export function resolveHandoffTarget(tfsType: string): Route | null {
  switch (tfsType.trim()) {
    case "Bug":
      return { type: "agent", name: "Bug Fix Agent" };
    case "Requirement":
    case "需求":
      return { type: "squad", name: "Delivery Squad" };
    default:
      return null;
  }
}

function parseArgs(argv: string[]): { issue: string } | null {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i], value = argv[i + 1];
    if (flag !== "--issue" || !value || value.startsWith("--") || values[flag]) return null;
    values[flag] = value;
  }
  return values["--issue"] ? { issue: values["--issue"] } : null;
}

function namedList(raw: unknown, what: string): NamedObject[] {
  if (!Array.isArray(raw) || raw.some((v) =>
    !v || typeof v !== "object" || typeof v.id !== "string" || typeof v.name !== "string")) {
    throw new UnknownError(what + " 返回不是有效对象列表");
  }
  return raw as NamedObject[];
}

function uniqueName(items: NamedObject[], name: string): NamedObject {
  const matched = items.filter((item) => item.name === name && !item.archived_at);
  if (matched.length !== 1) throw new UnknownError(name + " 不存在或不唯一，不能安全交接");
  return matched[0];
}

function readRuns(client: MulticaClient, issueId: string): Run[] {
  const raw = client.run(
    ["issue", "runs", issueId, ...client.ws(), "--output", "json"],
    "回读 Issue Run",
    { transient: true },
  );
  if (!Array.isArray(raw) || raw.some((v) => !v || typeof v.id !== "string")) {
    throw new UnknownError("Issue Run 列表格式不可确认");
  }
  return raw as Run[];
}

function matchingRuns(runs: Run[], issueId: string, agentId: string): Run[] {
  return runs.filter((run) =>
    run.issue_id === issueId &&
    run.agent_id === agentId &&
    run.attribution?.evidence?.kind === "issue_assignment" &&
    run.attribution.evidence.ref_id === issueId);
}

function isWayfinderOwned(issue: Issue, wayfinderId: string): boolean {
  return issue.assignee_id === wayfinderId &&
    (!issue.assignee_type || issue.assignee_type === "agent") &&
    (issue.status === "todo" || issue.status === "in_progress");
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }
  const args = parseArgs(argv);
  if (!args) {
    process.stderr.write(USAGE);
    return 64;
  }

  try {
    // 仅从 Runtime 环境变量取配置；MULTICA_CLI_PATH 保留显式指定 CLI 的能力。
    const runtime = {
      multica_cli: process.env.MULTICA_CLI_PATH?.trim() || "multica",
      workspace_id: process.env.MULTICA_WORKSPACE_ID?.trim(),
      multica_server_url: process.env.MULTICA_SERVER_URL?.trim(),
    };
    if (!runtime.workspace_id || !runtime.multica_server_url) {
      throw new UnknownError("缺少 Multica Runtime Workspace / Server，禁止使用默认环境交接");
    }
    const client = new MulticaClient(runtime);
    const issue = client.getIssue(args.issue) as Issue;
    const issueKey = issue.identifier ?? issue.id;
    const tfsType = issue.metadata?.["tfs.type"];
    const tfsId = issue.metadata?.["tfs.id"];
    if (!tfsType || !tfsId) {
      throw new FailError("当前 Issue 缺少 TFS 来源类型或身份");
    }
    if (issue.parent_issue_id) throw new FailError("入口交接只接受原始 TFS Issue，不处理 Sub-Issue");

    const route = resolveHandoffTarget(tfsType);
    if (!route) throw new FailError("不支持的 TFS Work Item Type: " + tfsType);

    const agents = namedList(client.run(
      ["agent", "list", ...client.ws(), "--output", "json"], "读取当前 Workspace Agents",
      { transient: true },
    ), "Agent List");
    const wayfinder = uniqueName(agents, "Wayfinder Agent");
    if (process.env.MULTICA_AGENT_ID?.trim() !== wayfinder.id) {
      throw new UnknownError("当前 Multica Runtime Agent 不是 Wayfinder，禁止交接");
    }
    let target: NamedObject;
    let expectedAgentId: string;
    if (route.type === "agent") {
      target = uniqueName(agents, route.name);
      if (target.runtime_bound === false) throw new UnknownError("Bug Fix Agent 尚未绑定 Runtime");
      expectedAgentId = target.id;
    } else {
      const squads = namedList(client.run(
        ["squad", "list", ...client.ws(), "--output", "json"], "读取当前 Workspace Squads",
        { transient: true },
      ), "Squad List");
      target = uniqueName(squads, route.name);
      const lead = uniqueName(agents, "Delivery Lead");
      if (target.leader_id && target.leader_id !== lead.id) {
        throw new UnknownError("Delivery Squad Leader 与登记的 Delivery Lead 不一致");
      }
      expectedAgentId = lead.id;
    }

    // A completed handoff is a NOOP. Never move a downstream Issue back to todo.
    const already = issue.assignee_id === target.id;
    if (already) {
      const matches = matchingRuns(readRuns(client, issue.id), issue.id, expectedAgentId);
      if (matches.length === 0) throw new UnknownError("已指派目标但未观察到对应的交接 Run，禁止重新触发");
      process.stdout.write(JSON.stringify({
        result: "NOOP", issue: issueKey, tfs_type: tfsType,
        target: { type: route.type, name: route.name, id: target.id },
        status: issue.status, run_id: matches[0].id,
      }, null, 2) + "\n");
      return 0;
    }

    if (!isWayfinderOwned(issue, wayfinder.id)) {
      throw new FailError("Issue 不再处于 Wayfinder 可交接状态，禁止覆盖当前负责人或状态");
    }

    const beforeRuns = new Set(readRuns(client, issue.id).map((run) => run.id));
    // The current source/owner may have changed during lookups; re-read before the one write.
    const fresh = client.getIssue(issue.id) as Issue;
    if (!isWayfinderOwned(fresh, wayfinder.id) ||
      fresh.metadata?.["tfs.type"] !== tfsType ||
      fresh.metadata?.["tfs.id"] !== tfsId ||
      fresh.metadata?.["tfs.changed_at"] !== issue.metadata?.["tfs.changed_at"]) {
      throw new UnknownError("交接前 Issue 负责人、状态或 TFS 来源已经变化");
    }

    // This update is a Run-start signal. A lost response must NOT trigger an automatic retry.
    let writeError: unknown;
    try {
      client.run(
        ["issue", "update", issue.id, "--status", "todo",
          "--assignee-id", target.id, ...client.ws(), "--output", "json"],
        "原子交接 Issue（todo + assignee）",
      );
    } catch (error) {
      writeError = error;
    }

    const after = client.getIssue(issue.id) as Issue;
    if (!after.status || after.status === "backlog" || after.assignee_id !== target.id ||
      (after.assignee_type && after.assignee_type !== route.type)) {
      throw new UnknownError("Issue Update 结果未确认，不重试触发: " +
        (writeError instanceof Error ? writeError.message : "Owner / Status 回读不一致"));
    }
    const matches = matchingRuns(readRuns(client, issue.id), issue.id, expectedAgentId)
      .filter((run) => !beforeRuns.has(run.id));
    if (matches.length !== 1) {
      throw new UnknownError("Issue 已指派，但未确认唯一的新下游 Run；不得再次执行 Assignment Update");
    }

    process.stdout.write(JSON.stringify({
      result: "PASS", issue: issueKey, tfs_type: tfsType,
      target: { type: route.type, name: route.name, id: target.id },
      status: after.status, run_id: matches[0].id,
      mode: writeError ? "recovered" : "applied",
    }, null, 2) + "\n");
    return 0;
  } catch (error) {
    const result = error instanceof FailError ? "FAIL" : "UNKNOWN";
    process.stdout.write(JSON.stringify({
      result, issue: args.issue, reason: error instanceof Error ? error.message : String(error),
    }, null, 2) + "\n");
    return result === "FAIL" ? 2 : 3;
  }
}

export function registerDeliveryHandoff(group: Command): void {
  group.command("handoff")
    .description("Wayfinder 通过准入后的确定性 TFS Type 交接")
    .helpOption(false).allowUnknownOption(true).allowExcessArguments(true)
    .action(async (...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      throw new ExitSignal(await main(cmd.args));
    });
}
