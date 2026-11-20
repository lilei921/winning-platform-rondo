/**
 * resolve-tasks.ts — TFS 任务批量置"已解决"（02 §9 Lead 汇总点，用户裁定②）。
 * 方案：archive/docs-2026-10-26/tfs-state-writeback-plan.md §4.3（历史溯源）。
 *
 * 裁决 D3 修订：自 rondo 收编起，实现位置为 @winning/skill-flow 包内
 * commands/tfs/resolve-tasks.ts，原 projects/multica/workspace-skills/delivery-flow/scripts/
 * resolve-tfs-tasks.ts 路径在迁移窗口期保持有效（见 change-progress-script-contract.md addendum）。
 *
 * 调用方：Delivery Lead，收齐全部 active dispatch 完成声明（各 Engineer Completion Check PASS
 * 回流）后、PR 物化前调用；exit 3 不阻塞 PR 物化（平面隔离），如实回流交 Human。
 *
 * 前置（任一不过 → exit 2，零写入）：
 *   1. Issue 可读，metadata 含 dev.dispatch；
 *   2. dev.dispatch 至少一条 active:true 条目；
 *   3. 全部 active 条目 task_refs 并集每个 ref 都有 tfs_task_ids 映射（任意 dispatch 条目
 *      记录即可，含失效条目；缺 → FAIL，提示先重跑 materialize-tfs-tasks 补齐）。
 *
 * 流程：ID 并集去重 → 逐任务 set-state 已解决（幂等，单个失败不中断；带 --complete-with-estimate
 * 同一 PATCH 落库 CompletedWork=OriginalEstimate、RemainingWork=0，用户裁定 2026-10-20 §4.3）
 * → WIQL 回读核对（state + 工时字段）。
 * 输出 { result, resolved: {ref: id}, failed: [...], estimate_missing: [...] }；全部已解决且工时齐 → exit 0；
 * 任一置态失败/回读不符 → exit 3 UNKNOWN（部分成功如实列明，重跑幂等自愈）。
 * OE 缺失的任务只写 RW=0、不核对 CW，列入 estimate_missing 如实回流（不视为失败）。
 * 不写防重 metadata（set-state 幂等 + 回读核对已提供确定性验证，§4.3 裁定）。
 *
 * 用法：rondo tfs resolve-tasks --config <repo-registry.json> --issue <KEY>
 * 退出码：0 PASS / 2 FAIL（前置，零写入）/ 3 UNKNOWN / 64 用法错误。stdout 只出 JSON；日志走 stderr。
 *
 * 类型分支（tfs-bug-delivery-task-skip-plan §4.2，2026-10-26）：metadata tfs.type=Bug 且全部
 *   task_refs 无 tfs_task_ids 映射 → NOOP（Bug 交付不建 TFS 子任务）；Bug 但存在映射（历史已建
 *   任务）→ 维持现有置态与工时核对，不丢历史；tfs.type=需求 → 现有逻辑；缺失/其他 → UNKNOWN。
 *
 * 运行环境：Node ≥ 23.6 直跑（22.6+ 需 --experimental-strip-types）；只用可擦除类型注解；零 npm 依赖。
 */

import { Command } from "commander";
import { UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { loadConfig } from "../../clients/config.js";
import { MulticaClient, type IssueRecord } from "../../clients/multica.js";
import { TfsClient } from "../../clients/tfs.js";

interface RegistryConfig {
  runtime: { multica_cli: string; workspace_id?: string; tfs_cli?: string[] };
}

interface DispatchEntry {
  dispatch_key: string;
  task_refs: string[];
  active: boolean;
  tfs_task_ids?: Record<string, number>;
}

interface TfsWorkItem {
  id: number;
  state?: string | null;
  originalEstimate?: number | null;
  remainingWork?: number | null;
  completedWork?: number | null;
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

  async tfsQuery(wiql: string, what: string): Promise<TfsWorkItem[]> {
    const out = await this.tfs.run(["query", "--wiql", wiql], what);
    if (!Array.isArray(out)) throw new UnknownError(`${what} 输出不是数组`);
    return out as TfsWorkItem[];
  }

  async tfsSetState(id: number, state: string): Promise<{ estimateMissing?: boolean }> {
    const out = await this.tfs.run(
      ["workitem", "set-state", "--id", String(id), "--state", state, "--complete-with-estimate"],
      `置 TFS 任务 ${id} 状态为 ${state}`,
    ) as { estimateMissing?: boolean };
    return out ?? {};
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

async function main(rawArgs: string[]): Promise<number> {
  const args = parseArgs(rawArgs);
  const missingArgs = ["config", "issue"].filter((k) => typeof args[k] !== "string" || args[k] === "");
  if (missingArgs.length > 0) {
    process.stderr.write(
      "用法: rondo tfs resolve-tasks --config <repo-registry.json> --issue <KEY>\n" +
      `缺少参数: ${missingArgs.join(", ")}\n`,
    );
    return 64;
  }

  try {
    const cfg = loadConfig<RegistryConfig>(args.config as string, { requireRegistry: false });
    const clients = new Clients(cfg);
    const issue = clients.getIssue(args.issue as string);
    const issueKey = issue.identifier ?? issue.id;
    const md = issue.metadata ?? {};

    let dispatches: DispatchEntry[] = [];
    const rawDispatch = md["dev.dispatch"];
    if (rawDispatch) {
      try { dispatches = JSON.parse(rawDispatch) as DispatchEntry[]; }
      catch { throw new UnknownError(`Issue ${issueKey} 的 metadata dev.dispatch 不是合法 JSON`); }
      if (!Array.isArray(dispatches)) throw new UnknownError(`Issue ${issueKey} 的 metadata dev.dispatch 不是数组`);
    }
    const activeEntries = dispatches.filter((d) => d.active);

    // --- 前置（任一不过 → FAIL，零写入） ---
    const reasons: string[] = [];
    if (activeEntries.length === 0) {
      reasons.push("dev.dispatch 无 active:true 条目——先完成派发物化（materialize-development）");
    }
    const unionRefs = [...new Set(activeEntries.flatMap((d) => d.task_refs ?? []))].sort();
    if (activeEntries.length > 0 && unionRefs.length === 0) reasons.push("active dispatch 条目的 task_refs 并集为空");

    // 映射来源：任意 dispatch 条目（含失效）记录的第一个 id——与 materialize-tfs-tasks recordedId 查询一致
    const idByRef = new Map<string, number>();
    for (const d of dispatches) {
      for (const [ref, id] of Object.entries(d.tfs_task_ids ?? {})) {
        if (typeof id === "number" && id > 0 && !idByRef.has(ref)) idByRef.set(ref, id);
      }
    }

    // --- 类型分支（tfs-bug-delivery-task-skip-plan §4.2）：Bug 无映射 → NOOP；有映射维持现有核对 ---
    const tfsType = typeof md["tfs.type"] === "string" ? (md["tfs.type"] as string) : "";
    if (tfsType === "Bug" && idByRef.size === 0) {
      process.stdout.write(JSON.stringify({
        result: "NOOP",
        reason: "tfs_type_bug_skip（Bug 交付无 TFS 子任务面，无需置态）",
        issue: issueKey,
        tfs_type: tfsType,
        resolved: {},
        failed: [],
        estimate_missing: [],
      }, null, 2) + "\n");
      return 0;
    }
    if (tfsType !== "Bug" && tfsType !== "需求") {
      throw new UnknownError(`Issue ${issueKey} metadata tfs.type 缺失或不是 需求/Bug: ${tfsType || "(缺失)"}——交 Lead 核对来源同步`);
    }

    const unmapped = unionRefs.filter((ref) => !idByRef.has(ref));
    if (unmapped.length > 0) {
      reasons.push(`task_refs 缺 tfs_task_ids 映射: ${unmapped.join(", ")}——先重跑 materialize-tfs-tasks 补齐`);
    }
    if (reasons.length > 0) {
      process.stdout.write(JSON.stringify({ result: "FAIL", reasons }, null, 2) + "\n");
      return 2;
    }

    // --- 逐任务置态 + 工时落库（ID 并集去重；单个失败不中断） ---
    const resolved: Record<string, number> = {};
    const failed: Array<Record<string, unknown>> = [];
    const estimateMissing: Array<Record<string, unknown>> = [];
    for (const ref of unionRefs) {
      const id = idByRef.get(ref) as number;
      resolved[ref] = id;
    }
    const uniqueIds = [...new Set(Object.values(resolved))];
    const refById = new Map<number, string>();
    for (const [ref, id] of Object.entries(resolved)) if (!refById.has(id)) refById.set(id, ref);

    for (const id of uniqueIds) {
      try {
        const out = await clients.tfsSetState(id, "已解决");
        if (out.estimateMissing) {
          estimateMissing.push({ ref: refById.get(id), id, note: "OriginalEstimate 缺失，仅落库 RemainingWork=0" });
        }
      } catch (exc) {
        failed.push({ ref: refById.get(id), id, error: exc instanceof Error ? exc.message : String(exc) });
      }
    }

    // --- 回读核对：state 不为"已解决"或工时字段不齐（RW≠0；OE 存在而 CW≠OE）的列入 failed
    // （置态已失败的 id 不重复列；OE 缺失不核对 CW，已在 estimate_missing 标注） ---
    const failedIds = new Set(failed.map((f) => f.id as number));
    const readback = await clients.tfsQuery(
      `SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN (${uniqueIds.join(", ")})`,
      "回读任务状态核对",
    );
    const wiById = new Map<number, TfsWorkItem>();
    for (const wi of readback) wiById.set(wi.id, wi);
    for (const id of uniqueIds) {
      if (failedIds.has(id)) continue;
      const wi = wiById.get(id);
      if (!wi) {
        failed.push({ ref: refById.get(id), id, error: "回读未找到该任务（不存在或不可读）" });
        continue;
      }
      if (wi.state !== "已解决") {
        failed.push({ ref: refById.get(id), id, state: wi.state ?? null });
        continue;
      }
      const problems: string[] = [];
      if (wi.remainingWork !== 0) problems.push(`remainingWork=${wi.remainingWork ?? null}（应为 0）`);
      if (typeof wi.originalEstimate === "number" && wi.completedWork !== wi.originalEstimate) {
        problems.push(`completedWork=${wi.completedWork ?? null}（应为 originalEstimate=${wi.originalEstimate}）`);
      }
      if (problems.length > 0) {
        failed.push({ ref: refById.get(id), id, error: `工时字段未落齐: ${problems.join("; ")}` });
      }
    }

    if (failed.length > 0) {
      process.stdout.write(JSON.stringify({
        result: "UNKNOWN",
        reason: "部分任务未达'已解决'或工时未落齐（如实列明；修复后重跑本脚本幂等补齐）",
        resolved,
        failed,
        estimate_missing: estimateMissing,
      }, null, 2) + "\n");
      return 3;
    }
    process.stdout.write(JSON.stringify(
      { result: "PASS", issue: issueKey, resolved, failed: [], estimate_missing: estimateMissing },
      null, 2,
    ) + "\n");
    return 0;
  } catch (exc) {
    if (exc instanceof UnknownError) {
      process.stdout.write(JSON.stringify({ result: "UNKNOWN", reason: exc.message }, null, 2) + "\n");
      log(`UNKNOWN: ${exc.message}`);
      return 3;
    }
    throw exc;
  }
}

/** commander 注册：group=tfs；参数解析沿用原脚本实现以保证契约逐字节等价。 */
export function registerTfsResolveTasks(group: Command): void {
  group
    .command("resolve-tasks")
    .description("[deprecated] TFS 任务批量置已解决——新流程由 tfs writeback 在 PR 通过后统一执行（tfs-writeback-decoupling-plan）；本命令仅作在途交付恢复入口")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      throw new ExitSignal(await main(cmd.args));
    });
}
