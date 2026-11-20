/**
 * dev pr-prep —— PR Preparation Facts 一段写入（engineer-run-efficiency-optimization-plan P1-1）。
 *
 * 背景：pr_prep 此前由 Engineer 手工多步写入（探测 CLI 帮助 → 先写一次 → 补描述文件 →
 * 重写补齐 description_ref），WNDF-43 Run 实测该段 3.6m / 13 次工具轮。本命令把固定顺序的
 * 确定性管道收敛为一条命令：
 *   读取既有 pr_prep（保留其他仓条目）→ git ls-remote 核候选分支 HEAD == candidate_commit
 *   → 生成/核对 pr-description 文件 → 单条 metadata set 合并写入 → 回读核对。
 * 红线（同 pr materialize）：title / description 语义只有 Engineer 可改——title 原样透传，
 * 描述文件仅在其不存在时按模板搭架，已存在文件一个字节都不改写。
 *
 * 事实契约唯一权威：pull-request/references/pr-facts-contract.md（本命令只是写入方）。
 *
 * 用法: rondo dev pr-prep --config <repo-registry.json> --issue <KEY> --repo <repo_key>
 *        --root-repo <path> --change-ref <ref> --candidate-commit <sha> --title <PR 标题>
 *        [--target-branch <branch>] [--source-branch <branch>] [--description <path>]
 *
 * 判定：
 *   - candidate_commit ≠ 远端分支 HEAD / 分支不存在 / 入参非法 → FAIL（不写 metadata）；
 *   - Issue 不可读、pr_prep 既有值不可解析、根仓/枢纽克隆缺失、回读不一致 → UNKNOWN。
 * 退出码：0 = PASS / 2 = FAIL / 3 = UNKNOWN / 64 用法错误。stdout 只出 JSON，日志走 stderr。
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { logLine as log, markLeafExecuted } from "../../cli/output.js";
import { TOOL_VERSION } from "../../cli/version.js";
import { loadConfig, type BaseRegistryConfig } from "../../clients/config.js";
import { MulticaClient } from "../../clients/multica.js";
import { git } from "../../clients/git.js";
import { resolveRuntimePaths } from "../../clients/runtime-paths.js";
import { requirementRoot } from "../runtime/root-git.js";
import { runAuthenticatedGit } from "../../clients/authenticated-git.js";
import { guardRepository } from "./requirement-guard.js";

interface RepoEntry {
  repo_path: string;
  repo_url?: string;
  default_target_branch?: string;
}

interface RegistryConfig extends BaseRegistryConfig {
  registry: Record<string, RepoEntry>;
}

interface PrPrepEntry {
  repo_key: string;
  source_branch: string;
  target_branch?: string;
  candidate_commit: string;
  title: string;
  description_ref?: string;
}

type FailCode =
  | "invalid_candidate_commit"
  | "repo_key_not_in_registry"
  | "source_branch_not_found"
  | "head_mismatch"
  | "description_file_missing"
  | "description_file_empty";

interface Args {
  config: string;
  issue: string;
  mode: string;
  repo: string;
  rootRepo: string;
  changeRef: string;
  candidateCommit: string;
  title: string;
  targetBranch: string | null;
  sourceBranch: string | null;
  description: string | null;
}

const USAGE =
  "用法: rondo dev pr-prep --config <repo-registry.json> --issue <KEY> --repo <repo_key>\n" +
  "  --root-repo <path> --change-ref <ref> --candidate-commit <sha> --title <PR 标题>\n" +
  "  [--target-branch <branch>] [--source-branch <branch>] [--description <path>]\n";

function parseArgs(argv: string[]): Args {
  // --help/-h：stdout 用法 + exit 0（M5，先例：change resolve-identity）——正常求助不计入业务失败指标
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const args: Args = {
    config: get("--config") ?? "",
    mode: get("--mode") ?? "legacy",
    issue: get("--issue") ?? "",
    repo: get("--repo") ?? "",
    rootRepo: get("--root-repo") ?? "",
    changeRef: get("--change-ref") ?? "",
    candidateCommit: get("--candidate-commit") ?? "",
    title: get("--title") ?? "",
    targetBranch: get("--target-branch"),
    sourceBranch: get("--source-branch"),
    description: get("--description"),
  };
  if (!args.config || !args.issue || !args.repo || (args.mode !== "requirement" && !args.rootRepo) || !args.changeRef || !args.candidateCommit || !args.title) {
    process.stderr.write(USAGE);
    process.exit(64);
  }
  return args;
}

function fail(issue: string, code: FailCode, reasons: string[]): number {
  process.stdout.write(JSON.stringify({ result: "FAIL", tool_version: TOOL_VERSION, issue, code, reasons }, null, 2) + "\n");
  return 2;
}

/** 远端 HEAD 核验：found=false 与 mismatch 都是确定性 FAIL；命令本身失败才是 UNKNOWN。 */
function checkRemoteHead(hub: string, sourceBranch: string, repoUrl?: string): { found: boolean; head: string | null } {
  // 由共享封装设置 Git 子进程 cwd，避免 MXC 中 Git -C 的目录切换失败。
  const cp = repoUrl
    ? runAuthenticatedGit(repoUrl, ["ls-remote", repoUrl, `refs/heads/${sourceBranch}`], hub)
    : git(hub, ["ls-remote", "origin", `refs/heads/${sourceBranch}`]);
  if (cp.status !== 0) {
    throw new UnknownError(`git ls-remote 失败 rc=${cp.status}: ${cp.stderr.trim() || cp.stdout.trim()}（网络/认证问题，未写 metadata）`);
  }
  const line = cp.stdout.split(/\r?\n/).find((l) => l.trim() !== "");
  if (!line) return { found: false, head: null };
  const head = line.split(/\s+/)[0];
  return { found: true, head };
}

/** 描述文件：显式路径只核对；默认路径缺失时按模板搭架，已存在不改写（语义归 Engineer）。 */
function resolveDescriptionFile(args: Args, openspecRoot: string): { path: string; scaffolded: boolean } | { code: FailCode; reason: string } {
  if (args.description) {
    const p = isAbsolute(args.description) ? args.description : resolve(args.description);
    if (!existsSync(p)) return { code: "description_file_missing", reason: `--description 指定的文件不存在: ${p}` };
    if (statSync(p).size === 0) return { code: "description_file_empty", reason: `--description 指定的文件为空: ${p}` };
    return { path: p, scaffolded: false };
  }
  const p = join(openspecRoot, "changes", args.changeRef, `pr-description-${args.repo}.md`);
  if (existsSync(p)) {
    if (statSync(p).size === 0) return { code: "description_file_empty", reason: `pr-description 文件为空: ${p}` };
    log(`pr-description 已存在，保留原文: ${p}`);
    return { path: p, scaffolded: false };
  }
  const template =
    `# ${args.title}\n\n` +
    `> 本文件由 rondo dev pr-prep 按模板搭架（${new Date().toISOString().slice(0, 10)}）；` +
    `语义内容由 Engineer 维护，脚本重跑不覆盖。\n\n` +
    `## 变更摘要\n\n\n## 验证\n\n\n## 关联\n\n- Refs: #（补 TFS 工作项 id）\n`;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, template, "utf8");
  log(`pr-description 不存在，已按模板搭架: ${p}`);
  return { path: p, scaffolded: true };
}

function parseExistingPrep(raw: string | undefined, issue: string): PrPrepEntry[] {
  if (!raw) return [];
  let prep: unknown;
  try {
    prep = JSON.parse(raw);
  } catch (exc) {
    throw new UnknownError(`Issue ${issue} 的 metadata pr_prep 不是合法 JSON: ${exc}（既有值不可确认，停止不写）`);
  }
  if (!Array.isArray(prep)) {
    throw new UnknownError(`Issue ${issue} 的 metadata pr_prep 不是数组（既有值不可确认，停止不写）`);
  }
  return prep as PrPrepEntry[];
}

async function main(rawArgs: string[]): Promise<number> {
  const args = parseArgs(rawArgs);
  try {
    if (!/^[0-9a-f]{40}$/i.test(args.candidateCommit)) {
      return fail(args.issue, "invalid_candidate_commit", [
        `candidate_commit 必须是 40 位完整 SHA: ${args.candidateCommit}（pr_prep 物化校验锚点，短 SHA 会在 PR 物化时被阻断）`,
      ]);
    }

    const cfg = loadConfig<RegistryConfig>(args.config, { requireRegistry: true, requireTfs: false });
    const repo = cfg.registry[args.repo];
    if (!repo?.repo_path) {
      return fail(args.issue, "repo_key_not_in_registry", [
        `repo_key ${args.repo} 不在 ${args.config} 的 registry 中（或缺少 repo_path）`,
      ]);
    }

    const multica = new MulticaClient(cfg.runtime);
    const issue = multica.getIssue(args.issue);
    const tfsId = issue.metadata?.["tfs.id"] ?? "";
    const sourceBranch = args.sourceBranch ?? (tfsId ? `${args.mode === "requirement" ? "feature" : "feat"}/${tfsId}` : "");
    if (args.mode === "requirement" && sourceBranch !== `feature/${tfsId}`) return fail(args.issue, "source_branch_not_found", ["Requirement Branch 必须为 feature/<tfs.id>"]);
    if (!sourceBranch) {
      throw new UnknownError(`Issue ${args.issue} 缺少 metadata tfs.id 且未显式传 --source-branch——分支身份不可确认`);
    }

    if (args.mode === "requirement") {
      await guardRepository(cfg, multica, args.issue, args.changeRef, args.repo);
    } else if (args.mode !== "legacy") throw new UnknownError("--mode 仅支持 requirement 或旧默认路径");
    const paths = args.mode === "requirement"
      ? { rootRepo: requirementRoot(args.rootRepo), openspecRoot: join(requirementRoot(args.rootRepo), "openspec") }
      : resolveRuntimePaths(cfg, { issue, rootRepoArg: args.rootRepo, need: ["openspec"] });
    const hub = join(paths.rootRepo, repo.repo_path);
    if (!existsSync(join(hub, ".git"))) {
      throw new UnknownError(`枢纽克隆不存在或不是 git 仓: ${hub}（先完成根仓检出/业务仓接驳）`);
    }

    // 1. HEAD 核验（FAIL 即停，零写入）
    const { found, head } = checkRemoteHead(hub, sourceBranch, args.mode === "requirement" ? repo.repo_url : undefined);
    if (!found) {
      return fail(args.issue, "source_branch_not_found", [
        `远端分支 ${sourceBranch} 不存在（origin，经 ${hub} 查询）——Engineer 未完成 push 或分支名有误`,
      ]);
    }
    if (head !== args.candidateCommit) {
      return fail(args.issue, "head_mismatch", [
        `远端分支 ${sourceBranch} HEAD(${head}) != candidate_commit(${args.candidateCommit})——候选已落后或未推送最新提交，回流 Lead 判断`,
      ]);
    }
    log(`HEAD 核验一致: ${sourceBranch} @ ${head}`);

    // 2. 描述文件（生成或核对）
    const desc = resolveDescriptionFile(args, paths.openspecRoot);
    if ("code" in desc) return fail(args.issue, desc.code, [desc.reason]);
    const descriptionRef = args.mode === "requirement"
      ? `change:pr-description-${args.repo}.md` : `file:${desc.path}`;

    // 3. 合并写入（保留其他仓条目，同仓条目整体替换）
    const existing = parseExistingPrep(issue.metadata?.["pr_prep"], args.issue);
    const preserved = existing.filter((e) => e?.repo_key !== args.repo);
    const entry: PrPrepEntry = {
      repo_key: args.repo,
      source_branch: sourceBranch,
      candidate_commit: args.candidateCommit,
      title: args.title,
      description_ref: descriptionRef,
    };
    if (args.targetBranch) entry.target_branch = args.targetBranch;
    const merged = [...preserved, entry];
    multica.setMetadata(issue.id, "pr_prep", JSON.stringify(merged));
    log(`pr_prep 已写入（共 ${merged.length} 条，本仓条目替换/新增，保留 ${preserved.length} 条他仓条目）`);

    // 4. 回读核对
    const after = multica.getIssue(args.issue);
    const readback = parseExistingPrep(after.metadata?.["pr_prep"], args.issue);
    const mine = readback.find((e) => e?.repo_key === args.repo);
    const preservedAfter = readback.filter((e) => e?.repo_key !== args.repo);
    const fieldMismatch = !mine ||
      mine.source_branch !== entry.source_branch ||
      mine.candidate_commit !== entry.candidate_commit ||
      mine.title !== entry.title ||
      mine.description_ref !== entry.description_ref ||
      (entry.target_branch ?? undefined) !== (mine.target_branch ?? undefined);
    if (fieldMismatch) {
      throw new UnknownError(`pr_prep 回读不一致：本仓条目与写入值不符（写入 ${JSON.stringify(entry)}，回读 ${JSON.stringify(mine ?? null)}）`);
    }
    if (preservedAfter.length !== preserved.length) {
      throw new UnknownError(`pr_prep 回读不一致：他仓条目数 ${preservedAfter.length} != 写入前 ${preserved.length}（疑似并发写冲突，交 Lead 核对）`);
    }

    process.stdout.write(JSON.stringify({
      result: "PASS",
      tool_version: TOOL_VERSION,
      issue: issue.identifier ?? issue.id,
      repo_key: args.repo,
      source_branch: sourceBranch,
      head,
      candidate_commit: args.candidateCommit,
      description_ref: descriptionRef,
      description_scaffolded: desc.scaffolded,
      pr_prep_size: merged.length,
      preserved_repo_keys: preserved.map((e) => e?.repo_key).filter(Boolean),
    }, null, 2) + "\n");
    return 0;
  } catch (exc) {
    if (exc instanceof FailError) {
      return fail(args.issue, "repo_key_not_in_registry", [exc.message]);
    }
    if (exc instanceof UnknownError) {
      log(`UNKNOWN: ${exc.message}`);
      process.stdout.write(JSON.stringify({ result: "UNKNOWN", tool_version: TOOL_VERSION, issue: args.issue, reasons: [exc.message] }, null, 2) + "\n");
      return 3;
    }
    throw exc;
  }
}

/** commander 注册：group=dev；参数解析沿用同组命令实现以保证契约逐字节等价。 */
export function registerDevPrPrep(group: Command): void {
  group
    .command("pr-prep")
    .description("PR Preparation Facts 一段写入（HEAD 核验 + pr-description + 合并写 + 回读）")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      process.exitCode = await main(cmd.args);
    });
}
