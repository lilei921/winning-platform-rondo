/** Verify the reviewed Change, publish it and record its immutable remote source before review. */
import { resolveMulticaRuntime } from "../../clients/runtime-context.js";
import { loadConfig as loadTfsConfig, ConfigError } from "../../tfs/config.js";
import { multicaPrefix } from "../../clients/multica-environment.js";
import { MulticaClient, requireIssueMetadata } from "../../clients/multica.js";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { logLine as log, markLeafExecuted } from "../../cli/output.js";
import { runCommand, runJson } from "../../clients/spawn.js";
import { resolveRuntimePaths } from "../../clients/runtime-paths.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";
import { assertNativeTaskCheckout, nativeCheckoutExpected, readProjectResources, projectRootResource, type ProjectResource } from "../../clients/native-checkout.js";
import { gitOk } from "../../clients/git.js";
import { publishChange, requirementRoot, rootRepositoryUrl, resolveProjectRootBranch } from "../runtime/root-git.js";
import { assertAnalysisWritable } from "./guard.js";
import { sourceSchemaViolation, changeKindSchemaViolation, assertStableChangeRef, CHANGE_KINDS } from "./change-schema.js";
import { changeEvidenceDigest, metadataEvidenceDigest } from "./gate-evidence.js";
import { evaluateAnalysisGate } from "./validate.js";
import { parseAnalysisSource, readAnalysisSource, repositoryUrl, sameAnalysisSource, type AnalysisSource } from "./source.js";
import {
  PreconditionError,
  classifyTfsType,
  analysisMetadataEntries,
} from "./facts.js";

import { committedContract, readPublishedContract, assertCommittedContractFiles } from "./published-source.js";
import { assertProjectRepositoryScope } from "./repository-scope.js";

const TARGET_STATUS = "analysis_review";
const GATE_RESULT = "analysis.gate.result";
const DELIVERY_FACTS = ["tfs.changed_at", "analysis.human_approval", "finalize.pending", "delivery.tfs_written"];

function sameSourceFacts(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  return before["tfs.id"] === after["tfs.id"] && before["tfs.type"] === after["tfs.type"];
}

function sameDeliveryFacts(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  return DELIVERY_FACTS.every(key => before[key] === after[key]) &&
    (before["tfs.type"] !== "Bug" || before["verify_agent.required"] === after["verify_agent.required"]);
}

function sameIssueOwner(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  return ["id", "assignee_id", "assignee_type", "project_id"].every(key => before[key] === after[key]);
}
const ANALYSIS_CONTRACT_FILE = /^(?:\.openspec\.yaml|proposal\.md|tasks\.md|design\.md|specs\/.+\.md)$/;

function parseArgs(argv: string[]): { issue: string; changeRef: string; rootRepo: string | null; targetBranch: string | null; mode: string | null } {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const retired = argv.find(a => ["--registry-config", "--workspace-id", "--multica", "--profile"].some(flag => a === flag || a.startsWith(flag + "=")));
  if (retired) {
    process.stderr.write("analysis publish 使用当前 Multica Runtime，不接受 " + retired.split("=")[0] + "\n");
    process.exit(64);
  }
  const rootRepo = get("--root-repo");
  if (argv.includes("--root-repo") && (!rootRepo?.trim() || rootRepo.startsWith("--"))) {
    process.stderr.write("--root-repo 必须提供非空路径\n");
    process.exit(64);
  }
  const issue = get("--issue");
  const changeRef = get("--change-ref");
  if (!issue || !changeRef) {
    process.stderr.write("用法: rondo analysis publish --issue <issue-id> --change-ref <id> [--root-repo <path>] [--target-branch <branch>]\n");
    process.exit(64);
  }
  return { issue, changeRef, rootRepo, targetBranch: get("--target-branch"), mode: get("--mode") };
}

/** 读取唯一推送地址；拒绝凭据 URL，避免在 metadata 中保存认证信息。 */
function pushRepositoryUrl(root: string): string {
  const urls = gitOk(root, ["remote", "get-url", "--push", "--all", "origin"], "读取推送仓库").split(/\r?\n/);
  if (urls.length !== 1) throw new UnknownError("origin 必须有唯一推送地址，无法确定规范来源");
  return repositoryUrl(urls[0]).href;
}

async function main(rawArgs: string[]): Promise<number> {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) { process.stdout.write("用法: rondo analysis publish --issue <issue-id> --change-ref <id> [--root-repo <path>] [--target-branch <branch>]\n"); return 0; }
  const args = parseArgs(rawArgs);
  try {
    const runtime = resolveMulticaRuntime();
    const ws = ["--workspace-id", runtime.workspace_id];
    const MC = multicaPrefix(runtime);
    assertStableChangeRef(args.changeRef);
    const entries: Record<string, string> = { [GATE_RESULT]: "PASS" };

    const getIssue = (what: string): Record<string, unknown> => {
      const issue = runJson([...MC, "issue", "get", args.issue, ...ws, "--output", "json"], what, undefined, { transient: true }) as Record<string, unknown>;
      if (!issue?.id) throw new UnknownError(`Issue ${args.issue} 不可读取（不存在或不属于当前工作区）`);
      return issue;
    };
    const before = getIssue("读取 Issue 及分析事实");
    const priorMeta = requireIssueMetadata(before);
    const tfsKind = classifyTfsType(priorMeta["tfs.type"]);
    if (!tfsKind) throw new UnknownError(`tfs.type 缺失或不支持: ${String(priorMeta["tfs.type"] ?? "")}`);
    const requirement = tfsKind === "requirement";
    // 已部署的调用可继续传旧参数，但它只核对来源类型，不能选择或绕过发布路径。
    if (rawArgs.includes("--mode") && args.mode !== (requirement ? "requirement" : "legacy")) {
      throw new PreconditionError("analysis publish --mode 与当前 tfs.type 不一致，请省略该参数");
    }
    const cfg = { runtime };

    // Requirement 审核重放只消费已登记的 PASS、Facts 和固定来源，不重读工件。
    if (!assertAnalysisWritable(before, priorMeta, entries)) {
      const source = readAnalysisSource(priorMeta);
      if (source.change_ref !== args.changeRef) throw new UnknownError("当前审核 Change 与已发布来源不一致");
      if (priorMeta["analysis.gate.result"] !== "PASS") throw new UnknownError("已审核 Issue 缺少可信的 PASS 状态，不能重放");
      if (!(CHANGE_KINDS as readonly unknown[]).includes(priorMeta["analysis.change_kind"]))
        throw new UnknownError("已审核 Issue 缺少有效 Change Kind，不能重放");
      entries["analysis.change_kind"] = String(priorMeta["analysis.change_kind"]);
      if (!requirement) {
        const published = await readPublishedContract(source, priorMeta);
        const violation = sourceSchemaViolation(tfsKind, published.schema);
        if (violation) throw new PreconditionError(violation);
        const invalid = changeKindSchemaViolation(priorMeta["analysis.change_kind"], published.schema);
        if (invalid) throw new PreconditionError(invalid);
        // Legacy 路径尚未采用相同的 Git 候选证明，保留原有读取及读后状态核验。
        const latest = getIssue("重放后核对审核事实");
        const current = requireIssueMetadata(latest);
        if (String(latest.status ?? latest.status_name ?? "") !== TARGET_STATUS ||
            !sameIssueOwner(before, latest) || !sameDeliveryFacts(priorMeta, current) || !sameSourceFacts(priorMeta, current) ||
            !sameAnalysisSource(source, readAnalysisSource(current)) ||
            Object.entries(entries).some(([k, v]) => current[k] !== v)) throw new UnknownError("审核重放期间状态或来源已变化，停止放行");
      }
      process.stdout.write(JSON.stringify({ result: "PASS", issue: args.issue, status: TARGET_STATUS,
        replayed: true, gate_reexecuted: false,
        metadata_keys: [...Object.keys(entries), "analysis.source"], analysis_source: source,
        root_commit: { branch: source.branch, commit: source.commit, pushed: true, committed: "skipped_review_replay" } }, null, 2) + "\n");
      return 0;
    }

    // Complete itself executes the final Gate. A prior validate or Metadata PASS is only a preview.
    const root = requirement ? requirementRoot(args.rootRepo) : resolveRuntimePaths(cfg, {
      issue: before as { project_id?: string | null }, rootRepoArg: args.rootRepo ?? process.env.RONDO_WORKSPACE_PATH,
      rootRepoOrigin: args.rootRepo !== null ? "--root-repo" : "RONDO_WORKSPACE_PATH",
      need: ["openspec"],
    }).rootRepo;
    const native = requirement && nativeCheckoutExpected(root);
    const saved = requirement && priorMeta["analysis.source"] !== undefined
      ? parseAnalysisSource(priorMeta["analysis.source"]) : undefined;
    const pinned = saved?.change_ref === args.changeRef ? saved : undefined;
    const rootUrl = rootRepositoryUrl(root);
    if (pinned && canonicalRepositoryIdentity(rootUrl) !== canonicalRepositoryIdentity(pinned.repo_url))
      throw new FailError("根仓与已有 analysis.source 仓库不一致");
    let publicationBranch: string | undefined;
    if (native) {
      if (!args.rootRepo)
        throw new UnknownError("Native 分析发布需要当前 Workspace 和显式根仓路径");
      const workdir = dirname(root);
      assertNativeTaskCheckout(root, workdir, undefined, String(before.id));
      const runs = runJson([...MC, "issue", "runs", String(before.id), "--active", ...ws, "--output", "json"],
        "核验当前 Analysis Run", undefined, { transient: true });
      const matches = Array.isArray(runs) ? runs.filter(r => r?.id === process.env.MULTICA_TASK_ID) : [];
      if (matches.length !== 1 || matches[0].issue_id !== before.id ||
          matches[0].agent_id !== process.env.MULTICA_AGENT_ID ||
          matches[0].workspace_id !== runtime.workspace_id || matches[0].status !== "running")
        throw new UnknownError("当前 Analysis Task / Issue / Agent / Workspace 身份无法确认");
    } else {
      if (args.targetBranch) throw new PreconditionError("--target-branch 仅用于 Native Requirement 分析发布");
    }
    const changeDir = join(root, "openspec", "changes", args.changeRef);
    // Shared real Gate, independent of caller-supplied PASS or old Metadata.
    const gate = evaluateAnalysisGate({ issue: args.issue, openspecRoot: root, workspaceId: runtime.workspace_id, runtime, changeRef: args.changeRef, snapshot: { issue: before, metadata: priorMeta } });
    if (gate.exitCode !== 0 || gate.payload.result !== "PASS") {
      const reason = gate.payload.reasons.join("; ") || "Analysis Gate 未通过";
      if (gate.payload.result === "FAIL") throw new FailError(reason);
      throw new UnknownError(reason);
    }
    // Only a new contract needs current Resource membership. Fixed-source recovery
    // is proved by the existing Git reachability and Gate digest checks below.
    let resources: ProjectResource[] | undefined;
    const currentResources = () => resources ??= readProjectResources(dirname(root), before.project_id, new MulticaClient(runtime));
    let scopeChecked = false;
    const checkNewScope = () => {
      if (scopeChecked) return;
      if (!gate.scope) throw new UnknownError("本次 Gate 缺少 Repository Scope");
      let serverUrl: string;
      try { serverUrl = loadTfsConfig().serverUrl; }
      catch (e) { if (e instanceof ConfigError) throw new UnknownError(e.message); throw e; }
      assertProjectRepositoryScope(gate.scope, currentResources(), rootUrl, serverUrl);
      scopeChecked = true;
    };
    if (requirement) {
      if (!pinned) checkNewScope();
      publicationBranch = pinned?.branch ?? resolveProjectRootBranch(root, currentResources(), rootUrl);
      if (args.targetBranch && args.targetBranch !== publicationBranch)
        throw new PreconditionError("--target-branch 与固定发布来源或 Project Resource ref 冲突");
    }
    const schema = gate.payload.schema;
    if (!schema) throw new UnknownError("本次 Gate 缺少 Change Schema");
    const derived = analysisMetadataEntries(schema);
    Object.assign(entries, derived);
    const effectiveMeta = { ...priorMeta, ...derived };
    const readContractAt = (commit: string) => committedContract(root, commit, args.changeRef, effectiveMeta);
    if (gate.payload.issue_id !== String(before.id) || gate.payload.workspace_id !== runtime.workspace_id ||
        gate.payload.change_ref !== args.changeRef ||
        gate.payload.metadata_digest !== metadataEvidenceDigest(effectiveMeta, args.changeRef) ||
        !/^[a-f0-9]{64}$/.test(gate.payload.change_digest ?? "")) {
      throw new UnknownError("本次真实 Gate 与 Analysis 身份、Facts 或 Change 摘要不一致");
    }
    const gateEvidence = { change_digest: gate.payload.change_digest!, metadata_digest: gate.payload.metadata_digest! };
    let rootCommit: Record<string, unknown> | null = null;
    {
      // Requirement 恢复使用 publishChange 已 Fetch 的固定 Git 对象。
      // Legacy 保留原有远端契约读取。
      let recovered: AnalysisSource | undefined;
      let checkedSource: AnalysisSource | undefined;
      let checkedContract: Awaited<ReturnType<typeof readPublishedContract>> | undefined;
      if (!requirement && priorMeta["analysis.source"] !== undefined && metadataEvidenceDigest(priorMeta, args.changeRef) === gateEvidence.metadata_digest) {
        const saved = parseAnalysisSource(priorMeta["analysis.source"]);
        if (saved.change_ref === args.changeRef) {
          const published = await readPublishedContract(saved, effectiveMeta);
          checkedSource = saved;
          checkedContract = published;
          if (published.digest === gateEvidence.change_digest) {
            if (published.schema !== schema) throw new UnknownError("已保存来源的 Schema 与当前审核包不一致");
            recovered = saved;
          }
        }
      }
      if (recovered) {
        rootCommit = { repo_url: recovered.repo_url, branch: recovered.branch, commit: recovered.commit,
          committed: "skipped_no_changes", pushed: true, reused_source: true };
      } else {
        if (!requirement) {
          checkNewScope();
          projectRootResource(currentResources(), rootUrl);
        }
        const tfsId = String(priorMeta["tfs.id"] ?? "").trim();
        const subject = `analysis: ${args.changeRef} (${args.issue}${tfsId ? ` / tfs ${tfsId}` : ""})`;
        const result = requirement ? await publishChange(root, args.changeRef, args.issue, ANALYSIS_CONTRACT_FILE, subject, {
          repoUrl: rootUrl, expectedBranch: publicationBranch!, fixedSourceCommit: pinned?.commit,
          commitWorkingChange: true,
          canRecoverFixedSource: pinned && metadataEvidenceDigest(priorMeta, args.changeRef) === gateEvidence.metadata_digest
            ? (commit: string, localHead: string) => {
                const published = readContractAt(commit);
                if (published.digest !== gateEvidence.change_digest) return false;
                if (published.schema !== schema) throw new UnknownError("已保存来源的 Schema 与当前审核包不一致");
                if (localHead !== commit) {
                  const local = readContractAt(localHead);
                  if (local.digest !== gateEvidence.change_digest || local.schema !== schema)
                    throw new FailError("当前已提交分析工件与 Gate 不一致");
                }
                return true;
              }
            : undefined,
          validateTree: (commit: string) => {
            checkNewScope();
            const candidate = readContractAt(commit);
            if (candidate.schema !== schema || candidate.digest !== gateEvidence.change_digest) {
              throw new FailError("候选发布版本与本次真实 Analysis Gate 工程契约不一致");
            }
          },
        }) : publishChange(root, args.changeRef, args.issue, ANALYSIS_CONTRACT_FILE, subject);
        rootCommit = { ...result };
      }
      if (!requirement && changeEvidenceDigest(changeDir, effectiveMeta, undefined, true) !== gateEvidence.change_digest) {
        throw new UnknownError("根仓 Commit/Push 后 Change 工件发生变化，必须重新执行 Analysis Gate");
      }
      // Git 使用 origin 执行；确认发布期间该配置未发生可观测的目标漂移。
      if (!recovered && canonicalRepositoryIdentity(pushRepositoryUrl(root)) !== canonicalRepositoryIdentity(String(rootCommit.repo_url))) {
        throw new UnknownError("推送期间 origin 地址已变化，无法确定规范来源");
      }
      const source = recovered ?? parseAnalysisSource({ repo_url: rootCommit.repo_url, branch: rootCommit.branch,
        commit: String(rootCommit.commit), change_ref: args.changeRef }, args.changeRef);
      if (!requirement) {
        const publishedContract = checkedSource && checkedContract && sameAnalysisSource(checkedSource, source)
          ? checkedContract : await readPublishedContract(source, effectiveMeta);
        const localBlob = gitOk(root, ["rev-parse", `${source.commit}:openspec/changes/${args.changeRef}/tasks.md`], "核对任务快照");
        if (publishedContract.tasksObjectId !== localBlob) throw new UnknownError("远端规范与最终 Git commit 不一致");
        if (publishedContract.schema !== schema || publishedContract.digest !== gateEvidence.change_digest) {
          throw new UnknownError("最终固定 Git Commit 与本次真实 Gate 检查的工程契约不一致");
        }
        assertCommittedContractFiles(root, source, effectiveMeta, gateEvidence.change_digest);
      }
      // Requirement 的候选契约及远端可达性已由 publishChange 确认；直接消费固定 SHA。
      rootCommit.commit = source.commit;
      rootCommit.repo_url = source.repo_url;
      entries["analysis.source"] = JSON.stringify(source);
      const assertWritableSnapshot = (issue: Record<string, unknown>): void => {
        if (String(issue.status ?? issue.status_name ?? "") !== "in_progress" || !sameIssueOwner(before, issue))
          throw new UnknownError("收口期间 Issue 状态或负责人已变化，停止发布审核");
      };
      const liveIssue = getIssue("Git 发布后核对 Issue 及 Facts");
      assertWritableSnapshot(liveIssue);
      let latestMeta = requireIssueMetadata(liveIssue);
      if (latestMeta["analysis.source"] !== priorMeta["analysis.source"]) throw new UnknownError("收口期间 analysis.source 已被其他流程更新，停止覆盖");
      if (metadataEvidenceDigest(latestMeta, args.changeRef) !== metadataEvidenceDigest(priorMeta, args.changeRef) || !sameDeliveryFacts(priorMeta, latestMeta) || latestMeta[GATE_RESULT] !== priorMeta[GATE_RESULT]) {
        throw new UnknownError("根仓 Commit/Push 期间 Analysis Facts 发生变化，必须重新执行 Analysis Gate");
      }
      const replacing = Object.entries(entries).some(([k, v]) => k !== GATE_RESULT && latestMeta[k] !== v);
      if (replacing && latestMeta[GATE_RESULT] === "PASS") {
        runJson([...MC, "issue", "metadata", "delete", args.issue, "--key", GATE_RESULT, ...ws, "--output", "json"], "撤销被替换审核版本的 Gate PASS");
        const invalidatedIssue = getIssue("确认旧 Gate 已失效");
        assertWritableSnapshot(invalidatedIssue);
        const invalidated = requireIssueMetadata(invalidatedIssue);
        if (invalidated[GATE_RESULT] === "PASS" || !sameDeliveryFacts(priorMeta, invalidated) || metadataEvidenceDigest(invalidated, args.changeRef) !== metadataEvidenceDigest(latestMeta, args.changeRef) || invalidated["analysis.source"] !== latestMeta["analysis.source"]) {
          throw new UnknownError("旧 Gate 失效结果或审核事实无法确认");
        }
        latestMeta = invalidated;
      }
      for (const [k, v] of Object.entries(entries)) {
        if (k === GATE_RESULT || latestMeta[k] === v) continue;
        runJson([...MC, "issue", "metadata", "set", args.issue,
                 "--key", k, "--value", v, "--type", "string", ...ws, "--output", "json"],
                `写入 metadata(key=${k})`);
      }
      const matchesReview = (meta: Record<string, unknown>, expectedGate: unknown): boolean =>
        sameSourceFacts(priorMeta, meta) && sameDeliveryFacts(priorMeta, meta) &&
        Object.entries(entries).every(([k, v]) => meta[k] === (k === GATE_RESULT ? expectedGate : v));
      // 只有实际写入了 Facts/Source 才需要新的快照；PASS 不得先于完整审核事实。
      let published = latestMeta;
      if (replacing) {
        const publishedIssue = getIssue("确认审核 Facts 及固定来源");
        assertWritableSnapshot(publishedIssue);
        published = requireIssueMetadata(publishedIssue);
      }
      if (!matchesReview(published, latestMeta[GATE_RESULT]))
        throw new UnknownError("审核 metadata 回读不一致，未进入 analysis_review");
      if (published[GATE_RESULT] !== "PASS") {
        runJson([...MC, "issue", "metadata", "set", args.issue, "--key", GATE_RESULT, "--value", "PASS", "--type", "string", ...ws, "--output", "json"], "登记本次 Gate PASS");
        const confirmedIssue = getIssue("确认本次 Gate、审核来源及状态");
        assertWritableSnapshot(confirmedIssue);
        if (!matchesReview(requireIssueMetadata(confirmedIssue), "PASS"))
          throw new UnknownError("本次 Gate 或审核来源无法确认，未进入 analysis_review");
      }
      const statusCp = runCommand([...MC, "issue", "status", args.issue, TARGET_STATUS, "--no-start", ...ws, "--output", "json"]);
      if (statusCp.status !== 0) {
        throw new UnknownError(`写入状态失败 rc=${statusCp.status}: ${statusCp.stderr.trim()}`);
      }
    }

    // 3. 回读确认
    const issue = getIssue("确认审核登记结果");
    const meta = requireIssueMetadata(issue);
    const mismatches: string[] = [];
    const statusNow = String(issue.status ?? issue.status_name ?? "");
    if (!sameIssueOwner(before, issue) || !sameDeliveryFacts(priorMeta, meta) || !sameSourceFacts(priorMeta, meta)) mismatches.push("审核身份或来源事实发生变化");
    if (statusNow !== TARGET_STATUS) mismatches.push(`status=${statusNow}（期望 ${TARGET_STATUS}）`);
    for (const [k, v] of Object.entries(entries)) {
      if (meta[k] !== v) mismatches.push(`metadata ${k} 回读不一致`);
    }
    if (mismatches.length > 0) {
      process.stdout.write(JSON.stringify({ result: "FAIL", reason: "回读校验不一致", mismatches }, null, 2) + "\n");
      return 2;
    }

    const analysisSource = readAnalysisSource(meta);

    // TFS 剥离（tfs-writeback-decoupling-plan）：此处不再有 TFS 写段——
    // 需求/Bug 的状态链由 PR 通过后的 `rondo tfs writeback` 统一逐跳补走。
    process.stdout.write(JSON.stringify({
      result: "PASS",
      issue: args.issue,
      status: TARGET_STATUS,
      metadata_keys: Object.keys(entries),
      root_commit: rootCommit,
      analysis_source: analysisSource,
      diagnostics: gate.payload.reasons,
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
export function registerAnalysisPublish(group: Command): void {
  group
    .command("publish")
    .description("发布 OpenSpec 审核版本，登记来源事实并进入审核状态")
    .usage("--issue <key> --change-ref <id> [--root-repo <path>] [--target-branch <branch>]")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      process.exitCode = await main(cmd.args);
    });
}
