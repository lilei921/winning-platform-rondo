/** Bug 开工授权不要求候选 Commit/Evidence，也不提前固定仓库 Scope。 */
import { FailError, UnknownError } from "../../cli/errors.js";
import type { IssueRecord } from "../../clients/multica.js";
import { MulticaClient } from "../../clients/multica.js";
import { assertBugAgentAssignment, requiredBugRepos } from "./scope.js";
import { TfsClient } from "../../tfs/client.js";

/** Bug 写操作沿用当前活跃 Run 的执行者约束；根仓目录检查不承载这项授权。 */
export function assertBugExecution(client: MulticaClient, issue: IssueRecord): void {
  const taskId = process.env.MULTICA_TASK_ID, agentId = process.env.MULTICA_AGENT_ID;
  const workspaceId = process.env.MULTICA_WORKSPACE_ID;
  if (!taskId || !agentId || !workspaceId || !process.env.MULTICA_TOKEN || !process.env.MULTICA_DAEMON_PORT) {
    throw new UnknownError("缺少 Multica Task/Actor 上下文，不能执行 Bug 写操作");
  }
  const raw = client.run(["issue", "runs", issue.id, "--active", ...client.ws(), "--output", "json"], "核验 Bug 执行者", { transient: true });
  if (!Array.isArray(raw)) throw new UnknownError("Bug Task 列表不可核实");
  const runs = raw.filter(r => r?.id === taskId);
  if (runs.length !== 1) throw new UnknownError("当前 Task 不属于该 Bug 的有效 Run");
  const run = runs[0];
  if (run.issue_id !== issue.id || run.agent_id !== agentId || run.workspace_id !== workspaceId || issue.assignee_id !== agentId) {
    throw new FailError("Bug Task / Issue / Workspace / 当前执行者绑定不一致");
  }
  if (run.status !== "running") throw new UnknownError("当前 Bug Run 未运行，不能执行写操作");
}

/** 来源 URL 与当前 TFS Collection / Work Item ID 必须一致，不向未知来源发送凭据。 */
export async function assertBugSource(issue: IssueRecord, serverUrl: string, suppliedClient?: Pick<TfsClient, "rawRequest">): Promise<void> {
  const md = issue.metadata ?? {};
  let legacy: URL | undefined;
  try {
    const source = new URL(md["tfs.url"]), configured = new URL(serverUrl);
    const base = configured.pathname.replace(/\/+$/, "").toLowerCase();
    const path = source.pathname.toLowerCase();
    const legacyPath = base.slice(0, base.lastIndexOf("/")) + "/web/wi.aspx";
    if (source.origin === configured.origin && path === legacyPath && !source.username && !source.password &&
        /^\d+$/.test(source.searchParams.get("id") ?? "") && Number(source.searchParams.get("id")) === Number(md["tfs.id"]) &&
        source.searchParams.get("pcguid")) {
      legacy = source;
    } else {
      const id = /\/_apis\/wit\/workitems\/(\d+)$/.exec(path)?.[1] ??
        (path.endsWith("/_workitems") || path.endsWith("/_workitems/edit/" + md["tfs.id"]) ? source.searchParams.get("id") ?? path.split("/").at(-1) : null);
      if (source.origin !== configured.origin || !path.startsWith(base + "/") || source.username || source.password ||
          !id || !/^\d+$/.test(id) || Number(id) !== Number(md["tfs.id"])) throw new Error();
    }
  } catch { throw new FailError("Bug 来源 URL 与 TFS Collection / 工作项身份不一致"); }
  if (!legacy) return;
  // 旧版页面 URL 不包含 Collection；只请求配置内的 API，以权威 html 链接核实 pcguid。
  const client = suppliedClient ?? new TfsClient();
  let item: any;
  try {
    const result = await client.rawRequest(`${serverUrl.replace(/\/+$/, "")}/_apis/wit/workitems/${Number(md["tfs.id"])}?api-version=4.1`, "GET");
    if (result.statusCode !== 200) throw new Error();
    item = JSON.parse(result.body);
  } catch { throw new UnknownError("无法回读 TFS 2018 来源身份，停止准备"); }
  let html: URL;
  try { html = new URL(item._links.html.href); }
  catch { throw new UnknownError("TFS 未提供权威工作项页面链接"); }
  if (item.id !== Number(md["tfs.id"]) || item.fields?.["System.WorkItemType"] !== "Bug" ||
      html.origin !== legacy.origin || html.pathname.toLowerCase() !== legacy.pathname.toLowerCase() ||
      html.searchParams.get("id") !== legacy.searchParams.get("id") ||
      html.searchParams.get("pcguid")?.toLowerCase() !== legacy.searchParams.get("pcguid")?.toLowerCase()) {
    throw new FailError("Bug 旧版来源链接与 TFS 权威身份不一致");
  }
}

export function assertBugStart(client: MulticaClient, issue: IssueRecord, repoKey: string): number {
  const md = issue.metadata ?? {};
  if (md["tfs.type"] !== "Bug") throw new FailError("当前仅支持独立 Bug，Requirement prepare 待 08-B");
  const id = Number(md["tfs.id"]);
  if (!Number.isSafeInteger(id) || id <= 0) throw new FailError("Bug tfs.id 无效");
  assertBugAgentAssignment(issue.assignee_id, client.run(["agent", "list", ...client.ws(), "--output", "json"], "核验 Bug Fix 指派", { transient: true }));
  if (!["todo", "in_progress"].includes(issue.status ?? "")) throw new FailError("Bug 当前状态不允许开工");
  if (md["analysis.change_ref"] || md["analysis.gate.result"] ||
      md["finalize.pending"] || md["delivery.tfs_written"] === "true") {
    throw new FailError("存在冲突的交付或收口事实，不能准备业务仓");
  }
  let prs: unknown;
  try { prs = JSON.parse(md.current_pr ?? "[]"); } catch { throw new UnknownError("current_pr 非法，停止准备"); }
  if (!Array.isArray(prs)) throw new UnknownError("current_pr 必须是数组");
  if (prs.length) throw new FailError("已有当前 PR，需先完成或受控返工");
  if (md["bug.required_repos"] && !requiredBugRepos(md["bug.required_repos"]).includes(repoKey)) throw new FailError("仓库超出已固定 Bug Scope");
  return id;
}
