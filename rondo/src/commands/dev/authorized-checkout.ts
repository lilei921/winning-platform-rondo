/** Resolve the current authorized Native checkout, shared by Git and PR Preparation. */
import { dirname } from "node:path";
import { FailError, UnknownError } from "../../cli/errors.js";
import { MulticaClient } from "../../clients/multica.js";
import { resolveMulticaRuntime } from "../../clients/runtime-context.js";
import { validateNativeCheckout, assertNativeTaskCheckout, readProjectResources, projectRootResource } from "../../clients/native-checkout.js";
import { gitOk } from "../../clients/git.js";
import { loadConfig as loadTfsConfig } from "../../tfs/config.js";
import { assertBugExecution, assertBugSource, assertBugStart } from "../bug/authorization.js";
import { readAnalysisSource, type AnalysisSource } from "../analysis/source.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";
import { candidateBranch } from "../pr/candidate-branch.js";
import { registeredPrs } from "../pr/facts.js";
import { guardRepository } from "./requirement-guard.js";
import { resourcePrepareRepo, resolveNativeBusinessPath, validateBusinessCheckout } from "./prepare-workspace.js";

export async function authorizedCheckout(issueKey: string, repoKey: string, rootRepo: string) {
  const runtime = resolveMulticaRuntime(), client = new MulticaClient(runtime);
  const issue = client.getIssue(issueKey), md = issue.metadata ?? {};
  if (md["tfs.type"] === "需求" && registeredPrs(md.pr).some(p => p.repo_key === repoKey))
    throw new FailError("当前仓库已有登记 PR，需先完成或受控恢复");
  const root = validateNativeCheckout(rootRepo).rootRepo, workdir = dirname(root);
  assertNativeTaskCheckout(root, workdir, undefined, issue.id);
  const server = loadTfsConfig().serverUrl;
  const rootUrl = gitOk(root, ["remote", "get-url", "--all", "origin"], "核对根仓 Origin");
  const rootPush = gitOk(root, ["remote", "get-url", "--push", "--all", "origin"], "核对根仓 Push URL");
  if (canonicalRepositoryIdentity(rootUrl) !== canonicalRepositoryIdentity(rootPush)) throw new FailError("根仓 Origin 与 Push URL 不一致");
  let tfsId: number, revision: string;
  let analysisSource: AnalysisSource | undefined;
  const bug = md["tfs.type"] === "Bug";
  if (bug) {
    assertBugExecution(client, issue);
    await assertBugSource(issue, server);
    tfsId = assertBugStart(client, issue, repoKey);
    revision = gitOk(root, ["rev-parse", "HEAD"], "固定 Bug 根仓版本");
  } else if (md["tfs.type"] === "需求") {
    const source = readAnalysisSource(md);
    analysisSource = source;
    if (canonicalRepositoryIdentity(rootUrl) !== canonicalRepositoryIdentity(source.repo_url))
      throw new FailError("Native 根仓与批准来源不一致");
    revision = source.commit;
    tfsId = Number(md["tfs.id"]);
  } else throw new FailError("不支持当前 TFS Type");
  if (analysisSource) {
    const approved = await guardRepository({ runtime }, client, issueKey, repoKey, { root, source: analysisSource });
    if (approved.source.commit !== revision || approved.issue.metadata?.["analysis.source"] !== md["analysis.source"] ||
        approved.issue.metadata?.["analysis.human_approval"] !== md["analysis.human_approval"] || approved.tfsId !== tfsId)
      throw new UnknownError("批准来源在授权期间变化");
  }
  const resources = readProjectResources(workdir, issue.project_id, client);
  if (bug) projectRootResource(resources, rootUrl);
  const repo = resourcePrepareRepo(resources, repoKey, rootUrl, server);
  const branch = candidateBranch(tfsId), path = resolveNativeBusinessPath(root, repo);
  if (branch === repo.default_target_branch) throw new FailError("Candidate 与 PR Target 相同");
  const head = validateBusinessCheckout(path, repo, branch, workdir);
  return { runtime, client, issue, md, root, path, repo, resources, rootUrl, branch, head, tfsId, bug, revision };
}
