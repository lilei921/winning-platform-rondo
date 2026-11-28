/** Resolve the current authorized Native checkout, shared by Git and PR Preparation. */
import { dirname } from "node:path";
import { FailError, UnknownError } from "../../cli/errors.js";
import { MulticaClient } from "../../clients/multica.js";
import { resolveMulticaRuntime } from "../../clients/runtime-context.js";
import { validateNativeCheckout, assertNativeTaskCheckout, readProjectResources, projectRootResource } from "../../clients/native-checkout.js";
import { rootRepositoryUrl } from "../runtime/root-git.js";
import { loadConfig as loadTfsConfig } from "../../tfs/config.js";
import { assertBugExecution, assertBugSource, assertBugStart } from "../bug/authorization.js";
import { readAnalysisSource, type AnalysisSource } from "../analysis/source.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";
import { candidateBranch } from "../pr/candidate-branch.js";
import { registeredPrs } from "../pr/facts.js";
import { guardRepository } from "../analysis/requirement-guard.js";
import { resourcePrepareRepo, resolveNativeBusinessPath, validateBusinessCheckout } from "./checkout.js";

export async function authorizedCheckout(issueKey: string, repoKey: string, rootRepo: string, requireActiveRun = true) {
  const runtime = resolveMulticaRuntime(), client = new MulticaClient(runtime);
  const issue = client.getIssue(issueKey), md = issue.metadata ?? {};
  if (md["tfs.type"] === "需求" && registeredPrs(md.pr).some(p => p.repo_key === repoKey))
    throw new FailError("当前仓库已有登记 PR，需先完成或受控恢复");
  const root = validateNativeCheckout(rootRepo).rootRepo, workdir = dirname(root);
  assertNativeTaskCheckout(root, workdir, undefined, issue.id);
  const server = loadTfsConfig().serverUrl;
  const rootUrl = rootRepositoryUrl(root);
  let tfsId: number;
  let analysisSource: AnalysisSource | undefined;
  const bug = md["tfs.type"] === "Bug";
  if (bug) {
    assertBugExecution(client, issue, requireActiveRun);
    await assertBugSource(issue, server);
    tfsId = assertBugStart(client, issue, repoKey);
  } else if (md["tfs.type"] === "需求") {
    const source = readAnalysisSource(md);
    analysisSource = source;
    if (canonicalRepositoryIdentity(rootUrl) !== canonicalRepositoryIdentity(source.repo_url))
      throw new FailError("Native 根仓与批准来源不一致");
    tfsId = Number(md["tfs.id"]);
  } else throw new FailError("不支持当前 TFS Type");
  if (analysisSource) {
    const approved = await guardRepository({ runtime }, client, issueKey, repoKey, { root, source: analysisSource }, requireActiveRun);
    if (approved.source.commit !== analysisSource.commit || approved.issue.project_id !== issue.project_id || approved.issue.metadata?.["analysis.source"] !== md["analysis.source"] ||
        approved.issue.metadata?.["analysis.human_approval"] !== md["analysis.human_approval"] || approved.tfsId !== tfsId)
      throw new UnknownError("批准来源在授权期间变化");
  }
  const resources = readProjectResources(workdir, issue.project_id, client);
  if (bug) projectRootResource(resources, rootUrl);
  const repo = resourcePrepareRepo(resources, repoKey, rootUrl, server);
  const branch = candidateBranch(tfsId), path = resolveNativeBusinessPath(root, repo);
  const head = validateBusinessCheckout(path, repo, branch, workdir);
  return { runtime, client, issue, md, root, path, repo, resources, rootUrl, branch, head, tfsId, bug };
}
