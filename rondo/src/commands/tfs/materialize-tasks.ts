/**
 * materialize-tasks.ts — TFS 任务项物化（02 §7"按 TFS Type 补齐必要 TFS Task / 关联"）。
 * 方案：archive/docs-2026-10-26/tfs-task-materialization-plan.md §4.2（历史溯源）。
 *
 * 裁决 D3 修订：自 rondo 收编起，实现位置为 @winning/skill-flow 包内
 * commands/tfs/materialize-tasks.ts，原 projects/multica/workspace-skills/delivery-flow/scripts/
 * materialize-tfs-tasks.ts 路径在迁移窗口期保持有效（见 change-progress-script-contract.md addendum）。
 *
 * 调用方：Delivery Lead，在 materialize-development 派发成功后同 Run 紧接调用。
 * 平面隔离（红线）：本脚本失败不影响已落账的 dev.dispatch；修复靠重跑补齐，不重新派发。
 *
 * 前置（任一不过 → exit 2，零创建）：
 *   1. Issue 可读，metadata 含 tfs.id / analysis.change_ref；
 *   2. dev.dispatch 至少一条 active:true 条目；
 *   3. 父工作项（tfs.id）经 WIQL 回读存在；
 *   4. active 条目 task_refs 并集在 openspec/changes/<change_ref>/tasks.md 原生编号可定位；
 *   5. 可选历史 [预估: Nh] 尾注仅作为兼容输入；未提供不影响任务创建。
 *
 * 幂等（身份 = (issue, task_ref)）：
 *   - 任意 dispatch 条目（含已失效）tfs_task_ids 已记录该 ref → WIQL 核对仍存在 → reused；
 *   - 未记录但 TFS 侧已有同前缀标题的子任务（孤儿，创建后回写失败遗留）→ 认领回写，不重复创建；
 *   - 否则按 tasks.md 原生行文本组标题 "[<issueKEY> <ref>] <行文本>" 创建（剥离预估尾注，
 *     正文 >80 字符确定性截断 + "…"，完整行文本进描述，§4.8；预估写工时字段，§4.7）。
 *
 * 回写：created/reused/adopted 的映射合并进对应 active 条目 tfs_task_ids（本脚本唯一写入者），
 *   一次 metadata set 全量写回（含失效条目原样保留）。先创建后回写；回写失败 → exit 3
 *   并输出已暂存的 created/reused/adopted 映射，重跑经孤儿认领自愈。
 *
 * 状态段（§4.2，先事实后状态）：metadata 回写成功后对全部 resolved 任务 set-state 活动；
 *   任一失败 → exit 3 UNKNOWN（state_set/state_failed 明细，metadata 不回滚），
 *   重跑经 reused 路径补写状态自愈；跳态不预验证（已解决→活动被拒则如实 UNKNOWN）。
 *
 * 用法：rondo tfs materialize-tasks --config <repo-registry.json> --issue <KEY> [--root-repo <path>（使用本地工件时必填）]
 * 退出码：0 PASS / 2 FAIL（前置，零创建）/ 3 UNKNOWN / 64 用法错误。stdout 只出 JSON；日志走 stderr。
 *
 * 类型分支（tfs-bug-delivery-task-skip-plan §4.1，2026-10-26）：metadata tfs.type=Bug → NOOP
 *   零创建（Bug 交付不建 TFS 子任务，PR 直接关联 bug 号）；tfs.type=需求 → 现有逻辑；
 *   tfs.type 缺失/其他 → UNKNOWN（不默认按需求建任务，防静默误判）。
 *
 * 运行环境：Node ≥ 23.6 直跑（22.6+ 需 --experimental-strip-types）；只用可擦除类型注解；零 npm 依赖。
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { loadConfig } from "../../clients/config.js";
import { MulticaClient, type IssueRecord } from "../../clients/multica.js";
import { TfsClient } from "../../clients/tfs.js";
import { resolveRuntimePaths } from "../../clients/runtime-paths.js";

interface RegistryConfig {
  runtime: { multica_cli: string; workspace_id?: string; tfs_cli?: string[] };
}

interface DispatchEntry {
  dispatch_key: string;
  task_refs: string[];
  engineer_id?: string;
  projection?: "parent" | "sub_issue";
  change_ref?: string;
  active: boolean;
  tfs_task_ids?: Record<string, number>;
}

interface TfsWorkItem {
  id: number;
  type?: string | null;
  title?: string | null;
  project?: string | null;
  parentId?: number | null;
}

function log(msg: string): void { process.stderr.write(msg + "\n"); }

class Clients {
  private multica: MulticaClient;
  private tfs: TfsClient;
  constructor(cfg: RegistryConfig) {
    this.multica = new MulticaClient(cfg.runtime);
    this.tfs = new TfsClient();
  }

  getIssue(issueKey: string): IssueRecord {
    return this.multica.getIssue(issueKey);
  }

  setMetadata(issueId: string, key: string, value: string): void {
    this.multica.setMetadata(issueId, key, value);
  }

  async tfsQuery(wiql: string, what: string): Promise<TfsWorkItem[]> {
    const out = await this.tfs.run(["query", "--wiql", wiql], what);
    if (!Array.isArray(out)) throw new UnknownError(`${what} 输出不是数组`);
    return out as TfsWorkItem[];
  }

  async tfsCreateTask(opts: { title: string; parent: number; project?: string | null; descriptionFile: string; estimate?: number }): Promise<TfsWorkItem> {
    const cmd = ["workitem", "create", "--type", "任务",
      "--title", opts.title, "--parent", String(opts.parent), "--description-file", opts.descriptionFile];
    if (opts.estimate !== undefined) cmd.push("--estimate", String(opts.estimate));
    if (opts.project) cmd.push("--project", opts.project);
    const out = await this.tfs.run(cmd, `创建 TFS 任务(parent=${opts.parent}, title=${opts.title})`) as TfsWorkItem;
    if (!out?.id) throw new UnknownError("创建 TFS 任务返回缺少 id（结果未知，勿盲目重建——重跑经标题前缀认领）");
    return out;
  }

  async tfsSetState(id: number, state: string): Promise<void> {
    await this.tfs.run(
      ["workitem", "set-state", "--id", String(id), "--state", state],
      `置 TFS 任务 ${id} 状态为 ${state}`,
    );
  }
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { out[key] = next; i++; }
      else out[key] = true;
    }
  }
  return out;
}

function escapeRef(ref: string): string {
  return ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** tasks.md 原生行定位 + 行文本提取（Native First，不解析语义）。行尾兼容 CRLF：`.` 不匹配 `\r`，须显式吸收（2026-11-03 WNDF-52 D1 同类）。 */
export function extractTaskText(tasksText: string, ref: string): string | null {
  const re = new RegExp(`^\\s*- \\[[ xX]\\]\\s*${escapeRef(ref)}\\.?[ \\t]+(.*)\\r?$`, "m");
  const m = tasksText.match(re);
  return m ? m[1].trim() : null;
}

// --- 旧预估尾注兼容（可选，不定义 OpenSpec Task 粒度）与标题截断 ---

const ESTIMATE_TAIL_RE = /\[预估:\s*(\d+(?:\.\d+)?)\s*h\]\s*$/i;
const TITLE_TEXT_MAX = 80;

/** 可选历史预估格式：没有尾注合法，存在但无法解析则拒绝把它伪装成有效工时。 */
export function estimateIssue(text: string): string | null {
  const tail = text.match(ESTIMATE_TAIL_RE);
  if (!tail) return text.includes("[预估:") ? "预估尾注格式非法（如填写，须为行末 [预估: Nh]）" : null;
  const n = Number(tail[1]);
  return Number.isFinite(n) && n > 0 ? null : `预估 ${n}h 非法（如填写，必须为正数）`;
}

export function parseEstimate(text: string): number | null {
  const m = text.match(ESTIMATE_TAIL_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function stripEstimateTail(text: string): string {
  return text.replace(ESTIMATE_TAIL_RE, "").trim();
}

/** 标题正文确定性截断（§4.8）：prefix 不参与截断，身份前缀完整保留（孤儿认领 startsWith 不受影响）。 */
export function truncateTitleText(text: string): string {
  return text.length > TITLE_TEXT_MAX ? text.slice(0, TITLE_TEXT_MAX) + "…" : text;
}

async function main(rawArgs: string[]): Promise<number> {
  const args = parseArgs(rawArgs);
  const missingArgs = ["config", "issue"].filter((k) => typeof args[k] !== "string" || args[k] === "");
  if (missingArgs.length > 0) {
    process.stderr.write(
      "用法: rondo tfs materialize-tasks --config <repo-registry.json> --issue <KEY>\n" +
      "  [--root-repo <path>]（使用本地工件时必填）\n" +
      `缺少参数: ${missingArgs.join(", ")}\n`,
    );
    return 64;
  }

  let partial: {
    created: Record<string, number>;
    reused: Record<string, number>;
    adopted: Record<string, number>;
  } | null = null;

  try {
    const cfg = loadConfig<RegistryConfig>(args.config as string, { requireRegistry: false });
    const clients = new Clients(cfg);
    const issue = clients.getIssue(args.issue as string);
    const issueKey = issue.identifier ?? issue.id;
    const md = issue.metadata ?? {};

    // --- 类型分支（tfs-bug-delivery-task-skip-plan §4.1）：Bug 不建 TFS 子任务 ---
    const tfsType = typeof md["tfs.type"] === "string" ? (md["tfs.type"] as string) : "";
    if (tfsType === "Bug") {
      process.stdout.write(JSON.stringify({
        result: "NOOP",
        reason: "tfs_type_bug_skip（Bug 交付不建 TFS 子任务，PR 直接关联 bug 号）",
        issue: issueKey,
        tfs_type: tfsType,
      }, null, 2) + "\n");
      return 0;
    }
    if (tfsType !== "需求") {
      throw new UnknownError(`Issue ${issueKey} metadata tfs.type 缺失或不是 需求/Bug: ${tfsType || "(缺失)"}——不默认按需求建任务，交 Lead 核对来源同步`);
    }

    // --- dev.dispatch 解析（含失效条目，供复用查询；写回时全量原样保留） ---
    let dispatches: DispatchEntry[] = [];
    const rawDispatch = md["dev.dispatch"];
    if (rawDispatch) {
      try { dispatches = JSON.parse(rawDispatch) as DispatchEntry[]; }
      catch { throw new UnknownError(`Issue ${issueKey} 的 metadata dev.dispatch 不是合法 JSON`); }
      if (!Array.isArray(dispatches)) throw new UnknownError(`Issue ${issueKey} 的 metadata dev.dispatch 不是数组`);
    }
    const activeEntries = dispatches.filter((d) => d.active);

    // --- 前置（任一不过 → FAIL，零创建） ---
    const reasons: string[] = [];
    const tfsIdRaw = md["tfs.id"];
    const tfsId = tfsIdRaw ? Number(tfsIdRaw) : NaN;
    if (!tfsIdRaw || !Number.isInteger(tfsId) || tfsId <= 0) {
      reasons.push(`metadata tfs.id 缺失或不是正整数: ${tfsIdRaw ?? "(缺失)"}`);
    }
    if (activeEntries.length === 0) {
      reasons.push("dev.dispatch 无 active:true 条目——先完成派发物化（materialize-development）");
    }
    const changeRef = md["analysis.change_ref"];
    if (!changeRef) reasons.push("metadata analysis.change_ref 缺失（无法定位 tasks.md）");

    const unionRefs = [...new Set(activeEntries.flatMap((d) => d.task_refs ?? []))].sort();
    if (activeEntries.length > 0 && unionRefs.length === 0) reasons.push("active dispatch 条目的 task_refs 并集为空");

    // 本地根仓由调用方显式传入；只校验与派生路径。
    // 解析失败 → UNKNOWN exit 3（环境事实不可确认，不进入 FAIL 前置判定）。
    const paths = resolveRuntimePaths(cfg, { issue, rootRepoArg: args["root-repo"] as string | undefined, need: ["openspec"] });

    let tasksText = "";
    if (changeRef && unionRefs.length > 0) {
      const tasksPath = join(paths.openspecRoot, "changes", changeRef, "tasks.md");
      if (!existsSync(tasksPath)) {
        reasons.push(`tasks.md 不存在: ${tasksPath}`);
      } else {
        tasksText = readFileSync(tasksPath, "utf8");
        const missing = unionRefs.filter((ref) => extractTaskText(tasksText, ref) === null);
        if (missing.length > 0) reasons.push(`task_refs 在 ${tasksPath} 中不可定位: ${missing.join(", ")}`);
        // 已包含历史预估尾注时校验其格式；无尾注是合法的新工程 Task。
        for (const ref of unionRefs) {
          const text = extractTaskText(tasksText, ref);
          if (text === null) continue; // 已被 missing 拦截
          const issue = estimateIssue(text);
          if (issue) reasons.push(`task ${ref} ${issue}`);
        }
      }
    }
    if (reasons.length > 0) {
      process.stdout.write(JSON.stringify({ result: "FAIL", reasons, created: {}, reused: {} }, null, 2) + "\n");
      return 2;
    }

    // --- 父项核对（WIQL 回读；确定不存在 → FAIL 零创建；查询故障 → UNKNOWN） ---
    const parentArr = await clients.tfsQuery(
      `SELECT [System.Id] FROM WorkItems WHERE [System.Id] = ${tfsId}`,
      `回读 TFS 父工作项 ${tfsId}`,
    );
    if (parentArr.length === 0) {
      process.stdout.write(JSON.stringify({
        result: "FAIL", reasons: [`TFS 父工作项 ${tfsId} 不存在或不可读`], created: {}, reused: {},
      }, null, 2) + "\n");
      return 2;
    }
    const parentProject = parentArr[0].project ?? null;

    // --- 逐 task_ref 幂等物化 ---
    const created: Record<string, number> = {};
    const reused: Record<string, number> = {};
    const adopted: Record<string, number> = {};
    partial = { created, reused, adopted };

    for (const ref of unionRefs) {
      // 1) 既有记录（含失效条目）→ 核对仍存在 → reused
      let recordedId: number | undefined;
      for (const d of dispatches) {
        const id = d.tfs_task_ids?.[ref];
        if (typeof id === "number" && id > 0) { recordedId = id; break; }
      }
      if (recordedId !== undefined) {
        const check = await clients.tfsQuery(
          `SELECT [System.Id] FROM WorkItems WHERE [System.Id] = ${recordedId}`,
          `核对 TFS 任务 ${recordedId}（ref=${ref}）`,
        );
        if (check.length === 0) {
          throw new UnknownError(`tfs_task_ids 记录的任务 ${recordedId}（ref=${ref}）在 TFS 侧不存在——事实冲突，交 Lead 核对，不擅自重建`);
        }
        reused[ref] = recordedId;
        continue;
      }

      // 2) 孤儿认领：同前缀标题 + 父链接匹配的子任务已存在（创建后回写失败遗留）→ adopted
      //    TFS 2018 扁平 WIQL 不支持 [System.Parent]，用 Title CONTAINS 查询 + parentId（relations）过滤。
      const prefix = `[${issueKey} ${ref}]`;
      const orphans = (await clients.tfsQuery(
        `SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS '${prefix}'`,
        `孤儿任务查询(parent=${tfsId}, ref=${ref})`,
      )).filter((wi) => typeof wi.title === "string" && (wi.title as string).startsWith(prefix) && wi.parentId === tfsId);
      if (orphans.length > 0) {
        adopted[ref] = orphans[0].id;
        continue;
      }

      // 3) 创建 TFS 管理投影：不强制估算；历史合法尾注可兼容写入。
      const owner = activeEntries.find((d) => (d.task_refs ?? []).includes(ref));
      const rawText = extractTaskText(tasksText, ref) as string;
      const estimate = parseEstimate(rawText);
      const title = `${prefix} ${truncateTitleText(stripEstimateTail(rawText))}`;
      const descriptionFile = join(tmpdir(), `tfs-task-${issueKey}-${ref.replace(/[^\w.-]/g, "_")}.md`);
      writeFileSync(descriptionFile, [
        `Multica Delivery Issue: ${issueKey}`,
        `OpenSpec Change: openspec/changes/${changeRef}/`,
        `Task ref: ${ref}`,
        `派发身份 dispatch_key: ${owner?.dispatch_key ?? "(未知)"}`,
        `Task: ${rawText}`,
        ...(estimate !== null ? [`预估: ${estimate}h`] : []),
        ``,
        `工程真相以 OpenSpec Change 为准（Reference-not-Replication，本任务不复制需求/验收内容）。`,
      ].join("\n"), "utf8");
      try {
        const wi = await clients.tfsCreateTask({ title, parent: tfsId, project: parentProject, descriptionFile, ...(estimate !== null ? { estimate } : {}) });
        created[ref] = wi.id;
      } finally {
        try { unlinkSync(descriptionFile); } catch { /* 临时文件清理失败不影响主流程 */ }
      }
    }

    // --- 回写：合并进对应 active 条目 tfs_task_ids（含 reused/adopted，供后续重跑免查询） ---
    const resolved: Record<string, number> = { ...reused, ...adopted, ...created };
    for (const d of activeEntries) {
      const merged: Record<string, number> = { ...(d.tfs_task_ids ?? {}) };
      for (const ref of d.task_refs ?? []) {
        if (typeof resolved[ref] === "number") merged[ref] = resolved[ref];
      }
      d.tfs_task_ids = merged;
    }
    clients.setMetadata(issue.id, "dev.dispatch", JSON.stringify(dispatches));

    // --- 状态段（§4.2，先事实后状态）：全部 resolved 任务 set-state 活动；任一失败 exit 3 不回滚 ---
    const stateSet: Record<string, string> = {};
    const stateFailed: Array<{ ref: string; id: number; error: string }> = [];
    for (const ref of unionRefs) {
      const id = resolved[ref];
      if (typeof id !== "number") continue;
      try {
        await clients.tfsSetState(id, "活动");
        stateSet[ref] = "活动";
      } catch (exc) {
        stateFailed.push({ ref, id, error: exc instanceof Error ? exc.message : String(exc) });
      }
    }

    const summary: Record<string, unknown> = {
      issue: issueKey,
      parent: tfsId,
      parent_project: parentProject,
      created,
      reused,
      adopted,
      active_entries: activeEntries.length,
      state_set: stateSet,
    };
    if (stateFailed.length > 0) {
      process.stdout.write(JSON.stringify({
        result: "UNKNOWN",
        reason: "部分任务置'活动'失败（metadata 已回写不回滚；修复后重跑本脚本经 reused 路径补写状态自愈）",
        ...summary,
        state_failed: stateFailed,
      }, null, 2) + "\n");
      return 3;
    }
    process.stdout.write(JSON.stringify({ result: "PASS", ...summary }, null, 2) + "\n");
    return 0;
  } catch (exc) {
    if (exc instanceof UnknownError) {
      const output: Record<string, unknown> = { result: "UNKNOWN", reason: exc.message };
      if (partial) {
        output.created = partial.created;
        output.reused = partial.reused;
        output.adopted = partial.adopted;
      }
      process.stdout.write(JSON.stringify(output, null, 2) + "\n");
      log(`UNKNOWN: ${exc.message}`);
      return 3;
    }
    throw exc;
  }
}

/** commander 注册：group=tfs；参数解析沿用原脚本实现以保证契约逐字节等价。 */
export function registerTfsMaterializeTasks(group: Command): void {
  group
    .command("materialize-tasks")
    .description("[deprecated] TFS 任务项物化——新流程由 tfs writeback 在 PR 通过后统一执行（tfs-writeback-decoupling-plan）；本命令仅作在途交付恢复入口")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      throw new ExitSignal(await main(cmd.args));
    });
}
