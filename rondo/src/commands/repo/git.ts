import { Command } from "commander";
import { authorizedCheckout } from "./authorized-checkout.js";
import { requireTargetBranch } from "./checkout.js";
import { runAuthenticatedGit } from "../../clients/authenticated-git.js";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";

export function registerRepoGit(group: Command): void {
  for (const operation of ["fetch", "push"] as const) {
    group.command(operation).description(operation === "fetch" ? "Fetch 已授权仓库的目标分支" : "非强制 Push 已授权仓库的 Candidate")
      .requiredOption("--issue <key>", "Multica Issue 标识").requiredOption("--repo <key>", "完整仓库名称")
      .requiredOption("--root-repo <path>", "当前根仓路径")
      .action(async (opts: { issue: string; repo: string; rootRepo: string }) => {
        markLeafExecuted();
        try {
          const { repo, path, branch, head } = await authorizedCheckout(opts.issue, opts.repo, opts.rootRepo, operation === "push");
          if (operation === "fetch") {
            const target = requireTargetBranch(repo, branch);
            const result = runAuthenticatedGit(repo.repo_url, ["fetch", "--no-tags", repo.repo_url, `refs/heads/${target}:refs/remotes/origin/${target}`], path);
            if (result.status !== 0) throw new UnknownError("Git Fetch 未确认成功，保留现场");
          } else {
            if (branch === repo.ref) throw new FailError("Candidate 与 PR Target 相同");
            try { runAuthenticatedGit(repo.repo_url, ["push", repo.repo_url, `${head}:refs/heads/${branch}`], path); }
            catch (e) { if (!(e instanceof UnknownError)) throw e; }
            // A transport failure can follow a successful push; the exact remote SHA is authoritative.
            const ref = "refs/heads/" + branch;
            const observed = runAuthenticatedGit(repo.repo_url, ["ls-remote", repo.repo_url, ref], path);
            if (observed.status !== 0 || observed.stdout.trim() !== head + "\t" + ref)
              throw new UnknownError("远端 Candidate SHA 未确认，保留现场");
          }
          process.stdout.write(JSON.stringify({ result: "PASS", operation, path, branch, head }) + "\n");
        } catch (e) {
          if (!(e instanceof FailError || e instanceof UnknownError)) throw e;
          process.stdout.write(JSON.stringify({ result: e instanceof FailError ? "FAIL" : "UNKNOWN", reason: e.message }) + "\n");
          throw new ExitSignal(e instanceof FailError ? 2 : 3);
        }
      });
  }
}
