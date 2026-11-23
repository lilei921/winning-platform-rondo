import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, existsSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { prepareRoot, verifyCloseoutRoot, confirmPublishedArchive, assertCloseoutChange, parsePlatformCheckoutOutput } from '../dist/commands/delivery/closeout-root.js';
import { readPlatformCheckoutManifest } from '../dist/clients/native-checkout.js';
import { approvedTasksAtCommit, inspectRequirementCommits } from '../dist/commands/tfs/requirement-commits.js';
import { prChangedCommits } from '../dist/tfs/api/commit-facts.js';

const repoUrl = 'http://tfs.test/tfs/C/P/_git/root';
const taskId = '01a1d2fc-da3a-796b-9584-f8f23e188c07';
const taskSuffix = 'f8f23e188c07';
const workspaceId = 'ws-fixture';
const multicaEnvKeys = ['MULTICA_TASK_ID', 'MULTICA_WORKSPACE_ID', 'MULTICA_AGENT_ID'];

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, 'git ' + args.join(' ') + ': ' + result.stderr);
  return result.stdout.trim();
}

function fixture(t, { checkoutSuffix = taskSuffix, checkoutThrows = false, staleLocal = false, linked = false } = {}) {
  const previousCwd = process.cwd();
  const savedEnv = Object.fromEntries(multicaEnvKeys.map(key => [key, process.env[key]]));
  const dir = mkdtempSync(join(tmpdir(), 'rondo-native-closeout-'));
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
  Object.assign(process.env, {
    MULTICA_TASK_ID: taskId, MULTICA_WORKSPACE_ID: workspaceId, MULTICA_AGENT_ID: 'agent-fixture',
  });

  const work = join(dir, 'work'), bare = join(dir, 'bare.git');
  mkdirSync(work);
  git(work, 'init', '-b', 'dev');
  git(work, 'config', 'user.name', 'Rondo Test');
  git(work, 'config', 'user.email', 'test@example.invalid');
  git(work, 'commit', '--allow-empty', '-m', 'base');
  for (const ref of ['change-a', 'change-b', 'change-c']) {
    const folder = join(work, 'openspec', 'changes', ref);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'tasks.md'), '- [ ] 1.1 Implement ' + ref + '\n');
  }
  git(work, 'add', '-A');
  git(work, 'commit', '-m', 'approved changes');
  const approved = git(work, 'rev-parse', 'HEAD');
  git(dir, 'init', '--bare', bare);
  git(work, 'remote', 'add', 'origin', bare);
  git(work, 'push', 'origin', 'dev');
  git(work, 'push', 'origin', 'dev:main', 'dev:master');
  git(work, 'switch', '-c', 'release');
  const releaseRef = join(work, 'openspec', 'changes', 'release-change');
  mkdirSync(releaseRef, { recursive: true });
  writeFileSync(join(releaseRef, 'tasks.md'), '- [ ] 1.1 Release\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-m', 'release change');
  const releaseApproved = git(work, 'rev-parse', 'HEAD');
  git(work, 'push', 'origin', 'release');
  git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/dev');
  if (linked) git(bare, 'remote', 'add', 'origin', repoUrl);

  let lastRoot, checkoutCount = 0;
  const remote = (url, args, cwd) => {
    assert.equal(url, repoUrl);
    assert.equal(args[0], 'fetch');
    const rewritten = [...args];
    rewritten[1] = bare;
    const r = spawnSync('git', rewritten, { cwd, encoding: 'utf8' });
    return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
  };
  const checkout = (workdir, url) => {
    checkoutCount++;
    assert.equal(workdir, realpathSync(taskWorkdir));
    assert.equal(url, repoUrl);
    if (checkoutThrows) throw new Error('platform checkout failed');
    const root = join(workdir, 'root');
    const agentBranch = 'agent/pr-status-sync-agent/' + checkoutSuffix;
    if (linked) {
      git(bare, 'worktree', 'add', '-b', agentBranch, root, 'dev');
    } else {
      git(workdir, 'clone', bare, root);
      if (staleLocal) git(root, 'reset', '--hard', 'HEAD~1');
      git(root, 'switch', '-c', agentBranch);
    }
    git(root, 'config', 'user.name', 'Rondo Test');
    git(root, 'config', 'user.email', 'test@example.invalid');
    git(root, 'config', 'multica.checkout-mode', 'isolated');
    if (!linked) {
      git(root, 'remote', 'set-url', 'origin', repoUrl);
      git(root, 'remote', 'set-url', '--push', 'origin', repoUrl);
    }
    lastRoot = root;
    return { root, branch: agentBranch };
  };
  const source = (ref, branch = 'dev') => ({
    repo_url: repoUrl, branch, commit: branch === 'release' ? releaseApproved : approved, change_ref: ref,
  });
  const prepare = source => prepareRoot(source, { checkout, remote });
  const paths = root => ({
    rootRepo: root, openspecRoot: join(root, 'openspec'), projectId: '', daemonId: null, source: 'explicit_arg',
  });
  return { bare, source, paths, remote, prepare, checkout,
    get lastRoot() { return lastRoot; }, get checkoutCount() { return checkoutCount; } };
}

test('平台 checkout 输出含路径与分支时可解析，包括 Windows 路径', () => {
  const root = 'D:\\Multica\\workdir\\root';
  assert.deepEqual(parsePlatformCheckoutOutput(root + '\n',
    'Checked out http://tfs/x/_git/root -> ' + root + ' (branch: agent/pr-status-sync-agent/795c637fbd86)\n'),
  { root, branch: 'agent/pr-status-sync-agent/795c637fbd86' });
});

test('Native checkout 直接位于 Task workdir，并以来源分支建立独立本地分支', t => {
  const f = fixture(t, { staleLocal: true });
  const source = f.source('change-a');
  const root = f.prepare(source).root_repo;
  assert.equal(realpathSync(dirname(root)), realpathSync(process.cwd()));
  assert.equal(root, join(process.cwd(), 'root'));
  assert.equal(git(root, 'symbolic-ref', '--short', 'HEAD'), 'rondo/closeout/' + taskSuffix + '/dev');
  assert.equal(git(root, 'rev-parse', 'HEAD'), source.commit);
  assert.equal(verifyCloseoutRoot(f.paths(root), source).gitRemoteUrl, repoUrl);
  assert.equal(existsSync(join(root, '.git', 'rondo-closeout-owner.json')), false);
  assert.equal(f.checkoutCount, 1);
});

test('同 Task 重复准备直接复用 Checkout 与分支，不覆盖本地已确认的提交', t => {
  const f = fixture(t);
  const source = f.source('change-a');
  const root = f.prepare(source).root_repo;
  assert.equal(f.prepare(source).root_repo, root);
  assert.equal(f.checkoutCount, 1);
  assert.equal(git(root, 'symbolic-ref', '--short', 'HEAD'), 'rondo/closeout/' + taskSuffix + '/dev');
  const head = git(root, 'rev-parse', 'HEAD');
  assert.equal(f.prepare(f.source('change-b')).root_repo, root);
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
});

test('同 Run 多 Issue 顺序发布到 dev，而不是同名本地 Task 分支', t => {
  const f = fixture(t);
  const root = f.prepare(f.source('change-a')).root_repo;
  for (const changeRef of ['change-a', 'change-b', 'change-c']) {
    const issue = f.source(changeRef);
    assert.equal(f.prepare(issue).root_repo, root);
    assert.equal(verifyCloseoutRoot(f.paths(root), issue).gitRemoteUrl, repoUrl);
    const dest = join(root, 'openspec', 'changes', 'archive', '2026-11-20-' + changeRef);
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(join(root, 'openspec', 'changes', changeRef), dest);
    git(root, 'add', '-A');
    git(root, 'commit', '-m', 'archive ' + changeRef);
    git(root, 'push', f.bare, 'HEAD:refs/heads/dev');
    assert.equal(confirmPublishedArchive(f.paths(root), issue, f.remote).folder, '2026-11-20-' + changeRef);
  }
  assert.equal(f.checkoutCount, 1);
  assert.equal(existsSync(root), true);
  assert.equal(existsSync(join(root, '.git', 'rondo-closeout-owner.json')), false);
});

test('批准 tasks 始终按不可变 Commit 读取，每个 Issue 独立检查 Change', t => {
  const f = fixture(t);
  const source = f.source('change-a');
  const root = f.prepare(source).root_repo;
  const original = approvedTasksAtCommit(root, source.commit, 'change-a');
  writeFileSync(join(root, 'openspec', 'changes', 'change-a', 'tasks.md'), '- [x] changed\n');
  assert.equal(approvedTasksAtCommit(root, source.commit, 'change-a'), original);
  assert.doesNotThrow(() => assertCloseoutChange(f.paths(root), f.source('change-b')));
  assert.throws(() => assertCloseoutChange(f.paths(root), f.source('not-on-branch')), /不存在/);
  git(root, 'restore', '.');
});

test('main 与 master 各自 Fetch、Push、Readback，且不占用共享本地 main/master', t => {
  const f = fixture(t, { linked: true });
  const shared = join(dirname(f.bare), 'other-worktree');
  git(f.bare, 'worktree', 'add', shared, 'main');
  let root;
  for (const branch of ['main', 'master']) {
    const issue = f.source('change-a', branch);
    root = f.prepare(issue).root_repo;
    assert.equal(git(root, 'symbolic-ref', '--short', 'HEAD'), 'rondo/closeout/' + taskSuffix + '/' + branch);
    const dest = join(root, 'openspec', 'changes', 'archive', '2026-11-20-change-a');
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(join(root, 'openspec', 'changes', 'change-a'), dest);
    git(root, 'add', '-A');
    git(root, 'commit', '-m', 'archive on ' + branch);
    git(root, 'push', f.bare, 'HEAD:refs/heads/' + branch);
    assert.equal(confirmPublishedArchive(f.paths(root), issue, f.remote).folder, '2026-11-20-change-a');
    assert.equal(git(f.bare, 'rev-parse', branch), git(root, 'rev-parse', 'HEAD'));
  }
  assert.equal(f.checkoutCount, 1);
  assert.equal(git(root, 'symbolic-ref', '--short', 'HEAD'), 'rondo/closeout/' + taskSuffix + '/master');
  assert.notEqual(git(f.bare, 'rev-parse', 'main'), git(f.bare, 'rev-parse', 'master'));
});

test('跨 Run 远端先行推进时普通 Push 被拒绝且本地提交保留', t => {
  const f = fixture(t);
  const issue = f.source('change-a');
  const root = f.prepare(issue).root_repo;
  const peer = join(dirname(f.bare), 'peer');
  git(dirname(f.bare), 'clone', '--branch', 'dev', f.bare, peer);
  git(peer, 'config', 'user.name', 'Peer');
  git(peer, 'config', 'user.email', 'peer@example.invalid');
  writeFileSync(join(peer, 'peer.txt'), 'concurrent\n');
  git(peer, 'add', 'peer.txt');
  git(peer, 'commit', '-m', 'remote concurrent');
  git(peer, 'push', 'origin', 'dev');
  writeFileSync(join(root, 'local.txt'), 'local archive\n');
  git(root, 'add', 'local.txt');
  git(root, 'commit', '-m', 'local archive');
  const head = git(root, 'rev-parse', 'HEAD');
  const push = spawnSync('git', ['push', f.bare, 'HEAD:refs/heads/dev'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(push.status, 0, 'Non-FF must not replace another Run');
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(f.bare, 'rev-parse', 'dev'), git(peer, 'rev-parse', 'HEAD'));
});

test('linked worktree 的 Git common-dir manifest 必须校验当前 Task 身份', t => {
  const f = fixture(t, { linked: true });
  const source = f.source('change-a');
  const root = f.prepare(source).root_repo;
  const manifest = join(f.bare, 'multica-checkout.json');
  writeFileSync(manifest, JSON.stringify({
    checkout_branch: 'agent/pr-status-sync-agent/' + taskSuffix,
    task_id: 'another-task', workspace_id: workspaceId, checkout_mode: 'isolated',
  }));
  assert.throws(() => verifyCloseoutRoot(f.paths(root), source), /Task\/Workspace/);
  rmSync(manifest);
  assert.doesNotThrow(() => verifyCloseoutRoot(f.paths(root), source));
});

test('上一归档分支存在未推送 Commit 时拒绝切组并保留现场', t => {
  const f = fixture(t);
  const root = f.prepare(f.source('change-a')).root_repo;
  writeFileSync(join(root, 'local.txt'), 'local\n');
  git(root, 'add', 'local.txt');
  git(root, 'commit', '-m', 'unpublished');
  const head = git(root, 'rev-parse', 'HEAD');
  assert.throws(() => f.prepare(f.source('change-a', 'main')), /未确认的本地 Commit/);
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
});

test('远端分叉时拒绝覆盖或 Reset 本地提交', t => {
  const f = fixture(t);
  const root = f.prepare(f.source('change-a')).root_repo;
  writeFileSync(join(root, 'local.txt'), 'local\n');
  git(root, 'add', 'local.txt');
  git(root, 'commit', '-m', 'local');
  const head = git(root, 'rev-parse', 'HEAD');
  git(f.bare, 'update-ref', 'refs/heads/dev', 'refs/heads/release');
  assert.throws(() => f.prepare(f.source('change-a')), /分叉/);
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
});

test('缺失 Change 或 Checkout 错误时保留平台目录，不尝试 Cleanup', t => {
  const f = fixture(t);
  assert.throws(() => f.prepare(f.source('missing-change')), /Change/);
  assert.equal(existsSync(f.lastRoot), true);
  assert.equal(f.checkoutCount, 1);
});

test('平台返回错误时不创建额外父目录', t => {
  const f = fixture(t, { checkoutThrows: true });
  assert.throws(() => f.prepare(f.source('change-a')), /platform checkout failed/);
  assert.equal(f.checkoutCount, 1);
  assert.equal(existsSync(join(process.cwd(), 'root')), false);
});

test('平台分支尾号、Task 身份和 isolated 证据缺失时拒绝', t => {
  const invalid = fixture(t, { checkoutSuffix: '000000000000' });
  assert.throws(() => invalid.prepare(invalid.source('change-a')), /尾号/);
});

test('Task/Workspace 与 manifest 身份必须回读一致', t => {
  const f = fixture(t);
  const source = f.source('change-a'), root = f.prepare(source).root_repo;
  process.env.MULTICA_TASK_ID = taskId.replace('f8f23e188c07', '111111111111');
  assert.throws(() => verifyCloseoutRoot(f.paths(root), source), /Task|Checkout/);
  process.env.MULTICA_TASK_ID = taskId;
  git(root, 'config', '--unset', 'multica.checkout-mode');
  assert.throws(() => verifyCloseoutRoot(f.paths(root), source), /isolated/);
  git(root, 'config', 'multica.checkout-mode', 'isolated');
  const manifest = join(root, '.git', 'multica-checkout.json');
  const identity = {
    checkout_branch: 'agent/pr-status-sync-agent/' + taskSuffix,
    task_id: taskId, workspace_id: workspaceId, checkout_mode: 'isolated',
  };
  writeFileSync(manifest, JSON.stringify(identity));
  assert.doesNotThrow(() => verifyCloseoutRoot(f.paths(root), source));
  assert.deepEqual(readPlatformCheckoutManifest(join(root, '.git')), identity);
  writeFileSync(manifest, JSON.stringify({ ...identity, task_id: 'another' }));
  assert.throws(() => verifyCloseoutRoot(f.paths(root), source), /Task\/Workspace/);
});

test('Origin/Push URL 和批准 Commit 错误时拒绝', t => {
  const f = fixture(t);
  const source = f.source('change-a'), root = f.prepare(source).root_repo;
  assert.throws(() => verifyCloseoutRoot(f.paths(root), { ...source, repo_url: 'http://tfs.test/tfs/C/P/_git/other' }), /Origin|Checkout/);
  assert.throws(() => verifyCloseoutRoot(f.paths(root), { ...source, commit: 'a'.repeat(40) }), /Commit/);
});

test('认证 Fetch 前必须拒绝不匹配的 Origin 与 Push URL', t => {
  const f = fixture(t);
  const source = f.source('change-a');
  const root = f.prepare(source).root_repo;
  const guard = () => { throw new Error('authenticated fetch must not be reached'); };

  git(root, 'remote', 'set-url', 'origin', 'http://tfs.test/tfs/C/P/_git/foreign');
  assert.throws(() => prepareRoot(source, { checkout: f.checkout, remote: guard }), /Origin\/Push/);
  git(root, 'remote', 'set-url', 'origin', repoUrl);

  git(root, 'remote', 'set-url', '--push', 'origin', 'http://tfs.test/tfs/C/P/_git/foreign');
  assert.throws(() => prepareRoot(source, { checkout: f.checkout, remote: guard }), /Origin\/Push/);
  assert.equal(git(root, 'rev-parse', '--abbrev-ref', 'HEAD'), 'rondo/closeout/' + taskSuffix + '/dev');
  assert.equal(f.checkoutCount, 1);
});

test('拒绝复用没有 Multica isolated 身份的用户目录', t => {
  const f = fixture(t);
  const root = join(process.cwd(), 'root');
  git(process.cwd(), 'clone', '--single-branch', '--branch', 'dev', f.bare, root);
  git(root, 'remote', 'set-url', 'origin', repoUrl);
  assert.throws(() => verifyCloseoutRoot(f.paths(root), f.source('change-a')), /isolated/);
});

test('Root 验证必须在当前 Task workdir 内运行', t => {
  const f = fixture(t);
  const source = f.source('change-a'), root = f.prepare(source).root_repo;
  process.chdir(dirname(f.bare));
  assert.throws(() => verifyCloseoutRoot(f.paths(root), source), /Task workdir/);
});

test('Inspect 仍拒绝与已批准 PR Preparation 分支不符的 PR', async t => {
  const f = fixture(t);
  const source = f.source('change-a'), root = f.prepare(source).root_repo;
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
