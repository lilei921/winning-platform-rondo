/** 后续 fetch/push 复用准备阶段的受控工具与认证，不接受任意 Git argv。 */
import { join } from "node:path";
import { lstatSync } from "node:fs";
import { Command } from "commander";
import { loadConfig, type BaseRegistryConfig } from "../../clients/config.js";
import { MulticaClient } from "../../clients/multica.js";
import { validateNativeCheckout } from "../../clients/native-checkout.js";
import { runAuthenticatedGit } from "../../clients/authenticated-git.js";
import { loadConfig as loadTfsConfig } from "../../tfs/config.js";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { assertBugExecution, assertBugStart, assertBugSource } from "./authorization.js";
import { assertNativeDeliveryMapping } from "../dev/native-prepare.js";
import { validatePrepareRepo, validateBusinessPath, validateBusinessCheckout, type PrepareRepo } from "../dev/prepare-workspace.js";

export function registerBugGit(group: Command): void {
  group.command("git").description("以相同 Task 授权与认证 fetch 或非强制 push Bug 候选分支")
    .requiredOption("--config <path>").requiredOption("--issue <key>").requiredOption("--repo <key>")
    .requiredOption("--root-repo <path>").requiredOption("--operation <fetch|push>")
    .action(async (opts: { config: string; issue: string; repo: string; rootRepo: string; operation: string }) => {
      markLeafExecuted();
      try {
        if (!["fetch", "push"].includes(opts.operation)) throw new FailError("仅支持 fetch / push");
        const cfg = loadConfig<BaseRegistryConfig & { registry: Record<string, PrepareRepo> }>(opts.config);
        const client = new MulticaClient(cfg.runtime), issue = client.getIssue(opts.issue);
        assertBugExecution(client, issue);
        await assertBugSource(issue, loadTfsConfig().serverUrl);
        const paths = validateNativeCheckout(opts.rootRepo);
        const id = assertBugStart(client, issue, opts.repo), branch = `feat/${id}`;
        const repo = validatePrepareRepo(cfg.registry[opts.repo], loadTfsConfig().serverUrl);
        const path = validateBusinessPath(paths.rootRepo, repo);
        const head = validateBusinessCheckout(path, repo, branch);
        if (lstatSync(join(path, ".git")).isFile())
          assertNativeDeliveryMapping(paths.rootRepo, "HEAD", opts.repo, repo, loadTfsConfig().serverUrl);
        const args = opts.operation === "fetch"
          ? ["fetch", "--no-tags", repo.repo_url, `refs/heads/${repo.default_target_branch}:refs/remotes/origin/${repo.default_target_branch}`]
          : ["push", repo.repo_url, `${head}:refs/heads/${branch}`];
        if (opts.operation === "fetch") {
          const result = runAuthenticatedGit(repo.repo_url, args, path);
          if (result.status !== 0) throw new UnknownError("Git Fetch 未确认成功，保留现场");
        } else {
          try { runAuthenticatedGit(repo.repo_url, args, path); }
          catch (e) { if (!(e instanceof UnknownError)) throw e; }
          // A transport failure can follow a successful push; the exact remote SHA is authoritative.
          const ref = "refs/heads/" + branch;
          const observed = runAuthenticatedGit(repo.repo_url, ["ls-remote", repo.repo_url, ref], path);
          if (observed.status !== 0 || observed.stdout.trim() !== head + "\t" + ref)
            throw new UnknownError("远端 Candidate SHA 未确认，保留现场");
        }
        process.stdout.write(JSON.stringify({ result: "PASS", operation: opts.operation, path, branch, head }) + "\n");
      } catch (e) {
        if (!(e instanceof FailError || e instanceof UnknownError)) throw e;
        process.stdout.write(JSON.stringify({ result: e instanceof FailError ? "FAIL" : "UNKNOWN", reason: e.message }) + "\n");
        throw new ExitSignal(e instanceof FailError ? 2 : 3);
      }
    });
}
