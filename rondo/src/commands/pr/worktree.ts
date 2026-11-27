#!/usr/bin/env node
/**
 * worktree.ts — 业务仓 worktree 生命周期管理（ops guide §3.5 落地）。
 *
 * 目录约定（root_repo 为 monorepo 根仓，repo_path 来自 repo-context 渲染结果）：
 *   root_repo/<repo_path>/                  常驻枢纽克隆（只 fetch/push，不开发）
 *   root_repo/.worktrees/<issue>-<repo_id>/  每 Issue×仓 工作树（checkout 特性分支）
 *
 * 命令：
 *   rondo pr worktree create --issue <KEY> --repo <repo_key> --branch <branch> [--base <target>] --config <path> [--root-repo <path>]
 *   rondo pr worktree remove --issue <KEY> --repo <repo_key> --config <path> [--root-repo <path>]
 *   rondo pr worktree prune  --config <path> --root-repo <path>
 *
 * 根仓路径必须通过 --root-repo 显式传入，所有操作先核验本地 Git 根目录。
 * 缺少路径或目录不可用时返回 UNKNOWN（exit 3），不从平台发现挂载。
 *
 * 退出码：0 成功 / 2 单项失败（脏树拒删等）/ 3 UNKNOWN（分支冲突、Issue 状态不可确认等）/ 64 用法错误。
 * stdout 只出 JSON；日志走 stderr。
 *
 * 纪律：create/remove 幂等；remove 前校验工作树干净，不吞未提交工作；
 * git 禁止同一分支被两个 worktree checkout——分支冲突 UNKNOWN，不擅自换分支。
 *
 * 收编说明（D3 修订）：自 rondo 收编起，实现位置为 @winning/skill-flow 包内
 * commands/pr/worktree.ts，原 projects/multica/workspace-skills/pull-request/scripts/worktree.ts
 * 路径在迁移窗口期保持有效。
 */

import { multicaPrefix } from "../../clients/multica-environment.js";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { Command } from "commander";
import { UnknownError, FailError } from "../../cli/errors.js";
import { ExitSignal, logLine, markLeafExecuted } from "../../cli/output.js";
import { runCommand } from "../../clients/spawn.js";
import { loadConfig, type BaseRegistryConfig } from "../../clients/config.js";
import { MulticaClient } from "../../clients/multica.js";
import { resolveRuntimePaths, type RuntimePaths } from "../../clients/runtime-paths.js";

interface RepoEntry {
  repo_path: string;
  tfs_repo?: string;
  tfs_project?: string;
  default_target_branch?: string;
}

interface RegistryConfig extends BaseRegistryConfig {
  registry: Record<string, RepoEntry>;
}

function log(msg: string): void {
  logLine(msg);
}

/** create/remove 的 Issue 上下文：只取 project_id（§4.3 解析链入口）。 */
function getIssueProjectId(multica: MulticaClient, issueKey: string): string | undefined {
  return multica.getIssue(issueKey).project_id ?? undefined;
}

function git(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  return runCommand(["git", ...args], cwd);
}

function gitOk(cwd: string, args: string[], what: string): string {
  const r = git(cwd, args);
  if (r.status !== 0) throw new UnknownError(`${what} 失败: ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout.trim();
}

function worktreePath(paths: RuntimePaths, issue: string, repoKey: string): string {
  return join(paths.rootRepo, ".worktrees", `${issue}-${repoKey}`);
}

function hubPath(cfg: RegistryConfig, paths: RuntimePaths, repoKey: string): string {
  const entry = cfg.registry[repoKey];
  if (!entry) {
    throw new FailError(JSON.stringify({ ok: false, reason: "repo_key_not_in_registry", repo_key: repoKey }));
  }
  const repoPath = entry.repo_path;
  if (typeof repoPath !== "string" || repoPath === "." || repoPath === ".."
    || repoPath.trim() !== repoPath || isAbsolute(repoPath) || /[<>:"/\\|?*\0]/.test(repoPath)) {
    throw new FailError(JSON.stringify({ ok: false, reason: "invalid_repo_path", repo_key: repoKey, repo_path: repoPath }));
  }
  return join(paths.rootRepo, repoPath);
}

/** git worktree list --porcelain → [{path, branch}]（branch 为短名，可能 undefined=detached） */
function listWorktrees(hub: string): Array<{ path: string; branch?: string }> {
  const out = gitOk(hub, ["worktree", "list", "--porcelain"], "列出 worktree");
  const entries: Array<{ path: string; branch?: string }> = [];
  let cur: { path?: string; branch?: string } = {};
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (cur.path) entries.push(cur as { path: string; branch?: string });
      cur = { path: line.slice(9).trim() };
    } else if (line.startsWith("branch ")) {
      cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
    }
  }
  if (cur.path) entries.push(cur as { path: string; branch?: string });
  return entries;
}

const normPath = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

function cmdCreate(cfg: RegistryConfig, paths: RuntimePaths, opts: { issue: string; repo: string; branch: string; base?: string }): unknown {
  const hub = hubPath(cfg, paths, opts.repo);
  if (!existsSync(join(hub, ".git"))) {
    throw new FailError(JSON.stringify({ ok: false, reason: "hub_not_cloned", hub, hint: "先人工克隆枢纽仓：git clone <tfs_url> " + hub }));
  }
  const entry = cfg.registry[opts.repo];
  const base = opts.base || entry.default_target_branch;
  if (!base) throw new FailError(JSON.stringify({ ok: false, reason: "no_base_branch", repo_key: opts.repo }));

  const wt = worktreePath(paths, opts.issue, opts.repo);

  // 幂等：已存在且分支正确 → 复用
  if (existsSync(wt)) {
    const cur = git(wt, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (cur.status === 0 && cur.stdout.trim() === opts.branch) {
      return { created: false, reused: true, path: wt, branch: opts.branch, base };
    }
    throw new UnknownError(`worktree 已存在但分支不符：${wt}（当前 ${cur.stdout.trim() || "未知"}，期望 ${opts.branch}）`);
  }

  gitOk(hub, ["fetch", "origin", "--prune"], "fetch origin");

  // 同分支互斥：git 禁止同一分支被两个 worktree checkout
  const holder = listWorktrees(hub).find((w) => w.branch === opts.branch);
  if (holder) {
    throw new UnknownError(`分支 ${opts.branch} 已被 worktree ${holder.path} 占用（同分支互斥，交人工核对）`);
  }

  // 分支已存在（远端或本地——上次 create 后 worktree 被 remove、分支保留）→ 直接挂接；
  // 否则从 origin/<base> 新建
  const remoteRef = git(hub, ["rev-parse", "--verify", `refs/remotes/origin/${opts.branch}`]);
  const localRef = git(hub, ["rev-parse", "--verify", `refs/heads/${opts.branch}`]);
  const args = remoteRef.status === 0 || localRef.status === 0
    ? ["worktree", "add", wt, opts.branch]
    : ["worktree", "add", wt, "-b", opts.branch, `origin/${base}`];
  gitOk(hub, args, "创建 worktree");

  return { created: true, reused: false, path: wt, branch: opts.branch, base };
}

function cmdRemove(cfg: RegistryConfig, paths: RuntimePaths, opts: { issue: string; repo: string }): unknown {
  const hub = hubPath(cfg, paths, opts.repo);
  const wt = worktreePath(paths, opts.issue, opts.repo);
  if (!existsSync(wt)) return { removed: false, reason: "not_exists", path: wt };

  const dirty = gitOk(wt, ["status", "--porcelain"], "检查工作树状态");
  if (dirty) {
    throw new FailError(JSON.stringify({ removed: false, reason: "dirty", path: wt, detail: dirty.slice(0, 500) }));
  }
  gitOk(hub, ["worktree", "remove", wt], "移除 worktree");
  return { removed: true, path: wt };
}

/** Issue → 是否允许回收（done/cancelled/不存在 → 可回收；其他 → 保留；查不到状态 → UNKNOWN） */
function issueSettled(cfg: RegistryConfig, issueKey: string): boolean {
  const ws = cfg.runtime.workspace_id ? ["--workspace-id", cfg.runtime.workspace_id] : [];
  const r = runCommand([...multicaPrefix(cfg.runtime), "issue", "get", issueKey, ...ws, "--output", "json"]);
  if (r.status !== 0) {
    // issue 不存在（已删除）→ 视为可回收
    if (/not found|不存在/i.test(r.stderr ?? "")) return true;
    throw new UnknownError(`查询 Issue ${issueKey} rc=${r.status}: ${(r.stderr ?? "").trim()}`);
  }
  const issue = JSON.parse(r.stdout ?? "{}") as { status?: string };
  return issue.status === "done" || issue.status === "cancelled";
}

function cmdPrune(cfg: RegistryConfig, paths: RuntimePaths): unknown {
  const wtRoot = join(paths.rootRepo, ".worktrees");
  const result = { pruned: [] as unknown[], kept: [] as unknown[], dirty: [] as unknown[] };
  if (!existsSync(wtRoot)) return result;

  const repoKeys = Object.keys(cfg.registry).sort((a, b) => b.length - a.length); // 长名优先匹配
  for (const dir of readdirSync(wtRoot)) {
    const repoKey = repoKeys.find((k) => dir.endsWith("-" + k));
    if (!repoKey) {
      result.kept.push({ dir, reason: "repo_key_unrecognized" });
      continue;
    }
    const issue = dir.slice(0, dir.length - repoKey.length - 1);
    if (!issue) {
      result.kept.push({ dir, reason: "issue_key_unparseable" });
      continue;
    }
    if (!issueSettled(cfg, issue)) {
      result.kept.push({ dir, issue, reason: "issue_active" });
      continue;
    }
    try {
      result.pruned.push(cmdRemove(cfg, paths, { issue, repo: repoKey }));
    } catch (exc) {
      if (exc instanceof FailError) {
        result.dirty.push({ dir, issue, detail: exc.message });
      } else {
        throw exc;
      }
    }
  }
  return result;
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = { _: "" };
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      }
    } else {
      pos.push(a);
    }
  }
  out._ = pos.join(" ");
  return out;
}

function req(args: Record<string, string>, key: string): string {
  const v = args[key];
  if (!v) {
    process.stderr.write(`缺少必需参数 --${key}\n`);
    throw new ExitSignal(64);
  }
  return v;
}

function main(rawArgs: string[]): number {
  const args = parseArgs(rawArgs);
  const cmd = args._;
  try {
    const cfg = loadConfig<RegistryConfig>(req(args, "config"), { requireTfs: false });
    if (cmd !== "create" && cmd !== "remove" && cmd !== "prune") {
      process.stderr.write("用法: rondo pr worktree <create|remove|prune> --config <path> [--issue K --repo R --branch B --base T] [--project-id <id> | --root-repo <path>]\n");
      return 64;
    }
    const multica = new MulticaClient(cfg.runtime);
    // 根仓路径解析（§4.3）：create/remove 经 --issue 定位项目；prune 无 Issue 上下文，
    // 必须显式 --project-id 或 --root-repo（§4.3 规则 3）
    const rootRepoArg = args["root-repo"] || undefined;
    const projectIdArg = args["project-id"] || undefined;
    let issueCtx: { project_id?: string | null } | undefined;
    if ((cmd === "create" || cmd === "remove") && !rootRepoArg && !projectIdArg) {
      issueCtx = { project_id: getIssueProjectId(multica, req(args, "issue")) };
    }
    const paths = resolveRuntimePaths(cfg, { issue: issueCtx, projectId: projectIdArg, rootRepoArg, need: [] });
    let out: unknown;
    if (cmd === "create") {
      out = cmdCreate(cfg, paths, { issue: req(args, "issue"), repo: req(args, "repo"), branch: req(args, "branch"), base: args.base });
    } else if (cmd === "remove") {
      out = cmdRemove(cfg, paths, { issue: req(args, "issue"), repo: req(args, "repo") });
    } else {
      out = cmdPrune(cfg, paths);
    }
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return 0;
  } catch (exc) {
    if (exc instanceof FailError) {
      process.stdout.write(exc.message + "\n");
      log(`FAIL: ${exc.message}`);
      return 2;
    }
    if (exc instanceof UnknownError) {
      process.stdout.write(JSON.stringify({ unknown: true, reason: exc.message }) + "\n");
      log(`UNKNOWN: ${exc.message}`);
      return 3;
    }
    throw exc;
  }
}

/** commander 注册：group=pr；参数解析沿用原脚本实现以保证契约逐字节等价。 */
export function registerPrWorktree(group: Command): void {
  group
    .command("worktree")
    .description("管理人工运维使用的 Git Worktree")
    .usage("<create|remove|prune> --config <path> [--issue <key> --repo <repo> --branch <branch> --base <target>] [--project-id <id> | --root-repo <path>]")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action((...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      throw new ExitSignal(main(cmd.args));
    });
}
