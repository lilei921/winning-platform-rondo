import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePlatformCheckoutOutput, assertNativeTaskCheckout } from "../dist/clients/native-checkout.js";
import { removePublishedRequirementWorktree } from "../dist/commands/dev/requirement-worktree.js";
import { readNativeRepoMapping, prepareNativeBusiness } from "../dist/commands/dev/native-prepare.js";

const branch = "agent/engineer/abcdef123456";
test("Native Checkout parser recognizes Windows paths and Kept; rejects ambiguous output", () => {
  const p = "D:\\multica\\task\\root";
  assert.deepEqual(parsePlatformCheckoutOutput(p, "Checked out (branch: " + branch + ")"), { root: p, branch });
  assert.deepEqual(parsePlatformCheckoutOutput(p, "Kept (branch: " + branch + ")"), { root: p, branch });
  assert.deepEqual(parsePlatformCheckoutOutput(p, "Checked out https://example.test/repo -> " + p + "\n(branch: " + branch + ")"), { root: p, branch });
  assert.deepEqual(parsePlatformCheckoutOutput(p, "Kept the existing checkout " + p + " (branch: " + branch + ",\nthis task's branch; 1 uncommitted file, 0 unpushed commits):\nnothing was reset, cleaned, or switched; only remote refs were fetched."), { root: p, branch });
  assert.throws(() => parsePlatformCheckoutOutput(p, "Kept"));
  assert.throws(() => parsePlatformCheckoutOutput(p + "\nD:\\other", "(branch: " + branch + ")"));
});

test("Native linked worktree: committed mapping, first checkout, Kept, dirty protection and divergent candidate", () => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "rondo-native-")));
  const keys = ["MULTICA_TASK_ID", "MULTICA_WORKSPACE_ID", "MULTICA_AGENT_ID"];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, { MULTICA_TASK_ID: "01234567-abcd-ef12-3456-abcdef123456", MULTICA_WORKSPACE_ID: "workspace", MULTICA_AGENT_ID: "engineer" });
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const url = "https://example.test/tfs/collection";
  const rootUrl = url + "/project/_git/root";
  const repoUrl = url + "/project/_git/frame";
  const task = join(temp, "task"), root = join(task, "root"), business = join(root, "frame");
  const cache = join(temp, ".repos", "workspace");
  const seed = (name, origin, files) => {
    const src = join(temp, name + "-seed"), bare = join(cache, name + ".git");
    mkdirSync(src, { recursive: true });
    git(src, "init");
    for (const [path, value] of Object.entries(files)) {
      mkdirSync(join(src, path, ".."), { recursive: true });
      writeFileSync(join(src, path), value);
    }
    git(src, "add", ".");
    git(src, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "seed");
    git(temp, "clone", "--bare", src, bare);
    git(bare, "remote", "set-url", "origin", origin);
    return { bare, sha: git(src, "rev-parse", "HEAD") };
  };
  try {
    mkdirSync(join(task, ".multica"), { recursive: true });
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(task, ".multica", "daemon_task_context.json"), JSON.stringify({ managed_by: "multica-daemon-task", agent_id: "engineer" }));
    const rootSeed = seed("root", rootUrl, { "AGENTS.md": "# root", ".gitignore": "/frame/\n/frame-42/\n/legacy/\n/legacy-42/\n", "docs/config/repo-context.yaml": JSON.stringify({ repos: [{ repo_id: "root", repo_path: ".", repo_url: rootUrl }, { repo_id: "frame", repo_path: "frame", repo_url: repoUrl, tfs_project: "project", default_target_branch: "dev" }] }) });
    const child = seed("frame", repoUrl, { "source.txt": "initial" });
    git(rootSeed.bare, "worktree", "add", "-b", branch, root, rootSeed.sha);
    assert.equal(assertNativeTaskCheckout(root, task), branch);
    const mapping = readNativeRepoMapping(root, "HEAD", url);
    assert.equal(mapping.frame.default_target_branch, "dev");
    const repo = mapping.frame;
    const runtime = { multica_cli: "multica", workspace_id: "workspace" };
    let candidate = null, count = 0;
    const remote = () => ({ status: 0, stderr: "", stdout: child.sha + "\trefs/heads/dev\n" + (candidate ? candidate + "\trefs/heads/feature/42\n" : "") });
    const checkout = (argv, cwd) => {
      assert.equal(cwd, root);
      assert.equal(argv.at(-1), candidate ? "feature/42" : "dev");
      if (count++ === 0) {
        git(child.bare, "worktree", "add", "-b", branch, business, child.sha);
        git(business, "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*");
        git(business, "update-ref", "refs/remotes/origin/dev", child.sha);
        git(business, "branch", "--set-upstream-to=origin/dev", branch);
        return { status: 0, stdout: business, stderr: "Checked out -> " + business + "\n(branch: " + branch + ")" };
      }
      return { status: 0, stdout: business, stderr: "Kept the existing checkout (branch: " + branch + ", this task's branch; 2 uncommitted files, 0 unpushed commits)" };
    };
    const first = prepareNativeBusiness(root, repo, "feature/42", runtime, "dev", remote, checkout);
    assert.equal(first.changed, true);
    assert.equal(first.head, child.sha);
    assert.equal(first.local_branch, branch);
    writeFileSync(join(business, "source.txt"), "dirty");
    writeFileSync(join(business, "untracked.txt"), "keep");
    const beforePublish = prepareNativeBusiness(root, repo, "feature/42", runtime, "dev", remote, checkout);
    assert.equal(beforePublish.changed, false);
    assert.throws(() => prepareNativeBusiness(root, repo, "feature/42", runtime, "dev", remote,
      () => ({ status: 0, stdout: business, stderr: "Kept (branch: " + branch + ") fetch_error" })));
    candidate = child.sha;
    const again = prepareNativeBusiness(root, repo, "feature/42", runtime, undefined, remote, checkout);
    assert.equal(again.changed, false);
    assert.equal(readFileSync(join(business, "source.txt"), "utf8"), "dirty");
    assert.equal(readFileSync(join(business, "untracked.txt"), "utf8"), "keep");
    // Native root + old Requirement hub/worktree still cleans only the legacy checkout.
    const legacy = join(root, "legacy"), legacyWorktree = join(root, "legacy-42");
    git(root, "clone", child.bare, legacy);
    git(legacy, "remote", "set-url", "origin", repoUrl);
    git(legacy, "worktree", "add", "-b", "feature/42", legacyWorktree, child.sha);
    assert.equal(removePublishedRequirementWorktree(root, { repo_path: "legacy", repo_url: repoUrl }, 42, child.sha), "legacy-42");
    assert.equal(existsSync(legacyWorktree), false);
    assert.equal(removePublishedRequirementWorktree(root, repo, 42, child.sha), undefined);
    assert.equal(readFileSync(join(business, "untracked.txt"), "utf8"), "keep");
    candidate = "f".repeat(40);
    assert.throws(() => prepareNativeBusiness(root, repo, "feature/42", runtime, undefined, remote, checkout));
    assert.throws(() => prepareNativeBusiness(root, repo, "feature/42", runtime, undefined, () => ({ status: 1, stdout: "", stderr: "network" }), checkout));
    process.env.MULTICA_TASK_ID = "01234567-abcd-ef12-3456-000000000000";
    assert.throws(() => assertNativeTaskCheckout(business, task));
  } finally {
    for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    rmSync(temp, { recursive: true, force: true });
  }
});
