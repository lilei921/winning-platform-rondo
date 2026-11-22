import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, appendFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { cloneCloseoutRoot, cleanupCloseoutRoot, verifyCloseoutRoot, confirmPublishedArchive, assertCloseoutChange } from '../dist/commands/delivery/closeout-root.js';
import { approvedTasksAtCommit, inspectRequirementCommits } from '../dist/commands/tfs/requirement-commits.js';
import { prChangedCommits } from '../dist/tfs/api/commit-facts.js';

const repoUrl = 'http://tfs.test/tfs/C/P/_git/root';

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function fixture(t) {
  const previousCwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), 'rondo-closeout-fixture-'));
  const taskWorkdir = join(dir, 'task-workdir');
  mkdirSync(taskWorkdir);
  t.after(() => {
    process.chdir(previousCwd);
    rmSync(dir, { recursive: true, force: true });
  });
  process.chdir(taskWorkdir);
  const work = join(dir, 'work');
  const bare = join(dir, 'bare.git');
  mkdirSync(work);
  git(work, 'init', '-b', 'dev');
  git(work, 'config', 'user.name', 'Rondo Test');
  git(work, 'config', 'user.email', 'test@example.invalid');
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

  let cloneCalls = 0;
  const remote = (url, args, cwd) => {
    assert.equal(url, repoUrl);
    const rewritten = [...args];
    if (rewritten.includes('clone')) {
      cloneCalls++;
      rewritten[rewritten.indexOf(url)] = bare;
    } else if (rewritten[0] === 'fetch') {
      rewritten[1] = bare;
    } else {
      throw new Error('unexpected authenticated operation ' + args.join(' '));
    }
    const r = spawnSync('git', rewritten, { cwd, encoding: 'utf8' });
    if (r.status === 0 && args.includes('clone')) git(cwd, 'remote', 'set-url', 'origin', url);
    return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
  };
  const source = (ref, branch = 'dev') => ({
    repo_url: repoUrl, branch, commit: branch === 'dev' ? approved : releaseApproved, change_ref: ref,
  });
  const paths = root => ({
    rootRepo: root, openspecRoot: join(root, 'openspec'), projectId: '', daemonId: null, source: 'explicit_arg',
  });
  return { bare, source, paths, remote, get cloneCalls() { return cloneCalls; } };
}

test('three Issues in one Repository+Branch share one Clone and publish separate archives', t => {
  const f = fixture(t);
  const first = f.source('change-a');
  const { root_repo: root, cleanup_token: token } = cloneCloseoutRoot(first, f.remote);
  assert.equal(realpathSync(dirname(root)), realpathSync(process.cwd()));
  const owner = JSON.parse(readFileSync(join(root, '.git', 'rondo-closeout-owner.json'), 'utf8'));
  assert.equal(owner.workdir, realpathSync(process.cwd()));
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
  assert.equal(f.cloneCalls, 1);
  assert.deepEqual(cleanupCloseoutRoot(root, token, f.remote), { removed: true });
  assert.equal(existsSync(root), false);
});

test('approved tasks are read from the immutable analysis.source.commit and each Issue checks its Change', t => {
  const f = fixture(t);
  const source = f.source('change-a');
  const { root_repo: root, cleanup_token: token } = cloneCloseoutRoot(source, f.remote);
  const original = approvedTasksAtCommit(root, source.commit, 'change-a');
  assert.match(original, /\[ \] 1\.1 Implement change-a/);
  writeFileSync(join(root, 'openspec', 'changes', 'change-a', 'tasks.md'), '- [x] 1.1 Implement change-a\\n');
  assert.equal(approvedTasksAtCommit(root, source.commit, 'change-a'), original);
  assert.doesNotThrow(() => assertCloseoutChange(f.paths(root), f.source('change-b')));
  assert.throws(() => assertCloseoutChange(f.paths(root), f.source('not-on-branch')), /不存在/);
  git(root, 'restore', '.');
  assert.deepEqual(cleanupCloseoutRoot(root, token, f.remote), { removed: true });
});

test('missing Change fails clone and safely releases its clean temporary checkout', t => {
  const f = fixture(t);
  assert.throws(() => cloneCloseoutRoot(f.source('missing-change'), f.remote), /Change/);
});

test('same Repository on different Branch requires a separate Clone and rejects cross-branch reuse', t => {
  const f = fixture(t);
  const dev = cloneCloseoutRoot(f.source('change-a'), f.remote);
  const release = cloneCloseoutRoot(f.source('release-change', 'release'), f.remote);
  assert.notEqual(dev.root_repo, release.root_repo);
  assert.equal(f.cloneCalls, 2);
  assert.throws(() => verifyCloseoutRoot(f.paths(dev.root_repo), f.source('release-change', 'release')), /分支/);
  assert.deepEqual(cleanupCloseoutRoot(dev.root_repo, dev.cleanup_token, f.remote), { removed: true });
  assert.deepEqual(cleanupCloseoutRoot(release.root_repo, release.cleanup_token, f.remote), { removed: true });
});

test('Git-reported root path works for Verify and Cleanup on Windows', t => {
  const f = fixture(t);
  const source = f.source('change-a');
  const { root_repo: root, cleanup_token: token } = cloneCloseoutRoot(source, f.remote);
  const gitRoot = git(root, 'rev-parse', '--show-toplevel');
  assert.equal(verifyCloseoutRoot(f.paths(gitRoot), source).gitRemoteUrl, repoUrl);
  assert.deepEqual(cleanupCloseoutRoot(gitRoot, token, f.remote), { removed: true });
  assert.equal(existsSync(root), false);
});

test('cleanup uses recorded workdir after caller changes cwd', t => {
  const f = fixture(t);
  const { root_repo: root, cleanup_token: token } = cloneCloseoutRoot(f.source('change-a'), f.remote);
  process.chdir(dirname(f.bare));
  assert.notEqual(process.cwd(), dirname(root));
  assert.deepEqual(cleanupCloseoutRoot(root, token, f.remote), { removed: true });
  assert.equal(existsSync(root), false);
});

test('cleanup rejects Clone whose recorded workdir no longer matches its parent', t => {
  const f = fixture(t);
  const { root_repo: root, cleanup_token: token } = cloneCloseoutRoot(f.source('change-a'), f.remote);
  const marker = join(root, '.git', 'rondo-closeout-owner.json');
  const original = readFileSync(marker, 'utf8');
  writeFileSync(marker, JSON.stringify({ ...JSON.parse(original), workdir: dirname(f.bare) }));
  assert.throws(() => verifyCloseoutRoot(f.paths(root), f.source('change-a')), /workdir/);
  assert.throws(() => cleanupCloseoutRoot(root, token, f.remote), /workdir/);
  assert.equal(existsSync(root), true);
  writeFileSync(marker, original);
  assert.deepEqual(cleanupCloseoutRoot(root, token, f.remote), { removed: true });
});

test('cleanup preserves dirty tree, incorrect token and unpushed commits', t => {
  const f = fixture(t);
  const { root_repo: root, cleanup_token: token } = cloneCloseoutRoot(f.source('change-a'), f.remote);
  assert.throws(() => cleanupCloseoutRoot(root, 'wrong-token', f.remote), /token/);
  appendFileSync(join(root, 'openspec', 'changes', 'change-a', 'tasks.md'), 'work in progress\n');
  assert.throws(() => cleanupCloseoutRoot(root, token, f.remote), /未提交/);
  assert.equal(existsSync(root), true);
  git(root, 'restore', '.');
  git(root, 'config', 'user.name', 'Rondo Test');
  git(root, 'config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'new-file.md'), 'unpublished\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'unpushed');
  assert.throws(() => cleanupCloseoutRoot(root, token, f.remote), /未 Push/);
  assert.equal(existsSync(root), true);
  git(root, 'push', f.bare, 'dev');
  assert.deepEqual(cleanupCloseoutRoot(root, token, f.remote), { removed: true });
});

test('ignored files and another group remain untouched on unsafe cleanup', t => {
  const f = fixture(t);
  const first = cloneCloseoutRoot(f.source('change-a'), f.remote);
  const other = cloneCloseoutRoot(f.source('release-change', 'release'), f.remote);
  appendFileSync(join(first.root_repo, '.git', 'info', 'exclude'), '\nignored-temp.txt\n');
  writeFileSync(join(first.root_repo, 'ignored-temp.txt'), 'must preserve');
  assert.throws(() => cleanupCloseoutRoot(first.root_repo, first.cleanup_token, f.remote), /忽略/);
  assert.equal(existsSync(first.root_repo), true);
  assert.equal(existsSync(other.root_repo), true);
  assert.deepEqual(cleanupCloseoutRoot(other.root_repo, other.cleanup_token, f.remote), { removed: true });
  rmSync(join(first.root_repo, 'ignored-temp.txt'));
  assert.deepEqual(cleanupCloseoutRoot(first.root_repo, first.cleanup_token, f.remote), { removed: true });
});

test('cleanup preserves additional local Git refs even with a clean working tree', t => {
  const f = fixture(t);
  const { root_repo: root, cleanup_token: token } = cloneCloseoutRoot(f.source('change-a'), f.remote);
  git(root, 'branch', 'offline-work');
  assert.throws(() => cleanupCloseoutRoot(root, token, f.remote), /Branch\/Tag\/Stash/);
  assert.equal(existsSync(root), true);
  git(root, 'branch', '-D', 'offline-work');
  assert.deepEqual(cleanupCloseoutRoot(root, token, f.remote), { removed: true });
});

test('wrong origin or unavailable approved commit rejects a shared root', t => {
  const f = fixture(t);
  const { root_repo: root, cleanup_token: token } = cloneCloseoutRoot(f.source('change-a'), f.remote);
  assert.throws(() => verifyCloseoutRoot(f.paths(root), { ...f.source('change-a'), repo_url: 'http://tfs.test/tfs/C/P/_git/other' }), /Origin/);
  assert.throws(() => verifyCloseoutRoot(f.paths(root), { ...f.source('change-a'), commit: 'a'.repeat(40) }), /批准 Commit/);
  assert.deepEqual(cleanupCloseoutRoot(root, token, f.remote), { removed: true });
});

test('Requirement refuses an unmanaged checkout even if origin and branch match', t => {
  const f = fixture(t);
  const root = mkdtempSync(join(tmpdir(), 'rondo-unmanaged-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'clone', '--single-branch', '--branch', 'dev', f.bare, '.');
  git(root, 'remote', 'set-url', 'origin', repoUrl);
  assert.throws(() => verifyCloseoutRoot(f.paths(root), f.source('change-a')), /受控临时 Clone/);
});

test('early clone failure releases its empty temporary directory', t => {
  const f = fixture(t);
  let root;
  assert.throws(() => cloneCloseoutRoot(f.source('change-a'), (_url, _args, cwd) => {
    root = cwd;
    return { status: 1, stdout: '', stderr: 'clone failed' };
  }), /已安全清理临时 Clone/);
  assert.equal(existsSync(root), false);
});

test('Inspect rejects a PR whose repository branch disagrees with approved preparation', async t => {
  const f = fixture(t);
  const source = f.source('change-a');
  const { root_repo: root, cleanup_token: token } = cloneCloseoutRoot(source, f.remote);
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
  assert.deepEqual(cleanupCloseoutRoot(root, token, f.remote), { removed: true });
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
