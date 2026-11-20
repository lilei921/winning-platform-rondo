/**
 * workspace migrate-repo-keys — 将活跃 Delivery Issue 的 legacy PR Facts repo_key 收敛到 repo-context.repo_id。
 *
 * （rondo 收编：实现位置为 @winning/skill-flow 包内 commands/workspace/migrate-repo-keys.ts，
 * 原 projects/multica/scripts/migrate-repo-keys.ts 在迁移窗口期保持有效。）
 *
 * 默认 dry-run；只有显式 --apply 才写 metadata。只处理 pr_prep / current_pr /
 * pr.abandoned / finalize.pending，不改 status、assignee、Run、TFS、PR 或 Git。
 * done/cancelled 历史 Issue 默认跳过；pr_history 或未知结构一律 UNKNOWN。
 *
 * 用法：
 *   rondo workspace migrate-repo-keys --workspace <name> [--issue <KEY|id>] [--config <repo-registry.json>] [--dry-run]
 *   rondo workspace migrate-repo-keys --workspace <name> --apply [--backup-dir <仓外目录>]
 *
 * 退出码：0 PASS / 2 单项写入或回读失败 / 3 配置或 Facts UNKNOWN / 64 用法错误。
 * stdout 只出 JSON；日志走 stderr。Node ≥ 23.6 直跑，零 npm 依赖。
 */

import { multicaPrefix } from "../../clients/multica-environment.js";
import type { RuntimeConfig } from "../../clients/config.js";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Command } from "commander";
import { UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { runJson } from "../../clients/spawn.js";
import { resolveMulticaRoot } from "../../clients/repo-root.js";

// 根定位见 clients/repo-root.ts（npm pack 全局安装后不能按包内位置回推）。
// 模块级可变绑定由 main() 开头的 initRoots() 填充，helper 函数引用。
let REPO_ROOT = "";
let MONOREPO_ROOT = "";
function initRoots(): void {
  const r = resolveMulticaRoot();
  REPO_ROOT = r.multicaRoot;
  MONOREPO_ROOT = r.monorepoRoot;
}
const FACT_KEYS = ["pr_prep", "current_pr", "pr.abandoned", "finalize.pending"] as const;
type FactKey = typeof FACT_KEYS[number];

export const LEGACY_TO_REPO_ID: Readonly<Record<string, string>> = Object.freeze({
  "df-dataintegration": "dataintegration",
  "df-dataintegration-web": "dataintegration-web",
});

interface RegistryConfig {
  runtime: { multica_cli: string; workspace_id?: string };
  registry: Record<string, unknown>;
}

interface WorkspaceOverlay { workspace_id: string }

interface IssueRecord {
  id: string;
  identifier?: string;
  status?: string;
  assignee_id?: string | null;
  assignee_type?: string | null;
  metadata?: Record<string, unknown>;
}

interface FactChange {
  key: FactKey;
  before: unknown;
  after: unknown;
  afterRaw: string;
}

interface IssuePlan {
  issue: string;
  id: string;
  status?: string;
  assignee_id?: string | null;
  assignee_type?: string | null;
  action: "MIGRATE" | "NOOP" | "UNKNOWN" | "SKIP_HISTORY";
  reason?: string;
  changes: FactChange[];
  original: Record<string, unknown>;
  originalPresent: Record<string, boolean>;
}

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function parseJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (exc) {
    throw new UnknownError(`无法读取 JSON ${path}: ${exc instanceof Error ? exc.message : String(exc)}`);
  }
}

// 共享层缺口：clients/config.ts 的 loadConfig 校验消息形态（缺 `: ${path}` 尾缀、无 requireRegistry 关闭
// tfs_cli 的组合）与本脚本原校验不逐字一致，故保留本地 loadConfig 以维持原校验语义。
function loadConfig(path: string): RegistryConfig {
  const cfg = parseJsonFile(path) as RegistryConfig;
  if (!isObject(cfg) || !isObject(cfg.runtime) || typeof cfg.runtime.multica_cli !== "string"
    || !cfg.runtime.multica_cli || !isObject(cfg.registry)) {
    throw new UnknownError(`配置缺少 runtime.multica_cli / registry: ${path}`);
  }
  return cfg;
}

function loadOverlay(workspace: string): WorkspaceOverlay {
  if (!/^[A-Za-z0-9._-]+$/.test(workspace) || workspace === "." || workspace === "..") {
    throw new UnknownError(`非法 workspace 名称: ${workspace}`);
  }
  const path = join(REPO_ROOT, "workspace-config", "workspaces", `${workspace}.json`);
  const overlay = parseJsonFile(path) as WorkspaceOverlay;
  if (!isObject(overlay) || typeof overlay.workspace_id !== "string" || !overlay.workspace_id) {
    throw new UnknownError(`overlay 缺少 workspace_id: ${path}`);
  }
  return overlay;
}

function mapRepoKey(value: unknown, validRepoIds: ReadonlySet<string>): { before: string; after: string } {
  if (typeof value !== "string" || !value) throw new UnknownError("repo_key 缺失或不是非空字符串");
  const after = LEGACY_TO_REPO_ID[value] ?? value;
  if (!validRepoIds.has(after)) throw new UnknownError(`未登记的 repo_key，无明确迁移映射: ${value}`);
  return { before: value, after };
}

function parseFact(issue: IssueRecord, key: FactKey): { present: boolean; raw?: string; value?: unknown } {
  const md = issue.metadata ?? {};
  if (!hasOwn(md, key)) return { present: false };
  const raw = md[key];
  if (typeof raw !== "string") throw new UnknownError(`${key} 不是 string 类型存储的 JSON`);
  try {
    return { present: true, raw, value: JSON.parse(raw) };
  } catch {
    throw new UnknownError(`${key} 不是合法 JSON`);
  }
}

function requireArray(value: unknown, key: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new UnknownError(`${key} 必须是数组`);
  return value.map((entry, index) => {
    if (!isObject(entry)) throw new UnknownError(`${key}[${index}] 必须是对象`);
    return entry;
  });
}

function requirePrId(entry: Record<string, unknown>, key: string): number {
  const id = entry.pr_id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    throw new UnknownError(`${key} 的 pr_id 必须是正整数`);
  }
  return id;
}

function assertNoDuplicate(entries: Record<string, unknown>[], mappedKeys: string[], key: string): void {
  const seen = new Set<string>();
  for (const repoKey of mappedKeys) {
    if (seen.has(repoKey)) throw new UnknownError(`${key} 迁移后存在重复 repo_key 或新旧键冲突: ${repoKey}`);
    seen.add(repoKey);
  }
}

function migrateRepoArray(
  value: unknown,
  key: "pr_prep" | "current_pr",
  validRepoIds: ReadonlySet<string>,
): { value: Record<string, unknown>[]; repoKeys: string[] } {
  const entries = requireArray(value, key);
  const repoKeys: string[] = [];
  const migrated = entries.map((entry, index) => {
    const mapped = mapRepoKey(entry.repo_key, validRepoIds);
    if (key === "current_pr") requirePrId(entry, `${key}[${index}]`);
    repoKeys.push(mapped.after);
    return mapped.before === mapped.after ? entry : { ...entry, repo_key: mapped.after };
  });
  assertNoDuplicate(entries, repoKeys, key);
  return { value: migrated, repoKeys };
}

function canonicalEvent(issueKey: string, repoKey: string, prId: number, terminal: "abandoned" | "completed"): string {
  return `${issueKey}#${repoKey}#${prId}#${terminal}`;
}

function migrateAbandoned(
  value: unknown,
  issueKey: string,
  validRepoIds: ReadonlySet<string>,
): Record<string, unknown>[] {
  const entries = requireArray(value, "pr.abandoned");
  const events = new Set<string>();
  return entries.map((entry, index) => {
    const mapped = mapRepoKey(entry.repo_key, validRepoIds);
    const prId = requirePrId(entry, `pr.abandoned[${index}]`);
    if (typeof entry.event_key !== "string") throw new UnknownError(`pr.abandoned[${index}] 缺少 event_key`);
    const expectedBefore = canonicalEvent(issueKey, mapped.before, prId, "abandoned");
    if (entry.event_key !== expectedBefore) {
      throw new UnknownError(`pr.abandoned[${index}] event_key 与 issue/repo_key/pr_id 不一致`);
    }
    const eventKey = canonicalEvent(issueKey, mapped.after, prId, "abandoned");
    if (events.has(eventKey)) throw new UnknownError(`pr.abandoned 迁移后存在重复 event_key: ${eventKey}`);
    events.add(eventKey);
    return mapped.before === mapped.after ? entry : { ...entry, repo_key: mapped.after, event_key: eventKey };
  });
}

function parsePendingEvent(event: unknown, issueKey: string, validRepoIds: ReadonlySet<string>): {
  before: string;
  after: string;
  repoKey: string;
  prId: number;
} {
  if (typeof event !== "string") throw new UnknownError("finalize.pending.event_keys[] 必须都是字符串");
  const match = /^([^#]+)#([^#]+)#(\d+)#completed$/.exec(event);
  if (!match || match[1] !== issueKey) throw new UnknownError(`finalize.pending 含非法或不属于本 Issue 的 completed event_key: ${event}`);
  const mapped = mapRepoKey(match[2], validRepoIds);
  const prId = Number(match[3]);
  if (!Number.isSafeInteger(prId) || prId <= 0) throw new UnknownError(`finalize.pending 含非法 pr_id: ${event}`);
  const expectedBefore = canonicalEvent(issueKey, mapped.before, prId, "completed");
  if (event !== expectedBefore) throw new UnknownError(`finalize.pending event_key 解析不一致: ${event}`);
  return {
    before: event,
    after: canonicalEvent(issueKey, mapped.after, prId, "completed"),
    repoKey: mapped.after,
    prId,
  };
}

function migratePending(
  value: unknown,
  issueKey: string,
  validRepoIds: ReadonlySet<string>,
): { value: Record<string, unknown>; identities: string[] } {
  if (!isObject(value) || !Array.isArray(value.event_keys) || value.event_keys.length === 0) {
    throw new UnknownError("finalize.pending 必须是含非空 event_keys 数组的对象");
  }
  const parsed = value.event_keys.map((event) => parsePendingEvent(event, issueKey, validRepoIds));
  const afterEvents = parsed.map((event) => event.after);
  if (new Set(afterEvents).size !== afterEvents.length) {
    throw new UnknownError("finalize.pending 迁移后存在重复 event_key 或新旧键冲突");
  }
  return {
    value: { ...value, event_keys: afterEvents },
    identities: parsed.map((event) => `${event.repoKey}#${event.prId}`),
  };
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length
    && new Set(right).size === right.length && left.every((value) => right.includes(value));
}

/** 纯计划函数：不执行 CLI、不写文件，供离线 fixture 验证。 */
export function planIssueMigration(issue: IssueRecord, validRepoIds: ReadonlySet<string>): IssuePlan {
  const issueKey = issue.identifier ?? issue.id;
  const original: Record<string, unknown> = {};
  const originalPresent: Record<string, boolean> = {};
  for (const key of [...FACT_KEYS, "pr_history"]) {
    originalPresent[key] = hasOwn(issue.metadata ?? {}, key);
    original[key] = (issue.metadata ?? {})[key];
  }
  const base: IssuePlan = {
    issue: issueKey,
    id: issue.id,
    status: issue.status,
    assignee_id: issue.assignee_id,
    assignee_type: issue.assignee_type,
    action: "NOOP",
    changes: [],
    original,
    originalPresent,
  };
  if (issue.status === "done" || issue.status === "cancelled") {
    return { ...base, action: "SKIP_HISTORY", reason: "done/cancelled 历史 Facts 默认不迁移" };
  }

  try {
    if (hasOwn(issue.metadata ?? {}, "pr_history")) {
      throw new UnknownError("发现 pr_history 或未知扩展结构，拒绝猜测迁移");
    }
    const parsed = new Map<FactKey, { raw?: string; value?: unknown }>();
    for (const key of FACT_KEYS) {
      const fact = parseFact(issue, key);
      if (fact.present) parsed.set(key, fact);
    }

    let prepRepos: string[] | null = null;
    let currentRepos: string[] | null = null;
    let currentIdentities: string[] | null = null;
    let pendingIdentities: string[] | null = null;

    for (const key of FACT_KEYS) {
      const fact = parsed.get(key);
      if (!fact) continue;
      let migrated: unknown;
      if (key === "pr_prep") {
        const result = migrateRepoArray(fact.value, key, validRepoIds);
        migrated = result.value;
        prepRepos = result.repoKeys;
      } else if (key === "current_pr") {
        const result = migrateRepoArray(fact.value, key, validRepoIds);
        migrated = result.value;
        currentRepos = result.repoKeys;
        currentIdentities = result.value.map((entry) => `${entry.repo_key}#${entry.pr_id}`);
      } else if (key === "pr.abandoned") {
        migrated = migrateAbandoned(fact.value, issueKey, validRepoIds);
      } else {
        const result = migratePending(fact.value, issueKey, validRepoIds);
        migrated = result.value;
        pendingIdentities = result.identities;
      }
      if (JSON.stringify(migrated) !== JSON.stringify(fact.value)) {
        base.changes.push({ key, before: fact.value, after: migrated, afterRaw: JSON.stringify(migrated) });
      }
    }

    if (prepRepos && currentRepos && !sameStringSet(prepRepos, currentRepos)) {
      throw new UnknownError("pr_prep 与 current_pr 的 repo_key 集合不一致");
    }
    if (pendingIdentities) {
      if (!currentIdentities || !sameStringSet(pendingIdentities, currentIdentities)) {
        throw new UnknownError("finalize.pending.event_keys 与 current_pr 的 repo_key/pr_id 集合不一致");
      }
    }
    base.action = base.changes.length > 0 ? "MIGRATE" : "NOOP";
    return base;
  } catch (exc) {
    return {
      ...base,
      action: "UNKNOWN",
      reason: exc instanceof Error ? exc.message : String(exc),
      changes: [],
    };
  }
}

// --- Multica CLI（flag 已对照安装版 0.6.4 核验；升级后须复核） ---
// 共享层缺口：clients/multica.ts 的 MulticaClient 无分页 listIssues（--limit/--offset/has_more 扫描），
// 故保留本地 Clients 类（内部统一走 clients/spawn.ts 的 runJson）。
class Clients {
  private cli: string[];
  private workspaceId: string;

  constructor(runtime: RuntimeConfig, workspaceId: string) {
    this.cli = multicaPrefix(runtime);
    this.workspaceId = workspaceId;
  }

  private ws(): string[] {
    return ["--workspace-id", this.workspaceId];
  }

  getIssue(issueKey: string): IssueRecord {
    const out = runJson([...this.cli, "issue", "get", issueKey, ...this.ws(), "--output", "json"], `读取 Issue ${issueKey}`, undefined, { transient: true });
    if (!isObject(out) || typeof out.id !== "string" || !out.id) throw new UnknownError(`读取 Issue ${issueKey} 返回缺少 id`);
    return out as unknown as IssueRecord;
  }

  listIssues(): IssueRecord[] {
    const out: IssueRecord[] = [];
    let offset = 0;
    for (;;) {
      const raw = runJson([
        ...this.cli, "issue", "list", "--limit", "100", "--offset", String(offset),
        "--fields", "id,identifier,status,assignee_id,assignee_type", ...this.ws(), "--output", "json",
      ], `扫描 Issue(offset=${offset})`, undefined, { transient: true });
      const page = Array.isArray(raw) ? raw : (isObject(raw) && Array.isArray(raw.issues) ? raw.issues : null);
      if (!page) throw new UnknownError("issue list 返回既不是数组，也不是含 issues 数组的对象");
      out.push(...page as IssueRecord[]);
      const hasMore = !Array.isArray(raw) && isObject(raw) && raw.has_more === true;
      if (page.length === 0 || (!hasMore && (Array.isArray(raw) || page.length < 100))) break;
      offset += page.length;
    }
    return out;
  }

  setMetadata(issueId: string, key: FactKey, value: string): void {
    runJson([
      ...this.cli, "issue", "metadata", "set", issueId, "--key", key, "--value", value,
      "--type", "string", ...this.ws(), "--output", "json",
    ], `写入 metadata(issue=${issueId}, key=${key})`);
  }
}

function sameSnapshot(plan: IssuePlan, latest: IssueRecord): boolean {
  if (plan.status !== latest.status || plan.assignee_id !== latest.assignee_id
    || plan.assignee_type !== latest.assignee_type) return false;
  return Object.keys(plan.original).every((key) => plan.originalPresent[key] === hasOwn(latest.metadata ?? {}, key)
    && plan.original[key] === (latest.metadata ?? {})[key]);
}

function publicPlan(plan: IssuePlan): Record<string, unknown> {
  return {
    issue: plan.issue,
    status: plan.status,
    action: plan.action,
    ...(plan.reason ? { reason: plan.reason } : {}),
    changes: plan.changes.map(({ key, before, after }) => ({ key, before, after })),
  };
}

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function writeBackup(runDir: string, plan: IssuePlan): string {
  mkdirSync(runDir, { recursive: true });
  const safeName = plan.issue.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = join(runDir, `${safeName}-${plan.id}.json`);
  const temp = `${path}.${process.pid}.tmp`;
  const payload = {
    schema: "repo-key-migration-backup/v1",
    issue: plan.issue,
    id: plan.id,
    status: plan.status,
    assignee_id: plan.assignee_id,
    assignee_type: plan.assignee_type,
    original_present: plan.originalPresent,
    original: plan.original,
    changes: plan.changes.map(({ key, before, after }) => ({ key, before, after })),
  };
  writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(temp, path);
  return path;
}

function parseArgs(argv: string[]): { flags: Record<string, string>; booleans: Set<string> } {
  const flags: Record<string, string> = {};
  const booleans = new Set<string>();
  const valueFlags = new Set(["workspace", "issue", "config", "backup-dir"]);
  const boolFlags = new Set(["apply", "dry-run", "help"]);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new UnknownError(`无法识别的位置参数: ${arg}`);
    const key = arg.slice(2);
    if (boolFlags.has(key)) {
      booleans.add(key);
      continue;
    }
    if (!valueFlags.has(key)) throw new UnknownError(`无法识别的参数: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new UnknownError(`参数 ${arg} 缺值`);
    flags[key] = value;
    index++;
  }
  return { flags, booleans };
}

function main(rawArgs: string[]): number {
  let args: { flags: Record<string, string>; booleans: Set<string> };
  try {
    args = parseArgs(rawArgs);
  } catch (exc) {
    process.stdout.write(`${JSON.stringify({ result: "UNKNOWN", reason: exc instanceof Error ? exc.message : String(exc) })}\n`);
    return 64;
  }
  if (args.booleans.has("help")) {
    process.stderr.write("用法: rondo workspace migrate-repo-keys --workspace <name> [--issue <KEY|id>] [--config <path>] [--dry-run | --apply] [--backup-dir <仓外目录>]\n");
    return 0;
  }
  const apply = args.booleans.has("apply");
  if (!args.flags.workspace || (apply && args.booleans.has("dry-run"))) {
    process.stdout.write(`${JSON.stringify({ result: "UNKNOWN", reason: "必须指定 --workspace，且 --apply 与 --dry-run 互斥" })}\n`);
    return 64;
  }

  const changesOut: Record<string, unknown>[] = [];
  let backupDir: string | undefined;
  try {
    initRoots();
    const overlay = loadOverlay(args.flags.workspace);
    const configPath = args.flags.config
      ? resolve(args.flags.config)
      : join(REPO_ROOT, "skills", "delivery-flow", "config", "repo-registry.json");
    if (!existsSync(configPath)) {
      throw new UnknownError(`渲染配置不存在: ${configPath}；先运行 sync-workspace.ts --workspace ${args.flags.workspace} --local-only`);
    }
    const cfg = loadConfig(configPath);
    if (cfg.runtime.workspace_id !== overlay.workspace_id) {
      throw new UnknownError("渲染配置与 workspace overlay 的 workspace_id 不一致，拒绝跨工作区操作");
    }
    const validRepoIds = new Set(Object.keys(cfg.registry));
    for (const [legacy, repoId] of Object.entries(LEGACY_TO_REPO_ID)) {
      if (!validRepoIds.has(repoId)) throw new UnknownError(`registry 缺少迁移目标 ${legacy} -> ${repoId}`);
    }

    const clients = new Clients(cfg.runtime, overlay.workspace_id);
    const candidates = args.flags.issue ? [clients.getIssue(args.flags.issue)] : clients.listIssues();
    const plans: IssuePlan[] = [];
    for (const candidate of candidates) {
      const issue = args.flags.issue ? candidate : clients.getIssue(candidate.identifier ?? candidate.id);
      plans.push(planIssueMigration(issue, validRepoIds));
    }

    let failures = 0;
    if (apply) {
      const backupRoot = resolve(args.flags["backup-dir"] ?? join(tmpdir(), "multica-repo-key-migration"));
      if (isWithin(MONOREPO_ROOT, backupRoot)) {
        process.stdout.write(`${JSON.stringify({ result: "UNKNOWN", reason: `backup-dir 必须在 monorepo 仓外: ${backupRoot}` })}\n`);
        return 64;
      }
      for (const plan of plans) {
        if (plan.action !== "MIGRATE") {
          changesOut.push(publicPlan(plan));
          continue;
        }
        const item = publicPlan(plan);
        try {
          const latest = clients.getIssue(plan.id);
          if (!sameSnapshot(plan, latest)) throw new Error("apply 前回读与迁移计划输入不一致，未写入");
          if (!backupDir) backupDir = join(backupRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`);
          const backup = writeBackup(backupDir, plan);
          const written: FactKey[] = [];
          for (const change of plan.changes) {
            clients.setMetadata(plan.id, change.key, change.afterRaw);
            const afterWrite = clients.getIssue(plan.id);
            if ((afterWrite.metadata ?? {})[change.key] !== change.afterRaw) {
              throw new Error(`写入后回读不一致: ${change.key}`);
            }
            if (afterWrite.status !== plan.status || afterWrite.assignee_id !== plan.assignee_id
              || afterWrite.assignee_type !== plan.assignee_type) {
              throw new Error(`迁移期间 status/Owner 发生变化: ${change.key}`);
            }
            written.push(change.key);
          }
          const final = clients.getIssue(plan.id);
          const verified = plan.changes.every((change) => (final.metadata ?? {})[change.key] === change.afterRaw)
            && final.status === plan.status && final.assignee_id === plan.assignee_id
            && final.assignee_type === plan.assignee_type;
          if (!verified) throw new Error("最终回读校验失败");
          changesOut.push({ ...item, action: "MIGRATED", backup, written, readback: "PASS" });
        } catch (exc) {
          failures++;
          changesOut.push({ ...item, action: "FAILED", reason: exc instanceof Error ? exc.message : String(exc) });
        }
      }
    } else {
      changesOut.push(...plans.map(publicPlan));
    }

    const unknown = plans.filter((plan) => plan.action === "UNKNOWN").length;
    const migrated = changesOut.filter((item) => item.action === "MIGRATED").length;
    const wouldMigrate = plans.filter((plan) => plan.action === "MIGRATE").length;
    const result = failures > 0 ? "FAIL" : unknown > 0 ? "UNKNOWN" : "PASS";
    const output = {
      result,
      mode: apply ? "apply" : "dry-run",
      workspace: args.flags.workspace,
      scanned: plans.length,
      would_migrate: apply ? undefined : wouldMigrate,
      migrated: apply ? migrated : undefined,
      noop: plans.filter((plan) => plan.action === "NOOP").length,
      skipped_history: plans.filter((plan) => plan.action === "SKIP_HISTORY").length,
      unknown,
      failed: failures,
      ...(backupDir ? { backup_dir: backupDir } : {}),
      issues: changesOut,
    };
    process.stdout.write(`${JSON.stringify(output, (_key, value) => value === undefined ? undefined : value, 2)}\n`);
    return failures > 0 ? 2 : unknown > 0 ? 3 : 0;
  } catch (exc) {
    const reason = exc instanceof Error ? exc.message : String(exc);
    process.stdout.write(`${JSON.stringify({ result: "UNKNOWN", reason }, null, 2)}\n`);
    log(`UNKNOWN: ${reason}`);
    return 3;
  }
}

/** commander 注册：group=workspace；参数解析沿用原脚本实现以保证契约逐字节等价。 */
export function registerWorkspaceMigrateRepoKeys(group: Command): void {
  group
    .command("migrate-repo-keys")
    .description("repo_key 收敛迁移")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action((...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      throw new ExitSignal(main(cmd.args));
    });
}
