/**
 * check-development-completion.ts — Development Completion Check 确定性检查（02 §8 / §8.1）。
 *
 * （D3 修订：自 rondo 收编起，实现位置为 @winning/skill-flow 包内
 * commands/dev/check-completion.ts，原 projects/multica/workspace-skills/development-execution/scripts/
 * check-development-completion.ts 路径在迁移窗口期保持有效，见 change-progress-script-contract.md addendum。）
 *
 * 判断范围：当前 assigned Task Set 的 Engineering Contract，而不是整个 Delivery。
 * 输入：OpenSpec Change（有效 Task 身份）+ Engineer 结构化 Evidence（evidence.json）。
 * 输出：{ result: PASS | FAIL | UNKNOWN, checks: [...], reasons: [...] }
 * 退出码：0 = PASS，2 = FAIL，3 = UNKNOWN。
 *
 * 只承载可确定性判定部分：Task 身份（不要求先勾选）、Evidence 字段与结论、Commit 存在性（可选核验）、
 * Commit ↔ TFS 工作项关联（可选，--issue 开启；2026-10-30 TFS 剥离后统一核 `Refs: #<tfs.id>`，
 * 见 tfs-writeback-decoupling-plan）、PR Preparation 完整性、blocker 声明。实现语义正确性
 * 不由本脚本判断（02 §8：先 Check PASS 再 Patch checkbox；未勾选不构成 Completion FAIL）。
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { Command } from "commander";
import { UnknownError } from "../../cli/errors.js";
import { markLeafExecuted } from "../../cli/output.js";
import { TOOL_VERSION } from "../../cli/version.js";
import { runCommand } from "../../clients/spawn.js";
import type { BaseRegistryConfig } from "../../clients/config.js";
import { resolveRuntimePaths, resolveOpenspecRootDir, type RuntimePaths } from "../../clients/runtime-paths.js";
import { loadDispatchFacts } from "./dispatch-facts.js";
import { verifyContractFiles, type ContractFiles } from "../delivery/contract-files.js";

type CheckResult = "PASS" | "FAIL" | "UNKNOWN";
interface Check { name: string; result: CheckResult; reasons: string[] }

// ---- Evidence 契约（references/development-evidence-contract.md 的机器可读子集） ----

interface Evidence {
  change_ref?: string;
  task_refs?: string[];
  local_validation?: { result?: string; summary?: string; evidence_refs?: string[] };
  code_review?: { result?: string; findings?: Array<{ resolved?: boolean; blocking?: boolean; risk_note?: string; risk_ref?: string }>; };
  commits?: Array<{ repo_path?: string; branch?: string; sha?: string }>;
  pr_preparation?: { required?: boolean; title?: string; description_ref?: string; work_item_ref?: string; reason_if_not_required?: string };
  /** Engineer Completion 必须先绑定当前契约；Finalize 再复核是否漂移。 */
  contract_files?: ContractFiles;
  blockers?: string[];
}

// ---- Commit ↔ TFS 任务关联核验的事实类型（archive/docs-2026-10-26/tfs-task-commit-linkage-plan.md（历史溯源） §4.4） ----

interface RegistryConfig extends BaseRegistryConfig {
  registry: Record<string, { repo_path: string }>;
}

function loadEvidence(path: string): Evidence {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, "utf8")); } catch (exc) {
    throw new UnknownError(`无法读取 evidence 文件 ${path}: ${exc}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new UnknownError("evidence 不是 JSON 对象");
  }
  return raw as Evidence;
}

// ---- 各检查项 ----

function checkTasks(openspecRoot: string, changeRef: string, taskRefs: string[]): Check {
  const tasksPath = join(openspecRoot, "changes", changeRef, "tasks.md");
  if (!existsSync(tasksPath)) {
    return { name: "task_identity", result: "FAIL", reasons: ["tasks.md 不存在: " + tasksPath] };
  }
  // 只验证当前 Task 身份；checkbox [ ] 属于 Check → Patch 顺序的正常前置状态。
  const entries = [...readFileSync(tasksPath, "utf8").matchAll(/^[ \t]*[-*][ \t]+\[([^\r\n\]])\][ \t]+(\d+(?:\.\d+)*)(?=[ \t:：]|$)/gm)];
  const reasons: string[] = [];
  for (const ref of taskRefs) {
    const matches = entries.filter((m) => m[2] === ref);
    if (matches.length === 0) reasons.push("task " + ref + " 在 tasks.md 中不存在有效 checkbox 任务");
    else if (matches.length > 1) reasons.push("task " + ref + " 编号重复，不能检查或 Patch");
    else if (![" ", "x", "X"].includes(matches[0][1])) reasons.push("task " + ref + " checkbox 标记非法");
  }
  return { name: "task_identity", result: reasons.length ? "FAIL" : "PASS", reasons };
}

function checkLocalValidation(ev: Evidence): Check {
  const reasons: string[] = [];
  const lv = ev.local_validation;
  if (!lv) reasons.push("缺少 local_validation 段");
  else {
    if (lv.result !== "PASS") reasons.push(`local_validation.result=${String(lv.result)}（须为 PASS）`);
    if (!lv.summary || lv.summary.trim() === "") reasons.push("local_validation.summary 缺失");
  }
  return { name: "local_validation", result: reasons.length ? "FAIL" : "PASS", reasons };
}

function checkCodeReview(ev: Evidence): Check {
  const reasons: string[] = [];
  const cr = ev.code_review;
  if (!cr) reasons.push("缺少 code_review 段");
  else {
    if (cr.result !== "PASS") reasons.push("code_review.result 须为 PASS");
    for (const [i, f] of (cr.findings ?? []).entries()) {
      if (f.resolved === true) continue;
      if (f.blocking !== false) reasons.push("code_review.findings[" + i + "] 存在未解决 Blocking Finding");
      else if (!f.risk_note?.trim() && !f.risk_ref?.trim()) {
        reasons.push("code_review.findings[" + i + "] 为 Non-blocking 但无风险说明");
      }
    }
  }
  return { name: "code_review", result: reasons.length ? "FAIL" : "PASS", reasons };
}

function checkContractBinding(ev: Evidence, openspecRoot: string, changeRef: string): Check {
  const name = "contract_binding";
  const binding = ev.contract_files;
  if (!binding || !binding.files || typeof binding.files !== "object" ||
      Array.isArray(binding.files) || Object.keys(binding.files).length === 0) {
    return { name, result: "UNKNOWN", reasons: ["Evidence 缺少 contract_files；先运行 rondo dev contract-hash"] };
  }
  try {
    const result = verifyContractFiles(join(openspecRoot, "changes", changeRef), binding);
    return result.ok
      ? { name, result: "PASS", reasons: [] }
      : { name, result: result.kind === "missing_file" ? "UNKNOWN" : "FAIL", reasons: result.problems };
  } catch (exc) {
    return { name, result: "UNKNOWN", reasons: [`无法核对当前 Change 契约: ${exc instanceof Error ? exc.message : String(exc)}`] };
  }
}

function checkCommits(ev: Evidence, verifyInRepo: boolean): Check {
  const reasons: string[] = [];
  const commits = ev.commits ?? [];
  if (commits.length === 0) return { name: "commits", result: "FAIL", reasons: ["commits 为空（无 Commit/Push 事实）"] };
  commits.forEach((c, i) => {
    if (!c.sha || !/^[0-9a-f]{7,40}$/i.test(c.sha)) reasons.push(`commits[${i}].sha 缺失或非法`);
    if (!c.branch) reasons.push(`commits[${i}].branch 缺失`);
  });
  if (verifyInRepo) {
    for (const c of commits) {
      if (!c.repo_path) { reasons.push(`commits[].repo_path 缺失，无法在仓内核验 ${c.sha}`); continue; }
      if (!existsSync(join(c.repo_path, ".git"))) { reasons.push(`repo_path 不是 git 仓: ${c.repo_path}`); continue; }
      const cp = runCommand(["git", "rev-parse", "--verify", "--quiet", `${c.sha}^{commit}`], c.repo_path);
      if (cp.status !== 0) reasons.push(`commit ${c.sha} 在 ${c.repo_path} 中不存在`);
    }
  }
  return { name: "commits", result: reasons.length ? "FAIL" : "PASS", reasons };
}

// ---- commit_task_links：Commit Message `Refs: #<id>` 核验 ----
// 只在 --issue + --registry-config 同时提供时启用。
// 新规则（2026-10-30 TFS 剥离，tfs-writeback-decoupling-plan）：需求/Bug 同一口径——
// 每个业务仓 commit 的 Refs: 尾注行含 `#<tfs.id>`（父工作项号）且不引用其他工作项 id；
// 不核验 task_ref 覆盖（子任务由 PR 通过后 writeback 创建，开发期不存在）。
// legacy 过渡兼容：covering dispatch 条目存在 tfs_task_ids（在途交付，映射在派发期已写入）时，
// 沿用旧规则（Refs 须属于 tfs_task_ids 合法集合且覆盖 task_refs，archive/docs-2026-10-26/
// tfs-task-commit-linkage-plan.md（历史溯源） §4.4）。
// tfs.type 缺失/其他 → UNKNOWN（不默认按需求核验）。

/** 路径规范化：Windows 不区分大小写、统一斜杠、去尾斜杠。 */
function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** 从 commit message 提取 Refs: 尾注行的 #id 列表；无合法行返回 null。 */
function parseRefsLine(message: string): number[] | null {
  for (const line of message.split(/\r?\n/)) {
    const m = line.match(/^Refs:\s+((?:#\d+\s*)+)$/);
    if (m) return (m[1].match(/\d+/g) ?? []).map(Number);
  }
  return null;
}

const FORBIDDEN_KEYWORD_RE = /\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#\d+/i;

function checkCommitTaskLinks(
  ev: Evidence, taskRefs: string[], issueKey: string, cfgPath: string, rootRepoArg: string | null,
): Check {
  const reasons: string[] = [];
  const NAME = "commit_task_links";

  let cfg: RegistryConfig;
  try { cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as RegistryConfig; }
  catch (exc) { return { name: NAME, result: "UNKNOWN", reasons: [`无法读取 registry-config ${cfgPath}: ${exc}`] }; }
  if (!cfg.runtime?.multica_cli || !cfg.registry || typeof cfg.registry !== "object" || Array.isArray(cfg.registry)) {
    return { name: NAME, result: "UNKNOWN", reasons: ["registry-config 缺少 runtime.multica_cli / registry"] };
  }

  // 1) 读 dev.dispatch，取 active 且 task_refs 覆盖本次检查范围的条目
  //    （共享 dispatch-facts.ts：与 dev check-dispatch 同一读取与类型分支实现，防规则漂移）
  const loaded = loadDispatchFacts(cfg, issueKey, taskRefs);
  if (!loaded.ok) {
    return { name: NAME, result: "UNKNOWN", reasons: [loaded.reason] };
  }
  const { facts } = loaded;
  const tfsId = facts.tfsId;
  const idToRef = facts.idToRef;
  // legacy 在途兼容：covering 条目存在 tfs_task_ids → 旧规则（Refs 挂子任务 ID）；
  // 否则（新流程全类型）→ 统一规则（Refs 挂 #<tfs.id>）
  const legacy = !facts.bugMode && idToRef.size > 0;
  if (!legacy && (!Number.isInteger(tfsId) || tfsId <= 0)) {
    return { name: NAME, result: "UNKNOWN", reasons: [`Issue ${issueKey} metadata tfs.id 缺失或不是正整数（Refs: 统一挂父工作项号核验需 tfs.id）`] };
  }

  // 2) 本地根仓由调用方显式传入；只校验与派生路径。
  //    解析失败 → 本检查 UNKNOWN（整体结果 UNKNOWN / exit 3），不回退静态路径。
  let paths: RuntimePaths;
  try {
    paths = resolveRuntimePaths(cfg, { issue: { project_id: facts.projectId }, rootRepoArg: rootRepoArg ?? undefined, need: [] });
  } catch (exc) {
    return { name: NAME, result: "UNKNOWN", reasons: [`根仓路径解析失败: ${exc instanceof Error ? exc.message : String(exc)}`] };
  }

  // 3) 逐业务仓 commit 提取 Refs: 行并校验。仅 root_repo 本身豁免；
  //    root_repo/<已登记 repo_path> 与 root_repo/.worktrees/<直接子目录> 是业务仓，其余路径一律 FAIL。
  const rootRepo = normPath(paths.rootRepo);
  const worktreesRoot = normPath(join(paths.rootRepo, ".worktrees"));
  const businessHubs = new Set<string>();
  for (const [repoKey, repo] of Object.entries(cfg.registry)) {
    const repoPath = repo.repo_path;
    if (typeof repoPath !== "string" || repoPath === "." || repoPath === ".."
      || repoPath.trim() !== repoPath || isAbsolute(repoPath) || /[<>:"/\\|?*\0]/.test(repoPath)) {
      return { name: NAME, result: "UNKNOWN", reasons: [`registry ${repoKey}.repo_path 不是根仓直接子目录: ${String(repoPath)}`] };
    }
    businessHubs.add(normPath(join(paths.rootRepo, repoPath)));
  }
  const seenRefs = new Set<string>();
  for (const c of ev.commits ?? []) {
    if (!c.repo_path) continue; // 缺 repo_path 由 commits 检查（--verify-commits）报告，这里跳过
    const np = normPath(c.repo_path);
    const worktreeSuffix = np.startsWith(worktreesRoot + "/") ? np.slice(worktreesRoot.length + 1) : "";
    const isWorktree = worktreeSuffix !== "" && !worktreeSuffix.includes("/");
    const isBusiness = businessHubs.has(np) || isWorktree;
    const isRoot = np === rootRepo;
    if (!isAbsolute(c.repo_path) || (!isBusiness && !isRoot)) {
      reasons.push(`commit ${c.sha?.slice(0, 7) ?? "?"} 的 repo_path 无法归类（须为 root_repo、已登记直接业务子仓或根仓 .worktrees 直接子目录的绝对路径）: ${c.repo_path}`);
      continue;
    }
    if (!isBusiness) continue; // 仅 OpenSpec 根仓本身豁免
    if (!c.sha || !/^[0-9a-f]{7,40}$/i.test(c.sha)) continue; // sha 非法由 commits 检查报告
    if (!existsSync(join(c.repo_path, ".git"))) {
      reasons.push(`业务仓路径不存在或不是 git 仓: ${c.repo_path}（无法读取 commit message）`);
      continue;
    }
    const lg = runCommand(["git", "log", "-1", "--format=%B", c.sha], c.repo_path);
    if (lg.status !== 0) {
      reasons.push(`commit ${c.sha} 在 ${c.repo_path} 中不可读: ${lg.stderr.trim()}`);
      continue;
    }
    const msg = lg.stdout;
    if (FORBIDDEN_KEYWORD_RE.test(msg)) {
      reasons.push(`commit ${c.sha.slice(0, 7)} 含状态变迁关键字（fix/close/resolve #id 一律禁用，见方案 §4.2）`);
    }
    const ids = parseRefsLine(msg);
    if (ids === null) {
      reasons.push(`业务仓 commit ${c.sha.slice(0, 7)}（${c.repo_path}）缺少合法 "Refs: #<id>" 尾注行`);
      continue;
    }
    if (!legacy) {
      // 统一口径（新流程，需求/Bug 同一规则）：Refs: 须含 #<tfs.id>（父工作项号），
      // 且不得引用其他工作项 id（tfs-writeback-decoupling-plan，对齐 tfs-bug-delivery-task-skip-plan §4.5）
      if (!ids.includes(tfsId)) {
        reasons.push(`业务仓 commit ${c.sha.slice(0, 7)} 的 Refs: 行未引用父工作项 #${tfsId}`);
      }
      for (const id of ids) {
        if (id !== tfsId) reasons.push(`commit ${c.sha.slice(0, 7)} 引用了非本交付的工作项 #${id}（只允许 Refs: #${tfsId}）`);
      }
      continue;
    }
    // legacy 在途口径：Refs 须属于 tfs_task_ids 合法集合
    for (const id of ids) {
      const ref = idToRef.get(id);
      if (ref === undefined) {
        reasons.push(`commit ${c.sha.slice(0, 7)} 引用了不属于本 Issue 当前派发合法集合的任务 #${id}`);
      } else {
        seenRefs.add(ref);
      }
    }
  }

  if (!legacy) {
    // 统一口径无 task_ref 覆盖概念，逐 commit 核验已在上面的循环完成
    return { name: NAME, result: reasons.length ? "FAIL" : "PASS", reasons };
  }

  // 4) legacy 覆盖检查：本次 task_refs 每个 ref 的任务 ID 至少出现在一条业务仓 commit 的 Refs: 行
  const mappedRefs = new Set([...idToRef.values()]);
  const unmapped: string[] = [];
  for (const ref of taskRefs) {
    if (!mappedRefs.has(ref)) unmapped.push(ref);
    else if (!seenRefs.has(ref)) reasons.push(`task ${ref} 的 TFS 任务 ID 未被任何业务仓 commit 的 Refs: 行覆盖`);
  }
  if (unmapped.length > 0) {
    reasons.unshift(`task_refs 在合法集合中无 tfs_task_ids 映射（任务物化缺失）: ${unmapped.join(", ")}——Lead 补齐后重跑`);
    return { name: NAME, result: "UNKNOWN", reasons };
  }

  return { name: NAME, result: reasons.length ? "FAIL" : "PASS", reasons };
}

function checkPrPreparation(ev: Evidence): Check {
  const reasons: string[] = [];
  const pr = ev.pr_preparation;
  if (!pr) return { name: "pr_preparation", result: "FAIL", reasons: ["缺少 pr_preparation 段"] };
  if (pr.required === true) {
    if (!pr.title || pr.title.trim() === "") reasons.push("pr_preparation.required=true 但 title 缺失");
    if (!pr.description_ref || pr.description_ref.trim() === "") reasons.push("pr_preparation.required=true 但 description_ref 缺失");
    // work_item_ref 校验已于 2026-11-03 移除：值恒等于 issue metadata tfs.id（PR 关联走该链路），
    // 本处仅查存在性、从不核对语义，属无消费方的死字段（WNDF-52 D3）
  } else if (pr.required === false) {
    if (!pr.reason_if_not_required || pr.reason_if_not_required.trim() === "") {
      reasons.push("pr_preparation.required=false 但缺少 reason_if_not_required");
    }
  } else {
    reasons.push("pr_preparation.required 缺失（须显式 true/false）");
  }
  return { name: "pr_preparation", result: reasons.length ? "FAIL" : "PASS", reasons };
}

function checkBlockers(ev: Evidence): Check {
  const blockers = ev.blockers ?? [];
  return blockers.length === 0
    ? { name: "blockers", result: "PASS", reasons: [] }
    : { name: "blockers", result: "FAIL", reasons: blockers.map((b) => `未解决 blocker: ${b}`) };
}

function checkIdentity(ev: Evidence, changeRef: string, taskRefs: string[]): Check {
  const reasons: string[] = [];
  if (ev.change_ref !== changeRef) reasons.push(`evidence.change_ref=${String(ev.change_ref)} 与参数 ${changeRef} 不一致`);
  const evRefs = ev.task_refs ?? [];
  const missing = taskRefs.filter((t) => !evRefs.includes(t));
  if (missing.length > 0) reasons.push(`evidence.task_refs 未覆盖派发范围: ${missing.join(", ")}`);
  return { name: "identity", result: reasons.length ? "FAIL" : "PASS", reasons };
}

// ---- 入口 ----

interface Args {
  openspecRoot: string; changeRef: string; taskRefs: string[]; evidence: string; verifyCommits: boolean;
  issue: string | null; registryConfig: string | null; rootRepo: string | null;
}

const USAGE =
  "用法: rondo dev check-completion --openspec-root <path> --change-ref <name> --task-refs <1.1,1.2,...> --evidence <evidence.json> [--verify-commits] [--issue <KEY> --registry-config <repo-registry.json> [--root-repo <path>]]\n" +
  "  --issue/--registry-config 同时提供时启用 commit_task_links 检查（Commit Message Refs: #<tfs.id> 核验；在途 legacy 交付沿用 tfs_task_ids 口径）\n" +
  "  commit_task_links 使用 --root-repo 显式指定本次实际根仓路径\n";

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
  const openspecRoot = get("--openspec-root");
  const changeRef = get("--change-ref");
  const taskRefsRaw = get("--task-refs");
  const evidence = get("--evidence");
  if (!openspecRoot || !changeRef || !taskRefsRaw || !evidence) {
    process.stderr.write(USAGE);
    process.exit(64);
  }
  const issue = get("--issue");
  const registryConfig = get("--registry-config");
  if ((issue === null) !== (registryConfig === null)) {
    process.stderr.write("--issue 与 --registry-config 必须同时提供（或同时省略）\n");
    process.exit(64);
  }
  return {
    openspecRoot,
    changeRef,
    taskRefs: taskRefsRaw.split(",").map((s) => s.trim()).filter(Boolean),
    evidence,
    verifyCommits: argv.includes("--verify-commits"),
    issue,
    registryConfig,
    rootRepo: get("--root-repo"),
  };
}

function main(rawArgs: string[]): number {
  const args = parseArgs(rawArgs);
  const checks: Check[] = [];
  try {
    if (args.taskRefs.length === 0) throw new UnknownError("--task-refs 为空");
    const ev = loadEvidence(args.evidence);
    // --openspec-root 语义统一：根仓路径自动归一到其 openspec/ 子目录
    const openspecRoot = resolveOpenspecRootDir(args.openspecRoot);
    checks.push(checkIdentity(ev, args.changeRef, args.taskRefs));
    checks.push(checkTasks(openspecRoot, args.changeRef, args.taskRefs));
    checks.push(checkLocalValidation(ev));
    checks.push(checkCodeReview(ev));
    checks.push(checkContractBinding(ev, openspecRoot, args.changeRef));
    checks.push(checkCommits(ev, args.verifyCommits));
    if (args.issue !== null && args.registryConfig !== null) {
      checks.push(checkCommitTaskLinks(ev, args.taskRefs, args.issue, args.registryConfig, args.rootRepo));
    }
    checks.push(checkPrPreparation(ev));
    checks.push(checkBlockers(ev));
  } catch (exc) {
    if (exc instanceof UnknownError) {
      process.stdout.write(JSON.stringify({ result: "UNKNOWN", tool_version: TOOL_VERSION, checks, reasons: [exc.message] }, null, 2) + "\n");
      return 3;
    }
    throw exc;
  }

  const result: CheckResult = checks.some((c) => c.result === "UNKNOWN") ? "UNKNOWN"
    : checks.some((c) => c.result === "FAIL") ? "FAIL" : "PASS";
  const reasons = checks.flatMap((c) => c.reasons.map((r) => `[${c.name}] ${r}`));
  process.stdout.write(JSON.stringify({ result, tool_version: TOOL_VERSION, checks, reasons }, null, 2) + "\n");
  return result === "PASS" ? 0 : result === "FAIL" ? 2 : 3;
}

/** commander 注册：group=dev；参数解析沿用原脚本实现以保证契约逐字节等价。 */
export function registerDevCheckCompletion(group: Command): void {
  group
    .command("check-completion")
    .description("Development Completion Check（02 §8）")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action((...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      process.exitCode = main(cmd.args);
    });
}
