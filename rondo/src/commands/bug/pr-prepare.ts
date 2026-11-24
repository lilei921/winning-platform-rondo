/**
 * bug pr-prepare — No-OpenSpec Bug delivery gate and PR preparation.
 *
 * Verify a TFS Bug's current candidate commit, diagnosis, regression, local validation
 * and code review before recording bug.delivery and the existing pr_prep contract.
 * PR creation is still delegated to rondo pr materialize.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { loadConfig, type BaseRegistryConfig } from "../../clients/config.js";
import { git, gitOk } from "../../clients/git.js";
import { MulticaClient } from "../../clients/multica.js";
import { validateNativeCheckout } from "../../clients/native-checkout.js";
import { assertTfsRepository, runAuthenticatedGit } from "../../clients/authenticated-git.js";
import { loadConfig as loadTfsConfig } from "../../tfs/config.js";
import { assertBugExecution, assertBugStart, assertBugSource } from "./authorization.js";
import { validatePrepareRepo, validateBusinessPath, validateBusinessCheckout, type PrepareRepo } from "../dev/prepare-workspace.js";
import { assertBugAgentAssignment, requiredBugRepos, assertBugReadyForPr } from "./scope.js";

interface RepoEntry extends PrepareRepo {}
interface RegistryConfig extends BaseRegistryConfig {
  registry: Record<string, RepoEntry>;
}
interface ValidationFact {
  result?: string;
  summary?: string;
  evidence_refs?: string[];
}
interface BugEvidence {
  issue?: string;
  tfs_id?: number | string;
  repo_key?: string;
  candidate_commit?: string;
  expected_behavior?: string;
  actual_behavior?: string;
  fix_summary?: string;
  root_cause?: {
    confidence?: string;
    summary?: string;
    evidence_refs?: string[];
    remaining_risk?: string;
  };
  regression?: ValidationFact;
  local_validation?: ValidationFact;
  code_review?: ValidationFact & {
    findings?: Array<{ resolved?: boolean; blocking?: boolean; risk_note?: string; risk_ref?: string }>;
  };
  blockers?: string[];
}
interface PreparedPr {
  repo_key: string;
  repo_url: string;
  source_branch: string;
  target_branch: string;
  candidate_commit: string;
  title: string;
  description_ref?: string;
}
interface DeliveryEntry {
  repo_key: string;
  source_branch: string;
  target_branch: string;
  candidate_commit: string;
  tfs_id: number;
  root_cause: NonNullable<BugEvidence["root_cause"]>;
  expected_behavior: string;
  actual_behavior: string;
  fix_summary: string;
  regression: ValidationFact;
  local_validation: ValidationFact;
  code_review: NonNullable<BugEvidence["code_review"]>;
}

function record(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}
function filled(raw: unknown): raw is string {
  return typeof raw === "string" && raw.trim().length > 0;
}
function refs(raw: unknown): boolean {
  return Array.isArray(raw) && raw.length > 0 && raw.every(filled);
}

/** Pure evidence validation; external I/O and Git identity are checked by pr-prepare. */
export function validateBugEvidence(
  raw: unknown, identity: { issue: string; tfsId: number; repoKey: string; sha: string },
): string[] {
  const reasons: string[] = [];
  if (!record(raw)) return ["evidence 必须是 JSON 对象"];
  const ev = raw as BugEvidence;
  // 身份来自已核验的 Issue、Repository 和候选 Commit；输入可省略，但显式给出时不得冲突。
  if (ev.issue !== undefined && ev.issue !== identity.issue) reasons.push("evidence.issue 与当前 Issue 不一致");
  if (ev.tfs_id !== undefined && Number(ev.tfs_id) !== identity.tfsId) reasons.push("evidence.tfs_id 与当前 TFS Bug 不一致");
  if (ev.repo_key !== undefined && ev.repo_key !== identity.repoKey) reasons.push("evidence.repo_key 与准备仓库不一致");
  if (ev.candidate_commit !== undefined && ev.candidate_commit !== identity.sha) reasons.push("evidence.candidate_commit 与候选 SHA 不一致");
  for (const key of ["expected_behavior", "actual_behavior", "fix_summary"] as const) {
    if (!filled(ev[key])) reasons.push("缺少 " + key);
  }
  const root = ev.root_cause;
  if (!root || !["confirmed", "probable"].includes(root.confidence ?? "")) {
    reasons.push("root_cause.confidence 必须为 confirmed 或 probable");
  }
  if (!filled(root?.summary)) reasons.push("root_cause.summary 缺失");
  if (!refs(root?.evidence_refs)) reasons.push("root_cause.evidence_refs 缺少可信引用");
  if (root?.confidence === "probable" && !filled(root.remaining_risk)) {
    reasons.push("probable Root Cause 必须说明 remaining_risk");
  }
  for (const key of ["regression", "local_validation", "code_review"] as const) {
    const item = ev[key];
    if (item?.result !== "PASS") reasons.push(key + ".result 必须为 PASS");
    if (!filled(item?.summary)) reasons.push(key + ".summary 缺失");
    if (!refs(item?.evidence_refs)) reasons.push(key + ".evidence_refs 缺少可核查依据");
  }
  const findings = ev.code_review?.findings ?? [];
  if (!Array.isArray(findings)) reasons.push("code_review.findings 必须是数组");
  else findings.forEach((f, i) => {
    if (!record(f)) { reasons.push("code_review.findings[" + i + "] 非法"); return; }
    if (f.resolved === true) return;
    if (f.blocking !== false) reasons.push("code_review.findings[" + i + "] 存在未解决 Blocking Finding");
    else if (!filled(f.risk_note) && !filled(f.risk_ref)) {
      reasons.push("code_review.findings[" + i + "] 未说明 Non-blocking 风险");
    }
  });
  if (!Array.isArray(ev.blockers)) reasons.push("blockers 必须是数组");
  else if (ev.blockers.length > 0) reasons.push("存在未解决 blockers");
  return reasons;
}

/** 读取 UTF-8 文件或 stdin；输入格式错误为 FAIL，读取失败为 UNKNOWN。 */
export function readBugEvidenceInput(input: string): unknown {
  if (input === "-" && process.stdin.isTTY) throw new FailError("--evidence - 仅接受 stdin 管道，不等待交互输入");
  let text: string;
  try { text = readFileSync(input === "-" ? 0 : input, "utf8").replace(/^\uFEFF/, ""); }
  catch (e) { throw new UnknownError("无法读取 evidence 输入: " + (e as Error).message); }
  if (!text.trim()) throw new FailError("evidence 输入不能为空");
  try { return JSON.parse(text); }
  catch { throw new FailError("evidence 必须是合法 JSON"); }
}

function parseList<T>(raw: string | undefined, field: string): T[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new UnknownError("metadata " + field + " 不是合法 JSON，拒绝覆盖"); }
  if (!Array.isArray(parsed)) throw new UnknownError("metadata " + field + " 不是数组，拒绝覆盖");
  return parsed as T[];
}
function getArg(argv: string[], name: string): string {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
}
const USAGE = "用法: rondo bug pr-prepare --config <repo-registry.json> --issue <KEY> --repo <repo_key> " +
  "--candidate-commit <40-SHA> --evidence <json路径|-> --title <PR标题> --root-repo <path> " +
  "[--description <md路径>] [--required-repos <repo1,repo2>] [--source-branch <branch>] [--target-branch <branch>]\n";

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) { process.stdout.write(USAGE); return 0; }
  const config = getArg(argv, "--config"), issueRef = getArg(argv, "--issue");
  const repoKey = getArg(argv, "--repo"), sha = getArg(argv, "--candidate-commit");
  const evidenceFile = getArg(argv, "--evidence"), title = getArg(argv, "--title");
  const descriptionInput = getArg(argv, "--description"), rootRepo = getArg(argv, "--root-repo");
  if (![config, issueRef, repoKey, sha, evidenceFile, title, rootRepo].every(filled)) {
    process.stderr.write(USAGE); return 64;
  }

  try {
    if (!/^[0-9a-f]{40}$/i.test(sha)) throw new FailError("candidate_commit 必须为完整 40 位 SHA");
    const raw = readBugEvidenceInput(evidenceFile);
    const cfg = loadConfig<RegistryConfig>(config);
    const repo = cfg.registry[repoKey];
    if (!repo?.repo_path || !filled(repo.default_target_branch) && !filled(getArg(argv, "--target-branch"))) {
      throw new FailError("Repository 不在配置中或缺少目标分支: " + repoKey);
    }
    const client = new MulticaClient(cfg.runtime);
    const issue = client.getIssue(issueRef);
    assertBugExecution(client, issue);
    const md = issue.metadata ?? {};
    const issueKey = issue.identifier ?? issue.id;
    await assertBugSource(issue, loadTfsConfig().serverUrl);
    const tfsId = assertBugStart(client, issue, repoKey);
    const supplied = getArg(argv, "--required-repos");
    const persisted = md["bug.required_repos"];
    const required = supplied ? requiredBugRepos(JSON.stringify(supplied.split(",").map(x => x.trim()))) :
      persisted ? requiredBugRepos(persisted) : [repoKey];
    if (!required.includes(repoKey)) throw new FailError("当前 repo 不在 Bug required_repos 内");
    for (const id of required) {
      if (!cfg.registry[id]?.repo_path) throw new FailError("required_repos 包含未登记的 Repository: " + id);
    }
    if (persisted && JSON.stringify(requiredBugRepos(persisted)) !== JSON.stringify(required)) {
      throw new FailError("Bug Repository Scope 已固定，扩大或收缩范围需要 Human 决定");
    }
    const targetBranch = getArg(argv, "--target-branch") || repo.default_target_branch as string;
    const sourceBranch = getArg(argv, "--source-branch") || "feat/" + tfsId;
    if (sourceBranch === targetBranch) throw new FailError("source_branch 与 target_branch 不得相同");

    const problems = validateBugEvidence(raw, { issue: issueKey, tfsId, repoKey, sha });
    if (problems.length > 0) throw new FailError(problems.join("；"));
    const evidence = raw as BugEvidence;

    const description = descriptionInput ? (isAbsolute(descriptionInput) ? descriptionInput : resolve(descriptionInput)) : undefined;
    if (description && (!existsSync(description) || !statSync(description).isFile() || statSync(description).size === 0)) {
      throw new FailError("PR description 文件不存在或为空: " + description);
    }
    const paths = validateNativeCheckout(rootRepo);
    validatePrepareRepo(repo, loadTfsConfig().serverUrl);
    const repoUrl = assertTfsRepository(repo.repo_url, loadTfsConfig().serverUrl).href;
    const hub = validateBusinessPath(paths.rootRepo, repo);
    validateBusinessCheckout(hub, repo, sourceBranch);
    const remote = runAuthenticatedGit(repo.repo_url, ["ls-remote", repo.repo_url, "refs/heads/" + sourceBranch], hub);
    if (remote.status !== 0) throw new UnknownError("远端候选分支读取失败");
    const head = remote.stdout.trim().split(/\s+/)[0];
    if (!head || head !== sha) throw new FailError("远端分支 HEAD 与 candidate_commit 不一致或分支不存在");
    const local = git(hub, ["cat-file", "-e", sha + "^{commit}"]);
    if (local.status !== 0) throw new UnknownError("候选 Commit 在本地业务仓不可核实");
    const message = gitOk(hub, ["show", "-s", "--format=%B", sha], "读取候选 Commit Message");
    const refLines = message.split(/\r?\n/).filter(line => /^Refs:\s*/i.test(line));
    if (refLines.length !== 1 || refLines[0].trim() !== "Refs: #" + tfsId) {
      throw new FailError("候选 Commit 必须包含唯一尾注 Refs: #" + tfsId);
    }

    const entry: DeliveryEntry = {
      repo_key: repoKey, source_branch: sourceBranch, target_branch: targetBranch,
      candidate_commit: sha, tfs_id: tfsId,
      root_cause: evidence.root_cause!,
      expected_behavior: evidence.expected_behavior!,
      actual_behavior: evidence.actual_behavior!,
      fix_summary: evidence.fix_summary!,
      regression: evidence.regression!,
      local_validation: evidence.local_validation!,
      code_review: evidence.code_review!,
    };
    const oldDelivery = parseList<DeliveryEntry>(md["bug.delivery"], "bug.delivery");
    const preparedDelivery = [...oldDelivery.filter(e => e.repo_key !== repoKey), entry];
    const oldPrep = parseList<PreparedPr>(md.pr_prep, "pr_prep");
    const prEntry: PreparedPr = {
      repo_key: repoKey, repo_url: repoUrl, source_branch: sourceBranch, target_branch: targetBranch,
      candidate_commit: sha, title, ...(description ? { description_ref: "file:" + description } : {}),
    };
    const preparedPr = [...oldPrep.filter(e => e.repo_key !== repoKey), prEntry];

    // Persist-before-PR: no PR/TFS side effects in this command. Partial writes are
    // resumable with identical inputs; never infer success from a CLI response alone.
    if (!persisted) client.setMetadata(issue.id, "bug.required_repos", JSON.stringify(required));
    client.setMetadata(issue.id, "bug.delivery", JSON.stringify(preparedDelivery));
    client.setMetadata(issue.id, "pr_prep", JSON.stringify(preparedPr));
    client.setMetadata(issue.id, "analysis.change_kind", "corrective");
    const check = client.getIssue(issueRef).metadata ?? {};
    if (check["bug.required_repos"] !== JSON.stringify(required) ||
        check["bug.delivery"] !== JSON.stringify(preparedDelivery) ||
        check.pr_prep !== JSON.stringify(preparedPr) ||
        check["analysis.change_kind"] !== "corrective") {
      throw new UnknownError("Bug 准备事实回读不一致；请核对并幂等重试");
    }
    let readyForPr = false;
    try { assertBugReadyForPr(check); readyForPr = true; }
    catch (err) { if (!(err instanceof FailError)) throw err; }
    process.stdout.write(JSON.stringify({
      result: "PASS", issue: issueKey, repo_key: repoKey,
      candidate_commit: sha, source_branch: sourceBranch, target_branch: targetBranch,
      bug_delivery_ready: true, pr_prep_ready: true,
      required_repos: required, ready_for_pr: readyForPr,
      next: readyForPr ? "rondo pr materialize --config <config-path> --issue " + issueKey
        : "继续准备其余 required_repos；全部完成后仅调用一次 rondo pr materialize",
    }, null, 2) + "\n");
    return 0;
  } catch (e) {
    const known = e instanceof FailError || e instanceof UnknownError;
    if (!known) throw e;
    const result = e instanceof FailError ? "FAIL" : "UNKNOWN";
    process.stdout.write(JSON.stringify({ result, issue: issueRef, reason: e.message }, null, 2) + "\n");
    return result === "FAIL" ? 2 : 3;
  }
}

export function registerBugPrPrepare(group: Command): void {
  group.command("pr-prepare")
    .description("Bug 修复完成检查与 PR Preparation（无 OpenSpec）")
    .helpOption(false).allowUnknownOption(true).allowExcessArguments(true)
    .action(async (...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      throw new ExitSignal(await main(cmd.args));
    });
}
