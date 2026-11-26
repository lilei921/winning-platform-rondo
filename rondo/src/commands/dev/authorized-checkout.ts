/** Resolve the current authorized Native checkout, shared by Git and PR Preparation. */
import { dirname } from "node:path";
import { FailError, UnknownError } from "../../cli/errors.js";
import { MulticaClient } from "../../clients/multica.js";
import { resolveMulticaRuntime } from "../../clients/runtime-context.js";
import { validateNativeCheckout, assertNativeTaskCheckout } from "../../clients/native-checkout.js";
import { gitOk } from "../../clients/git.js";
import { loadConfig as loadTfsConfig } from "../../tfs/config.js";
import { assertBugExecution, assertBugSource, assertBugStart } from "../bug/authorization.js";
import { readAnalysisSource, type AnalysisSource } from "../analysis/source.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";
import { candidateBranch } from "../pr/candidate-branch.js";
import { registeredPrs } from "../pr/facts.js";
import { guardRepository } from "./requirement-guard.js";
import { readNativeRepoMapping } from "./native-prepare.js";
import { validatePrepareRepo, validateBusinessPath, validateBusinessCheckout } from "./prepare-workspace.js";

export async function authorizedCheckout(issueKey: string, repoKey: string, rootRepo: string) {
  const runtime = resolveMulticaRuntime(), client = new MulticaClient(runtime);
  const issue = client.getIssue(issueKey), md = issue.metadata ?? {};
  if (md["tfs.type"] === "需求" && registeredPrs(md.pr).some(p => p.repo_key === repoKey))
    throw new FailError("当前仓库已有登记 PR，需先完成或受控恢复");
  const root = validateNativeCheckout(rootRepo).rootRepo, workdir = dirname(root);
  assertNativeTaskCheckout(root, workdir, undefined, issue.id);
  const server = loadTfsConfig().serverUrl;
  let tfsId: number, revision: string;
  let analysisSource: AnalysisSource | undefined;
  const bug = md["tfs.type"] === "Bug";
  if (bug) {
    assertBugExecution(client, issue);
    await assertBugSource(issue, server);
    tfsId = assertBugStart(client, issue, repoKey);
    revision = gitOk(root, ["rev-parse", "HEAD"], "固定 Bug 根仓映射版本");
  } else if (md["tfs.type"] === "需求") {
    const source = readAnalysisSource(md);
    analysisSource = source;
    if (canonicalRepositoryIdentity(gitOk(root, ["remote", "get-url", "origin"], "核对批准根仓")) !== canonicalRepositoryIdentity(source.repo_url))
      throw new FailError("Native 根仓与批准来源不一致");
    revision = source.commit;
    tfsId = Number(md["tfs.id"]);
  } else throw new FailError("不支持当前 TFS Type");
  const registry = readNativeRepoMapping(root, revision, server);
  if (analysisSource) {
    const approved = await guardRepository({ runtime, registry }, client, issueKey, repoKey, { root, source: analysisSource });
    if (approved.source.commit !== revision || approved.issue.metadata?.["analysis.source"] !== md["analysis.source"] ||
        approved.issue.metadata?.["analysis.human_approval"] !== md["analysis.human_approval"] || approved.tfsId !== tfsId)
      throw new UnknownError("批准来源在授权期间变化");
  }
  const repo = validatePrepareRepo(registry[repoKey], server);
  const branch = candidateBranch(tfsId), path = validateBusinessPath(root, repo);
  if (branch === repo.default_target_branch) throw new FailError("Candidate 与 PR Target 相同");
  const head = validateBusinessCheckout(path, repo, branch, workdir);
  return { runtime, client, issue, md, root, path, repo, registry, branch, head, tfsId, bug, revision };
}
