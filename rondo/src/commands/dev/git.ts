import { Command } from "commander";
import { authorizedCheckout } from "./authorized-checkout.js";
import { requireTargetBranch } from "./prepare-workspace.js";
import { runAuthenticatedGit } from "../../clients/authenticated-git.js";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";

export function registerDevGit(group: Command): void {
  group.command("git").description("以当前 Task 授权 fetch 或非强制 push Candidate")
    .requiredOption("--issue <key>").requiredOption("--repo <key>")
    .requiredOption("--root-repo <path>").requiredOption("--operation <fetch|push>")
    .action(async (opts: { issue: string; repo: string; rootRepo: string; operation: string }) => {
      markLeafExecuted();
      try {
        if (!["fetch", "push"].includes(opts.operation)) throw new FailError("仅支持 fetch / push");
        const { repo, path, branch, head } = await authorizedCheckout(opts.issue, opts.repo, opts.rootRepo, opts.operation === "push");
        if (opts.operation === "fetch") {
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
        process.stdout.write(JSON.stringify({ result: "PASS", operation: opts.operation, path, branch, head }) + "\n");
      } catch (e) {
        if (!(e instanceof FailError || e instanceof UnknownError)) throw e;
        process.stdout.write(JSON.stringify({ result: e instanceof FailError ? "FAIL" : "UNKNOWN", reason: e.message }) + "\n");
        throw new ExitSignal(e instanceof FailError ? 2 : 3);
      }
    });
}
