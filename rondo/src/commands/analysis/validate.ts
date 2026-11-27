/**
 * analysis validate — Analysis Gate 确定性检查（02 §5.4）。
 *
 * 用法: rondo analysis validate --issue <issue-id> --change-ref <id> --openspec-root <path> [--workspace-id <id>] [--multica <cli>]
 *
 * 输入：当前 Issue 来源事实、Change ID及 OpenSpec Change 目录。
 * 输出：{ result: PASS | FAIL | UNKNOWN, checks: [...], reasons: [...] }
 * 退出码：0 = PASS，2 = FAIL，3 = UNKNOWN。
 *
 * Delta 格式由 OpenSpec 严格校验，Rondo 核对项目的 Analysis 事实和工件。
 * 检查项由 ANALYSIS_GATE_CHECKS 定义，供 Gate 生成与消费共同使用。
 */

import { analysisRuntime } from "./runtime.js";
import type { RuntimeConfig } from "../../clients/config.js";
import { existsSync, readFileSync, realpathSync, readdirSync, lstatSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { assertStableChangeRef, matchesTfsChangeId, readChangeMetadata, parseChangeSchema, sourceSchemaViolation, changeKindFromSchema, type ChangeSchema } from "./change-schema.js";
import { markLeafExecuted } from "../../cli/output.js";
import { TOOL_VERSION } from "../../cli/version.js";
import { runCommand } from "../../clients/spawn.js";
import { MulticaClient, requireIssueMetadata } from "../../clients/multica.js";
import { commandExists } from "../../clients/which.js";
import { resolveOpenspecRootDir } from "../../clients/runtime-paths.js";
import { classifyTfsType, analysisMetadataEntries } from "./facts.js";
import { taskReferences } from "./source.js";
import { parseRepositoryScope } from "./repository-scope.js";
import { changeEvidenceDigest, metadataEvidenceDigest } from "./gate-evidence.js";

type CheckResult = "PASS" | "FAIL" | "UNKNOWN";
interface Check { name: string; result: CheckResult; reasons: string[] }


function readText(path: string): string | null {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

function hasMarkdown(dir: string): boolean {
  const info = lstatSync(dir, { throwIfNoEntry: false });
  if (!info) return false;
  if (!info.isDirectory()) throw new UnknownError("Specs 不是普通目录: " + dir);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new UnknownError("Specs 包含不可验证的链接: " + entry.name);
    if (entry.isDirectory() && hasMarkdown(join(dir, entry.name))) return true;
    if (entry.isFile() && entry.name.endsWith(".md")) return true;
  }
  return false;
}

interface Args { issue: string; openspecRoot: string; cli: string; workspaceId: string | null; out: string | null; changeRef: string }

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const issue = get("--issue");
  const openspecRoot = get("--openspec-root");
  const changeRef = get("--change-ref");
  if (!issue || !openspecRoot || !changeRef) {
    process.stderr.write("用法: rondo analysis validate --issue <issue-id> --change-ref <id> --openspec-root <path> [--workspace-id <id>] [--multica <cli>]\n");
    process.exit(64);
  }
  return { issue, openspecRoot, cli: get("--multica") ?? "multica", workspaceId: get("--workspace-id"), out: get("--out"), changeRef };
}

/** Gate is a read-only check; stdout and Complete share this in-memory result. */
export interface GateOutcome {
  exitCode: number;
  /** Scope from the exact metadata bytes included in the Gate digest; not serialized. */
  scope?: string[];
  payload: {
    result: "PASS" | "FAIL" | "UNKNOWN";
    checks: Check[];
    reasons: string[];
    change_digest?: string;
    metadata_digest?: string;
    digest_eol?: "lf";
    schema?: ChangeSchema;
    change_ref?: string;
    issue_id?: string;
    workspace_id?: string;
  };
}
function gateOutcome(payload: unknown, exitCode: number, _out: string | null): GateOutcome {
  return { payload: payload as GateOutcome["payload"], exitCode };
}
export function emitResult(payload: unknown, exitCode: number, _outPath: string | null): number {
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  return exitCode;
}

export function checkIdentity(meta: Record<string, unknown>, schema: ChangeSchema | null, changeRef: string): Check {
  const reasons: string[] = [];
  const tfsId = meta["tfs.id"];
  const tfsKind = classifyTfsType(meta["tfs.type"]);
  if (tfsId === undefined || tfsId === null || tfsId === "") reasons.push("缺少 metadata tfs.id");
  else if ((typeof tfsId !== "string" && typeof tfsId !== "number") || !/^\d+$/.test(String(tfsId)) ||
    !Number.isSafeInteger(Number(tfsId)) || Number(tfsId) <= 0) {
    reasons.push("metadata tfs.id 必须是正整数");
  } else if (!matchesTfsChangeId(changeRef, String(tfsId))) {
    reasons.push(`change_ref=${changeRef} 与 tfs.id=${tfsId} 冲突，必须使用当前 TFS ID 作为末尾独立段`);
  }
  if (!tfsKind) reasons.push(`tfs.type 缺失或不支持: ${String(meta["tfs.type"])}`);
  if (schema) {
    const violation = sourceSchemaViolation(tfsKind, schema);
    if (violation && tfsKind) reasons.push(violation);
  }
  return { name: "identity", result: reasons.length ? "FAIL" : "PASS", reasons };
}

export function checkChange(openspecRoot: string, changeRef: unknown): {
  check: Check; changeDir: string | null; schema: ChangeSchema | null; rawMetadata?: string;
} {
  try {
    assertStableChangeRef(changeRef);
  } catch (exc) {
    return { check: { name: "change", result: "FAIL", reasons: [String((exc as Error).message)] }, changeDir: null, schema: null };
  }
  const changeDir = join(openspecRoot, "changes", changeRef);
  if (!existsSync(changeDir)) {
    return { check: { name: "change", result: "FAIL", reasons: [`Change 目录不存在: ${changeDir}`] }, changeDir: null, schema: null };
  }
  try {
    const rawMetadata = readChangeMetadata(changeDir);
    const schema = parseChangeSchema(rawMetadata);
    return { check: { name: "change", result: "PASS", reasons: [] }, changeDir, schema, rawMetadata };
  } catch (exc) {
    const kind: CheckResult = exc instanceof FailError ? "FAIL" : "UNKNOWN";
    return { check: { name: "change", result: kind, reasons: [(exc as Error).message] }, changeDir: null, schema: null };
  }
}

function nativeRootIssue(root: { path?: unknown; source?: unknown } | undefined, openspecRoot: string): string | null {
  if (typeof root?.path !== "string" || !isAbsolute(root.path) ||
      typeof root.source !== "string" || !root.source || root.source === "implicit") {
    return "缺少可信根仓信息";
  }
  try {
    if (realpathSync(root.path) !== realpathSync(dirname(openspecRoot)) ||
        realpathSync(join(root.path, "openspec")) !== realpathSync(openspecRoot)) {
      return "Root 与当前 Analysis 的 OpenSpec 目录不一致";
    }
  } catch {
    return "Root 无法核实";
  }
  return null;
}

/**
 * 只有 OpenSpec 原生 status 在同一根仓、同一 Change、同一 Intentional Schema 下
 * 明确报告 specs=skipped，才能允许缺少 Delta Spec。不能仅凭 .openspec.yaml 的文字
 * 或另写一份 Artifact Graph 放行；无法读取权威状态即 UNKNOWN。
 */
function nativeSpecsSkipStatus(openspecRoot: string, changeDir: string): { result: CheckResult; reason: string } {
  if (!commandExists("openspec")) return { result: "UNKNOWN", reason: "OpenSpec CLI 不可用，无法核实 specs 的原生 skipped 状态" };
  const changeRef = basename(changeDir);
  let cp;
  try {
    cp = runCommand(["openspec", "status", "--change", changeRef, "--json"], dirname(openspecRoot));
  } catch (error) {
    return { result: "UNKNOWN", reason: `openspec status 无法执行: ${String(error)}` };
  }
  if (cp.status !== 0) {
    return { result: "UNKNOWN", reason: `openspec status 失败: ${(cp.stderr.trim() || cp.stdout.trim()).slice(0, 300)}` };
  }
  let status: any;
  try { status = JSON.parse(cp.stdout); }
  catch { return { result: "UNKNOWN", reason: "openspec status JSON 不可解析" }; }
  const rootIssue = nativeRootIssue(status?.root, openspecRoot);
  if (rootIssue) return { result: "UNKNOWN", reason: `openspec status ${rootIssue}` };
  if (status.changeName !== changeRef || status.schemaName !== "intentional-change") {
    return { result: "FAIL", reason: "Intentional Change 身份或 Schema 与 OpenSpec status 不一致" };
  }
  if (!Array.isArray(status.artifacts)) {
    return { result: "UNKNOWN", reason: "openspec status 缺少 artifacts 状态列表" };
  }
  const specs = status.artifacts.find((a: any) => a && a.id === "specs");
  if (!specs || typeof specs.status !== "string") {
    return { result: "UNKNOWN", reason: "openspec status 未返回 specs 的确定性状态" };
  }
  if (specs.status !== "skipped") {
    return { result: "FAIL", reason: `Intentional Change 缺少 specs/ Delta Specs；原生状态为 ${specs.status}` };
  }
  return { result: "PASS", reason: "" };
}

export function checkAcceptanceContract(schema: ChangeSchema | null, changeDir: string | null, openspecRoot: string, rawMetadata?: string): Check {
  const reasons: string[] = [];
  if (!schema || !changeDir) return { name: "acceptance_contract", result: "FAIL", reasons: ["前置检查未通过"] };
  const proposal = readText(join(changeDir, "proposal.md"));
  if (!proposal) reasons.push("缺少 proposal.md 或不可读");
  try {
    parseRepositoryScope(rawMetadata ?? readText(join(changeDir, ".openspec.yaml")) ?? "");
  } catch (error) {
    if (error instanceof UnknownError) return { name: "acceptance_contract", result: "UNKNOWN", reasons: [error.message] };
    if (!(error instanceof FailError)) throw error;
    reasons.push(error.message);
  }

  if (!reasons.length && schema === "intentional-change") {
    // 已有 Delta 的格式由 openspec_validate 按操作类型检查；只有缺少 Delta 才需核实 skipped。
    if (!hasMarkdown(join(changeDir, "specs"))) {
      const native = nativeSpecsSkipStatus(openspecRoot, changeDir);
      if (native.result === "UNKNOWN") {
        return { name: "acceptance_contract", result: "UNKNOWN", reasons: [...reasons, native.reason] };
      }
      if (native.result === "FAIL") reasons.push(native.reason);
    }
  }
  return { name: "acceptance_contract", result: reasons.length ? "FAIL" : "PASS", reasons };
}

function checkTasks(changeDir: string | null): Check {
  const reasons: string[] = [];
  if (!changeDir) return { name: "tasks", result: "FAIL", reasons: ["前置检查未通过"] };
  const tasks = readText(join(changeDir, "tasks.md"));
  if (!tasks) return { name: "tasks", result: "FAIL", reasons: ["缺少 tasks.md"] };
  try {
    if (!taskReferences(tasks).length) reasons.push("tasks.md 未找到任何可引用任务项");
  } catch (error) {
    if (!(error instanceof FailError)) throw error;
    reasons.push(error.message);
  }
  return { name: "tasks", result: reasons.length ? "FAIL" : "PASS", reasons };
}

function checkOpenSpecValidate(changeDir: string | null, openspecRoot: string): Check {
  const name = "openspec_validate";
  if (!changeDir) return { name, result: "FAIL", reasons: ["前置检查未通过"] };
  if (!commandExists("openspec")) {
    return { name, result: "UNKNOWN", reasons: ["openspec CLI 不可用（未安装或不在 PATH）"] };
  }
  const changeRef = basename(changeDir);
  let cp;
  try {
    cp = runCommand(["openspec", "validate", changeRef, "--type", "change", "--strict", "--no-interactive", "--json"], dirname(openspecRoot));
  } catch (error) {
    return { name, result: "UNKNOWN", reasons: [`openspec validate 无法执行: ${String(error)}`] };
  }
  let report;
  try { report = JSON.parse(cp.stdout); }
  catch {
    return { name, result: "UNKNOWN", reasons: [`openspec validate JSON 不可解析（rc=${cp.status}）: ${cp.stderr.trim().slice(0, 300)}`] };
  }
  const rootIssue = nativeRootIssue(report?.root, openspecRoot);
  if (rootIssue) return { name, result: "UNKNOWN", reasons: [`openspec validate ${rootIssue}`] };
  const item = Array.isArray(report.items) && report.items.length === 1 ? report.items[0] : null;
  if (item?.id !== changeRef || item.type !== "change" || typeof item.valid !== "boolean") {
    return { name, result: "UNKNOWN", reasons: ["openspec validate 未返回当前 Change 的唯一校验结果"] };
  }
  if (cp.status !== (item.valid ? 0 : 1)) {
    return { name, result: "UNKNOWN", reasons: [`openspec validate 退出码 ${cp.status} 与校验结果不一致`] };
  }
  const issues: { level: string; path: string; message: string }[] = Array.isArray(item.issues) ? item.issues : [];
  if (item.valid) return { name, result: "PASS", reasons: issues.filter(issue => issue && typeof issue.message === "string").map(issue => `${issue.level}: ${issue.path}: ${issue.message}`) };
  const details = issues.filter(issue => issue?.level === "ERROR" || issue?.level === "WARNING")
    .map(issue => `${issue.path}: ${issue.message}`).join("\n").slice(0, 500);
  return { name, result: "FAIL", reasons: [`openspec validate --strict 失败: ${details || changeRef}`] };
}

export function evaluateAnalysisGate(input: { issue: string; openspecRoot: string; workspaceId: string; runtime: RuntimeConfig; changeRef: string; snapshot?: { issue: Record<string, unknown>; metadata: Record<string, unknown> } }): GateOutcome {
  const args = input;
  const checks: Check[] = [];
  let context: { issue_id: string; workspace_id: string; change_ref: string; change_kind: "corrective" | "intentional"; schema: ChangeSchema; change_dir: string; metadata_digest: string; metadata: Record<string, unknown> } | null = null;
  try {
    // 先确认 Issue 在当前工作区可读取；复用同一原生响应中的 Metadata。
    const issue = input.snapshot?.issue ?? new MulticaClient(input.runtime).getIssue(args.issue);
    if (!issue.id) throw new UnknownError(`Issue ${args.issue} 不可读取（不存在或不属于当前工作区）`);
    const sourceMeta = input.snapshot?.metadata ?? requireIssueMetadata(issue);
    // --openspec-root 语义统一：根仓路径自动归一到其 openspec/ 子目录
    const openspecRoot = resolveOpenspecRootDir(args.openspecRoot);
    const { check: change, changeDir, schema, rawMetadata } = checkChange(openspecRoot, input.changeRef);
    const meta = schema ? { ...sourceMeta, ...analysisMetadataEntries(schema) } : sourceMeta;
    checks.push(checkIdentity(meta, schema, input.changeRef));
    checks.push(change);
    // Change 不可确认时不执行依赖该目录/Schema 的检查，避免派生 FAIL。
    if (change.result === "PASS") {
      checks.push(checkTasks(changeDir));
    }
    // 本地硬条件已失败时，不再执行可能启动外部 CLI 的 Acceptance 检查或 Strict Validation。
    if (checks.every(c => c.result === "PASS")) {
      checks.push(checkAcceptanceContract(schema, changeDir, openspecRoot, rawMetadata));
      if (checks.every(c => c.result === "PASS")) checks.push(checkOpenSpecValidate(changeDir, openspecRoot));
    }
    if (schema && changeDir) {
      context = {
        issue_id: String(issue.id), workspace_id: args.workspaceId!,
        change_ref: input.changeRef, change_kind: changeKindFromSchema(schema),
        schema, change_dir: changeDir, metadata_digest: metadataEvidenceDigest(meta, input.changeRef), metadata: meta,
      };
    }
  } catch (exc) {
    if (exc instanceof FailError) return gateOutcome({ result: "FAIL", checks, reasons: [exc.message] }, 2, null);
    if (exc instanceof UnknownError) {
      const out = { result: "UNKNOWN", checks, reasons: [exc.message] };
      return gateOutcome(out, 3, null);
    }
    throw exc;
  }

  let result: CheckResult = "PASS";
  if (checks.some((c) => c.result === "FAIL")) result = "FAIL";
  else if (checks.some((c) => c.result === "UNKNOWN")) result = "UNKNOWN";
  const reasons = checks.filter(c => result === "PASS" || c.result !== "PASS").flatMap((c) => c.reasons.map((r) => `[${c.name}] ${r}`));
  const code = result === "PASS" ? 0 : result === "FAIL" ? 2 : 3;
  if (result === "PASS") {
    if (!context) return gateOutcome({ result: "UNKNOWN", checks, reasons: ["Gate 缺少可核验的 Change 身份"] }, 3, null);
    try {
      const { change_dir, metadata, ...identity } = context;
      let scope: string[] | undefined;
      const change_digest = changeEvidenceDigest(change_dir, metadata, (name, bytes) => {
        if (name === ".openspec.yaml") scope = parseRepositoryScope(bytes.toString("utf8"));
      }, true);
      return { ...gateOutcome({ result, tool_version: TOOL_VERSION, ...identity, change_digest, digest_eol: "lf", checks, reasons }, code, null), scope };
    } catch (exc) {
      if (exc instanceof FailError) return gateOutcome({ result: "FAIL", checks, reasons: [exc.message] }, 2, null);
      if (exc instanceof UnknownError) {
        return gateOutcome({ result: "UNKNOWN", checks, reasons: [exc.message] }, 3, null);
      }
      throw exc;
    }
  }
  return gateOutcome({ result, tool_version: TOOL_VERSION, checks, reasons }, code, null);
}

/** Preview never persists a file. Complete invokes the same check again before publication. */
function main(rawArgs: string[]): number {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) { process.stdout.write("用法: rondo analysis validate --issue <issue-id> --change-ref <id> --openspec-root <path> [--workspace-id <id>] [--multica <cli>]\n"); return 0; }
  const args = parseArgs(rawArgs);
  if (args.out) return emitResult({ result: "FAIL", checks: [], reasons: ["--out 已退役；Analysis Gate 结果不再持久化"] }, 2, null);
  try {
    const runtime = analysisRuntime(rawArgs, args.cli, args.workspaceId);
    const outcome = evaluateAnalysisGate({
      issue: args.issue,
      openspecRoot: args.openspecRoot,
      workspaceId: runtime.workspace_id!,
      runtime, changeRef: args.changeRef,
    });
    return emitResult(outcome.payload, outcome.exitCode, null);
  } catch (error) {
    if (error instanceof UnknownError) return emitResult({ result: "UNKNOWN", checks: [], reasons: [error.message] }, 3, null);
    throw error;
  }
}

/** commander 注册：group=analysis；参数解析沿用原脚本实现以保证契约逐字节等价。 */
export function registerAnalysisValidate(group: Command): void {
  group
    .command("validate")
    .description("校验 Issue 与 OpenSpec Change 的身份及规范")
    .usage("--issue <key> --change-ref <id> --openspec-root <path> [--workspace-id <id>] [--multica <cli>]")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action((...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      process.exit(main(cmd.args));
    });
}
