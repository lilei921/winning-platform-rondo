import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tomllib
from datetime import datetime

HERE = Path(__file__).resolve().parent
WORK = HERE.parent
OUT = HERE / 'M02-independent-evidence.json'
GIT = Path(r'C:\Users\lilei\.multica\tools\mingit-busybox-2.54.0\cmd\git.exe')
BIN = GIT.parent.parent / 'mingw64' / 'bin'
ROOT = WORK / 'winning-platform-monorepo'
URL = 'http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_git/winning-platform-monorepo'
ISSUE = '01a1d329-8ea9-79bd-acd2-9a8fd2693811'
EXPECTED_HASH = 'ab90c8f11cb814b8915f07d4ad2a0b910f5ba82a8aec9a575eb393c0ec29cc32'
PS = r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
PHASE = sys.argv[1]

def now():
    return datetime.now().astimezone().isoformat()

def protect(text):
    token = os.environ.get('MULTICA_TOKEN')
    if token:
        text = text.replace(token, '[REDACTED_TOKEN]')
    port = os.environ.get('MULTICA_DAEMON_PORT')
    if port:
        text = re.sub(r'(?<![A-Za-z0-9])' + re.escape(port) + r'(?![A-Za-z0-9])', '[REDACTED_PORT]', text)
    return re.sub(r'(https?://)[^/\s@]+@', r'\1[REDACTED_USERINFO]@', text)

E = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {
    'schema_version': 1, 'issue_id': ISSUE, 'issue_identifier': 'TEST-8',
    'started_at': now(), 'workdir': str(WORK), 'commands': [], 'observations': [],
    'assertions': [], 'phases': {}, 'overall_status': 'NOT_RUN',
    'rondo_dev_prepare': 'NOT_RUN',
    'limitations': ['TEST-7 was neither read nor modified; controller owns cross-task before/after comparison.',
                    'No production commits, pushes, PRs, work items, issue metadata, credentials, daemon, agent or skill settings changed.'],
    'bootstrap_failures': [{
        'source': 'exec_command tool response d9a8de', 'cwd': str(WORK),
        'argv': ['&', './validation-evidence/validate-m02.ps1', '-Phase', 'preflight'],
        'exit_code': 1, 'error_category': 'PowerShell.PSSecurityException.UnauthorizedAccess',
        'output': 'AuthorizationManager check failed before script body ran.',
        'wall_time_seconds': 0.3562771,
        'timestamp': None, 'timestamp_note': 'Tool returned duration but no absolute command timestamp.',
        'retained_state': 'Root checkout and fixture had not been created; script retained. No policy changes.'}],
}

def save():
    OUT.write_text(protect(json.dumps(E, ensure_ascii=False, indent=2)), encoding='utf-8')

def observe(name, data, argv):
    E['observations'].append(dict(name=name, at=now(), cwd=str(WORK), argv=argv, exit_code=0, data=data))
    save()

def fact(name, passed, actual, prerequisite=False):
    E['assertions'].append(dict(name=name, status='PASS' if passed else 'FAIL', actual=actual, at=now()))
    save()
    if not passed:
        raise MissingPrerequisite(name) if prerequisite else AssertionError(name)

class MissingPrerequisite(Exception):
    pass

class CommandFailed(Exception):
    pass

def run(label, executable, argv, cwd=WORK, env=None, environment_note=None, selector=None):
    start = now()
    try:
        p = subprocess.run([str(executable), *map(str, argv)], cwd=cwd, env=env,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           creationflags=subprocess.CREATE_NO_WINDOW)
        code = p.returncode
        stdout = p.stdout.decode('utf-8', errors='replace')
        stderr = p.stderr.decode('utf-8', errors='replace')
    except OSError as exc:
        code, stdout, stderr = -1, '', str(exc)
    selected = selector(json.loads(stdout)) if code == 0 and selector else None
    record = dict(label=label, started_at=start, ended_at=now(), cwd=str(cwd),
                  executable=str(executable), argv=list(map(str, argv)), exit_code=code,
                  stdout=protect(json.dumps(selected, ensure_ascii=False, indent=2) if selector and code == 0 else stdout),
                  stderr=protect(stderr), child_environment=environment_note)
    if selector:
        record['output_scope'] = 'Selected identity fields; other response fields intentionally omitted.'
    if code:
        record['error_category'] = classify(stderr)
        record['retained_state'] = {'root_exists': ROOT.exists(), 'fixture_exists': (WORK / 'validation-fixture').exists()}
    E['commands'].append(record)
    save()
    print(f'{label}: exit={code}', flush=True)
    if code:
        raise CommandFailed(f'{label}: exit={code}; {protect(stderr.strip())}')
    return selected if selector else stdout.strip()

def classify(text):
    low = text.lower()
    for needle, category in [('authorizationmanager', 'PowerShell.AuthorizationManager'),
                             ('permission denied', 'AccessDenied'), ('access is denied', 'AccessDenied'),
                             ('authentication', 'Authentication'), ('could not resolve', 'NetworkResolution'),
                             ('cannot spawn', 'ProcessSpawn'), ('cannot run', 'ProcessSpawn'),
                             ('not a git repository', 'GitRepositoryState')]:
        if needle in low:
            return category
    return 'CommandFailure'

def cli(label, argv, selector=None):
    quoted = ' '.join("'" + str(a).replace("'", "''") + "'" for a in argv)
    command = '$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); & "$env:MULTICA_CLI_PATH" ' + quoted + '; exit $LASTEXITCODE'
    return run(label, PS, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], selector=selector)

def portable(label, argv, cwd=WORK, executable=GIT, trace=False):
    env = os.environ.copy()
    env['PATH'] = str(GIT.parent) + os.pathsep + str(BIN) + os.pathsep + env.get('PATH', '')
    note = {'PATH_prefix': [str(GIT.parent), str(BIN)], 'scope': 'child process only'}
    if trace:
        env['GIT_TRACE'] = '1'
        note['GIT_TRACE'] = '1; local-path clone only'
    if executable == GIT and Path(cwd).resolve().is_relative_to(ROOT) and Path(cwd).resolve() != ROOT:
        argv = ['-C', str(Path(cwd).resolve()), *argv]
    return run(label, executable, argv, cwd, env, note)

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def select_fields(obj, names):
    return {name: obj[name] for name in names if name in obj}

def runtimes_selected(obj):
    if isinstance(obj, dict):
        obj = obj.get('runtimes', obj.get('items', obj.get('data', [obj])))
    return [select_fields(row, ['id', 'name', 'display_name', 'provider', 'agent_type', 'hostname', 'device_name', 'status', 'daemon_id', 'version', 'profile_name']) for row in obj]

def snapshot(prefix, path):
    result = {'path': str(path), 'dot_git_is_directory': (path / '.git').is_dir(),
              'dot_git_is_file': (path / '.git').is_file()}
    for name, args in {
        'head': ['rev-parse', 'HEAD'], 'branch': ['branch', '--show-current'],
        'top_level': ['rev-parse', '--show-toplevel'], 'git_dir': ['rev-parse', '--absolute-git-dir'],
        'common_dir': ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        'origin': ['remote', 'get-url', 'origin'], 'status': ['status', '--porcelain=v1', '--untracked-files=all'],
    }.items():
        result[name] = portable(prefix + '_' + name, args, path)
    observe(prefix + '_identity', result, ['Python pathlib .git checks', 'recorded git commands'])
    return result

def require_phase(name):
    if E['phases'].get(name, {}).get('status') != 'PASS':
        raise MissingPrerequisite(name + ' has not passed')

def preflight():
    config_path = Path(os.environ['CODEX_HOME']) / 'config.toml'
    config = tomllib.loads(config_path.read_text(encoding='utf-8-sig'))
    ctx = json.loads((WORK / '.multica' / 'daemon_task_context.json').read_text(encoding='utf-8-sig'))
    identity = {
        'task_id': os.environ.get('MULTICA_TASK_ID'), 'task_slot': os.environ.get('MULTICA_TASK_SLOT'),
        'agent_id': os.environ.get('MULTICA_AGENT_ID'), 'workspace_id': os.environ.get('MULTICA_WORKSPACE_ID'),
        'context_issue_id': ctx.get('issue_id'), 'context_agent_id': ctx.get('agent_id'),
        'MULTICA_TOKEN_present': bool(os.environ.get('MULTICA_TOKEN')),
        'MULTICA_DAEMON_PORT_present': bool(os.environ.get('MULTICA_DAEMON_PORT')),
        'DAEMON_PORT_alias_present': bool(os.environ.get('DAEMON_PORT')),
        'sandbox_mode': config.get('sandbox_mode'), 'approval_policy': config.get('approval_policy'),
        'windows.sandbox': config.get('windows', {}).get('sandbox'), 'config_source': str(config_path),
        'effective_session_permissions': {'sandbox_mode': 'workspace-write', 'approval_policy': 'never', 'source': 'active developer permissions instructions'},
        'parent_PATH_sha256': hashlib.sha256(os.environ['PATH'].encode()).hexdigest(),
    }
    E['identity'] = identity
    observe('task_and_sandbox', identity, ['Read current task marker; select config.toml sandbox keys; environment presence checks'])
    fact('current_task_identity', identity['task_id'] == '01a1d329-8ec9-7ec7-9431-909e55251162' and WORK.name == 'workdir' and WORK.parent.name == 'test-8-909e55251162' and ctx['issue_id'] == ISSUE, identity['task_id'], True)
    fact('token_and_port_present', identity['MULTICA_TOKEN_present'] and identity['MULTICA_DAEMON_PORT_present'], 'presence only; values not emitted', True)
    fact('required_sandbox', [identity['sandbox_mode'], identity['approval_policy'], identity['windows.sandbox']] == ['workspace-write', 'never', 'mxc'], [identity['sandbox_mode'], identity['approval_policy'], identity['windows.sandbox']], True)
    identity['daemon'] = cli('daemon_identity', ['daemon', 'status', '--output', 'json'], lambda obj: select_fields(obj, ['daemon_id', 'pid', 'device_name', 'status', 'cli_version', 'cli_commit', 'os', 'active_task_count', 'running_task_count']))
    identity['agent'] = cli('agent_identity', ['agent', 'get', identity['agent_id'], '--output', 'json'], lambda obj: select_fields(obj, ['id', 'name', 'runtime_id']))
    identity['runtimes'] = cli('runtime_identity', ['runtime', 'list', '--output', 'json'], runtimes_selected)
    identity['runtime'] = next((r for r in identity['runtimes'] if r.get('id') == identity['agent'].get('runtime_id')), None)
    fact('bound_runtime_found', identity['runtime'] is not None, identity['runtime'], True)
    fact('specified_portable_git_exists', GIT.is_file(), str(GIT), True)
    observe('initial_workdir_entries', sorted(p.name for p in WORK.iterdir()), ['Path.iterdir', str(WORK)])
    fact('root_initially_absent', not ROOT.exists(), str(ROOT), True)
    E['initial_issue'] = cli('issue_context_record', ['issue', 'get', ISSUE, '--output', 'json'], lambda obj: select_fields(obj, ['id', 'identifier', 'title', 'status', 'revision', 'project_id', 'assignee_id']))
    E['initial_comments'] = json.loads(cli('comment_thread_scan_record', ['issue', 'comment', 'list', ISSUE, '--roots-only', '--summary', '--compact', '--output', 'json']))

def checkout1():
    require_phase('preflight')
    cli('native_checkout_first', ['repo', 'checkout', URL, '--ref', 'main'])
    fact('root_inside_current_task', ROOT.is_dir() and ROOT.resolve().is_relative_to(WORK), str(ROOT.resolve()))
    fact('root_not_TEST7', 'test-7-96ff82e8f4e9' not in str(ROOT.resolve()), str(ROOT.resolve()))
    E['root_first'] = snapshot('root_first', ROOT)
    fact('root_first_clean', E['root_first']['status'] == '', E['root_first']['status'])
    print(json.dumps(E['root_first'], ensure_ascii=False), flush=True)
    print('Registry discovery required before checkout2.', flush=True)

def checkout2():
    require_phase('checkout1')
    registry = E.get('registry')
    if not registry:
        raise MissingPrerequisite('Registry common.repo_path/common.repo_url must be recorded first')
    child = ROOT / registry['common.repo_path']
    fact('child_absent_first_checkout', not child.exists(), str(child))
    query = json.loads(run('registry_common_query', sys.executable, ['-X', 'utf8', str(ROOT / 'tools' / 'repo_registry.py'), '--workspace', str(ROOT), 'get', 'common'], ROOT))
    E['registry_common_query'] = query
    fact('registry_common_missing_before_repeat', query['status'] == 'ok' and query['repos'][0]['repo_status'] == 'missing-on-disk', query)
    cli('native_checkout_second', ['repo', 'checkout', URL])
    E['root_second'] = snapshot('root_second', ROOT)
    fact('child_absent_after_repeat_checkout', not child.exists(), str(child))
    fact('root_identity_and_status_unchanged_after_repeat', E['root_first'] == E['root_second'], E['root_second'])
    E['independent_run_conclusion'] = 'New Run did not automatically migrate the previous Run child: child absent after first and repeated native checkout in TEST-8. TEST-7 was not inspected.'

def registry():
    require_phase('checkout1')
    import yaml
    source = ROOT / 'docs' / 'config' / 'repo-context.yaml'
    data = yaml.safe_load(source.read_text(encoding='utf-8-sig'))
    common = next(r for r in data['repos'] if r['repo_id'] == 'common')
    E['registry'] = {'source': str(source), 'source_sha256': sha(source),
                     'common.repo_path': common['repo_path'], 'common.repo_url': common['repo_url']}
    observe('registry_common_metadata', E['registry'], ['yaml.safe_load', str(source), 'repos[repo_id=common]'])
    fact('common_path_inside_root', (ROOT / common['repo_path']).resolve().is_relative_to(ROOT.resolve()) and common['repo_path'] not in ['', '.'], common['repo_path'])
    ignore = ROOT / '.gitignore'
    E['root_ignore_before_fixture'] = {'path': str(ignore), 'sha256': sha(ignore), 'content': ignore.read_text(encoding='utf-8-sig')}
    observe('root_existing_ignore_file', E['root_ignore_before_fixture'], ['Path.read_text', str(ignore)])
    print(json.dumps(E['registry'], ensure_ascii=False), flush=True)

def fixture():
    require_phase('checkout2')
    fixture_dir = WORK / 'validation-fixture'
    child = ROOT / E['registry']['common.repo_path']
    fact('fixture_location_unused', not fixture_dir.exists(), str(fixture_dir), True)
    fact('child_destination_unused_and_inside_root', not child.exists() and child.resolve().is_relative_to(ROOT.resolve()), str(child), True)
    hashes = {p.name: sha(p) if p.is_file() else None for p in [BIN / 'sh.exe', BIN / 'busybox.exe']}
    observe('portable_binary_hashes', hashes, ['SHA256', str(BIN / 'sh.exe'), str(BIN / 'busybox.exe')])
    fact('sh_busybox_required_hash', hashes['sh.exe'] == hashes['busybox.exe'] == EXPECTED_HASH, hashes, True)
    portable('portable_sh_exit0', ['-c', 'exit 0'], executable=BIN / 'sh.exe')
    fixture_dir.mkdir()
    seed, bare = fixture_dir / 'seed', fixture_dir / 'common-fixture.git'
    E['fixture'] = {'directory': str(fixture_dir), 'seed': str(seed), 'bare': str(bare)}
    portable('seed_init', ['init', '--initial-branch=fixture-main', str(seed)])
    marker = seed / 'M02-local-validation.txt'
    marker.write_text('M02 independent Run local-only fixture\nTask: ' + os.environ['MULTICA_TASK_ID'] + '\nNo production content.\n', encoding='utf-8')
    observe('seed_marker_write', {'path': str(marker), 'sha256': sha(marker)}, ['Path.write_text', str(marker)])
    portable('seed_add', ['add', '--', marker.name], seed)
    portable('seed_commit', ['-c', 'user.name=M02 Validation Fixture', '-c', 'user.email=m02-validation@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'M02 local fixture marker'], seed)
    E['fixture']['seed_head'] = portable('seed_head', ['rev-parse', 'HEAD'], seed)
    portable('local_clone_bare_trace', ['clone', '--bare', str(seed), str(bare)], trace=True)
    child.parent.mkdir(parents=True, exist_ok=True)
    portable('local_clone_child_trace', ['clone', str(bare), str(child)], trace=True)
    E['child'] = snapshot('child', child)
    E['root_final'] = snapshot('root_final', ROOT)
    bare_head = portable('bare_head', ['rev-parse', 'HEAD'], bare)
    bare_flag = portable('bare_repository_check', ['rev-parse', '--is-bare-repository'], bare)
    E['fixture']['bare_head'] = bare_head
    E['fixture']['is_bare'] = bare_flag
    child_info = E['child']
    fact('child_independent_git_directory', child_info['dot_git_is_directory'] and Path(child_info['git_dir']).resolve() == (child / '.git').resolve() and Path(child_info['common_dir']).resolve() == (child / '.git').resolve() and Path(child_info['top_level']).resolve() == child.resolve(), child_info)
    fact('child_origin_local_bare', Path(child_info['origin']).resolve() == bare.resolve() and bare_flag == 'true', child_info['origin'])
    fact('child_seed_bare_same_HEAD', child_info['head'] == E['fixture']['seed_head'] == bare_head, child_info['head'])
    fact('child_clean', child_info['status'] == '', child_info['status'])
    ignore = portable('root_existing_ignore_match', ['check-ignore', '-v', '--no-index', '--', E['registry']['common.repo_path'].rstrip('/') + '/M02-local-validation.txt'], ROOT)
    E['ignore_match'] = ignore
    fact('root_ignore_match_exists', bool(ignore), ignore)
    fact('root_ignore_file_unchanged', sha(ROOT / '.gitignore') == E['root_ignore_before_fixture']['sha256'], sha(ROOT / '.gitignore'))
    fact('root_final_identity_status_unchanged', E['root_first'] == E['root_final'], E['root_final'])
    fact('parent_PATH_unchanged', E['identity']['parent_PATH_sha256'] == hashlib.sha256(os.environ['PATH'].encode()).hexdigest(), 'Only child process PATH was prefixed.')

def report():
    E['diagnostic_events'] = [
        {'source': 'exec_command e85070', 'timestamp': None, 'cwd': str(WORK),
         'argv': ['rg', '-n', '--hidden', '-g', '!**/.git/**', 'repo_path|repo_url', './winning-platform-monorepo/.rondo', './winning-platform-monorepo/rondo', './winning-platform-monorepo/AGENTS.md'],
         'shell_exit_code': 1, 'individual_rg_exit_code': None, 'error_category': 'DiscoveryPathsNotFound',
         'stderr': 'The guessed .rondo and rondo paths did not exist (os error 2).',
         'retained_state': 'Read-only discovery; first root checkout remained unchanged. Registry then located via AGENTS.md.'},
        {'source': 'exec_command a47ff2', 'timestamp': None, 'cwd': str(WORK),
         'argv': ['rg', '-n', 'winning-common|common|^repos/', './winning-platform-monorepo/.gitignore'],
         'exit_code': 1, 'error_category': 'SearchNoMatch', 'stdout': '',
         'retained_state': 'Read-only discovery; wildcard ignore rule subsequently verified using git check-ignore.'},
    ]
    E['evidence_scope'] = 'All native checkout, portable Git/sh, runtime identity and validation commands are timestamped below. Pre-recorder tool failures preserve tool IDs/durations where available; missing timestamps are explicitly null.'
    trace_commands = [c for c in E['commands'] if c['label'].endswith('_trace')]
    if E['phases'].get('fixture', {}).get('status') == 'PASS':
        fact('local_clone_trace_uses_portable_sh', len(trace_commands) == 2 and all(str(BIN / 'sh.exe').replace('\\', '/') + ' -c' in c['stderr'] for c in trace_commands), [c['label'] for c in trace_commands])
        fact('git_invocations_use_requested_executable', all(c['executable'] == str(GIT) for c in E['commands'] if Path(c['executable']).name.lower() == 'git.exe'), str(GIT))
    for phase in ['preflight', 'checkout1', 'checkout2', 'fixture']:
        if phase not in E['phases']:
            E['phases'][phase] = {'status': 'NOT_RUN', 'reason': 'Dependent prerequisite or prior phase not completed.'}
    failed = [p for p in E['phases'].values() if p['status'] == 'FAIL']
    E['overall_status'] = 'FAIL' if failed else ('PASS' if all(E['phases'][p]['status'] == 'PASS' for p in ['preflight', 'checkout1', 'checkout2', 'fixture']) else 'NOT_RUN')
    E['completed_at'] = now()
    trace = '\n\n'.join('## ' + c['label'] + '\n' + c['stderr'] for c in E['commands'] if c['label'].endswith('_trace'))
    (HERE / 'local-clone-trace.log').write_text(trace, encoding='utf-8')
    final_issue = cli('final_issue_status_read', ['issue', 'get', ISSUE, '--output', 'json'], lambda obj: select_fields(obj, ['id', 'status', 'revision', 'updated_at']))
    E['final_issue'] = final_issue
    if 'initial_issue' in E:
        fact('issue_metadata_unchanged', E['initial_issue']['status'] == final_issue['status'] and E['initial_issue']['revision'] == final_issue['revision'], final_issue)
    E['retained_state'] = {'root_exists': ROOT.exists(), 'fixture_exists': (WORK / 'validation-fixture').exists(), 'no_cleanup_reset_clean_fresh': True}
    save()
    passed = sum(a['status'] == 'PASS' for a in E['assertions'])
    lines = [f'M02 独立 Run 验证：{E["overall_status"]}', '',
             f'Issue：TEST-8；Task：{E.get("identity", {}).get("task_id", "未确认")}。',
             f'断言通过 {passed}/{len(E["assertions"])}；Rondo dev prepare：NOT_RUN。', '',
             '| 阶段 | 结果 |', '| --- | --- |']
    lines += [f'| {k} | {v["status"]} |' for k, v in E['phases'].items() if k != 'report']
    identity = E.get('identity', {})
    lines += ['', '沙箱：`' + ' / '.join(str(identity.get(k)) for k in ['sandbox_mode', 'approval_policy', 'windows.sandbox']) + '`。MULTICA_TOKEN 和 MULTICA_DAEMON_PORT 仅记录存在性，不记录值。',
              '', 'Daemon/Runtime：', '```json', json.dumps({'daemon': identity.get('daemon'), 'runtime': identity.get('runtime')}, ensure_ascii=False, indent=2), '```']
    for label, key in [('根仓初次身份', 'root_first'), ('根仓重复 checkout 身份', 'root_second'), ('根仓最终身份', 'root_final'), ('Registry', 'registry'), ('本地 fixture', 'fixture'), ('子仓身份', 'child')]:
        if key in E:
            lines += ['', label + '：', '```json', json.dumps(E[key], ensure_ascii=False, indent=2), '```']
    lines += ['', E.get('independent_run_conclusion', '尚无证据支持 Run 子仓迁移结论。'), '', 'Ignore 命中：`' + E.get('ignore_match', 'NOT_RUN') + '`。',
              '', 'PowerShell `.ps1` 记录器启动失败：exit 1，PSSecurityException / AuthorizationManager。失败发生于脚本体执行前；之后使用 Python 记录器调用 CLI/Git，未调整执行策略或沙箱。',
              '', '两个本地 clone 的 GIT_TRACE 均记录便携 `mingw64/bin/sh.exe -c` 启动本地 `git-upload-pack`，退出码为 0。探索阶段另有路径不存在和 rg 无匹配，均为只读命令，已单列诊断记录。',
              '', '所有验证命令的时间、cwd、argv、exit、脱敏 stdout/stderr 和 assertions 见 `M02-independent-evidence.json`；本地 clone trace 另见 `local-clone-trace.log`。启动失败的工具响应仅提供耗时，绝对时间未伪造。',
              '', '现场保留；未读取或修改 TEST-7，跨 Task before/after 由控制端单独比较。仅原生根仓 checkout/fetch 使用获授权根仓 URL；未访问 registry 指向的真实业务子仓 origin，未 push，根仓未创建 commit。Issue 元数据保持原样。']
    failures = [dict(phase=k, **v) for k, v in E['phases'].items() if v['status'] in ['FAIL', 'NOT_RUN']]
    if failures:
        lines += ['', '失败或未运行详情：', '```json', json.dumps(failures, ensure_ascii=False, indent=2), '```']
    (HERE / 'report.md').write_text(protect('\n'.join(lines) + '\n'), encoding='utf-8')
    print(json.dumps({'overall_status': E['overall_status'], 'assertions_passed': passed, 'assertions_total': len(E['assertions']), 'phases': E['phases']}, ensure_ascii=False), flush=True)

try:
    {'preflight': preflight, 'checkout1': checkout1, 'registry': registry, 'checkout2': checkout2, 'fixture': fixture, 'report': report}[PHASE]()
    E['phases'][PHASE] = {'status': 'PASS', 'at': now()}
    save()
except Exception as exc:
    E['phases'][PHASE] = {'status': 'NOT_RUN' if isinstance(exc, MissingPrerequisite) else 'FAIL', 'at': now(), 'error_category': type(exc).__name__, 'detail': protect(str(exc))}
    E['overall_status'] = E['phases'][PHASE]['status']
    save()
    print(protect(str(exc)), flush=True)
    sys.exit(1)
