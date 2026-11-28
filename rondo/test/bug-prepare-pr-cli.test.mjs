import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const mock = fileURLToPath(new URL('./mock-multica.cjs', import.meta.url));
const repoUrl = 'http://tfs.test/tfs/C/P/_git/biz';
const rootUrl = 'http://tfs.test/tfs/C/P/_git/winning-platform-monorepo';

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

test('Bug pr prepare CLI (Native resumed checkout): stdin/file, Git identity, quality Gate and Metadata readback', t => {
  const native = true;
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rondo-bug-cli-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const taskRoot = join(dir, 'task');
  const workdir = join(taskRoot, 'workdir');
  const configRoot = join(taskRoot, 'multica-config');
  mkdirSync(workdir, { recursive: true });
  mkdirSync(configRoot, { recursive: true });
  const root = join(workdir, 'winning-platform-monorepo'), hub = join(workdir, 'biz'), remote = join(dir, 'remote.git');
  mkdirSync(root); mkdirSync(hub); mkdirSync(remote);
  git(root, 'init', '-b', 'main'); git(root, 'remote', 'add', 'origin', rootUrl);
  writeFileSync(join(root, 'AGENTS.md'), '规则\n');
  const taskId = native ? '01234567-abcd-ef12-3456-000000000000' : 'run';
  const taskBranch = 'agent/bug-fix-agent/abcdef123456';
  if (native) {
    git(root, 'config', 'multica.checkout-mode', 'isolated');
    git(root, 'branch', '-m', taskBranch);
  }
  git(root, 'add', 'AGENTS.md');
  git(root, '-c', 'user.name=test', '-c', 'user.email=test@example.test', 'commit', '-m', 'fixture');
  git(hub, 'init', '-b', 'feature/12'); git(hub, 'remote', 'add', 'origin', repoUrl);
  writeFileSync(join(hub, 'fix.txt'), '修复'); git(hub, 'add', 'fix.txt');
  git(hub, '-c', 'user.name=test', '-c', 'user.email=test@example.test', 'commit', '-m', 'fix', '-m', 'Refs: #12');
  if (native) {
    git(hub, 'config', 'multica.checkout-mode', 'isolated');
    git(hub, 'branch', '-m', taskBranch);
  }
  const sha = git(hub, 'rev-parse', 'HEAD');
  git(remote, 'init', '--bare'); git(hub, 'push', remote, 'HEAD:refs/heads/feature/12', 'HEAD:refs/heads/main');

  // 仅把远端传输转向本地 bare 仓；身份检查与 Git 命令仍执行真实代码。
  const transport = join(dir, 'git-transport.cjs');
  writeFileSync(transport, `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (['ls-remote','push','fetch'].includes(args[0])) { const i = args.indexOf(${JSON.stringify(repoUrl)}); if (i >= 0) args[i] = ${JSON.stringify(remote)}; }
const r = spawnSync('git', args, { stdio: 'inherit' });
process.exit(r.status ?? 1);
`, { mode: 0o755 });

  const resources = [
    { id: 'r', resource_type: 'github_repo', resource_ref: { url: rootUrl, ref: 'main' } },
    { id: 'biz', resource_type: 'github_repo', resource_ref: { url: repoUrl, ref: 'main' } },
    { id: 'sibling', resource_type: 'github_repo', resource_ref: { url: 'http://tfs.test/tfs/C/P/_git/sibling', ref: 'main' } },
  ];
  mkdirSync(join(workdir, '.multica', 'project'), { recursive: true });
  writeFileSync(join(workdir, '.multica', 'daemon_task_context.json'), JSON.stringify({ managed_by: 'multica-daemon-task', issue_id: 'i', agent_id: 'agent' }));
  writeFileSync(join(workdir, '.multica', 'project', 'resources.json'), JSON.stringify({ project_id: 'p', resources }));
  const initial = {
    issues: { 'I-1': { id: 'i', identifier: 'I-1', project_id: 'p', status: 'todo', assignee_id: 'agent', metadata: {
      'tfs.type': 'Bug', 'tfs.id': '12', 'tfs.url': 'http://tfs.test/tfs/C/P/_workitems?id=12',
    } } },
    agents_list: [{ name: 'Bug Fix Agent', id: 'agent' }], project_resources: resources,
    runs: { i: [{ id: taskId, issue_id: 'i', agent_id: 'agent', workspace_id: 'ws', status: 'running', work_dir: workdir }] },
  };
  const statePath = join(dir, 'state.json'), config = join(dir, 'config.json'), callsPath = join(dir, 'calls.jsonl');
  writeFileSync(statePath, JSON.stringify(initial));
  writeFileSync(config, JSON.stringify({ runtime: { multica_cli: mock, workspace_id: 'ws' }, registry: {
    biz: { repo_path: 'biz', repo_url: repoUrl, tfs_repo: 'biz', tfs_project: 'P', default_target_branch: 'main' },
  } }));
  const env = { ...process.env, MOCK_STATE: statePath, MOCK_SYNC_CALLS_FILE: callsPath,
    MULTICA_CLI_PATH: mock, MULTICA_SERVER_URL: 'http://multica.test', MULTICA_TASK_ID: taskId, MULTICA_TASK_CONFIG_ROOT: configRoot, MULTICA_AGENT_ID: 'agent', MULTICA_WORKSPACE_ID: 'ws', MULTICA_TOKEN: 'fixture', MULTICA_DAEMON_PORT: '1',
    TFS_SERVER_URL: 'http://tfs.test/tfs/C', TFS_PAT: 'fixture', RONDO_GIT_EXECUTABLE: transport };
  const evidence = {
    expected_behavior: '返回列表', actual_behavior: '空数据时失败', fix_summary: '处理空数据',
    root_cause: { confidence: 'confirmed', summary: '未处理空值', evidence_refs: ['run:fixture/diagnosis'] },
    regression: { result: 'PASS', summary: '故障回归通过', evidence_refs: ['run:fixture/regression'] },
    validation: { result: 'PASS', summary: '定向测试通过', evidence_refs: ['run:fixture/test'] },
    code_review: { result: 'PASS', summary: '修改范围已审查', evidence_refs: ['run:fixture/review'], findings: [] }, blockers: [], description:'修复空数据；已完成回归。',
  };
  const args = ['pr', 'prepare', '--repo', 'biz', '--candidate-commit', sha,
    '--title', '修复空数据', '--root-repo', root];
  const run = (input, extraEnv = {}, source = '-', extraArgs = []) => spawnSync(process.execPath, [cli, ...args, '--facts', source, ...extraArgs], {
    input, encoding: 'utf8', env: { ...env, ...extraEnv }, timeout: 30_000,
  });
  const result = (r, status) => {
    assert.equal(r.status, status, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.result, status === 0 ? 'PASS' : status === 2 ? 'FAIL' : 'UNKNOWN');
    return out;
  };
  const state = () => JSON.parse(readFileSync(statePath, 'utf8'));

  if (native) {
    const noTask = { ...env, MULTICA_TASK_ID: '', MULTICA_TASK_ENV_FILE: '' };
    const runGit = (operation, gitEnv) => spawnSync(process.execPath, [cli, 'repo', operation, '--issue', 'I-1', '--repo', 'biz', '--root-repo', root], { encoding: 'utf8', env: gitEnv, timeout: 30_000 });
    writeFileSync(callsPath, '');
    assert.equal(result(runGit('fetch', noTask), 0).head, sha);
    const fetchCalls = readFileSync(callsPath, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(!fetchCalls.some(call => call[0] === 'issue' && call[1] === 'runs'));
    assert.match(result(runGit('push', noTask), 3).reason, /Task\/Actor/);
    assert.equal(result(runGit('push', env), 0).head, sha);
    assert.match(result(run(JSON.stringify(evidence), { MULTICA_TASK_ID: '', MULTICA_TASK_ENV_FILE: '' }), 3).reason, /Task\/Actor/);
    assert.equal(git(hub, 'branch', '--show-current'), taskBranch);
  }
  for (const input of ['', '  ', '{', JSON.stringify({ ...evidence, candidate_commit: 'b'.repeat(40) }),
    JSON.stringify({ ...evidence, regression: { ...evidence.regression, result: 'FAIL' } }),
    JSON.stringify({ ...evidence, validation: { ...evidence.validation, evidence_refs: [] } })]) {
    result(run(input), 2);
    assert.deepEqual(state(), initial);
  }
  assert.match(result(run(JSON.stringify(evidence), { MULTICA_AGENT_ID: 'other' }), 3).reason, /daemon Task/);
  assert.deepEqual(state(), initial);
  result(run(undefined, {}, join(dir, 'missing.json')), 3);
  assert.deepEqual(state(), initial);

  const firstMulti = result(run(JSON.stringify(evidence), {}, '-', ['--required-repos','biz,sibling']), 0);
  assert.equal(firstMulti.ready_for_pr, false);
  assert.deepEqual(JSON.parse(state().issues['I-1'].metadata['bug.required_repos']), ['biz','sibling']);
  writeFileSync(statePath, JSON.stringify(initial));
  const failedWrite = result(run(JSON.stringify(evidence), { MOCK_FAIL_METADATA_KEY: 'pr' }), 3);
  assert.match(failedWrite.reason, /injected metadata set failure/);
  assert.deepEqual(JSON.parse(state().issues['I-1'].metadata['bug.required_repos']), ['biz']);
  assert.equal(state().issues['I-1'].metadata['pr'], undefined);
  writeFileSync(callsPath, '');
  const before = readdirSync(hub).sort();
  const commandEvidence = { ...evidence, validation: { summary: '定向测试范围', evidence_refs: evidence.validation.evidence_refs, command: [process.execPath, '-e', 'process.exit(0)'] } };
  const marker=join(dir,'validation-ran');
  const invalid={...commandEvidence,regression:{...evidence.regression,result:'FAIL'},
    validation:{...commandEvidence.validation,command:[process.execPath,'-e','require("fs").writeFileSync('+JSON.stringify(marker)+',"ran")']}};
  const beforeInvalid=state();
  result(run(JSON.stringify(invalid)),2);
  assert.deepEqual(state(),beforeInvalid);
  assert.ok(!readdirSync(dir).includes('validation-ran'));
  const failing={...commandEvidence,validation:{...commandEvidence.validation,command:[process.execPath,'-e','process.exit(9)']}};
  result(run(JSON.stringify(failing)),2);
  assert.equal(JSON.parse(state().issues['I-1'].metadata['pr'])[0].local_validation.result,'FAIL');
  assert.equal(JSON.parse(state().issues['I-1'].metadata['pr'])[0].local_validation.exit_code,9);
  result(run(JSON.stringify(evidence)),2);
  assert.equal(result(run(JSON.stringify(commandEvidence)), 0).ready_for_pr, true);
  assert.deepEqual(JSON.parse(state().issues['I-1'].metadata['pr'])[0].local_validation, {
    ...commandEvidence.validation, result: 'PASS', exit_code: 0, candidate_commit: sha, source: 'rondo pr prepare',
  });
  const preparedState=state();
  const multi=state();
  const multiMd=multi.issues['I-1'].metadata;
  const sibling={...JSON.parse(multiMd.pr)[0],repo_key:'sibling',repo_url:'http://tfs.test/tfs/C/P/_git/sibling'};
  multiMd['bug.required_repos']=JSON.stringify(['biz','sibling']);
  multiMd.pr=JSON.stringify([...JSON.parse(multiMd.pr),sibling]);
  writeFileSync(statePath,JSON.stringify(multi));
  result(run(JSON.stringify(failing)),2);
  const failedMd=state().issues['I-1'].metadata;
  assert.equal(JSON.parse(failedMd['pr']).find(x=>x.repo_key==='biz').local_validation.result,'FAIL');
  assert.deepEqual(JSON.parse(failedMd['pr']).find(x=>x.repo_key==='sibling'),sibling);
  assert.equal(failedMd['bug.required_repos'],multiMd['bug.required_repos']);
  result(run(JSON.stringify(evidence)),2);
  assert.equal(result(run(JSON.stringify(commandEvidence)),0).ready_for_pr,true);
  writeFileSync(statePath,JSON.stringify(preparedState));
  const completed = result(run(JSON.stringify(evidence)), 0);
  assert.equal(completed.ready_for_pr, true);
  const md = state().issues['I-1'].metadata;
  assert.deepEqual(JSON.parse(md['bug.required_repos']), ['biz']);
  const record=JSON.parse(md.pr)[0];
  assert.equal(record.repo_key,'biz');
  assert.equal(record.tfs_id,undefined);
  assert.equal(record.blockers,undefined);
  assert.equal(record.pr_id,undefined);
  assert.deepEqual(record.root_cause,evidence.root_cause);
  assert.deepEqual(record.regression,evidence.regression);
  assert.deepEqual(record.local_validation,evidence.validation);
  assert.deepEqual(record.code_review,{...evidence.code_review,candidate_commit:sha});
  assert.equal(JSON.parse(md.pr)[0].candidate_commit, sha);
  assert.equal(JSON.parse(md.pr)[0].repo_url, repoUrl);
  assert.equal(JSON.parse(md.pr)[0].target_branch, 'main');
  assert.equal(JSON.parse(md.pr)[0].description, evidence.description);
  assert.equal(md['analysis.change_kind'], undefined);
  const calls = readFileSync(callsPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(calls.every(a => !a.some(x => /attachment|upload/.test(x))));
  assert.deepEqual(readdirSync(hub).sort(), before);
  assert.equal(git(root, 'status', '--porcelain'), '');
  assert.equal(git(hub, 'status', '--porcelain'), '');

  // 验证 Skill 中的 Bash stdin 调用形态，不通过 Shell 拼接 JSON。
  if (process.platform !== 'win32') {
    const piped = spawnSync('bash', ['-c', 'printf "%s" "$evidence_json" | "$node_binary" "$rondo_entry" "$@"', 'rondo', ...args, '--facts', '-'], {
      encoding: 'utf8', timeout: 30_000, env: { ...env, evidence_json: JSON.stringify(evidence), node_binary: process.execPath, rondo_entry: cli },
    });
    result(piped, 0);
  }
  const file = dir + '-evidence.json';
  t.after(() => rmSync(file, { force: true }));
  writeFileSync(file, '\uFEFF' + JSON.stringify(evidence), 'utf8');
  result(run(undefined, {}, file), 0);
  assert.deepEqual(state().issues['I-1'].metadata, md);
});
