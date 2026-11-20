/** Delivery-owned TFS Tasks are independent of OpenSpec Tasks. */
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FailError, UnknownError } from "../../cli/errors.js";
import { resolveStableEvidenceCommit } from "../delivery/evidence-repository.js";
import { loadConfig as loadTfsConfig } from "../../tfs/config.js";
import type { Clients } from "./writeback.js";

export interface TfsDeliveryTask { id: number; title?: string | null; parentId?: number | null; project?: string | null; state?: string | null }
interface DeliveryRegistry { [repo: string]: { repo_path: string; repo_url?: string; tfs_project?: string; tfs_repo?: string } }
function titlePrefix(issueKey: string): string { return "[" + issueKey + " Delivery"; }
/** Externally split task titles: [ISSUE Delivery/1] ... [ISSUE Delivery/5]. */
export function isDeliveryTaskTitle(issueKey: string, title: string): boolean {
  const escaped = issueKey.replace(/[\^$.*+?()[\]{}|]/g, "\\$&");
  return new RegExp("^\\[" + escaped + " Delivery(?:\\/[1-5])?\\](?:\\s|$)").test(title);
}

export async function findDeliveryTasks(
  clients: Pick<Clients,"tfsQuery">, issueKey: string, tfsId: number,
): Promise<TfsDeliveryTask[]> {
  const key = titlePrefix(issueKey);
  const candidates = await clients.tfsQuery("SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS '" + key.replace(/'/g, "''") + "'",
    "查找当前 Change 的 Delivery 子任务");
  const tasks = candidates.filter(t => t.parentId === tfsId && typeof t.title === "string" && isDeliveryTaskTitle(issueKey,t.title));
  if (tasks.length > 5) throw new FailError("Delivery TFS 子任务超过 5 个；请先由 Delivery 调整");
  if (new Set(tasks.map(t=>t.id)).size !== tasks.length) throw new UnknownError("TFS Delivery 子任务存在重复 ID");
  if (tasks.some(t=>!Number.isSafeInteger(t.id)||t.id<=0)) throw new UnknownError("TFS Delivery 子任务包含非法 ID");
  // A default singleton and an explicitly split group are mutually exclusive.
  const labels = tasks.map(t => t.title!.slice(titlePrefix(issueKey).length).match(/^(?:\/([1-5]))?\]/)?.[1] ?? "default");
  if ((tasks.length > 1 && labels.includes("default")) || new Set(labels).size !== labels.length) {
    throw new FailError("Delivery TFS 子任务存在默认项与拆分项混用或重复编号；请由 Delivery 核对");
  }
  return tasks;
}

export async function ensureDeliveryTasks(
  clients: Pick<Clients,"tfsQuery"|"tfsCreateTask">, issueKey: string, changeRef: string, tfsId: number,
): Promise<{ids:number[];created:boolean}> {
  const parents = await clients.tfsQuery("SELECT [System.Id] FROM WorkItems WHERE [System.Id] = " + tfsId,"核对 TFS 父需求");
  if(parents.length!==1||parents[0].id!==tfsId)throw new FailError("TFS 父需求不可读取");
  const found=await findDeliveryTasks(clients,issueKey,tfsId);
  if(found.length)return {ids:found.map(t=>t.id),created:false};
  const title=titlePrefix(issueKey)+"] 研发交付";
  const descriptionFile=join(tmpdir(),"rondo-delivery-"+process.pid+".md");
  writeFileSync(descriptionFile,"Multica Issue: "+issueKey+"\nOpenSpec Change: "+changeRef+
    "\nTFS 子任务拆合由 Delivery 独立管理，与 OpenSpec Tasks 无需一一对应。\n","utf8");
  try{
    const made=await clients.tfsCreateTask({title,parent:tfsId,project:parents[0].project,descriptionFile});
    const actual=await findDeliveryTasks(clients,issueKey,tfsId);
    if(!actual.some(t=>t.id===made.id))throw new UnknownError("TFS 创建响应后未确认父子链接，保留现场");
    return {ids:actual.map(t=>t.id),created:true};
  }finally{try{unlinkSync(descriptionFile);}catch{/* cleanup best effort */}}
}

/** Link stable business commits to the parent, not to invented OpenSpec task mappings. */
export async function linkRequirementCommits(
  clients: Pick<Clients,"tfsLinkCommits">, registry: DeliveryRegistry, changeDir: string, parentId: number,
): Promise<Record<string, unknown>> {
  const failed: Array<Record<string,unknown>>=[];
  const grouped=new Map<string,{repo:string;project:string;shas:Set<string>}>();
  for(const file of readdirSync(changeDir)){
    if(!/^evidence.*\.json$/i.test(file))continue;
    let content:unknown;
    try{content=JSON.parse(readFileSync(join(changeDir,file),"utf8"));}
    catch{failed.push({file,error:"Evidence JSON 无法解析"});continue;}
    const commits=(content as {commits?:unknown})?.commits;
    if(!Array.isArray(commits))continue;
    for(const item of commits){
      try{
        const c=resolveStableEvidenceCommit(registry,item,loadTfsConfig().serverUrl);
        const bucket=grouped.get(c.key)??{repo:c.repo,project:c.project,shas:new Set<string>()};
        bucket.shas.add(c.sha);grouped.set(c.key,bucket);
      }catch(e){failed.push({file,error:e instanceof Error?e.message:String(e)});}
    }
  }
  const linked:Record<string,number>={};
  for(const [key,bucket] of grouped){
    try{
      const result=await clients.tfsLinkCommits(parentId,bucket.repo,[...bucket.shas],bucket.project);
      linked[key]=(result.linked??[]).length;
      for(const f of result.failed??[])failed.push({repo_key:key,...f});
    }catch(e){failed.push({repo_key:key,error:e instanceof Error?e.message:String(e)});}
  }
  return {linked,commit_link_failed:failed};
}

/** New Requirement: Agent owns grouping/estimates; Rondo owns all deterministic guards. */
import { extractTaskText } from "./materialize-tasks.js";

export interface PlannedCommit { repo_key: string; sha: string }
export interface PlannedTask {
  summary: string; estimate_hours: number; source_refs: string[]; commits: PlannedCommit[];
}
export interface RequirementTaskPlan { tasks: PlannedTask[] }

const fullSha = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{40}$/i.test(s);
const taskIdentity = (parent: number, issueKey: string, number: number): string =>
  `Multica Delivery Task: ${issueKey}/${number} (parent=${parent})`;

export function validateRequirementTaskPlan(
  value: unknown, approvedTasks: string, available: PlannedCommit[],
): RequirementTaskPlan {
  const input = value as { tasks?: unknown };
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      !Array.isArray(input.tasks) || input.tasks.length < 1 || input.tasks.length > 5 ||
      input.tasks.length > available.length) {
    throw new FailError("TFS 任务计划必须包含 1–5 项且不得超过真实可用 Commit 数量");
  }
  const availableKeys = new Set(available.map(c => c.repo_key + "/" + c.sha.toLowerCase()));
  if (!availableKeys.size || availableKeys.size !== available.length) throw new UnknownError("可用业务 Commit 清单无效或重复");
  const titles = new Set<string>(); const used = new Set<string>();
  const tasks: PlannedTask[] = input.tasks.map((raw: unknown, index: number) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new FailError(`TFS 任务 ${index + 1} 的结构非法`);
    const task = raw as Partial<PlannedTask>;
    const summary = typeof task?.summary === "string" ? task.summary.trim() : "";
    if (!summary || summary.length > 180 || /[\r\n]/.test(summary) || titles.has(summary.toLowerCase())) {
      throw new FailError(`TFS 任务 ${index + 1} 总结为空、重复或过长`);
    }
    titles.add(summary.toLowerCase());
    const estimate = task.estimate_hours;
    if (typeof estimate !== "number" || !Number.isFinite(estimate) || estimate < 0.5 || estimate > 4) {
      throw new FailError(`TFS 任务 ${index + 1} estimate_hours 必须为 0.5–4h`);
    }
    if (!Array.isArray(task.source_refs) || !task.source_refs.length ||
        task.source_refs.some(r => typeof r !== "string" || !r.trim() ||
          extractTaskText(approvedTasks, r) === null)) {
      throw new FailError(`TFS 任务 ${index + 1} source_refs 必须可在已批准 tasks.md 中定位`);
    }
    if (!Array.isArray(task.commits) || !task.commits.length || task.commits.length > available.length) {
      throw new FailError(`TFS 任务 ${index + 1} 缺少独占业务 Commit`);
    }
    const commits = task.commits.map(c => {
      if (!c || typeof c.repo_key !== "string" || !fullSha(c.sha)) {
        throw new FailError(`TFS 任务 ${index + 1} Commit 身份无效`);
      }
      const normalized = { repo_key: c.repo_key, sha: c.sha.toLowerCase() };
      const key = normalized.repo_key + "/" + normalized.sha;
      if (!availableKeys.has(key)) throw new FailError(`Commit ${key} 不属于本 Change 已核验的 PR 代码交付`);
      if (used.has(key)) throw new FailError(`Commit ${key} 被重复分配给多个 TFS Task`);
      used.add(key);
      return normalized;
    });
    return { summary, estimate_hours: estimate, source_refs: [...new Set(task.source_refs)], commits };
  });
  return { tasks };
}

interface PlannedWorkItem extends TfsDeliveryTask {
  type?: string | null;
  originalEstimate?: number | null;
  fields?: Record<string, unknown>;
  childIds?: number[];
  artifactLinks?: string[];
}

async function plannedChildren(
  clients: Pick<Clients, "tfsQuery">, parentId: number,
): Promise<{parent: PlannedWorkItem; children: PlannedWorkItem[]}> {
  const parents = await clients.tfsQuery(`SELECT [System.Id] FROM WorkItems WHERE [System.Id] = ${parentId}`, "读取 TFS 父需求与子项");
  if (parents.length !== 1 || parents[0].id !== parentId) throw new UnknownError("TFS 父需求未确认唯一存在");
  const parent = parents[0] as PlannedWorkItem;
  if (typeof parent.title !== "string" || !parent.title.trim() || !Array.isArray(parent.childIds)) {
    throw new UnknownError("TFS 父需求标题/子项关系无法确认");
  }
  if (parent.childIds.length > 500 || parent.childIds.some(id => !Number.isSafeInteger(id) || id <= 0) ||
      new Set(parent.childIds).size !== parent.childIds.length) {
    throw new UnknownError("TFS 父需求子项关系非法或超过安全读取上限");
  }
  const children: PlannedWorkItem[] = [];
  for (let i = 0; i < parent.childIds.length; i += 50) {
    const batch = parent.childIds.slice(i, i + 50);
    const items = await clients.tfsQuery(
      `SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN (${batch.join(",")})`,
      "核对 TFS 父需求子项与稳定身份",
    ) as PlannedWorkItem[];
    if (items.length !== batch.length || items.some(c => !batch.includes(c.id) || c.parentId !== parentId)) {
      throw new UnknownError("TFS 子项回读与父链不一致或存在不可读工作项");
    }
    children.push(...items);
  }
  return { parent, children };
}

function verifyPlannedChildren(
  children: PlannedWorkItem[], plan: RequirementTaskPlan, parentId: number, issueKey: string, changeRef: string,
  parentTitle: string,
): Array<PlannedWorkItem | undefined> {
  const titles = plan.tasks.map(t => `${parentTitle} - ${t.summary}`);
  if (titles.some(t => t.length > 255) || new Set(titles).size !== titles.length) {
    throw new FailError("TFS 子任务拼接标题超过 255 字符或存在重复，不得截断");
  }
  if (children.some(t => typeof t.title === "string" && isDeliveryTaskTitle(issueKey, t.title))) {
    throw new FailError("父项已有旧 [Issue Delivery] 子任务，禁止新旧模式混用");
  }
  const found: Array<PlannedWorkItem | undefined> = [];
  for (let i = 0; i < plan.tasks.length; i++) {
    const marker = taskIdentity(parentId, issueKey, i + 1);
    const hits = children.filter(t => String(t.fields?.["System.Description"] ?? "").includes(marker));
    if (hits.length > 1) throw new FailError(`TFS 子任务稳定身份 ${marker} 重复`);
    const task = hits[0];
    if (task && ((task.type !== "任务" && task.type !== "Task") || task.parentId !== parentId ||
        !String(task.fields?.["System.Description"] ?? "").includes(`OpenSpec Change: ${changeRef}`) ||
        task.originalEstimate !== plan.tasks[i].estimate_hours)) {
      throw new FailError(`已有 TFS 子任务 ${task.id} 的身份、Change 或 OriginalEstimate 与计划冲突`);
    }
    if (!task && children.some(t => t.title === titles[i])) {
      throw new FailError(`已有同名 TFS 子任务但无稳定身份: ${titles[i]}`);
    }
    found.push(task);
  }
  if (children.some(t => String(t.fields?.["System.Description"] ?? "")
      .includes(`Multica Delivery Task: ${issueKey}/`) && !found.some(x => x?.id === t.id))) {
    throw new FailError("存在本 Issue 计划外的 TFS 子任务标识，停止自动恢复");
  }
  return found;
}

/** Create only missing planned children; recover lost POST responses by re-reading parent links. */
export async function ensurePlannedDeliveryTasks(
  clients: Pick<Clients, "tfsQuery" | "tfsCreateTask">,
  issueKey: string, changeRef: string, parentId: number, plan: RequirementTaskPlan,
): Promise<{ids: number[]; created: number[]; reused: number[]}> {
  const created: number[] = [];
  let latest = await plannedChildren(clients, parentId);
  const initialTitle = latest.parent.title!;
  for (let i = 0; i < plan.tasks.length; i++) {
    const found = verifyPlannedChildren(latest.children, plan, parentId, issueKey, changeRef, initialTitle);
    if (found[i]) continue;
    const title = `${initialTitle} - ${plan.tasks[i].summary}`;
    const descriptionFile = join(tmpdir(), `rondo-planned-task-${process.pid}-${i + 1}.md`);
    writeFileSync(descriptionFile, [
      taskIdentity(parentId, issueKey, i + 1),
      `OpenSpec Change: ${changeRef}`,
      `OpenSpec Task refs: ${plan.tasks[i].source_refs.join(", ")}`,
    ].join("\n"), "utf8");
    try {
      // If POST result is unknown, stop. Next run discovers the relation by marker, never blindly re-POST.
      const createdTask = await clients.tfsCreateTask({
        title, parent: parentId, project: latest.parent.project, descriptionFile,
        estimate: plan.tasks[i].estimate_hours,
      });
      latest = await plannedChildren(clients, parentId);
      const confirmed = verifyPlannedChildren(latest.children, plan, parentId, issueKey, changeRef, initialTitle);
      if (confirmed[i]?.id !== createdTask.id) throw new UnknownError("TFS 创建响应与父链稳定身份回读不一致");
      created.push(createdTask.id);
    } finally { try { unlinkSync(descriptionFile); } catch { /* best effort */ } }
  }
  latest = await plannedChildren(clients, parentId);
  const all = verifyPlannedChildren(latest.children, plan, parentId, issueKey, changeRef, initialTitle);
  if (all.some(v => !v)) throw new UnknownError("TFS 计划子任务未全部回读确认");
  const ids = all.map(v => v!.id);
  if (new Set(ids).size !== ids.length) throw new FailError("计划多个 TFS Task 认领了同一个 Work Item");
  return { ids, created, reused: ids.filter(id => !created.includes(id)) };
}

/** Read only: existing stable identities, before any planned TFS creation or linkage. */
export async function findExistingPlannedTasks(
  clients: Pick<Clients, "tfsQuery">, issueKey: string, changeRef: string,
  parentId: number, plan: RequirementTaskPlan,
): Promise<Array<number | null>> {
  const {parent,children} = await plannedChildren(clients, parentId);
  return verifyPlannedChildren(children,plan,parentId,issueKey,changeRef,parent.title!)
    .map(item => item?.id ?? null);
}
