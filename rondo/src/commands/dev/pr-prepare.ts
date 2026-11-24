/**
 * dev pr-prepare —— PR Preparation Facts 一段写入（engineer-run-efficiency-optimization-plan P1-1）。
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
 * 用法: rondo dev pr-prepare --config <repo-registry.json> --issue <KEY> --repo <repo_key>
 *        --root-repo <path> --change-ref <ref> --candidate-commit <sha> --title <PR 标题>
 *        [--target-branch <branch>] [--source-branch <branch>] [--description <path>]
 *
 * 判定：
 *   - candidate_commit ≠ 远端分支 HEAD / 分支不存在 / 入参非法 → FAIL（不写 metadata）；
 *   - Issue 不可读、pr_prep 既有值不可解析、根仓/枢纽克隆缺失、回读不一致 → UNKNOWN。
 * 退出码：0 = PASS / 2 = FAIL / 3 = UNKNOWN / 64 用法错误。stdout 只出 JSON，日志走 stderr。
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { logLine as log, markLeafExecuted } from "../../cli/output.js";
import { TOOL_VERSION } from "../../cli/version.js";
import { loadConfig, type BaseRegistryConfig } from "../../clients/config.js";
import { MulticaClient } from "../../clients/multica.js";
import { git, gitOk } from "../../clients/git.js";
import { runCommand } from "../../clients/spawn.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";
import { resolveRuntimePaths } from "../../clients/runtime-paths.js";
import { requirementRoot } from "../runtime/root-git.js";
import { assertTfsRepository, runAuthenticatedGit } from "../../clients/authenticated-git.js";
import { loadConfig as loadTfsConfig } from "../../tfs/config.js";
import { assertNativeTaskCheckout } from "../../clients/native-checkout.js";
import { assertNativeDeliveryMapping } from "./native-prepare.js";
import { validateBusinessPath } from "./prepare-workspace.js";
import { readAnalysisSource } from "../analysis/source.js";
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
  repo_url: string;
  source_branch: string;
  target_branch: string;
  candidate_commit: string;
  title: string;
  description_ref?: string;
  description?: string;
  local_validation?: { result: "PASS"; summary: string; command: string[]; exit_code: 0; candidate_commit: string; source: "rondo dev pr-prepare" };
  code_review?: { result: "PASS"; candidate_commit: string; summary: string; findings: Array<{ resolved?: boolean; blocking?: boolean; risk_note?: string; risk_ref?: string }> };
  blockers?: string[];
}

type FailCode =
  | "invalid_candidate_commit"
  | "repo_key_not_in_registry"
  | "source_branch_not_found"
  | "head_mismatch"
  | "description_file_missing"
  | "description_file_empty"
  | "invalid_delivery_facts"
  | "precondition_failed";

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
  deliveryFacts: string | null;
  validationCwd: string | null;
}

const USAGE =
  "用法: rondo dev pr-prepare --config <repo-registry.json> --issue <KEY> --repo <repo_key>\n" +
  "  --root-repo <path> --change-ref <ref> --candidate-commit <sha> --title <PR 标题>\n" +
  "  [--target-branch <branch>] [--source-branch <branch>] [--delivery-facts <temporary.json>] [--validation-cwd <path>] [--description <path>]\n";

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
    deliveryFacts: get("--delivery-facts"),
    validationCwd: get("--validation-cwd"),
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

/** Keep legacy Task-level description behaviour unchanged. Not used for Requirement. */
function resolveLegacyDescription(args: Args, openspecRoot: string): { path: string; scaffolded: boolean } | { code: FailCode; reason: string } {
  if (args.description) {
    const p = isAbsolute(args.description) ? args.description : resolve(args.description);
    if (!existsSync(p)) return { code: "description_file_missing", reason: `--description 指定的文件不存在: ${p}` };
    if (statSync(p).size === 0) return { code: "description_file_empty", reason: `--description 指定的文件为空: ${p}` };
    return { path: p, scaffolded: false };
  }
  const p = join(openspecRoot, "changes", args.changeRef, `pr-description-${args.repo}.md`);
  if (existsSync(p)) {
    if (statSync(p).size === 0) return { code: "description_file_empty", reason: `pr-description 文件为空: ${p}` };
    return { path: p, scaffolded: false };
  }
  const template = `# ${args.title}\n\n> 本文件由 rondo dev pr-prepare 生成草稿；语义内容由 Engineer 维护。\n\n## 变更摘要\n\n\n## 验证\n\n\n## 关联\n\n- Refs: #（补 TFS 工作项 id）\n`;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, template, "utf8");
  return { path: p, scaffolded: true };
}

interface DeliveryInput {
  validation?: { command?: string[]; summary?: string };
  code_review?: { result?: string; candidate_commit?: string; summary?: string; findings?: Array<{ resolved?: boolean; blocking?: boolean; risk_note?: string; risk_ref?: string }> };
  blockers?: string[];
  description?: string;
}

/** The input is disposable. Only verified delivery facts are saved in the existing pr_prep. */
function validateDeliveryInput(path: string | null, descriptionFile: string | null): DeliveryInput & { description: string } {
  if (!path) throw new FailError("Requirement PR Preparation 必须提供 --delivery-facts 临时输入");
  let input: DeliveryInput;
  try { input = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new FailError("交付输入不存在或不是有效 JSON"); }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new FailError("交付输入必须为对象");
  if (!Array.isArray(input.validation?.command) || input.validation.command.length === 0 ||
      input.validation.command.some(x => typeof x !== "string" || !x.trim()) ||
      typeof input.validation.summary !== "string" || !input.validation.summary.trim()) {
    throw new FailError("必须提供真实可执行的 validation.command 与验证说明");
  }
  const review = input.code_review;
  if (review?.result !== "PASS" || typeof review.summary !== "string" || !review.summary.trim() ||
      !Array.isArray(review.findings)) throw new FailError("Code Review 缺少专业结论或 Findings");
  if (review.findings.some(f => !f || typeof f !== "object" || (f.resolved !== true &&
      (f.blocking !== false || !(f.risk_note?.trim() || f.risk_ref?.trim()))))) {
    throw new FailError("存在未解决 Blocking Finding 或未记录风险的 Non-blocking Finding");
  }
  if (!Array.isArray(input.blockers) || input.blockers.some(x => typeof x !== "string") || input.blockers.length) {
    throw new FailError("存在 Blocking Findings 或 blockers 格式不合法");
  }
  let description = input.description;
  if (descriptionFile) {
    try { description = readFileSync(descriptionFile, "utf8"); }
    catch { throw new FailError("无法读取 --description 指定的专业 PR 描述"); }
  }
  if (!description?.trim() || description.includes("补 TFS 工作项 id")) throw new FailError("PR 专业描述缺失或仍含模板占位");
  return { ...input, description };
}

/** Run validation against the actual, authorized candidate checkout rather than trusting a PASS string. */
function verifyAndExecuteValidation(root: string, checkout: string, repoUrl: string, candidate: string, command: string[]): void {
  const absoluteRoot = realpathSync(root);
  const actual = realpathSync(checkout);
  const rel = relative(absoluteRoot, actual);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new FailError("Validation 目录不属于当前授权 Root");
  const origin = gitOk(actual, ["remote", "get-url", "origin"], "读取 Validation 仓库来源");
  if (canonicalRepositoryIdentity(origin) !== canonicalRepositoryIdentity(repoUrl)) throw new FailError("Validation 仓库不等于获批 Repository");
  if (gitOk(actual, ["rev-parse", "HEAD"], "核对实际 Validation Candidate") !== candidate) throw new FailError("Validation Checkout 的 HEAD 与 Candidate 不一致");
  if (gitOk(actual, ["status", "--porcelain", "--untracked-files=no"], "读取 Validation 工作树")) throw new FailError("Validation 工作树含未提交修改，不能证明 Candidate 已验证");
  const check = runCommand(command, actual);
  if (check.status !== 0) throw new FailError(`Candidate Validation 失败 rc=${check.status}: ${check.stderr.slice(0, 300)}`);
  if (gitOk(actual, ["rev-parse", "HEAD"], "复核 Validation Candidate") !== candidate ||
      gitOk(actual, ["status", "--porcelain", "--untracked-files=no"], "复核 Validation 内容")) {
    throw new FailError("Validation 执行期间 Candidate 或工作树发生变化");
  }
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

    const repoUrl = assertTfsRepository(repo.repo_url ?? "", loadTfsConfig().serverUrl).href;
    const targetBranch = args.targetBranch || repo.default_target_branch;
    if (!targetBranch) throw new FailError("PR Preparation 缺少目标分支");
    if (args.mode === "requirement" && statSync(join(hub, ".git")).isFile()) {
      const workdir = dirname(paths.rootRepo);
      assertNativeTaskCheckout(paths.rootRepo, workdir);
      const nativePath = validateBusinessPath(paths.rootRepo, repo);
      assertNativeTaskCheckout(nativePath, workdir);
      assertNativeDeliveryMapping(paths.rootRepo, readAnalysisSource(issue.metadata ?? {}).commit, args.repo, repo, loadTfsConfig().serverUrl);
      const validationDir = realpathSync(args.validationCwd || hub);
      const validationRelative = relative(realpathSync(nativePath), validationDir);
      if (targetBranch !== repo.default_target_branch || isAbsolute(validationRelative) ||
          validationRelative === ".." || validationRelative.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) ||
          realpathSync(gitOk(validationDir, ["rev-parse", "--show-toplevel"], "核对 Validation Git 根")) !== realpathSync(nativePath))
        throw new FailError("Native Validation 工作树或交付目标与准备事实不一致");
      const origin = gitOk(nativePath, ["remote", "get-url", "--all", "origin"], "核对 Native Origin");
      const push = gitOk(nativePath, ["remote", "get-url", "--push", "--all", "origin"], "核对 Native Push");
      if (canonicalRepositoryIdentity(origin) !== canonicalRepositoryIdentity(repoUrl) ||
          canonicalRepositoryIdentity(push) !== canonicalRepositoryIdentity(repoUrl))
        throw new FailError("Native 工作树与批准仓库身份不一致");
    }
    if (args.mode !== "requirement" && canonicalRepositoryIdentity(gitOk(hub, ["remote", "get-url", "origin"], "核对业务仓来源")) !== canonicalRepositoryIdentity(repoUrl)) {
      throw new FailError("业务仓 origin 与 Registry 不一致");
    }

    // 1. HEAD 核验（FAIL 即停，零写入）
    const { found, head } = checkRemoteHead(hub, sourceBranch, args.mode === "requirement" ? repoUrl : undefined);
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

    // 2. Requirement: execute validation against Candidate, preserve Engineer's semantic Review.
    // Legacy Task-level/Direct Bug keeps its existing description-file contract.
    let descriptionRef: string | undefined;
    let descriptionScaffolded = false;
    let delivery: DeliveryInput & { description: string } | undefined;
    if (args.mode === "requirement") {
      delivery = validateDeliveryInput(args.deliveryFacts, args.description);
      if (delivery.code_review?.candidate_commit !== args.candidateCommit) {
        throw new FailError("Code Review 审核的 Candidate 与实际待发布 Commit 不一致");
      }
      verifyAndExecuteValidation(paths.rootRepo, args.validationCwd || hub, repoUrl,
        args.candidateCommit, delivery.validation!.command!);
    } else {
      const desc = resolveLegacyDescription(args, paths.openspecRoot);
      if ("code" in desc) return fail(args.issue, desc.code, [desc.reason]);
      descriptionRef = "file:" + desc.path;
      descriptionScaffolded = desc.scaffolded;
    }

    // 3. 合并写入（保留其他仓条目，同仓条目整体替换）
    // Re-read after validation: it may have taken minutes and another repo may have completed meanwhile.
    const fresh = multica.getIssue(args.issue);
    if (fresh.status !== issue.status ||
        ["analysis.source", "analysis.human_approval", "analysis.change_ref", "analysis.gate.result"].some(
          k => fresh.metadata?.[k] !== issue.metadata?.[k])) {
      throw new UnknownError("Validation 期间 Issue 授权或 Analysis 来源变化，请重新准备");
    }
    const beforePrep = parseExistingPrep(issue.metadata?.["pr_prep"], args.issue);
    const existing = parseExistingPrep(fresh.metadata?.["pr_prep"], args.issue);
    const originalMine = beforePrep.find(e => e?.repo_key === args.repo);
    const currentMine = existing.find(e => e?.repo_key === args.repo);
    if (JSON.stringify(originalMine) !== JSON.stringify(currentMine)) {
      throw new UnknownError("Validation 期间本仓 PR Preparation 已被其他 Runtime 修改，停止覆盖");
    }
    const preserved = existing.filter((e) => e?.repo_key !== args.repo);
    const entry: PrPrepEntry = {
      repo_key: args.repo,
      repo_url: repoUrl,
      source_branch: sourceBranch,
      target_branch: targetBranch,
      candidate_commit: args.candidateCommit,
      title: args.title,
      ...(descriptionRef && { description_ref: descriptionRef }),
      ...(delivery && {
        description: delivery.description,
        local_validation: { result: "PASS", summary: delivery.validation!.summary!, command: delivery.validation!.command!,
          exit_code: 0, candidate_commit: args.candidateCommit, source: "rondo dev pr-prepare" as const },
        code_review: { result: "PASS", candidate_commit: delivery.code_review!.candidate_commit!, summary: delivery.code_review!.summary!, findings: delivery.code_review!.findings! },
        blockers: [],
      }),
    };
    const merged = [...preserved, entry];
    multica.setMetadata(issue.id, "pr_prep", JSON.stringify(merged));
    log(`pr_prep 已写入（共 ${merged.length} 条，本仓条目替换/新增，保留 ${preserved.length} 条他仓条目）`);

    // 4. 回读核对
    const after = multica.getIssue(args.issue);
    const readback = parseExistingPrep(after.metadata?.["pr_prep"], args.issue);
    const mine = readback.find((e) => e?.repo_key === args.repo);
    const preservedAfter = readback.filter((e) => e?.repo_key !== args.repo);
    const fieldMismatch = !mine ||
      mine.repo_url !== entry.repo_url ||
      mine.source_branch !== entry.source_branch ||
      mine.candidate_commit !== entry.candidate_commit ||
      mine.title !== entry.title ||
      mine.description_ref !== entry.description_ref ||
      mine.description !== entry.description ||
      JSON.stringify(mine.local_validation) !== JSON.stringify(entry.local_validation) ||
      JSON.stringify(mine.code_review) !== JSON.stringify(entry.code_review) ||
      JSON.stringify(mine.blockers) !== JSON.stringify(entry.blockers) ||
      (entry.target_branch ?? undefined) !== (mine.target_branch ?? undefined);
    if (fieldMismatch) {
      throw new UnknownError(`pr_prep 回读不一致：本仓条目与写入值不符（写入 ${JSON.stringify(entry)}，回读 ${JSON.stringify(mine ?? null)}）`);
    }
    if (JSON.stringify(preservedAfter) !== JSON.stringify(preserved)) {
      throw new UnknownError("pr_prep 回读不一致：其他 Repository 的交付事实被覆盖或改变");
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
      validation_executed: args.mode === "requirement",
      description_scaffolded: descriptionScaffolded,
      pr_prep_size: merged.length,
      preserved_repo_keys: preserved.map((e) => e?.repo_key).filter(Boolean),
    }, null, 2) + "\n");
    return 0;
  } catch (exc) {
    if (exc instanceof FailError) {
      return fail(args.issue, "precondition_failed", [exc.message]);
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
export function registerDevPrPrepare(group: Command): void {
  group
    .command("pr-prepare")
    .description("PR Preparation Facts（HEAD + Candidate Validation + Code Review + 合并写及回读）")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      process.exitCode = await main(cmd.args);
    });
}
