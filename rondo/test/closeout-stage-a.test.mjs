import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, appendFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { prepareRoot, cleanupCloseoutRoot, verifyCloseoutRoot, confirmPublishedArchive, assertCloseoutChange, parsePlatformCheckoutOutput } from '../dist/commands/delivery/closeout-root.js';
import { readPlatformCheckoutManifest } from '../dist/clients/native-checkout.js';
import { approvedTasksAtCommit, inspectRequirementCommits } from '../dist/commands/tfs/requirement-commits.js';
import { prChangedCommits } from '../dist/tfs/api/commit-facts.js';

const repoUrl = 'http://tfs.test/tfs/C/P/_git/root';
// 平台任务 ID -> 分支尾号取去连字符后的末 12 位（与真实 daemon checkout 一致）。
const taskId = '01a1d2fc-da3a-796b-9584-f8f23e188c07';
const taskSuffix = 'f8f23e188c07';
const workspaceId = 'ws-fixture';
const multicaEnvKeys = ['MULTICA_TASK_ID', 'MULTICA_WORKSPACE_ID'];

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function fixture(t, { checkoutSuffix = taskSuffix, checkoutThrows = false, staleLocal = false } = {}) {
  const previousCwd = process.cwd();
  const savedEnv = Object.fromEntries(multicaEnvKeys.map((key) => [key, process.env[key]]));
  const dir = mkdtempSync(join(tmpdir(), 'rondo-closeout-fixture-'));
  const taskWorkdir = join(dir, 'task-workdir');
  mkdirSync(taskWorkdir);
  t.after(() => {
    process.chdir(previousCwd);
    for (const key of multicaEnvKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    rmSync(dir, { recursive: true, force: true });
  });
  process.chdir(taskWorkdir);
  // 模拟真实 daemon Task 环境：isolated checkout + Task/Workspace 身份。
  // 注意：不使用 MULTICA_REPO_CHECKOUT_MODE；平台证据来自 checkout 配置或 daemon cache 形态。
  Object.assign(process.env, {
    MULTICA_TASK_ID: taskId,
    MULTICA_WORKSPACE_ID: workspaceId,
  });

  const work = join(dir, 'work');
  const bare = join(dir, 'bare.git');
  mkdirSync(work);
  git(work, 'init', '-b', 'dev');
  git(work, 'config', 'user.name', 'Rondo Test');
  git(work, 'config', 'user.email', 'test@example.invalid');
  // 基线提交：让后续"本地分支落后"场景有可回退的父提交。
  git(work, 'commit', '--allow-empty', '-m', 'base');
  for (const ref of ['change-a', 'change-b', 'change-c']) {
    const path = join(work, 'openspec', 'changes', ref);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'tasks.md'), '- [ ] 1.1 Implement ' + ref + '\n');
  }
  git(work, 'add', '-A');
  git(work, 'commit', '-m', 'approved changes');
  const approved = git(work, 'rev-parse', 'HEAD');
  git(dir, 'init', '--bare', bare);
  git(work, 'remote', 'add', 'origin', bare);
  git(work, 'push', 'origin', 'dev');
  git(work, 'switch', '-c', 'release');
  const releaseRef = join(work, 'openspec', 'changes', 'release-change');
  mkdirSync(releaseRef, { recursive: true });
  writeFileSync(join(releaseRef, 'tasks.md'), '- [ ] 1.1 Release\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-m', 'release change');
  const releaseApproved = git(work, 'rev-parse', 'HEAD');
  git(work, 'push', 'origin', 'release');
  // 让平台模拟 checkout 的默认分支稳定落在 dev。
  git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/dev');

  let lastSubdir;
  let lastRoot;
  // 传输适配：认证 Fetch 的 origin 指向本地 bare fixture；其它操作不得借道。
  const remote = (url, args, cwd) => {
    assert.equal(url, repoUrl);
    const rewritten = [...args];
    if (rewritten[0] !== 'fetch') throw new Error('unexpected authenticated operation ' + args.join(' '));
    rewritten[1] = bare;
    const r = spawnSync('git', rewritten, { cwd, encoding: 'utf8' });
    return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
  };
  // 模拟 `multica repo checkout`：在子目录生成独立 checkout、真实 origin、isolated 标记与 agent 分支。
  const checkout = (subdir, url) => {
    lastSubdir = subdir;
    assert.equal(url, repoUrl);
    if (checkoutThrows) return { throw: true };
    const root = join(subdir, 'winning-platform-monorepo');
    git(subdir, 'clone', bare, root);
    git(root, 'config', 'user.name', 'Rondo Test');
    git(root, 'config', 'user.email', 'test@example.invalid');
    // 模拟 daemon cache 中已存在且落后于远端的同名本地分支。
    if (staleLocal) git(root, 'reset', '--hard', 'HEAD~1');
    git(root, 'switch', '-c', `agent/pr-status-sync-agent/${checkoutSuffix}`);
    git(root, 'config', 'multica.checkout-mode', 'isolated');
    git(root, 'remote', 'set-url', 'origin', repoUrl);
    git(root, 'remote', 'set-url', '--push', 'origin', repoUrl);
    lastRoot = root;
    return { root, branch: `agent/pr-status-sync-agent/${checkoutSuffix}` };
  };
  const wrappedCheckout = (subdir, url) => {
    const result = checkout(subdir, url);
    if (result.throw) throw new Error('platform checkout failed');
    return result;
  };
  const source = (ref, branch = 'dev') => ({
    repo_url: repoUrl, branch, commit: branch === 'dev' ? approved : releaseApproved, change_ref: ref,
  });
  const prepare = (value, extra = {}) => prepareRoot(value, {
    issueKey: 'LEI-1', issueId: 'issue-1', checkout: wrappedCheckout, remote, verifyRun: () => {}, ...extra,
  });
  const paths = root => ({
    rootRepo: root, openspecRoot: join(root, 'openspec'), projectId: '', daemonId: null, source: 'explicit_arg',
  });
  return { bare, source, paths, remote, prepare, get lastRoot() { return lastRoot; }, get lastSubdir() { return lastSubdir; }, checkout: wrappedCheckout };
}

test('平台 checkout 输出：路径在 stdout、分支在 stderr 仍可解析', () => {
  const root = 'D:\\Multica\\default\\w\\lei-49-1\\workdir\\rondo-closeout-LEI-49-abc\\winning-platform-monorepo';
  const parsed = parsePlatformCheckoutOutput(root + '\n',
    'Checked out http://tfs/x/_git/winning-platform-monorepo -> ' + root + ' (branch: agent/pr-status-sync-agent/795c637fbd86)\n');
  assert.deepEqual(parsed, { root, branch: 'agent/pr-status-sync-agent/795c637fbd86' });
});

test('daemon cache 已有落后的同名本地分支时快进到刚抓取的远端', t => {
  const f = fixture(t, { staleLocal: true });
  const source = f.source('change-a');
  const { root_repo: root, cleanup_token: token } = f.prepare(source);
  // 本地 dev 原本落后；必须 fast-forward 到 origin/dev 上的批准版本。
  assert.equal(git(root, 'rev-parse', 'HEAD'), source.commit);
  assert.equal(verifyCloseoutRoot(f.paths(root), source).gitRemoteUrl, repoUrl);
  assert.deepEqual(cleanupCloseoutRoot(root, token), { released: true });
});

test('three Issues in one Repository+Branch share one platform root and publish separate archives', t => {
  const f = fixture(t);
  const first = f.source('change-a');
  const { root_repo: root, cleanup_token: token } = f.prepare(first);
  const owner = JSON.parse(readFileSync(join(root, '.git', 'rondo-closeout-owner.json'), 'utf8'));
  assert.equal(owner.workdir, realpathSync(process.cwd()));
  assert.equal(owner.provenance, 'multica-repo-checkout');
  assert.equal(owner.task_id, taskId);
  assert.equal(owner.workspace_id, workspaceId);
  assert.equal(owner.checkout_branch, `agent/pr-status-sync-agent/${taskSuffix}`);
  // 根仓位于受控 workdir 的一次性子目录，而非 workdir 直属目录。
  assert.notEqual(realpathSync(dirname(root)), realpathSync(process.cwd()));
  assert.match(dirname(root), /rondo-closeout-/);
  for (const changeRef of ['change-a', 'change-b', 'change-c']) {
    const issue = f.source(changeRef);
    assert.equal(verifyCloseoutRoot(f.paths(root), issue).gitRemoteUrl, repoUrl);
    const dest = join(root, 'openspec', 'changes', 'archive', '2026-11-20-' + changeRef);
    mkdirSync(join(root, 'openspec', 'changes', 'archive'), { recursive: true });
    renameSync(join(root, 'openspec', 'changes', changeRef), dest);
    git(root, 'config', 'user.name', 'Rondo Test');
    git(root, 'config', 'user.email', 'test@example.invalid');
    git(root, 'add', '-A');
    git(root, 'commit', '-m', 'archive ' + changeRef);
    git(root, 'push', f.bare, 'dev');
    assert.equal(confirmPublishedArchive(f.paths(root), issue, f.remote).folder, '2026-11-20-' + changeRef);
  }
  assert.deepEqual(cleanupCloseoutRoot(root, token), { released: true });
  // 平台 worktree 归 daemon 所有：只释放标记，不删除目录。
  assert.equal(existsSync(root), true);
  assert.equal(existsSync(join(root, '.git', 'rondo-closeout-owner.json')), false);
});

test('approved tasks are read from the immutable analysis.source.commit and each Issue checks its Change', t => {
  const f = fixture(t);
  const source = f.source('change-a');
  const { root_repo: root, cleanup_token: token } = f.prepare(source);
  const original = approvedTasksAtCommit(root, source.commit, 'change-a');
  assert.match(original, /\[ \] 1\.1 Implement change-a/);
  writeFileSync(join(root, 'openspec', 'changes', 'change-a', 'tasks.md'), '- [x] 1.1 Implement change-a\\n');
  assert.equal(approvedTasksAtCommit(root, source.commit, 'change-a'), original);
  assert.doesNotThrow(() => assertCloseoutChange(f.paths(root), f.source('change-b')));
  assert.throws(() => assertCloseoutChange(f.paths(root), f.source('not-on-branch')), /不存在/);
  git(root, 'restore', '.');
  assert.deepEqual(cleanupCloseoutRoot(root, token), { released: true });
});

test('missing Change fails preparation, releases the marker and keeps the platform worktree', t => {
  const f = fixture(t);
  assert.throws(() => f.prepare(f.source('missing-change')), /Change/);
  assert.equal(existsSync(f.lastRoot), true);
  assert.equal(existsSync(join(f.lastRoot, '.git', 'rondo-closeout-owner.json')), false);
});

test('same Repository on different Branch requires a separate root and rejects cross-branch reuse', t => {
  const f = fixture(t);
  const dev = f.prepare(f.source('change-a'));
  const release = f.prepare(f.source('release-change', 'release'));
  assert.notEqual(dev.root_repo, release.root_repo);
  assert.throws(() => verifyCloseoutRoot(f.paths(dev.root_repo), f.source('release-change', 'release')), /Branch|分支/);
  assert.deepEqual(cleanupCloseoutRoot(dev.root_repo, dev.cleanup_token), { released: true });
  assert.deepEqual(cleanupCloseoutRoot(release.root_repo, release.cleanup_token), { released: true });
});

test('Git-reported root path works for Verify and Cleanup on Windows', t => {
  const f = fixture(t);
  const source = f.source('change-a');
  const { root_repo: root, cleanup_token: token } = f.prepare(source);
  const gitRoot = git(root, 'rev-parse', '--show-toplevel');
  assert.equal(verifyCloseoutRoot(f.paths(gitRoot), source).gitRemoteUrl, repoUrl);
  assert.deepEqual(cleanupCloseoutRoot(gitRoot, token), { released: true });
  assert.equal(existsSync(root), true);
});

test('cleanup uses recorded workdir after caller changes cwd', t => {
  const f = fixture(t);
  const { root_repo: root, cleanup_token: token } = f.prepare(f.source('change-a'));
  process.chdir(dirname(f.bare));
  assert.notEqual(process.cwd(), realpathSync(dirname(root)));
  assert.deepEqual(cleanupCloseoutRoot(root, token), { released: true });
});

test('cleanup rejects a root whose recorded workdir no longer matches its controlled parent', t => {
  const f = fixture(t);
  const { root_repo: root, cleanup_token: token } = f.prepare(f.source('change-a'));
  const marker = join(root, '.git', 'rondo-closeout-owner.json');
  const original = readFileSync(marker, 'utf8');
  writeFileSync(marker, JSON.stringify({ ...JSON.parse(original), workdir: dirname(f.bare) }));
  assert.throws(() => verifyCloseoutRoot(f.paths(root), f.source('change-a')), /workdir|受控/);
  assert.throws(() => cleanupCloseoutRoot(root, token), /workdir|受控/);
  assert.equal(existsSync(root), true);
  writeFileSync(marker, original);
  assert.deepEqual(cleanupCloseoutRoot(root, token), { released: true });
});

test('cleanup rejects incorrect token and a second release', t => {
  const f = fixture(t);
  const { root_repo: root, cleanup_token: token } = f.prepare(f.source('change-a'));
  assert.throws(() => cleanupCloseoutRoot(root, 'wrong-token'), /token/);
  assert.equal(existsSync(join(root, '.git', 'rondo-closeout-owner.json')), true);
  assert.deepEqual(cleanupCloseoutRoot(root, token), { released: true });
  assert.throws(() => cleanupCloseoutRoot(root, token), /拒绝清理/);
});

test('platform branch 尾号与当前 Task 不一致时拒绝准备', t => {
  const f = fixture(t, { checkoutSuffix: '000000000000' });
  assert.throws(() => f.prepare(f.source('change-a')), /尾号/);
});

test('platform identity: Task / Workspace / isolated 缺失或不一致时拒绝', t => {
  const f = fixture(t);
  const { root_repo: root, cleanup_token: token } = f.prepare(f.source('change-a'));
  const swapped = { ...process.env, MULTICA_TASK_ID: taskId.replace('f8f23e188c07', '111111111111') };
  assert.throws(() => {
    process.env.MULTICA_TASK_ID = swapped.MULTICA_TASK_ID;
    verifyCloseoutRoot(f.paths(root), f.source('change-a'));
  }, /Task/);
  process.env.MULTICA_TASK_ID = taskId;
  // 没有平台 isolated 证据（无 [multica] 配置、也不是 daemon cache worktree）时必须拒绝。
  git(root, 'config', '--unset', 'multica.checkout-mode');
  assert.throws(() => verifyCloseoutRoot(f.paths(root), f.source('change-a')), /isolated/);
  git(root, 'config', 'multica.checkout-mode', 'isolated');
  assert.deepEqual(cleanupCloseoutRoot(root, token), { released: true });
});

test('manifest（强方案接口）存在时优先使用，字段不一致即拒绝', t => {
  const f = fixture(t);
  const { root_repo: root, cleanup_token: token } = f.prepare(f.source('change-a'));
  const manifest = join(root, '.git', 'multica-checkout.json');
  const identity = {
    checkout_branch: `agent/pr-status-sync-agent/${taskSuffix}`,
    task_id: taskId,
    workspace_id: workspaceId,
    checkout_mode: 'isolated',
  };
  writeFileSync(manifest, JSON.stringify(identity));
  assert.doesNotThrow(() => verifyCloseoutRoot(f.paths(root), f.source('change-a')));
  assert.deepEqual(readPlatformCheckoutManifest(join(root, '.git')), identity);
  writeFileSync(manifest, JSON.stringify({ ...identity, task_id: 'other-task' }));
  assert.throws(() => verifyCloseoutRoot(f.paths(root), f.source('change-a')), /Task\/Workspace/);
  writeFileSync(manifest, 'not-json');
  assert.throws(() => verifyCloseoutRoot(f.paths(root), f.source('change-a')), /manifest/);
  rmSync(manifest);
  assert.deepEqual(cleanupCloseoutRoot(root, token), { released: true });
});

test('wrong origin or unavailable approved commit rejects a shared root', t => {
  const f = fixture(t);
  const { root_repo: root, cleanup_token: token } = f.prepare(f.source('change-a'));
  assert.throws(() => verifyCloseoutRoot(f.paths(root), { ...f.source('change-a'), repo_url: 'http://tfs.test/tfs/C/P/_git/other' }), /Origin|所有权/);
  assert.throws(() => verifyCloseoutRoot(f.paths(root), { ...f.source('change-a'), commit: 'a'.repeat(40) }), /批准 Commit/);
  assert.deepEqual(cleanupCloseoutRoot(root, token), { released: true });
});

test('Requirement refuses an unmanaged checkout even if origin and branch match', t => {
  const f = fixture(t);
  // 用户 checkout：直接放在 task workdir 下，既无受控子目录也无所有权标记。
  const root = join(realpathSync(process.cwd()), 'winning-platform-monorepo');
  git(process.cwd(), 'clone', '--single-branch', '--branch', 'dev', f.bare, root);
  git(root, 'remote', 'set-url', 'origin', repoUrl);
  assert.throws(() => verifyCloseoutRoot(f.paths(root), f.source('change-a')), /受控|所有权/);
  rmSync(root, { recursive: true, force: true });
});

test('platform checkout failure releases the empty controlled directory', t => {
  const f = fixture(t, { checkoutThrows: true });
  assert.throws(() => f.prepare(f.source('change-a')), /准备失败/);
  assert.equal(existsSync(f.lastSubdir), false);
});

test('Inspect rejects a PR whose repository branch disagrees with approved preparation', async t => {
  const f = fixture(t);
  const source = f.source('change-a');
  const { root_repo: root, cleanup_token: token } = f.prepare(source);
  const md = {
    'analysis.change_ref': source.change_ref,
    'analysis.source': JSON.stringify(source),
    pr_prep: JSON.stringify([{ repo_key: 'app', source_branch: 'feature/10', target_branch: 'dev' }]),
    current_pr: JSON.stringify([{ repo_key: 'app', pr_id: 42, source_branch: 'feature/99', target_branch: 'dev' }]),
  };
  await assert.rejects(
    inspectRequirementCommits({ app: { repo_url: repoUrl } }, md, root, { config: {} }, {}),
    /PR Preparation.*分支不一致/,
  );
  assert.deepEqual(cleanupCloseoutRoot(root, token), { released: true });
});

test('TFS completed PR commit enumeration no longer requires a Candidate SHA', async () => {
  const sha1 = 'a'.repeat(40), sha2 = 'b'.repeat(40);
  const repo = { project: 'P', repo: 'business', projectId: '11111111-1111-1111-1111-111111111111', repoId: '22222222-2222-2222-2222-222222222222' };
  const client = {
    config: { serverUrl: 'http://tfs.test/tfs/C' },
    async rawRequest(raw) {
      if (raw.includes('/pullRequests/42/commits')) return { statusCode: 200, body: JSON.stringify({
        value: [{ commitId: sha1, comment: 'first' }, { commitId: sha2, comment: 'second' }],
      }) };
      const sha = raw.includes('/commits/' + sha1) ? sha1 : sha2;
      return { statusCode: 200, body: JSON.stringify({ changes: [{ item: { path: '/src/' + sha[0] } }] }) };
    },
  };
  const changed = await prChangedCommits(client, repo, 42);
  assert.deepEqual(changed.map(c => c.sha), [sha1, sha2]);
  await assert.rejects(prChangedCommits(client, repo, 42, 'c'.repeat(40)), /Candidate/);
});
