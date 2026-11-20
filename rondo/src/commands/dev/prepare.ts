/** 薄入口：先核验当前 Task 与 Bug 授权，再调用安全准备主体。 */
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { loadConfig, type BaseRegistryConfig } from "../../clients/config.js";
import { MulticaClient } from "../../clients/multica.js";
import { validateNativeCheckout } from "../../clients/native-checkout.js";
import { loadConfig as loadTfsConfig } from "../../tfs/config.js";
import { assertBugExecution, assertBugStart, assertBugSource } from "../bug/authorization.js";
import { prepareBusinessWorkspace, validatePrepareRepo, type PrepareRepo } from "./prepare-workspace.js";
import { guardRepository } from "./requirement-guard.js";
import { prepareRequirementWorktree } from "./requirement-worktree.js";
import { requirementRoot } from "../runtime/root-git.js";

export function registerDevPrepare(group: Command): void {
  group.command("prepare").description("Bug 独立 Clone；Requirement 在持久根仓准备 feature/<tfs.id> Worktree")
    .option("--mode <mode>", "bug | requirement", "bug")
    .option("--change-ref <ref>")
    .requiredOption("--config <path>").requiredOption("--issue <key>")
    .requiredOption("--repo <key>").option("--root-repo <path>")
    .action(async (opts: { config: string; issue: string; repo: string; rootRepo?: string; mode: string; changeRef?: string }) => {
      markLeafExecuted();
      try {
        const cfg = loadConfig<BaseRegistryConfig & { registry: Record<string, PrepareRepo> }>(opts.config);
        const client = new MulticaClient(cfg.runtime);
        const repo = validatePrepareRepo(cfg.registry[opts.repo], loadTfsConfig().serverUrl);
        let result: Record<string, unknown>;
        let issue;
        if (opts.mode === "requirement") {
          if (!opts.changeRef) throw new FailError("Requirement prepare 需要 --change-ref");
          const approved = await guardRepository(cfg, client, opts.issue, opts.changeRef, opts.repo);
          issue = approved.issue;
          const root = requirementRoot(opts.rootRepo);
          result = prepareRequirementWorktree(root, repo, approved.tfsId, loadTfsConfig().serverUrl);
          // This existing Verify decision must be projected for Finalize; never infer it from Analyst advice.
          if (issue.metadata?.["verify_agent.required"] === undefined) {
            client.setMetadata(issue.id, "verify_agent.required", String(approved.verifyRequired));
          }
        } else if (opts.mode === "bug") {
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
