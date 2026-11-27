import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePlatformCheckoutOutput, assertNativeTaskCheckout, assertNativeCheckoutBaseline, readProjectResources } from "../dist/clients/native-checkout.js";
import { resourcePrepareRepo, requireTargetBranch, resolveNativeBusinessPath, validateBusinessCheckout } from "../dist/commands/dev/prepare-workspace.js";

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

for (const linked of [true, false]) test(`Native ${linked ? "linked worktree" : "isolated checkout"}: Project Resource, identity, baseline and WIP preservation`, () => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "rondo-native-")));
  const keys = ["MULTICA_TASK_ID", "MULTICA_WORKSPACE_ID", "MULTICA_AGENT_ID"];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, { MULTICA_TASK_ID: "01234567-abcd-ef12-3456-abcdef123456", MULTICA_WORKSPACE_ID: "workspace", MULTICA_AGENT_ID: "engineer" });
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const url = "https://example.test/tfs/collection";
  const rootUrl = url + "/project/_git/root";
  const repoUrl = url + "/project/_git/frame";
  const task = join(temp, "task"), root = join(task, "root"), business = join(task, "frame");
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
  const checkoutSeed = (seed, path, localBranch, origin, sha = seed.sha) => {
    if (linked) git(seed.bare, "worktree", "add", "-b", localBranch, path, sha);
    else {
      mkdirSync(path, { recursive: true });
      git(path, "init");
      git(path, "fetch", seed.bare, sha);
      git(path, "checkout", "-b", localBranch, sha);
      git(path, "remote", "add", "origin", origin);
      git(path, "config", "multica.checkout-mode", "isolated");
    }
  };
  try {
    mkdirSync(join(task, ".multica"), { recursive: true });
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(task, ".multica", "daemon_task_context.json"), JSON.stringify({ managed_by: "multica-daemon-task", issue_id: "issue-1", agent_id: "engineer" }));
    const rootSeed = seed("root", rootUrl, { "AGENTS.md": "# root" });
    mkdirSync(join(task, ".multica", "project"), { recursive: true });
    writeFileSync(join(task, ".multica", "project", "resources.json"), JSON.stringify({ project_id: "p", resources: [
      {resource_type:"github_repo", resource_ref:{url:rootUrl,ref:"dev"}},
      {resource_type:"github_repo", label:"业务模块", resource_ref:{url:repoUrl,ref:"main",default_branch_hint:"dev"}},
    ] }));
    const child = seed("frame", repoUrl, { "source.txt": "initial" });
    checkoutSeed(rootSeed, root, branch, rootUrl);
    assert.equal(assertNativeTaskCheckout(root, task), branch);
    const resources = readProjectResources(task, "p");
    const repo = resourcePrepareRepo(resources, "frame", rootUrl, url);
    assert.equal(repo.ref, "main");
    assert.equal(requireTargetBranch(repo, "feature/42"), "main");
    const withoutHint = resourcePrepareRepo(resources.map(row => ({...row, resource_ref: {...row.resource_ref, default_branch_hint: undefined}})), "frame", rootUrl, url);
    assert.equal(withoutHint.repo_url, repoUrl);
    assert.equal(requireTargetBranch(withoutHint, "feature/42"), "main");
    const withoutRef = resourcePrepareRepo(resources.map(row => ({...row, resource_ref: {...row.resource_ref, ref: undefined}})), "frame", rootUrl, url);
    assert.throws(() => requireTargetBranch(withoutRef, "feature/42"), /缺少 ref/);
    assert.throws(() => requireTargetBranch({...repo, ref:"feature/42"}, "feature/42"), /Candidate/);
    assert.throws(() => requireTargetBranch({...repo, ref:"refs/heads/dev"}, "feature/42"), /非法/);
    assert.throws(() => resourcePrepareRepo(resources, "root", rootUrl, url), /根仓/);
    assert.throws(() => resourcePrepareRepo(resources, "missing", rootUrl, url), /缺失/);
    assert.throws(() => resourcePrepareRepo([...resources, resources[1]], "frame", rootUrl, url), /不唯一/);
    assert.throws(() => readProjectResources(task, "other"), /Project 身份/);
    assert.throws(() => resolveNativeBusinessPath(root, { repo_path: '../outside' }), /路径/);
    assert.throws(() => resolveNativeBusinessPath(root, { repo_path: 'root' }), /冲突/);
    // A nested checkout with uncommitted work must never be replaced by a new sibling.
    const nested = join(root, 'frame');
    checkoutSeed(child, nested, 'agent/engineer/old-layout', repoUrl);
    writeFileSync(join(nested, 'source.txt'), 'nested WIP');
    assert.throws(() => assertNativeTaskCheckout(nested, task), /工作树/);
    assert.throws(() => resolveNativeBusinessPath(root, repo), /根仓内仍存在/);
    assert.equal(readFileSync(join(nested, 'source.txt'), 'utf8'), 'nested WIP');
    if (linked) git(child.bare, 'worktree', 'remove', '--force', nested);
    else rmSync(nested, { recursive: true, force: true });
    assert.equal(resolveNativeBusinessPath(root, repo), business);
    checkoutSeed(child, business, branch, repoUrl);
    git(business, "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*");
    git(business, "update-ref", "refs/remotes/origin/dev", child.sha);
    if (linked) git(business, "branch", "--set-upstream-to=origin/dev", branch);
    assert.equal(validateBusinessCheckout(business, repo, "feature/42", task), child.sha);
    assert.doesNotThrow(() => assertNativeCheckoutBaseline(business, "dev"));
    assert.throws(() => assertNativeCheckoutBaseline(business, "other"));
    writeFileSync(join(business, "source.txt"), "dirty");
    writeFileSync(join(business, "untracked.txt"), "keep");
    assert.equal(validateBusinessCheckout(business, repo, "feature/42", task), child.sha);
    assert.equal(readFileSync(join(business, "source.txt"), "utf8"), "dirty");
    assert.equal(readFileSync(join(business, "untracked.txt"), "utf8"), "keep");
    git(business, "add", "source.txt");
    git(business, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "local WIP");
    const unpushed = git(business, "rev-parse", "HEAD");
    assert.equal(validateBusinessCheckout(business, repo, "feature/42", task), unpushed);
    assert.equal(readFileSync(join(business, "untracked.txt"), "utf8"), "keep");
    // Multica can retain both working trees when a new Run continues the same task workdir.
    const creationTask = process.env.MULTICA_TASK_ID;
    delete process.env.MULTICA_TASK_ID;
    assert.equal(assertNativeTaskCheckout(root, task, undefined, "issue-1"), branch);
    assert.equal(assertNativeTaskCheckout(business, task), branch);
    const manifestPath = join(git(business, "rev-parse", "--absolute-git-dir"), "multica-checkout.json");
    const manifest = { task_id: creationTask, workspace_id: "workspace", checkout_branch: branch, checkout_mode: "isolated" };
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.equal(assertNativeTaskCheckout(business, task, branch, "issue-1"), branch);
    assert.equal(validateBusinessCheckout(business, repo, "feature/42", task), unpushed);
    process.env.MULTICA_TASK_ID = "01234567-abcd-ef12-3456-000000000000";
    assert.equal(assertNativeTaskCheckout(business, task, branch, "issue-1"), branch);
    assert.equal(git(business, "symbolic-ref", "--short", "HEAD"), branch);
    assert.equal(readFileSync(join(business, "untracked.txt"), "utf8"), "keep");
    assert.throws(() => assertNativeTaskCheckout(root, task, undefined, "other-issue"), /Issue/);
    assert.throws(() => assertNativeTaskCheckout(business, task, "agent/engineer/other"), /分支/);
    process.env.MULTICA_AGENT_ID = "other-agent";
    assert.throws(() => assertNativeTaskCheckout(root, task), /daemon Task/);
    process.env.MULTICA_AGENT_ID = "engineer";
    for (const patch of [{ workspace_id: "other" }, { checkout_branch: "agent/engineer/other" }, { checkout_mode: "shared" }]) {
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, ...patch }));
      assert.throws(() => assertNativeTaskCheckout(business, task));
    }
    rmSync(manifestPath);
    process.env.MULTICA_TASK_ID = creationTask;
    // A new workdir resumes only the published Candidate, not the previous workdir's WIP.
    const otherTask = join(temp, "other-task"), otherRoot = join(otherTask, "root"), otherBusiness = join(otherTask, "frame");
    const otherBranch = "agent/engineer/000000000001";
    mkdirSync(join(otherTask, ".multica"), { recursive: true });
    writeFileSync(join(otherTask, ".multica", "daemon_task_context.json"), JSON.stringify({ managed_by: "multica-daemon-task", agent_id: "engineer" }));
    process.env.MULTICA_TASK_ID = "01234567-abcd-ef12-3456-000000000001";
    checkoutSeed(rootSeed, otherRoot, otherBranch, rootUrl);
    assert.equal(assertNativeTaskCheckout(otherRoot, otherTask), otherBranch);
    checkoutSeed(child, otherBusiness, otherBranch, repoUrl, child.sha);
    assert.equal(validateBusinessCheckout(otherBusiness, repo, "feature/42", otherTask), child.sha);
    assert.equal(existsSync(join(otherBusiness, "untracked.txt")), false);
    assert.equal(git(business, "rev-parse", "HEAD"), unpushed);
    process.env.MULTICA_TASK_ID = "01234567-abcd-ef12-3456-abcdef123456";
    assert.throws(() => validateBusinessCheckout(business, { ...repo, repo_url: repoUrl + "-wrong" }, "feature/42", task), /origin/);
    assert.throws(() => assertNativeTaskCheckout(business, otherTask), /工作树/);
  } finally {
    for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    rmSync(temp, { recursive: true, force: true });
  }
});
