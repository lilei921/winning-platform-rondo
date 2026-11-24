/** 薄入口：先核验当前 Task 与 Bug 授权，再调用安全准备主体。 */
import { dirname } from "node:path";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { loadConfig, type BaseRegistryConfig } from "../../clients/config.js";
import { MulticaClient } from "../../clients/multica.js";
import { assertNativeTaskCheckout, validateNativeCheckout } from "../../clients/native-checkout.js";
import { loadConfig as loadTfsConfig } from "../../tfs/config.js";
import { assertBugExecution, assertBugStart, assertBugSource } from "../bug/authorization.js";
import { prepareBusinessWorkspace, validatePrepareRepo, type PrepareRepo } from "./prepare-workspace.js";
import { assertEngineerExecution, guardRepository } from "./requirement-guard.js";
import { prepareRequirementWorktree } from "./requirement-worktree.js";
import { resolveMulticaRuntime } from "../../clients/runtime-context.js";
import { readAnalysisSource } from "../analysis/source.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";
import { runAuthenticatedGit } from "../../clients/authenticated-git.js";
import { gitOk, git } from "../../clients/git.js";
import { readNativeRepoMapping, prepareNativeBusiness } from "./native-prepare.js";
import { requirementRoot } from "../runtime/root-git.js";

export function registerDevPrepare(group: Command): void {
  group.command("prepare").description("准备已授权业务仓")
    .option("--workspace <workspace>", "native")
    .option("--resource-ref <ref>", "已核实的业务仓 Project Resource 初始分支")
    .option("--mode <mode>", "bug | requirement")
    .option("--change-ref <ref>")
    .option("--config <path>").requiredOption("--issue <key>")
    .requiredOption("--repo <key>").option("--root-repo <path>")
    .action(async (opts: { config?: string; issue: string; repo: string; rootRepo?: string; mode?: string; changeRef?: string; workspace?: string; resourceRef?: string }) => {
      markLeafExecuted();
      try {
        if (opts.workspace === "native") {
          if (opts.config || opts.mode || !opts.rootRepo) throw new FailError("Native prepare 需要 --root-repo，不接受 --config 或 --mode");
          const runtime = resolveMulticaRuntime(), client = new MulticaClient(runtime);
          const issue = client.getIssue(opts.issue);
          const root = validateNativeCheckout(opts.rootRepo).rootRepo;
          assertNativeTaskCheckout(root, dirname(root), undefined, issue.id);
          const server = loadTfsConfig().serverUrl;
          let result: Record<string, unknown>;
          if (issue.metadata?.["tfs.type"] === "Bug") {
            assertBugExecution(client, issue);
            await assertBugSource(issue, server);
            const id = assertBugStart(client, issue, opts.repo);
            if (opts.changeRef) throw new FailError("Bug 不使用 --change-ref");
            const mapping = readNativeRepoMapping(root, "HEAD", server);
            const repo = validatePrepareRepo(mapping[opts.repo], server);
            result = prepareNativeBusiness(root, repo, "feat/" + id, runtime, opts.resourceRef);
          } else if (issue.metadata?.["tfs.type"] === "需求") {
            if (!opts.changeRef) throw new FailError("Requirement prepare 需要 --change-ref");
            const source = readAnalysisSource(issue.metadata);
            if (canonicalRepositoryIdentity(gitOk(root, ["remote", "get-url", "origin"], "核对批准根仓")) !== canonicalRepositoryIdentity(source.repo_url))
              throw new FailError("Native 根仓与批准来源不一致");
            assertEngineerExecution(client, issue, runtime.workspace_id);
            if (git(root, ["cat-file", "-e", source.commit + "^{commit}"]).status !== 0) {
              const ref = "refs/heads/" + source.branch;
              if (source.branch.startsWith("-") || source.branch.startsWith("refs/") || git(root, ["check-ref-format", ref]).status !== 0)
                throw new FailError("批准来源分支非法");
              const fetched = runAuthenticatedGit(source.repo_url, ["fetch", "--no-tags", source.repo_url, ref], root);
              if (fetched.status !== 0) throw new UnknownError("批准来源 Fetch 未确认，保留现场");
            }
            if (git(root, ["merge-base", "--is-ancestor", source.commit, "HEAD"]).status !== 0)
              throw new UnknownError("Native 根仓尚不包含批准 Commit，保留现场");
            const registry = readNativeRepoMapping(root, source.commit, server);
            const approved = await guardRepository({ runtime, registry }, client, opts.issue, opts.changeRef, opts.repo);
            if (approved.source.commit !== source.commit || approved.source.repo_url !== source.repo_url || approved.source.branch !== source.branch)
              throw new UnknownError("批准来源在准备期间变化");
            const repo = validatePrepareRepo(registry[opts.repo], server);
            result = prepareNativeBusiness(root, repo, "feature/" + approved.tfsId, runtime, opts.resourceRef);
            if (approved.issue.metadata?.["verify_agent.required"] === undefined) {
              client.setMetadata(approved.issue.id, "verify_agent.required", String(approved.verifyRequired));
            }
          } else throw new FailError("不支持当前 tfs.type");
          process.stdout.write(JSON.stringify({ ...result, issue: issue.identifier ?? issue.id, repo_key: opts.repo }, null, 2) + "\n");
          return;
        }
        if (opts.workspace !== undefined || opts.resourceRef !== undefined || !opts.config)
          throw new FailError("旧入口需要 --config；--workspace 仅支持 native");
        const mode = opts.mode ?? "bug";
        const cfg = loadConfig<BaseRegistryConfig & { registry: Record<string, PrepareRepo> }>(opts.config);
        const client = new MulticaClient(cfg.runtime);
        const repo = validatePrepareRepo(cfg.registry[opts.repo], loadTfsConfig().serverUrl);
        let result: Record<string, unknown>;
        let issue;
        if (mode === "requirement") {
          if (!opts.changeRef) throw new FailError("Requirement prepare 需要 --change-ref");
          const approved = await guardRepository(cfg, client, opts.issue, opts.changeRef, opts.repo);
          issue = approved.issue;
          const root = requirementRoot(opts.rootRepo);
          result = prepareRequirementWorktree(root, repo, approved.tfsId, loadTfsConfig().serverUrl);
          // This existing Verify decision must be projected for Finalize; never infer it from Analyst advice.
          if (issue.metadata?.["verify_agent.required"] === undefined) {
            client.setMetadata(issue.id, "verify_agent.required", String(approved.verifyRequired));
          }
        } else if (mode === "bug") {
          if (!opts.rootRepo) throw new FailError("Bug prepare 仍须显式提供 --root-repo");
          issue = client.getIssue(opts.issue);
          assertBugExecution(client, issue);
          await assertBugSource(issue, loadTfsConfig().serverUrl);
          const paths = validateNativeCheckout(opts.rootRepo);
          const tfsId = assertBugStart(client, issue, opts.repo);
          result = prepareBusinessWorkspace(paths.rootRepo, repo, tfsId);
        } else throw new FailError("--mode 仅接受 bug 或 requirement");
        process.stdout.write(JSON.stringify({ ...result, issue: issue.identifier ?? issue.id, repo_key: opts.repo }, null, 2) + "\n");
      } catch (e) {
        if (!(e instanceof FailError || e instanceof UnknownError)) throw e;
        process.stdout.write(JSON.stringify({ result: e instanceof FailError ? "FAIL" : "UNKNOWN", reason: e.message }) + "\n");
        throw new ExitSignal(e instanceof FailError ? 2 : 3);
      }
    });
}
