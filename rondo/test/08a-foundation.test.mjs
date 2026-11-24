import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, symlinkSync, existsSync, unlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareBusinessWorkspace, validatePrepareRepo } from '../dist/commands/dev/prepare-workspace.js';
import { validateNativeCheckout, platformCheckoutMode, platformTaskSuffix, assertPlatformCheckoutIdentity, readPlatformCheckoutManifest, nativeCheckoutExpected, readDaemonTaskContext } from '../dist/clients/native-checkout.js';
import { assertBugExecution, assertBugStart, assertBugSource } from '../dist/commands/bug/authorization.js';
import { ensureDeliverySummary } from '../dist/commands/delivery/summary.js';
import { deliveryCommentReference, readTfsHistory } from '../dist/commands/tfs/delivery-comment.js';
import { writebackParent } from '../dist/commands/tfs/writeback.js';
import { gitRuntime } from '../dist/clients/git.js';

const url = 'http://tfs.test/tfs/C/P/_git/biz';
const rootUrl = 'http://tfs.test/tfs/C/P/_git/winning-platform-monorepo';
const repo = { repo_path: 'biz', repo_url: url, tfs_repo: 'biz', tfs_project: 'P', default_target_branch: 'main' };
function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}
function fixture(t, { rootName = 'winning-platform-monorepo', rootOrigin = rootUrl } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rondo-08a-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, rootName), remote = join(dir, 'remote.git');
  mkdirSync(root); mkdirSync(remote); git(remote, 'init', '--bare');
  git(root, 'init', '-b', 'main');
  writeFileSync(join(root, '.gitignore'), 'biz/\n'); writeFileSync(join(root, 'AGENTS.md'), '规则');
  git(root, 'add', '.gitignore', 'AGENTS.md');
  git(root, '-c', 'user.name=test', '-c', 'user.email=test@example.test', 'commit', '-m', 'fixture');
  git(root, 'push', remote, 'main'); git(root, 'remote', 'add', 'origin', rootOrigin);
  // 只有传输适配为本地 bare fixture，clone / checkout / origin / 分支校验均运行真实 Git。
  const transport = (_url, args, cwd) => {
    const r = spawnSync('git', args.map(a => a === url ? remote : a), { cwd, encoding: 'utf8' });
    if (args[0] === 'clone' && r.status === 0) git(args.at(-1), 'remote', 'set-url', 'origin', url);
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  return { dir, root, remote, transport, rootOrigin };
}

test('首次 clone；dirty 与未 push Commit 重入逐字保留', t => {
  const f = fixture(t); const first = prepareBusinessWorkspace(f.root, repo, 12, f.transport);
  assert.equal(first.changed, true); assert.equal(first.branch, 'feat/12');
  writeFileSync(join(first.path, 'fix.txt'), '修复'); git(first.path, 'add', 'fix.txt');
  git(first.path, '-c', 'user.name=test', '-c', 'user.email=test@example.test', 'commit', '-m', 'fix');
  writeFileSync(join(first.path, 'fix.txt'), '保留未提交修改');
  const before = git(first.path, 'rev-parse', 'HEAD');
  const again = prepareBusinessWorkspace(f.root, repo, 12, () => { throw Error('不应 fetch'); });
  assert.equal(again.changed, false); assert.equal(again.head, before);
  assert.equal(readFileSync(join(first.path, 'fix.txt'), 'utf8'), '保留未提交修改');
  assert.throws(() => prepareBusinessWorkspace(f.root, repo, 13, f.transport), /分支/);
  git(first.path, 'remote', 'set-url', 'origin', url.replace('/biz', '/other'));
  assert.throws(() => prepareBusinessWorkspace(f.root, repo, 12, f.transport), /origin/);
});

test('跨 Task 从远端同 Bug 候选续接，不从目标分支重新开始', t => {
  const f = fixture(t); git(f.root, 'push', f.remote, 'HEAD:refs/heads/feat/12');
  const r = prepareBusinessWorkspace(f.root, repo, 12, f.transport);
  assert.equal(r.branch, 'feat/12'); assert.equal(r.head, git(f.root, 'rev-parse', 'HEAD'));
});

test('越界、junction、未忽略目录和不完整 clone 保留现场且拒绝', t => {
  const f = fixture(t);
  assert.throws(() => prepareBusinessWorkspace(f.root, { ...repo, repo_path: '../outside' }, 12, f.transport), /路径/);
  assert.throws(() => prepareBusinessWorkspace(f.root, { ...repo, repo_path: 'other' }, 12, f.transport), /忽略/);
  const outside = join(f.dir, 'outside'); mkdirSync(outside);
  symlinkSync(outside, join(f.root, 'biz'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => prepareBusinessWorkspace(f.root, repo, 12, f.transport), /链接/);
  unlinkSync(join(f.root, 'biz')); mkdirSync(join(f.root, 'biz'));
  writeFileSync(join(f.root, 'biz', 'partial'), 'keep');
  assert.throws(() => prepareBusinessWorkspace(f.root, repo, 12, f.transport), /完整独立/);
  assert.equal(readFileSync(join(f.root, 'biz', 'partial'), 'utf8'), 'keep');
});

test('clone 中断重试不删除现场或重复 clone', t => {
  const f = fixture(t); let clones = 0;
  const broken = (u, args, cwd) => {
    if (args[0] !== 'clone') return f.transport(u, args, cwd);
    clones++; mkdirSync(args.at(-1)); writeFileSync(join(args.at(-1), 'partial'), 'keep');
    return { status: 128, stdout: '', stderr: 'network' };
  };
  assert.throws(() => prepareBusinessWorkspace(f.root, repo, 12, broken), /clone/);
  assert.throws(() => prepareBusinessWorkspace(f.root, repo, 12, broken), /完整独立/);
  assert.equal(clones, 1);
});

test('Registry 必须匹配 Collection、Project、Repository，拒绝凭据 URL', () => {
  assert.equal(validatePrepareRepo(repo, 'http://tfs.test/tfs/C'), repo);
  for (const bad of [{ repo_url: undefined }, { repo_url: url.replace('/C/', '/Other/') }, { tfs_project: 'Other' }, { repo_url: url.replace('http://', 'http://secret@') }, { repo_path: 'NUL' }]) {
    assert.throws(() => validatePrepareRepo({ ...repo, ...bad }, 'http://tfs.test/tfs/C'));
  }
  assert.throws(() => gitRuntime({ RONDO_GIT_EXECUTABLE: 'relative/git' }), /绝对/);
});

test('根仓就绪检查不依赖 Task 身份，保留 dirty 与未推送 Commit', t => {
  const f = fixture(t); const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  for (const key of Object.keys(process.env).filter(k => k.startsWith('MULTICA_'))) delete process.env[key];
  writeFileSync(join(f.root, 'local.txt'), '未推送提交'); git(f.root, 'add', 'local.txt');
  git(f.root, '-c', 'user.name=test', '-c', 'user.email=test@example.test', 'commit', '-m', 'local');
  const head = git(f.root, 'rev-parse', 'HEAD');
  assert.notEqual(head, git(f.remote, 'rev-parse', 'main'));
  writeFileSync(join(f.root, 'AGENTS.md'), '保留根仓修改');
  const status = git(f.root, 'status', '--porcelain');
  assert.deepEqual(validateNativeCheckout(f.root), { rootRepo: git(f.root, 'rev-parse', '--show-toplevel') });
  assert.equal(readFileSync(join(f.root, 'AGENTS.md'), 'utf8'), '保留根仓修改');
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(f.root, 'status', '--porcelain'), status);
});

test('根仓就绪检查支持自定义目录布局和 linked worktree', t => {
  const f = fixture(t, { rootName: 'platform-foundation' });
  const nestedParent = join(f.dir, 'nested'); mkdirSync(nestedParent);
  const worktree = join(nestedParent, 'review-checkout');
  git(f.root, 'worktree', 'add', '--detach', worktree, 'HEAD');
  assert.ok(readFileSync(join(worktree, '.git'), 'utf8').startsWith('gitdir:'));
  assert.equal(validateNativeCheckout(worktree).rootRepo, git(worktree, 'rev-parse', '--show-toplevel'));
  assert.equal(readFileSync(join(worktree, 'AGENTS.md'), 'utf8'), '规则');
});

test('平台 checkout 形态：isolated 标记、任务分支尾号与 manifest 身份交叉验证', t => {
  const f = fixture(t);
  git(f.root, 'config', 'multica.checkout-mode', 'isolated');
  assert.equal(platformCheckoutMode(f.root), 'isolated');
  const taskId = '01a1d2fc-da3a-796b-9584-f8f23e188c07';
  const identity = {
    checkout_branch: 'agent/pr-status-sync-agent/' + platformTaskSuffix(taskId),
    task_id: taskId,
    workspace_id: 'ws',
    checkout_mode: 'isolated',
  };
  // 当前 Run 与平台 checkout 证据必须逐项一致。
  assert.doesNotThrow(() => assertPlatformCheckoutIdentity(identity, { mode: 'isolated', taskId, workspaceId: 'ws' }));
  assert.throws(() => assertPlatformCheckoutIdentity(
    { ...identity, checkout_branch: 'agent/pr-status-sync-agent/000000000000' },
    { mode: 'isolated', taskId, workspaceId: 'ws' }), /尾号/);
  // 平台为同一 Task 的多个 checkout 追加时间戳时仍接受。
  assert.doesNotThrow(() => assertPlatformCheckoutIdentity(
    { ...identity, checkout_branch: identity.checkout_branch + '-1795419784' },
    { mode: 'isolated', taskId, workspaceId: 'ws' }));
  // 非纯数字后缀不冒充同一 Task。
  assert.throws(() => assertPlatformCheckoutIdentity(
    { ...identity, checkout_branch: identity.checkout_branch + '-evil' },
    { mode: 'isolated', taskId, workspaceId: 'ws' }), /尾号/);
  assert.throws(() => assertPlatformCheckoutIdentity(identity, { mode: 'shared', taskId, workspaceId: 'ws' }), /isolated/);
  assert.throws(() => assertPlatformCheckoutIdentity(identity, { mode: 'isolated', taskId, workspaceId: 'other' }), /Task\/Workspace/);
  // 强方案接口：manifest 存在时字段可读且完整；不可识别必须 fail closed。
  const manifest = join(f.root, '.git', 'multica-checkout.json');
  writeFileSync(manifest, JSON.stringify({ checkout_mode: 'isolated', task_id: taskId, workspace_id: 'ws', branch: identity.checkout_branch }));
  assert.deepEqual(readPlatformCheckoutManifest(join(f.root, '.git')), identity);
  writeFileSync(manifest, JSON.stringify({ checkout_mode: 'isolated' }));
  assert.throws(() => readPlatformCheckoutManifest(join(f.root, '.git')), /缺少身份字段/);
  writeFileSync(manifest, 'not-json');
  assert.throws(() => readPlatformCheckoutManifest(join(f.root, '.git')), /合法 JSON/);
});

test('linked worktree 的存储路径不作为 Native 身份，读取 daemon Task 上下文', t => {
  const f = fixture(t);
  const reposDir = join(f.dir, '.repos', 'ws');
  mkdirSync(reposDir, { recursive: true });
  const cache = join(reposDir, 'winning-platform-cache.git');
  git(f.dir, 'clone', '--bare', f.remote, cache);
  const worktree = join(f.dir, 'workdir', 'rondo-closeout-x', 'winning-platform-monorepo');
  mkdirSync(dirname(worktree), { recursive: true });
  git(cache, 'worktree', 'add', '--detach', worktree, 'main');
  assert.ok(readFileSync(join(worktree, '.git'), 'utf8').startsWith('gitdir:'));
  // cache 目录本身不证明 Native Checkout；没有 Task Branch 或上下文时不认定。
  assert.equal(nativeCheckoutExpected(worktree), false);
  // 任务上下文由 daemon 写入；缺失返回 null，由调用方拒绝。
  const workdir = join(f.dir, 'workdir');
  mkdirSync(join(workdir, '.multica'), { recursive: true });
  writeFileSync(join(workdir, '.multica', 'daemon_task_context.json'), JSON.stringify({
    managed_by: 'multica-daemon-task', issue_id: 'issue-1', agent_id: 'agent-1',
  }));
  assert.deepEqual(readDaemonTaskContext(workdir), {
    managed_by: 'multica-daemon-task', issue_id: 'issue-1', agent_id: 'agent-1',
  });
  rmSync(join(workdir, '.multica', 'daemon_task_context.json'));
  assert.equal(readDaemonTaskContext(workdir), null);
});

test('根仓就绪检查拒绝相对路径、仓内目录、缺失规范和不完整检出', t => {
  const f = fixture(t);
  assert.throws(() => validateNativeCheckout('relative'), /绝对路径/);
  const nested = join(f.root, 'nested'); mkdirSync(nested);
  assert.throws(() => validateNativeCheckout(nested), /Git 根仓/);
  unlinkSync(join(f.root, 'AGENTS.md'));
  assert.throws(() => validateNativeCheckout(f.root), /规范/);
  mkdirSync(join(f.root, 'AGENTS.md'));
  assert.throws(() => validateNativeCheckout(f.root), /规范/);
  renameSync(join(f.root, '.git'), join(f.root, 'saved-git'));
  writeFileSync(join(f.root, 'partial'), '保留未完成检出');
  assert.throws(() => validateNativeCheckout(f.root), /Git 仓/);
  assert.equal(readFileSync(join(f.root, 'partial'), 'utf8'), '保留未完成检出');
  assert.equal(existsSync(join(f.root, '.git')), false);
});

test('check-checkout CLI 只消费实际根仓路径，无需平台配置或 Agent 环境', t => {
  const f = fixture(t); const env = { ...process.env };
  for (const key of Object.keys(env).filter(k => k.startsWith('MULTICA_'))) delete env[key];
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url)),
    'runtime', 'check-checkout', '--root-repo', f.root], { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { result: 'PASS', rootRepo: git(f.root, 'rev-parse', '--show-toplevel'), changed: false });
});

test('Bug 写操作在业务边界校验执行者，拒绝错 Actor、跨 Issue/Workspace 和已结束 Run', t => {
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  Object.assign(process.env, { MULTICA_TASK_ID: 'run', MULTICA_AGENT_ID: 'agent', MULTICA_WORKSPACE_ID: 'ws', MULTICA_TOKEN: 'fixture', MULTICA_DAEMON_PORT: '1' });
  const issue = { id: 'issue', assignee_id: 'agent' };
  const run = { id: 'run', issue_id: 'issue', agent_id: 'agent', workspace_id: 'ws', status: 'running' };
  let runs = [run];
  const client = { ws: () => ['--workspace-id', 'ws'], run: args => {
    assert.deepEqual(args, ['issue', 'runs', 'issue', '--active', '--workspace-id', 'ws', '--output', 'json']);
    return runs;
  } };
  assert.doesNotThrow(() => assertBugExecution(client, issue));
  for (const changed of [{ agent_id: 'other' }, { issue_id: 'other' }, { workspace_id: 'other' }]) {
    runs = [{ ...run, ...changed }];
    assert.throws(() => assertBugExecution(client, issue), /绑定不一致/);
  }
  runs = [{ ...run, status: 'completed' }];
  assert.throws(() => assertBugExecution(client, issue), /未运行/);
  runs = [run];
  assert.throws(() => assertBugExecution(client, { ...issue, assignee_id: 'other' }), /绑定不一致/);
  runs = [];
  assert.throws(() => assertBugExecution(client, issue), /有效 Run/);
  delete process.env.MULTICA_TASK_ID;
  assert.throws(() => assertBugExecution(client, issue), /上下文/);
});

test('Bug 开工不要求 Evidence；已固定 Scope 和错误指派不放行', () => {
  const client = { ws: () => [], run: () => [{ name: 'Bug Fix Agent', id: 'agent' }] };
  const issue = { id: 'i', assignee_id: 'agent', status: 'todo', metadata: { 'tfs.type': 'Bug', 'tfs.id': '12' } };
  assert.equal(assertBugStart(client, issue, 'biz'), 12);
  assert.equal(issue.metadata['bug.required_repos'], undefined);
  issue.metadata['bug.required_repos'] = '["other"]'; assert.throws(() => assertBugStart(client, issue, 'biz'), /Scope/);
  issue.metadata['tfs.type'] = '需求'; assert.throws(() => assertBugStart(client, issue, 'biz'), /08-B/);
});

test('Bug 来源 URL 必须绑定工作项与 Collection', async () => {
  const issue = { metadata: { 'tfs.id': '12', 'tfs.url': 'http://tfs.test/tfs/C/P/_workitems?id=12&_a=edit' } };
  await assertBugSource(issue, 'http://tfs.test/tfs/C');
  issue.metadata['tfs.url'] = 'http://tfs.test/tfs/C/_apis/wit/workitems/12'; await assertBugSource(issue, 'http://tfs.test/tfs/C');
  issue.metadata['tfs.url'] = 'http://tfs.test/tfs/Other/P/_workitems?id=12'; await assert.rejects(() => assertBugSource(issue, 'http://tfs.test/tfs/C'));
  issue.metadata['tfs.url'] = 'http://tfs.test/tfs/C/P/_workitems?id=13'; await assert.rejects(() => assertBugSource(issue, 'http://tfs.test/tfs/C'));
});

test('TFS 2018 旧版来源只从配置 Collection 回读，拒绝错 pcguid 与不可读事实', async () => {
  const source = 'http://tfs.test/tfs/web/wi.aspx?pcguid=collection-guid&id=12';
  const issue = { metadata: { 'tfs.id': '12', 'tfs.url': source } };
  const item = { id: 12, fields: { 'System.WorkItemType': 'Bug' }, _links: { html: { href: source } } };
  const client = { rawRequest: async (url, method) => {
    assert.equal(url, 'http://tfs.test/tfs/C/_apis/wit/workitems/12?api-version=4.1');
    assert.equal(method, 'GET');
    return { statusCode: 200, body: JSON.stringify(item) };
  } };
  await assertBugSource(issue, 'http://tfs.test/tfs/C', client);
  issue.metadata['tfs.url'] = source.replace('collection-guid', 'wrong');
  await assert.rejects(() => assertBugSource(issue, 'http://tfs.test/tfs/C', client), /权威身份/);
  await assert.rejects(() => assertBugSource(issue, 'http://tfs.test/tfs/C', { rawRequest: async () => ({ statusCode: 503 }) }), /无法回读/);
});

test('真实 prepare CLI 使用平台 fixture 与独立 Git 仓，拒绝缺 Task / 错 Actor，零事实写入', t => {
  const f = fixture(t); prepareBusinessWorkspace(f.root, repo, 12, f.transport);
  mkdirSync(join(f.dir, '.multica', 'project'), { recursive: true });
  const resource = { id: 'r', resource_type: 'github_repo', resource_ref: { url: rootUrl, ref: 'main' } };
  writeFileSync(join(f.dir, '.multica', 'daemon_task_context.json'), JSON.stringify({ managed_by: 'multica-daemon-task', issue_id: 'i', agent_id: 'agent' }));
  writeFileSync(join(f.dir, '.multica', 'project', 'resources.json'), JSON.stringify({ project_id: 'p', resources: [resource] }));
  const state = { issues: { 'I-1': { id: 'i', identifier: 'I-1', project_id: 'p', status: 'todo', assignee_id: 'agent', metadata: {
    'tfs.type': 'Bug', 'tfs.id': '12', 'tfs.url': 'http://tfs.test/tfs/C/P/_workitems?id=12' } } },
    agents_list: [{ name: 'Bug Fix Agent', id: 'agent' }], project_resources: [resource],
    runs: { i: [{ id: 'run', issue_id: 'i', agent_id: 'agent', workspace_id: 'ws', status: 'running', work_dir: f.dir }] } };
  const statePath = join(f.dir, 'state.json'), config = join(f.dir, 'config.json');
  writeFileSync(statePath, JSON.stringify(state));
  writeFileSync(config, JSON.stringify({ runtime: { multica_cli: fileURLToPath(new URL('./mock-multica.cjs', import.meta.url)), workspace_id: 'ws' }, registry: { biz: repo } }));
  const env = { ...process.env, MOCK_STATE: statePath, MULTICA_TASK_ID: 'run', MULTICA_AGENT_ID: 'agent', MULTICA_WORKSPACE_ID: 'ws',
    MULTICA_TOKEN: 'fixture', MULTICA_DAEMON_PORT: '1', TFS_SERVER_URL: 'http://tfs.test/tfs/C', TFS_PAT: 'fixture' };
  const run = extra => spawnSync(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url)), 'dev', 'prepare', '--config', config,
    '--issue', 'I-1', '--repo', 'biz', '--root-repo', f.root], { encoding: 'utf8', env: { ...env, ...extra } });
  const result = run({}); assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(JSON.parse(result.stdout).changed, false);
  const missing = run({ MULTICA_TASK_ID: '' }); assert.equal(missing.status, 3, missing.stdout + missing.stderr);
  const wrong = run({ MULTICA_AGENT_ID: 'other' }); assert.equal(wrong.status, 2, wrong.stdout + wrong.stderr);
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')), state);
});

test('摘要发布后 ID 保存失败：重入直接复用，不补 ID；查询失败不发布', () => {
  const comments = []; let writes = 0, saves = 0;
  const client = { listComments: () => comments, addCommentContent: (_id, content) => { writes++; comments.push({ content }); return 'c'; },
    setMetadata: () => { saves++; throw Error('标记保存失败'); } };
  assert.throws(() => ensureDeliverySummary(client, 'i', '本次摘要\nPR: 1'), /保存失败/);
  assert.equal(ensureDeliverySummary(client, 'i', 'PR: 1\r\n本次摘要').status, 'skipped');
  assert.equal(writes, 1); assert.equal(saves, 1);
  client.listComments = () => { throw Error('查询失败'); };
  assert.throws(() => ensureDeliverySummary(client, 'i', '本次摘要'), /查询失败/); assert.equal(writes, 1);
});

test('旧交付摘要不能冒充本次；ID 缺失的当前摘要直接复用', () => {
  const comments = [{ id: 'old', content: '摘要 PR: 1' }]; let writes = 0;
  const client = { listComments: () => comments, addCommentContent: (_id, content) => { writes++; comments.push({ content }); return 'new'; }, setMetadata: () => {} };
  assert.equal(ensureDeliverySummary(client, 'i', '摘要 PR: 2').status, 'done');
  assert.equal(ensureDeliverySummary(client, 'i', '摘要 PR: 2').status, 'skipped'); assert.equal(writes, 1);
  comments.push({ id: 'incomplete' }); assert.throws(() => ensureDeliverySummary(client, 'i', '摘要 PR: 2'), /完整/);
});

for (const type of ['Bug', '需求']) test(`${type} 评论成功但完成标记失败，换客户端恢复只补标记`, async () => {
  const issue = { id: 'i', metadata: { 'tfs.id': '12', 'tfs.type': type, ...(type === 'Bug' ? { 'bug.delivery': '[]' } : { 'analysis.change_ref': 'c' }),
    current_pr: JSON.stringify([{ repo_key: 'biz', pr_id: 1, pr_url: url + '/pullrequest/1' }]) } };
  const history = []; let writes = 0, saved = 0;
  const client = { tfsQuery: async () => [{ state: '已解决' }], tfsSetState: async () => ({}),
    tfsComment: async (_id, file) => { writes++; history.push(readFileSync(file, 'utf8')); },
    setMetadata: () => { throw Error('保存前中断'); } };
  await assert.rejects(writebackParent(client, issue, 'I-1', issue.metadata, 12, async () => history), /中断/);
  await writebackParent({ ...client, setMetadata: () => saved++ }, issue, 'I-1', issue.metadata, 12, async () => history);
  assert.equal(writes, 1); assert.equal(saved, 1); assert.ok(history[0].includes(deliveryCommentReference(issue)));
  await assert.rejects(writebackParent(client, issue, 'I-1', issue.metadata, 12, async () => { throw Error('查询失败'); }), /查询失败/);
  assert.equal(writes, 1);
});

test('TFS History 读取全部分页，拒绝截断、查询失败与 revision 漂移', async () => {
  const updates = Array.from({ length: 201 }, (_, i) => ({ id: i + 1, workItemId: 12, rev: i === 1 ? 1 : i + 1, fields: i === 0 ? { 'System.History': { newValue: 'old' } } : {} }));
  let mode = 'ok'; const client = { config: { serverUrl: 'http://fixture' }, rawRequest: async raw => {
    const u = new URL(raw); const skip = Number(u.searchParams.get('$skip'));
    const value = updates.slice(skip, skip + 200);
    return { statusCode: mode === 'error' ? 500 : 200, body: JSON.stringify(u.pathname.endsWith('/updates')
      ? { count: value.length, value: mode === 'truncated' ? [] : value }
      : { id: 12, rev: mode === 'drift' ? 202 : 201 }) };
  } };
  assert.deepEqual(await readTfsHistory(12, client), ['old']);
  for (mode of ['error', 'truncated', 'drift']) await assert.rejects(readTfsHistory(12, client));
});
