#!/usr/bin/env node
/**
 * materialize-pr.ts — PR 物化（02 §10.2 标准过程的确定性投影）。
 *
 * 输入：Issue 上的 PR Preparation Facts（metadata `pr_prep`，Engineer 写入，契约见 references/pr-facts-contract.md）。
 * 流程：逐仓校验 candidate_commit（tfs-cli branch get）→ 核对外部 PR 事实（pr list）→
 *       已存在则复用登记 / 不存在则创建（pr create + 关联 tfs 工作项）→ 回写 metadata `current_pr` →
 *       全部登记完成 → Issue → in_review（--no-start）。
 *
 * 幂等纪律（02 §10.2）：外部已建而本地未登记 → 复用登记，不重建；两边冲突 / 身份不可确认 → UNKNOWN。
 * PR Title 与显式 Description 原样透传；独立 Bug 未提供描述时，仅格式化已通过 Gate 的 bug.delivery 事实，不重新判断语义。
 *
 * 用法：rondo pr materialize --issue <KEY|id> --config <repo-registry.json>
 * 退出码：0 PASS（全部登记且状态已转 in_review）/ 2 FAIL（明确失败，含逐项 reason）/ 3 UNKNOWN / 64 用法错误。
 * stdout 只出 JSON；日志走 stderr。
 *
 * 收编说明（D3 修订）：自 rondo 收编起，实现位置为 @winning/skill-flow 包内
 * commands/pr/materialize.ts，原 projects/multica/workspace-skills/pull-request/scripts/materialize-pr.ts
 * 路径在迁移窗口期保持有效。
 */

import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, logLine, markLeafExecuted } from "../../cli/output.js";
import { loadConfig, type BaseRegistryConfig } from "../../clients/config.js";
import { MulticaClient } from "../../clients/multica.js";
import { assertBugReadyForPr, assertBugAgentAssignment } from "../bug/scope.js";
import { assertBugExecution, assertBugSource } from "../bug/authorization.js";
import { assertEngineerExecution } from "../dev/requirement-guard.js";
import { candidateBranch } from "./candidate-branch.js";
import { TfsClient as ApiTfsClient } from "../../tfs/client.js";
import { verifiedRepo, type VerifiedRepo } from "../../tfs/api/commit-facts.js";
import { ensurePrWorkItemLink } from "../../tfs/api/pr-link.js";
import { TfsClient } from "../../clients/tfs.js";
import { checkPublishedChange } from "../dev/change-completion.js";
import { loadConfig as loadTfsConfig } from "../../tfs/config.js";
import { normalizeTfsPrWebUrl, parseTfsPrWebUrl } from "../../tfs/api/pr.js";
import { assertTfsRepository } from "../../clients/authenticated-git.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";

class FailItem extends Error {      // 单仓明确失败：记 failures，不中断其余仓
  readonly detail: Record<string, unknown>;
  constructor(detail: Record<string, unknown>) {
    super(JSON.stringify(detail));
    this.detail = detail;
  }
}

interface RepoEntry {
  repo_path: string;
  repo_url?: string;
  tfs_repo?: string;
  tfs_project?: string;
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
}

interface CurrentPrEntry {
  repo_key: string;
  pr_id: number;
  pr_url: string;
  source_branch: string;
  target_branch: string;
}

/** Confirm PR registration independently of optional worktree cleanup. */
export function registerCurrentPr(
  multica: Pick<MulticaClient, "setMetadata" | "getIssue" | "setStatus">, issueId: string, currentPr: string,
): ReturnType<MulticaClient["getIssue"]> {
  multica.setMetadata(issueId, "current_pr", currentPr);
  if (multica.getIssue(issueId).metadata?.current_pr !== currentPr) {
    throw new UnknownError("current_pr 登记未确认，禁止进入 in_review");
  }
  multica.setStatus(issueId, "in_review");
  const confirmed = multica.getIssue(issueId);
  if (confirmed.status !== "in_review" || confirmed.metadata?.current_pr !== currentPr) {
    throw new UnknownError("PR 登记或 in_review 状态未确认");
  }
  return confirmed;
}

function log(msg: string): void {
  logLine(msg);
}

interface BugValidation {
  result: string;
  summary: string;
  evidence_refs: string[];
}
interface BugDeliveryEntry {
  repo_key: string;
  target_branch: string;
  candidate_commit: string;
  tfs_id: number;
  expected_behavior: string;
  actual_behavior: string;
  fix_summary: string;
  root_cause: {
    confidence: string;
    summary: string;
    evidence_refs: string[];
    remaining_risk?: string;
  };
  regression: BugValidation;
  local_validation: BugValidation;
  code_review: BugValidation & {
    findings?: Array<{ resolved?: boolean; blocking?: boolean; risk_note?: string; risk_ref?: string }>;
  };
}

/** 仅格式化已记录的专业结果，不推断 Root Cause 或验证结论。 */
export function renderBugPrDescription(delivery: BugDeliveryEntry): string {
  const fields = [
    delivery.expected_behavior, delivery.actual_behavior, delivery.fix_summary,
    delivery.root_cause?.summary,
    delivery.regression?.summary, delivery.local_validation?.summary, delivery.code_review?.summary,
  ];
  const refs = [
    delivery.root_cause?.evidence_refs,
    delivery.regression?.evidence_refs, delivery.local_validation?.evidence_refs, delivery.code_review?.evidence_refs,
  ];
  const unresolved = (delivery.code_review?.findings ?? []).some(
    f => f.resolved !== true && (f.blocking !== false || !(f.risk_note?.trim() || f.risk_ref?.trim())),
  );
  if (fields.some(v => typeof v !== "string" || !v.trim()) ||
      refs.some(v => !Array.isArray(v) || v.length === 0 || v.some(x => typeof x !== "string" || !x.trim())) ||
      !["confirmed", "probable"].includes(delivery.root_cause?.confidence) ||
      [delivery.regression, delivery.local_validation, delivery.code_review].some(v => v?.result !== "PASS") ||
      (delivery.root_cause.confidence === "probable" && !delivery.root_cause.remaining_risk?.trim()) ||
      unresolved) {
    throw new FailItem({ repo_key: delivery.repo_key, reason: "incomplete_bug_delivery", hint: "缺少已验证的 Bug 事实或 Evidence 引用" });
  }
  const risks = [
    ...(delivery.root_cause.remaining_risk ? [delivery.root_cause.remaining_risk] : []),
    ...(delivery.code_review.findings ?? [])
      .filter(f => f.resolved !== true && f.blocking === false)
      .map(f => f.risk_note || f.risk_ref)
      .filter((v): v is string => Boolean(v)),
  ];
  const lines = [
    "## Problem",
    "**Expected Behavior**", delivery.expected_behavior,
    "", "**Actual Behavior**", delivery.actual_behavior,
    "", "## Root Cause",
    "Confidence: " + delivery.root_cause.confidence,
    delivery.root_cause.summary,
    "", "## Fix", delivery.fix_summary,
    "", "## Validation",
    "- Regression: " + delivery.regression.result + " — " + delivery.regression.summary,
    "- Local Validation: " + delivery.local_validation.result + " — " + delivery.local_validation.summary,
    "- Code Review: " + delivery.code_review.result + " — " + delivery.code_review.summary,
    "", "## Evidence",
    "- Root Cause: " + delivery.root_cause.evidence_refs.join(", "),
    "- Regression: " + delivery.regression.evidence_refs.join(", "),
    "- Local Validation: " + delivery.local_validation.evidence_refs.join(", "),
    "- Code Review: " + delivery.code_review.evidence_refs.join(", "),
    ...(risks.length ? ["", "## Remaining Risks", ...risks.map(v => "- " + v)] : []),
    "", "## References",
    "- TFS Work Item: #" + delivery.tfs_id,
    "- Candidate Commit: " + delivery.candidate_commit,
    "",
  ];
  return lines.join("\n");
}

/** 显式描述文件原样使用；独立 Bug 缺省格式化 bug.delivery；其他交付缺省使用 title。 */
export function resolveDescription(entry: PrPrepEntry, bugDelivery?: BugDeliveryEntry, remoteDescription?: string): { file: string | null; cleanup: boolean } {
  if (remoteDescription !== undefined) {
    if (!remoteDescription.trim() || remoteDescription.includes("补 TFS 工作项 id")) {
      throw new FailItem({ repo_key: entry.repo_key, reason: "empty_or_incomplete_description" });
    }
    const tmp = join(tmpdir(), `pr-desc-${process.pid}-${Date.now()}-${entry.repo_key}.md`);
    writeFileSync(tmp, remoteDescription, "utf8");
    return { file: tmp, cleanup: true };
  }
  const ref = entry.description_ref;
  if (!ref) {
    const tmp = join(tmpdir(), `pr-desc-${process.pid}-${Date.now()}.md`);
    writeFileSync(tmp, bugDelivery ? renderBugPrDescription(bugDelivery) : entry.title + "\n", "utf8");
    return { file: tmp, cleanup: true };
  }
  if (ref.startsWith("file:")) {
    const p = ref.slice(5);
    if (!existsSync(p)) throw new FailItem({ repo_key: entry.repo_key, reason: "description_file_not_found", ref });
    return { file: p, cleanup: false };
  }
  throw new FailItem({ repo_key: entry.repo_key, reason: "unsupported_description_ref", ref, hint: "v1 仅支持 file:<绝对路径>；comment 引用待 P2 后定稿" });
}

/** 单仓物化：校验 → 核对/创建 → 返回 current_pr 条目。prior = 本地 current_pr 既有登记（可能 undefined）。 */
export async function materializeOne(tfs: TfsClient, cfg: RegistryConfig, tfsId: string, entry: PrPrepEntry, prior: CurrentPrEntry | undefined, bugDelivery?: BugDeliveryEntry, remoteDescription?: string, verify?: { api: ApiTfsClient; repo: VerifiedRepo; readOnly: boolean; authorize: () => void }): Promise<CurrentPrEntry & { reused: boolean }> {
  const repo = cfg.registry[entry.repo_key];
  if (!repo) throw new FailItem({ repo_key: entry.repo_key, reason: "repo_key_not_in_registry" });
  if (!repo.tfs_repo || !repo.tfs_project) {
    throw new FailItem({ repo_key: entry.repo_key, reason: "missing_tfs_config", detail: "tfs_repo/tfs_project 未配置" });
  }
  for (const f of ["repo_url", "source_branch", "target_branch", "candidate_commit", "title"] as const) {
    if (!entry[f]) throw new FailItem({ repo_key: entry.repo_key, reason: `pr_prep 缺少字段 ${f}` });
  }
  const collection = loadTfsConfig().serverUrl;
  const registered = assertTfsRepository(repo.repo_url ?? "", collection);
  const prepared = assertTfsRepository(entry.repo_url, collection);
  const parts = registered.pathname.split("/").map(decodeURIComponent);
  if (canonicalRepositoryIdentity(registered.href) !== canonicalRepositoryIdentity(prepared.href) ||
      parts.at(-3)!.toLowerCase() !== repo.tfs_project.toLowerCase() ||
      parts.at(-1)!.toLowerCase() !== repo.tfs_repo.toLowerCase()) {
    throw new FailItem({ repo_key: entry.repo_key, reason: "pr_prep_repository_identity_mismatch" });
  }
  const target = entry.target_branch;
  // Requirement uses the registered target; Direct Bug retains its explicit target override.
  if ((remoteDescription !== undefined && target !== repo.default_target_branch) ||
      (bugDelivery && target !== bugDelivery.target_branch)) {
    throw new FailItem({ repo_key: entry.repo_key, reason: "pr_prep_target_branch_mismatch" });
  }
  const prWebUrl = (candidate: string | undefined, id: number): string =>
    normalizeTfsPrWebUrl(candidate, collection, repo.tfs_project as string, repo.tfs_repo as string, id);

  if (prior) {
    const location = parseTfsPrWebUrl(prior.pr_url, collection);
    if (!location || location.prId !== prior.pr_id || prior.repo_key !== entry.repo_key ||
        location.project.toLowerCase() !== repo.tfs_project.toLowerCase() ||
        location.repository.toLowerCase() !== repo.tfs_repo.toLowerCase() ||
        prior.source_branch !== entry.source_branch || prior.target_branch !== target) {
      throw new UnknownError(`${entry.repo_key}: current_pr 仓库、PR 或分支身份不匹配`);
    }
  }

  // The actual remote branch always pins the Candidate, including when an existing PR is reused.
  const reusePr = async (id: number, priorUrl = ""): Promise<CurrentPrEntry & { reused: boolean }> => {
    const got = await tfs.run(
      ["pr", "get", "--repo", repo.tfs_repo as string, "--id", String(id), "--project", repo.tfs_project as string],
      `核对已有 PR #${id}`,
    ) as { found?: boolean; id?: number; status?: string; sourceBranch?: string; targetBranch?: string; description?: string; url?: string };
    if (got.found === false || got.id !== id || got.status !== "active" ||
        got.sourceBranch !== entry.source_branch || got.targetBranch !== target) {
      throw new UnknownError(`${entry.repo_key}: PR #${id} 的外部身份、分支或状态不匹配`);
    }
    if (remoteDescription !== undefined && (!got.description?.trim() || got.description.includes("补 TFS 工作项 id"))) {
      throw new FailItem({ repo_key: entry.repo_key, reason: "existing_pr_description_missing",
        hint: "已有 TFS PR 缺少有效的专业描述，需由 Engineer/Human 补充后再收口" });
    }
    if (verify) {
      verify.authorize();
      await ensurePrWorkItemLink(verify.api, verify.repo, id, Number(tfsId), !verify.readOnly);
    }
    return { repo_key: entry.repo_key, pr_id: id, pr_url: prWebUrl(got.url ?? priorUrl, id), source_branch: entry.source_branch,
      target_branch: target, reused: true };
  };

  // 1. HEAD 校验：不等 → UNKNOWN（02 §10.2：原因不明回 Engineer，不由脚本处置）
  const branch = await tfs.run(
    ["branch", "get", "--repo", repo.tfs_repo as string, "--name", entry.source_branch, "--project", repo.tfs_project as string],
    `校验分支 ${entry.source_branch}`,
  ) as { found: boolean; branch?: { commit: string } };
  if (!branch.found) {
    throw new FailItem({ repo_key: entry.repo_key, reason: "source_branch_not_found", branch: entry.source_branch, hint: "Engineer 未完成 push 或分支名有误" });
  }
  const head = branch.branch?.commit;
  if (head !== entry.candidate_commit) {
    throw new UnknownError(`${entry.repo_key}: 分支 HEAD(${head}) != candidate_commit(${entry.candidate_commit})，原因待 Lead 判断`);
  }

  // 2. Reuse only after checking both the remote Candidate and the actual TFS PR.
  if (prior) return reusePr(prior.pr_id, prior.pr_url);

  if (verify?.readOnly) throw new FailError("in_review 缺少已登记 PR");
  // 3. 外部事实核对：同 source+target 的 active PR 已存在 → 复用登记（02 §10.2）
  const prs = await tfs.run(
    ["pr", "list", "--repo", repo.tfs_repo as string, "--status", "active", "--source-branch", entry.source_branch, "--project", repo.tfs_project as string],
    `查询既有 PR(${entry.repo_key})`,
  ) as Array<{ id: number; url: string; targetBranch: string }>;
  const existing = (prs ?? []).find((p) => p.targetBranch === target);
  if (existing) {
    log(`${entry.repo_key}: 复用既有 PR #${existing.id}`);
    return reusePr(existing.id);
  }

  // 3. 创建（幂等由 tfs-cli pr create 双保险：重复返回 created:false + existing）
  const desc = resolveDescription(entry, bugDelivery, remoteDescription);
  try {
    const args = ["pr", "create", "--repo", repo.tfs_repo as string, "--source", entry.source_branch, "--target", target,
      "--title", entry.title, "--project", repo.tfs_project as string];
    if (desc.file) args.push("--description-file", desc.file);
    if (tfsId) args.push("--work-items", tfsId);
    verify?.authorize();
    // The common link helper owns association and read-back.
    if (verify) args.splice(args.indexOf("--work-items"), 2);
    const created = await tfs.run(args, `创建 PR(${entry.repo_key})`) as {
      created: boolean;
      existing?: { id: number; url: string };
      pr?: { id: number; url: string; workItems?: number[]; workItemLinkFailures?: number[] };
    };
    const pr = created.created ? created.pr : created.existing;
    if (!pr) throw new UnknownError(`创建 PR(${entry.repo_key}) 返回既非 created 也非 existing`);
    if (verify) return { ...await reusePr(pr.id, pr.url), reused: !created.created };
    if (created.pr?.workItemLinkFailures?.length) {
      throw new UnknownError(`${entry.repo_key}: PR #${pr.id} 已建但工作项 ${created.pr.workItemLinkFailures} 关联失败（外部事实已变，交人工核对补挂）`);
    }
    return { repo_key: entry.repo_key, pr_id: pr.id, pr_url: prWebUrl(pr.url, pr.id), source_branch: entry.source_branch, target_branch: target, reused: !created.created };
  } finally {
    if (desc.cleanup && desc.file) {
      try { unlinkSync(desc.file); } catch { /* 临时文件清理失败不阻塞 */ }
    }
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

async function main(rawArgs: string[]): Promise<number> {
  const args = parseArgs(rawArgs);
  if (!args.issue || !args.config) {
    process.stderr.write("用法: rondo pr materialize --issue <KEY|id> --config <repo-registry.json>\n");
    return 64;
  }
  try {
    const cfg = loadConfig<RegistryConfig>(args.config);
    const multica = new MulticaClient(cfg.runtime);
    const tfs = new TfsClient();
    const issue = multica.getIssue(args.issue);
    const md = issue.metadata ?? {};
    const readOnly = issue.status === "in_review";
    const bug = md["tfs.type"] === "Bug";
    if (!bug && md["tfs.type"] !== "需求") throw new FailError("不支持当前 TFS Type");
    if (bug && (md["analysis.change_ref"] || md["analysis.gate.result"])) throw new FailError("Bug 不能混入 OpenSpec Gate");
    const authorize = () => {
      const fresh = multica.getIssue(issue.id);
      const facts = fresh.metadata ?? {};
      if (fresh.status !== issue.status || fresh.assignee_id !== issue.assignee_id ||
          ["tfs.id", "tfs.type", "tfs.url", "analysis.source", "analysis.human_approval", "analysis.change_ref",
            "analysis.gate.result", "dev.publication", "pr_prep", "bug.delivery", "bug.required_repos", "current_pr",
            "finalize.pending", "delivery.tfs_written", "dev.dispatch"].some(k => facts[k] !== md[k]))
        throw new UnknownError("PR 物化期间 Issue 授权或交付事实变化");
      if (!["todo", "in_progress", "in_review"].includes(fresh.status ?? "") ||
          facts["finalize.pending"] || facts["delivery.tfs_written"] === "true")
        throw new FailError("当前 Issue 状态不允许 PR 物化");
      if (readOnly) return;
      if (bug) {
        assertBugExecution(multica, fresh);
        assertBugAgentAssignment(fresh.assignee_id, multica.run(["agent", "list", ...multica.ws(), "--output", "json"], "核验 Bug Fix 指派", { transient: true }));
      } else assertEngineerExecution(multica, fresh, cfg.runtime.workspace_id);
    };
    authorize();
    if (bug) await assertBugSource(issue, loadTfsConfig().serverUrl);

    // For direct Bug delivery, every required repository must be prepared
    // before PR creation can produce external side effects / move in_review.
    let bugDeliveryByRepo: Map<string, BugDeliveryEntry> | undefined;
    if (md["tfs.type"] === "Bug" && !md["analysis.change_ref"]) {
      assertBugReadyForPr(md);
      const delivery = JSON.parse(md["bug.delivery"]) as BugDeliveryEntry[];
      bugDeliveryByRepo = new Map(delivery.map(item => [item.repo_key, item]));
    }

    if (!md["pr_prep"]) throw new UnknownError(`Issue ${args.issue} 缺少 metadata pr_prep（Engineer 未完成 PR Preparation？）`);
    let prep: PrPrepEntry[];
    try {
      prep = JSON.parse(md["pr_prep"]);
    } catch {
      throw new UnknownError(`Issue ${args.issue} 的 metadata pr_prep 不是合法 JSON`);
    }
    if (!Array.isArray(prep) || prep.length === 0) {
      throw new UnknownError(`Issue ${args.issue} 的 pr_prep 为空（无 required Repository Change？）`);
    }
    const tfsId = md["tfs.id"] ?? "";
    if (!tfsId) throw new UnknownError(`Issue ${args.issue} 缺少 metadata tfs.id（工作项关联无身份）`);
    if (!bug && args.mode !== "requirement") {
      throw new FailError("Requirement Change 的 PR 创建必须显式 --mode requirement，禁止退回旧入口绕过 Completion Gate");
    }

    // Explicit Requirement mode: fully validate published Change before any external PR side effect.
    if (args.mode === "requirement") {
      if (!args["change-ref"]) throw new FailError("Requirement PR 需要 --change-ref");
      await checkPublishedChange(cfg, multica, args.issue, args["change-ref"]);
      const latest = multica.getIssue(args.issue);
      if (latest.metadata?.["pr_prep"] !== md["pr_prep"] ||
          latest.metadata?.["dev.publication"] !== md["dev.publication"] ||
          latest.metadata?.["analysis.source"] !== md["analysis.source"] ||
          latest.metadata?.["analysis.human_approval"] !== md["analysis.human_approval"] ||
          latest.status !== issue.status) {
        throw new UnknownError("PR 创建前批准来源、研发发布记录、候选或 Issue 状态已变化，请重新执行 Completion");
      }
    } else if (args.mode !== undefined) throw new FailError("PR --mode 仅支持 requirement 或省略（legacy）");

    const priorByRepo = new Map<string, CurrentPrEntry>();
    if (md["current_pr"]) {
      let saved: unknown;
      try { saved = JSON.parse(md["current_pr"]); } catch { throw new UnknownError("current_pr 不是合法 JSON"); }
      if (!Array.isArray(saved)) throw new UnknownError("current_pr 必须是数组");
      for (const item of saved) {
        const pr = item as CurrentPrEntry;
        if (!pr || typeof pr.repo_key !== "string" || !Number.isSafeInteger(pr.pr_id) || pr.pr_id <= 0 ||
            priorByRepo.has(pr.repo_key)) throw new UnknownError("current_pr 包含无效或重复的仓库登记");
        priorByRepo.set(pr.repo_key, pr);
      }
    }

    const api = new ApiTfsClient();
    const identities = new Map<string, VerifiedRepo>();
    const seen = new Set<string>();
    for (const entry of prep) {
      if (!entry || identities.has(entry.repo_key) || entry.source_branch !== candidateBranch(tfsId) ||
          !/^[0-9a-f]{40}$/i.test(entry.candidate_commit ?? "")) throw new FailError("PR Candidate 身份无效或重复");
      const repo = cfg.registry[entry.repo_key];
      if (!repo?.tfs_repo || !repo.tfs_project || entry.target_branch !== repo.default_target_branch ||
          canonicalRepositoryIdentity(assertTfsRepository(entry.repo_url, api.config.serverUrl).href) !==
          canonicalRepositoryIdentity(assertTfsRepository(repo.repo_url ?? "", api.config.serverUrl).href))
        throw new FailError("PR Preparation 仓库或目标分支不一致");
      const parts = new URL(entry.repo_url).pathname.split("/").map(decodeURIComponent);
      if (parts.at(-3)?.toLowerCase() !== repo.tfs_project.toLowerCase() ||
          parts.at(-1)?.toLowerCase() !== repo.tfs_repo.toLowerCase()) throw new FailError("TFS 仓库身份不一致");
      const identity = await verifiedRepo(api, repo.tfs_project, repo.tfs_repo);
      const key = identity.projectId + "/" + identity.repoId;
      if (seen.has(key)) throw new FailError("不同 repo_key 指向同一真实 TFS Repository");
      seen.add(key); identities.set(entry.repo_key, identity);
    }
    if ([...priorByRepo.keys()].some(k => !identities.has(k)) ||
        (readOnly && priorByRepo.size !== prep.length)) throw new FailError("current_pr 与准备仓库集合不一致");
    const prs: Array<CurrentPrEntry & { reused: boolean }> = [];
    const failures: unknown[] = [];
    for (const entry of prep) {
      try {
        const bugDelivery = bugDeliveryByRepo?.get(entry.repo_key);
        if (bugDeliveryByRepo && (!bugDelivery || bugDelivery.candidate_commit !== entry.candidate_commit)) {
          throw new FailItem({ repo_key: entry.repo_key, reason: "bug_delivery_identity_mismatch" });
        }
        prs.push(await materializeOne(tfs, cfg, tfsId, entry, priorByRepo.get(entry.repo_key), bugDelivery,
          args.mode === "requirement" ? entry.description : undefined, { api, repo: identities.get(entry.repo_key)!, readOnly, authorize }));
      } catch (exc) {
        if (exc instanceof UnknownError) throw exc; // 身份/事实不可确认：整体停止
        if (exc instanceof FailItem) {
          failures.push(exc.detail);
          log(`FAILED(${entry.repo_key}): ${exc.message}`);
          continue;
        }
        throw exc;
      }
    }

    if (failures.length > 0) {
      process.stdout.write(JSON.stringify({ result: "FAIL", prs, failures }, null, 2) + "\n");
      return 2;
    }

    // 全部登记完成才回写 + 转状态（02 §10.2：所有 required PR 注册完成后才进 in_review）
    const currentPr = JSON.stringify(prs.map(({ reused: _, ...rest }) => rest));
    authorize();
    if (!readOnly) registerCurrentPr(multica, issue.id, currentPr);

    process.stdout.write(JSON.stringify({ result: "PASS", issue: issue.identifier ?? issue.id, status: "in_review", prs }, null, 2) + "\n");
    return 0;
  } catch (exc) {
    if (exc instanceof FailError) {
      process.stdout.write(JSON.stringify({ result: "FAIL", reason: exc.message }) + "\n");
      return 2;
    }
    if (exc instanceof UnknownError) {
      process.stdout.write(JSON.stringify({ result: "UNKNOWN", reason: exc.message }) + "\n");
      log(`UNKNOWN: ${exc.message}`);
      return 3;
    }
    throw exc;
  }
}

/** commander 注册：group=pr；参数解析沿用原脚本实现以保证契约逐字节等价。 */
export function registerPrMaterialize(group: Command): void {
  group
    .command("materialize")
    .description("PR 物化")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      throw new ExitSignal(await main(cmd.args));
    });
}
