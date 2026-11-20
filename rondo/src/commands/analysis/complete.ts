/** Verify the reviewed Change, publish it and record its immutable remote source before review. */
import { analysisRuntime } from "./runtime.js";
import { multicaPrefix } from "../../clients/multica-environment.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { logLine as log, markLeafExecuted } from "../../cli/output.js";
import { runCommand, runJson } from "../../clients/spawn.js";
import { loadConfig, type BaseRegistryConfig } from "../../clients/config.js";
import { resolveRuntimePaths } from "../../clients/runtime-paths.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";
import { gitOk } from "../../clients/git.js";
import { publishChange, requirementBranch, requirementRoot, rootRepositoryUrl } from "../runtime/root-git.js";
import { assertAnalysisWritable } from "./guard.js";
import { readChangeSchema, sourceSchemaViolation } from "./change-schema.js";
import { changeEvidenceDigest, metadataEvidenceDigest, verifyGateEvidence, verifyGateEvidenceData } from "./gate-evidence.js";
import { parseAnalysisSource, readAnalysisArtifact, readAnalysisSource, repositoryUrl, sameAnalysisSource, type AnalysisSource } from "./source.js";
import {
  PreconditionError,
  classifyTfsType,
  draftMetadataEntries,
  loadFactsFile,
  validateDraftFields,
  type Facts,
} from "./facts.js";

import { committedGate, readPublishedGate, assertCommittedGateFiles } from "./published-source.js";

const TARGET_STATUS = "analysis_review";

function loadFacts(path: string): Facts {
  const f = loadFactsFile(path) as Partial<Facts>;
  const missing = validateDraftFields(f);
  if (!f.gate?.result) missing.push("gate.result");
  if (!f.gate?.reasons_ref?.trim()) missing.push("gate.reasons_ref");
  if (missing.length > 0) throw new PreconditionError(`facts 字段缺失或非法: ${missing.join("; ")}`);
  if (f.gate!.result !== "PASS") {
    throw new PreconditionError(`gate.result=${f.gate!.result}，analysis-completion 只接受 PASS（02 §5.4）`);
  }
  return f as Facts;
}

function metadataEntries(f: Facts): Record<string, string> {
  return {
    ...draftMetadataEntries(f),
    "analysis.gate.result": f.gate.result,
    "analysis.gate.reasons_ref": f.gate.reasons_ref,
  };
}

function parseArgs(argv: string[]): { issue: string; facts: string; cli: string; workspaceId: string | null; registryConfig: string | null; rootRepo: string | null; mode: string } {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const issue = get("--issue");
  const facts = get("--facts");
  if (!issue || !facts || !get("--workspace-id") || !get("--registry-config")) {
    process.stderr.write("用法: rondo analysis complete --issue <issue-id> --facts <facts.json> --registry-config <repo-registry.json> --workspace-id <id> [--multica <cli>] [--root-repo <path>]\n");
    process.exit(64);
  }
  return { issue, facts, cli: get("--multica") ?? "multica", workspaceId: get("--workspace-id"), registryConfig: get("--registry-config"), rootRepo: get("--root-repo"), mode: get("--mode") ?? "legacy" };
}

/** 读取唯一推送地址；拒绝凭据 URL，避免在 metadata 中保存认证信息。 */
function pushRepositoryUrl(root: string): string {
  const urls = gitOk(root, ["remote", "get-url", "--push", "--all", "origin"], "读取推送仓库").split(/\r?\n/);
  if (urls.length !== 1) throw new UnknownError("origin 必须有唯一推送地址，无法确定规范来源");
  return repositoryUrl(urls[0]).href;
}

/** Workspace 配置始终校验（身份一致即可）；TFS 剥离后不再依赖 TFS CLI。 */
export function assertRegistryWorkspace(path: string, workspaceId: string): void {
  let cfg: { runtime?: { workspace_id?: string } };
  try {
    cfg = JSON.parse(readFileSync(path, "utf8"));
  } catch (exc) {
    throw new UnknownError(`无法读取 Analysis Registry: ${exc}`);
  }
  if (cfg.runtime?.workspace_id !== workspaceId) {
    throw new UnknownError("Analysis Registry 的 runtime.workspace_id 与 --workspace-id 不一致");
  }
}

async function main(rawArgs: string[]): Promise<number> {
  const args = parseArgs(rawArgs);
  const ws = ["--workspace-id", args.workspaceId!];
  try {
    const runtime = analysisRuntime(rawArgs, args.cli, args.workspaceId);
    const MC = multicaPrefix(runtime);
    const facts = loadFacts(args.facts);
    const entries = metadataEntries(facts);

    // 0. 确认 Issue 在当前工作区可读取（transient：空 stdout 瞬态重试一次，P0）
    const before = runJson([...MC, "issue", "get", args.issue, ...ws, "--output", "json"], "读取 Issue", undefined, { transient: true }) as Record<string, unknown>;
    if (!before.id) throw new UnknownError(`Issue ${args.issue} 不可读取（不存在或不属于当前工作区）`);

    const priorMeta = runJson([...MC, "issue", "metadata", "list", args.issue, ...ws, "--output", "json"], "核对当前分析身份", undefined, { transient: true }) as Record<string, unknown>;
    if (!["legacy", "requirement"].includes(args.mode)) throw new PreconditionError("analysis complete --mode 仅支持 requirement 或省略");
    const tfsKind = classifyTfsType(priorMeta["tfs.type"]);
    if (args.mode === "requirement" && tfsKind !== "requirement") throw new PreconditionError("Requirement 模式仅适用于 TFS 需求");
    if (tfsKind === "requirement" && (process.env.RONDO_WORKSPACE_PATH || process.env.RONDO_WORKSPACE_BRANCH) && args.mode !== "requirement") {
      throw new PreconditionError("已配置 08-B 持久根仓的 Requirement 必须显式使用 --mode requirement，禁止绕过发布身份核验");
    }
    if (!tfsKind) throw new UnknownError(`tfs.type 缺失或不支持: ${String(priorMeta["tfs.type"] ?? "")}`);
    assertRegistryWorkspace(args.registryConfig!, args.workspaceId!);
    const cfg = loadConfig<BaseRegistryConfig>(args.registryConfig!, { requireRegistry: false, requireTfs: false });
    // 根仓资源查询与 Issue 读写使用同一环境，包含显式 --profile/--multica 覆盖。
    cfg.runtime = runtime;

    // 审核中的重放只核验已发布来源，不用当前工作树或已前进的 HEAD 改写审核基线。
    if (!assertAnalysisWritable(before, priorMeta, "complete", entries)) {
      const source = readAnalysisSource(priorMeta);
      const published = await readPublishedGate(source);
      const violation = sourceSchemaViolation(tfsKind, published.schema);
      if (violation) throw new PreconditionError(violation);
      const missing = validateDraftFields(facts, published.schema);
      if (missing.length) throw new PreconditionError(missing.join("; "));
      verifyGateEvidenceData(published.gate, facts, published.schema, String(before.id), args.workspaceId!, priorMeta);
      await readAnalysisArtifact(source, "tasks.md");
      const latest = runJson([...MC, "issue", "get", args.issue, ...ws, "--output", "json"], "重放后核对审核状态") as Record<string, unknown>;
      const current = runJson([...MC, "issue", "metadata", "list", args.issue, ...ws, "--output", "json"], "重放后核对来源") as Record<string, unknown>;
      if (String(latest.status ?? latest.status_name ?? "") !== TARGET_STATUS ||
          !sameAnalysisSource(source, readAnalysisSource(current)) || metadataEvidenceDigest(current) !== metadataEvidenceDigest(priorMeta) ||
          Object.entries(entries).some(([k, v]) => current[k] !== v)) throw new UnknownError("审核重放期间状态或来源已变化，停止放行");
      process.stdout.write(JSON.stringify({ result: "PASS", issue: args.issue, status: TARGET_STATUS,
        metadata_keys: [...Object.keys(entries), "analysis.source"], analysis_source: source,
        root_commit: { branch: source.branch, commit: source.commit, pushed: true, committed: "skipped_review_replay" } }, null, 2) + "\n");
      return 0;
    }

    // Gate 已按 Schema 验证；Complete 再次读取持久化 Change，防止在 Gate 之后
    // 漏传 Intentional AI Review 或把来源类型与工程契约错误组合写进审核状态。
    const requirement = args.mode === "requirement";
    const root = requirement ? requirementRoot(args.rootRepo) : resolveRuntimePaths(cfg, {
      issue: before as { project_id?: string | null }, rootRepoArg: args.rootRepo || process.env.RONDO_WORKSPACE_PATH,
      need: ["openspec"],
    }).rootRepo;
    const changeDir = join(root, "openspec", "changes", facts.change_ref);
    const readGateAt = (commit: string) => committedGate(root, commit, facts, String(before.id), args.workspaceId!, priorMeta);
    const committed = requirement ? readGateAt("HEAD") : undefined;
    const schema = committed?.schema ?? readChangeSchema(changeDir);
    const schemaIssues = validateDraftFields(facts, schema);
    if (schemaIssues.length > 0) throw new PreconditionError(`当前 Schema 的 Facts 校验失败: ${schemaIssues.join("; ")}`);
    const violation = sourceSchemaViolation(tfsKind, schema);
    if (violation) throw new PreconditionError(violation);
    // Facts 中的 PASS 声明不足以提交审核：必须有与当前 Issue、Workspace、
    // Change Kind / Schema 和工件快照一致的 Gate 结果文件。
    const gateEvidence = committed?.gate ?? verifyGateEvidence(root, facts, schema, String(before.id), args.workspaceId!, priorMeta);
    const writable = assertAnalysisWritable(before, priorMeta, "complete", entries);
    let rootCommit: Record<string, unknown> | null = null;
    if (writable) {
      for (const [key, value] of Object.entries(draftMetadataEntries(facts))) {
        if (String(priorMeta[key] ?? "") !== value) {
          throw new PreconditionError(`draft metadata ${key} 与本次 Facts 不一致；必须先完成 analysis stage 和 Gate`);
        }
      }
      // 来源已写入但状态未切换时，以固定版本 Gate 识别同一审核包，不能顺带推送新 HEAD。
      let recovered: AnalysisSource | undefined;
      if (!requirement && priorMeta["analysis.source"] !== undefined) {
        const saved = parseAnalysisSource(priorMeta["analysis.source"]);
        if (saved.change_ref === facts.change_ref) {
          const published = await readPublishedGate(saved);
          if (published.gate.change_digest === gateEvidence.change_digest && published.gate.metadata_digest === gateEvidence.metadata_digest) {
            verifyGateEvidenceData(published.gate, facts, schema, String(before.id), args.workspaceId!, priorMeta, gateEvidence.change_digest);
            if (published.schema !== schema) throw new UnknownError("已保存来源的 Schema 与当前审核包不一致");
            recovered = saved;
          }
        }
      }
      if (recovered) {
        rootCommit = { repo_url: recovered.repo_url, branch: recovered.branch, commit: recovered.commit,
          committed: "skipped_no_changes", pushed: true, reused_source: true };
      } else {
        const tfsId = String(priorMeta["tfs.id"] ?? "").trim();
        const subject = `analysis: ${facts.change_ref} (${args.issue}${tfsId ? ` / tfs ${tfsId}` : ""})`;
        const result = requirement ? await publishChange(root, facts.change_ref, args.issue, undefined, subject, {
          repoUrl: rootRepositoryUrl(root), expectedBranch: requirementBranch(),
          validateTree: (commit: string) => {
            if (readGateAt(commit).gate.change_digest !== gateEvidence.change_digest) {
              throw new FailError("候选发布版本与本次 Analysis Gate 工件不一致");
            }
          },
        }) : publishChange(root, facts.change_ref, args.issue, undefined, subject);
        rootCommit = { ...result };
      }
      if (!requirement && changeEvidenceDigest(changeDir, priorMeta, undefined, gateEvidence.digest_eol === "lf") !== gateEvidence.change_digest) {
        throw new UnknownError("根仓 Commit/Push 后 Change 工件发生变化，必须重新执行 Analysis Gate");
      }
      if (!recovered && canonicalRepositoryIdentity(pushRepositoryUrl(root)) !== canonicalRepositoryIdentity(String(rootCommit.repo_url))) {
        throw new UnknownError("推送期间 origin 地址已变化，无法确定规范来源");
      }
      const source = recovered ?? parseAnalysisSource({ repo_url: rootCommit.repo_url, branch: rootCommit.branch,
        commit: String(rootCommit.commit), change_ref: facts.change_ref }, facts.change_ref);
      if (!requirement) assertCommittedGateFiles(root, source, priorMeta, gateEvidence.change_digest, gateEvidence.digest_eol === "lf");
      const remoteTasks = await readAnalysisArtifact(source, "tasks.md");
      const localBlob = gitOk(root, ["rev-parse", `${source.commit}:openspec/changes/${facts.change_ref}/tasks.md`], "核对任务快照");
      if (remoteTasks.object_id !== localBlob) throw new UnknownError("远端规范与最终 Git commit 不一致");
      const publishedGate = await readPublishedGate(source);
      if (publishedGate.schema !== schema) throw new UnknownError("远端规范 Schema 与 Gate 不一致");
      verifyGateEvidenceData(publishedGate.gate, facts, schema, String(before.id), args.workspaceId!, priorMeta, gateEvidence.change_digest);
      if (!requirement) assertCommittedGateFiles(root, source, priorMeta, gateEvidence.change_digest, gateEvidence.digest_eol === "lf");
      // HEAD 是共享的；实际发布版本由本次路径 Commit SHA 和远端读取确认。
      rootCommit.commit = source.commit;
      rootCommit.repo_url = source.repo_url;
      entries["analysis.source"] = JSON.stringify(source);
      const latestMeta = runJson([...MC, "issue", "metadata", "list", args.issue, ...ws, "--output", "json"], "提交审核前核对 Facts") as Record<string, unknown>;
      if (latestMeta["analysis.source"] !== priorMeta["analysis.source"]) throw new UnknownError("收口期间 analysis.source 已被其他流程更新，停止覆盖");
      if (metadataEvidenceDigest(latestMeta) !== gateEvidence.metadata_digest) {
        throw new UnknownError("根仓 Commit/Push 期间 Analysis Facts 发生变化，必须重新执行 Analysis Gate");
      }
      const liveIssue = runJson([...MC, "issue", "get", args.issue, ...ws, "--output", "json"], "发布前核对 Issue 状态") as Record<string, unknown>;
      if (String(liveIssue.status ?? liveIssue.status_name ?? "") !== "in_progress") throw new UnknownError("收口期间 Issue 已离开 in_progress，停止发布审核");
      for (const [k, v] of Object.entries(entries)) {
        runJson([...MC, "issue", "metadata", "set", args.issue,
                 "--key", k, "--value", v, "--type", "string", ...ws, "--output", "json"],
                `写入 metadata(key=${k})`);
      }
      // 来源在切换审核状态前必须回读成功，避免 Human 看到没有版本指针的审核包。
      const published = runJson([...MC, "issue", "metadata", "list", args.issue, ...ws, "--output", "json"], "回读审核来源") as Record<string, unknown>;
      if (Object.entries(entries).some(([k, v]) => String(published[k]) !== v)) throw new UnknownError("审核 metadata 回读不一致，未进入 analysis_review");
      const statusCp = runCommand([...MC, "issue", "status", args.issue, TARGET_STATUS, "--no-start", ...ws, "--output", "json"]);
      if (statusCp.status !== 0) {
        throw new UnknownError(`写入状态失败 rc=${statusCp.status}: ${statusCp.stderr.trim()}`);
      }
    }

    // 3. 回读确认
    const issue = runJson([...MC, "issue", "get", args.issue, ...ws, "--output", "json"], "回读 Issue", undefined, { transient: true }) as Record<string, unknown>;
    const meta = runJson([...MC, "issue", "metadata", "list", args.issue, ...ws, "--output", "json"], "回读 metadata", undefined, { transient: true }) as Record<string, unknown>;
    const mismatches: string[] = [];
    const statusNow = String(issue.status ?? issue.status_name ?? "");
    if (statusNow !== TARGET_STATUS) mismatches.push(`status=${statusNow}（期望 ${TARGET_STATUS}）`);
    for (const [k, v] of Object.entries(entries)) {
      if (String(meta[k]) !== v) mismatches.push(`metadata ${k} 回读不一致`);
    }
    if (mismatches.length > 0) {
      process.stdout.write(JSON.stringify({ result: "FAIL", reason: "回读校验不一致", mismatches }, null, 2) + "\n");
      return 2;
    }

    // TFS 剥离（tfs-writeback-decoupling-plan）：此处不再有 TFS 写段——
    // 需求/Bug 的状态链由 PR 通过后的 `rondo tfs writeback` 统一逐跳补走。
    process.stdout.write(JSON.stringify({
      result: "PASS",
      issue: args.issue,
      status: TARGET_STATUS,
      metadata_keys: Object.keys(entries),
      root_commit: rootCommit,
    }, null, 2) + "\n");
    return 0;
  } catch (exc) {
    if (exc instanceof PreconditionError || exc instanceof FailError) {
      process.stdout.write(JSON.stringify({ result: "FAIL", reason: exc.message }, null, 2) + "\n");
      return 2;
    }
    if (exc instanceof UnknownError) {
      log(`UNKNOWN: ${exc.message}`);
      process.stdout.write(JSON.stringify({ result: "UNKNOWN", reason: exc.message }, null, 2) + "\n");
      return 3;
    }
    throw exc;
  }
}

/** commander 注册：group=analysis；参数解析沿用原脚本实现以保证契约逐字节等价。 */
export function registerAnalysisComplete(group: Command): void {
  group
    .command("complete")
    .description("analysis-completion 的确定性收口（02 §5.4）：提交推送当前 Change 后写入 analysis_review")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      process.exitCode = await main(cmd.args);
    });
}
