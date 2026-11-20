"""M04/M05/M06/M07/M09：仅使用本机私有 Git remote 的可复核机制实验。"""
from __future__ import annotations
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

WORKSPACE = Path(__file__).resolve().parents[5]
OUT = Path(__file__).resolve().parent
BASE = WORKSPACE / '.tmp' / 'multica-08-local-mechanisms-20261113'
TOOL = Path(r'C:\Users\lilei\.multica\tools\mingit-busybox-2.54.0')
GIT = TOOL / 'cmd/git.exe'
ENV = {k: v for k, v in os.environ.items() if k.upper() != 'PATH'}
ENV['PATH'] = str(TOOL / 'cmd') + os.pathsep + str(TOOL / 'mingw64/bin') + os.pathsep + os.environ.get('PATH', '')
ENV['GIT_TERMINAL_PROMPT'] = '0'
DATA = {'started_at': dt.datetime.now().astimezone().isoformat(), 'mode': 'controller sandbox; local fixture only',
        'workspace': str(WORKSPACE), 'base': str(BASE), 'commands': [], 'results': {}}


def save():
    (OUT / 'M04-M09-local-poc-evidence.json').write_text(json.dumps(DATA, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def run(argv, cwd, ok=True):
    """不调用 shell；逐条保存命令与退出码，失败保留现场。"""
    start = dt.datetime.now().astimezone().isoformat()
    p = subprocess.run([str(x) for x in argv], cwd=cwd, env=ENV, capture_output=True, timeout=120)
    row = {'cwd': str(cwd), 'argv': [str(x) for x in argv], 'started_at': start,
           'completed_at': dt.datetime.now().astimezone().isoformat(), 'exit': p.returncode,
           'stdout': p.stdout.decode('utf-8', errors='replace'), 'stderr': p.stderr.decode('utf-8', errors='replace')}
    DATA['commands'].append(row)
    save()
    if ok and p.returncode:
        raise RuntimeError(f'command failed: {row}')
    return row


def git(cwd, *args, ok=True):
    return run([GIT, '-c', 'core.autocrlf=false', '-C', cwd, *args], cwd, ok)


def val(cwd, *args):
    return git(cwd, *args)['stdout'].strip()


def write(root, rel, text):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding='utf-8', newline='\n')


def sha(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def commit(repo, message, paths):
    git(repo, 'add', '--', *paths)
    git(repo, '-c', 'user.name=Multica validation fixture', '-c', 'user.email=fixture@example.invalid',
        'commit', '-m', message)
    return val(repo, 'rev-parse', 'HEAD')


def init(path):
    path.mkdir(parents=True)
    git(path, 'init', '-b', 'master')


def clone(remote, path):
    git(BASE, 'clone', str(remote), str(path))


def private_remote(seed, remote):
    git(BASE, 'clone', '--bare', str(seed), str(remote))
    git(seed, 'remote', 'add', 'origin', str(remote))


def remote_head(remote, branch='master'):
    return val(remote, 'rev-parse', f'refs/heads/{branch}')


def snapshot(repo):
    return {'head': val(repo, 'rev-parse', 'HEAD'), 'branch': val(repo, 'branch', '--show-current'),
            'status': val(repo, 'status', '--porcelain=v1', '--untracked-files=all'),
            'diff_sha256': sha(val(repo, 'diff', '--binary'))}


def m04():
    base = BASE / 'M04'
    seed, remote, agent = base / 'seed', base / 'remote.git', base / 'agent'
    init(seed)
    allowed = 'openspec/changes/allowed/proposal.md'
    other = 'openspec/changes/other/proposal.md'
    write(seed, allowed, 'approved base\n')
    write(seed, other, 'other base\n')
    write(seed, 'README.md', 'base\n')
    c0 = commit(seed, 'fixture baseline', [allowed, other, 'README.md'])
    private_remote(seed, remote)
    clone(remote, agent)
    git(agent, 'switch', '-c', 'agent/validation')
    write(agent, allowed, 'approved proposed\n')
    write(agent, other, 'unrelated change\n')
    candidate = commit(agent, 'two independent changes', [allowed, other])
    write(agent, 'README.md', 'uncommitted agent content\n')
    write(agent, 'untracked.txt', 'must survive\n')
    before = snapshot(agent)
    before['untracked_sha256'] = sha((agent / 'untracked.txt').read_text())
    patch = base / 'allowed.patch'
    patch.write_text(git(agent, 'diff', '--binary', c0, candidate, '--', 'openspec/changes/allowed')['stdout'], encoding='utf-8', newline='\n')
    advance = base / 'advance'
    clone(remote, advance)
    write(advance, 'README.md', 'remote advanced\n')
    ahead = commit(advance, 'target advances unrelated path', ['README.md'])
    git(advance, 'push', 'origin', 'HEAD:refs/heads/master')
    publisher = base / 'publisher'
    clone(remote, publisher)
    git(publisher, 'apply', '--3way', '--index', str(patch))
    published = commit(publisher, 'publish whitelist only', [allowed])
    paths = val(publisher, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').splitlines()
    assert paths == [allowed]
    git(publisher, 'push', 'origin', 'HEAD:refs/heads/master')
    # 模拟调用方丢失成功响应：仅凭远端回读确认，不重复提交/强推。
    recovered = remote_head(remote)
    assert recovered == published
    assert val(remote, 'show', f'master:{other}') == 'other base'
    assert val(remote, 'show', 'master:README.md') == 'remote advanced'
    conflict = base / 'conflict-publisher'
    clone(remote, conflict)
    write(conflict, allowed, 'competing target body\n')
    conflict_commit = commit(conflict, 'competing same path', [allowed])
    git(conflict, 'push', 'origin', 'HEAD:refs/heads/master')
    stopped = git(conflict, 'apply', '--3way', '--index', str(patch), ok=False)
    assert stopped['exit'] != 0 and remote_head(remote) == conflict_commit
    after = snapshot(agent)
    after['untracked_sha256'] = sha((agent / 'untracked.txt').read_text())
    assert before == after
    DATA['results']['M04'] = {'status': 'PASS', 'level': 'local Git PoC', 'baseline': c0, 'agent_candidate': candidate,
        'ahead_target': ahead, 'published_commit': published, 'published_paths': paths, 'lost_response_readback': recovered,
        'conflict_exit': stopped['exit'], 'conflict_remote_unchanged': conflict_commit, 'agent_before': before, 'agent_after': after,
        'rondo_adapter': 'NOT_RUN', 'real_authority_push': 'NOT_RUN'}
    save()


def contract(text):
    return re.sub(r'^(- )\[[ xX]\]', r'\1[ ]', text, flags=re.M)


def complete_task(repo, task, evidence, approved):
    rel = 'openspec/changes/validation-delivery/tasks.md'
    old = (repo / rel).read_text(encoding='utf-8')
    assert sha(contract(old)) == sha(contract(approved)), 'approved contract drift'
    needle = f'- [ ] {task} '
    assert sum(line.startswith(needle) for line in old.splitlines()) == 1
    new = old.replace(needle, f'- [x] {task} ', 1)
    assert sha(contract(new)) == sha(contract(approved))
    write(repo, rel, new)
    ev = f'openspec/changes/validation-delivery/evidence/{task}.json'
    write(repo, ev, json.dumps(evidence, ensure_ascii=False, indent=2) + '\n')
    return commit(repo, f'publish {task}', [rel, ev])


def m05_m07():
    base = BASE / 'M05-M07'
    seed, remote = base / 'seed', base / 'remote.git'
    init(seed)
    task_path = 'openspec/changes/validation-delivery/tasks.md'
    approved = '# Approved delivery\n\n- [ ] T1 first independent delivery\n\n- [ ] T2 second independent delivery\n'
    proposal = 'Approved immutable contract\n'
    write(seed, task_path, approved)
    write(seed, 'openspec/changes/validation-delivery/proposal.md', proposal)
    c1 = commit(seed, 'approval C1', ['openspec/changes/validation-delivery'])
    private_remote(seed, remote)
    a, b, lead = base / 'engineer-a', base / 'engineer-b-stale', base / 'lead-at-c1'
    for dest in (a, b, lead): clone(remote, dest)
    ev_a = {'task_refs': ['T1'], 'candidate_commit': c1, 'fixture_engineer': 'A'}
    ev_b = {'task_refs': ['T2'], 'candidate_commit': c1, 'fixture_engineer': 'B'}
    ca = complete_task(a, 'T1', ev_a, approved)
    git(a, 'push', 'origin', 'HEAD:refs/heads/master')
    cb_stale = complete_task(b, 'T2', ev_b, approved)
    refused = git(b, 'push', 'origin', 'HEAD:refs/heads/master', ok=False)
    assert refused['exit'] != 0 and remote_head(remote) == ca
    recovery = base / 'engineer-b-revalidated'
    clone(remote, recovery)
    cb = complete_task(recovery, 'T2', ev_b, approved)
    git(recovery, 'push', 'origin', 'HEAD:refs/heads/master')
    current = val(remote, 'show', f'master:{task_path}') + '\n'
    fixed = val(remote, 'show', f'{c1}:{task_path}') + '\n'
    assert current.count('- [x]') == 2 and fixed.count('- [ ]') == 2
    assert sha(contract(current)) == sha(contract(fixed))
    assert val(lead, 'rev-parse', 'HEAD') == c1 and val(remote, 'rev-parse', 'master') == cb
    artifacts = {t: json.loads(val(remote, 'show', f'master:openspec/changes/validation-delivery/evidence/{t}.json')) for t in ('T1', 'T2')}
    assert artifacts == {'T1': ev_a, 'T2': ev_b}
    # 合同正文冲突必须在发布前停止，不把正文漂移当作 checkbox 更新。
    write(recovery, task_path, current.replace('first independent delivery', 'unauthorized changed contract'))
    try:
        complete_task(recovery, 'T1', ev_a, approved)
    except AssertionError as e:
        conflict = str(e)
    else:
        raise AssertionError('contract conflict not rejected')
    assert conflict == 'approved contract drift' and remote_head(remote) == cb
    DATA['results']['M05'] = {'status': 'PASS', 'level': 'local Git PoC', 'approval_c1': c1, 'progress_c2': cb,
        'approval_tasks_sha256': sha(fixed), 'progress_tasks_sha256': sha(current), 'contract_sha256': sha(contract(fixed)),
        'local_lead_head': c1, 'latest_remote_head': cb, 'approval_source_unchanged': True, 'rondo_adapter': 'NOT_RUN'}
    DATA['results']['M07'] = {'status': 'PASS', 'level': 'local Git PoC', 'a_commit': ca, 'b_stale_commit': cb_stale,
        'stale_push_exit': refused['exit'], 'b_revalidated_commit': cb, 'final_tasks': current, 'final_evidence': artifacts,
        'contract_conflict': conflict, 'remote_unchanged_after_conflict': cb, 'multica_facts_joint_acceptance': 'NOT_RUN'}
    save()


def prepare_guard(repo, expected_origin, authorized):
    """仅为 PoC 的显式安全规则；不能宣称已有 rondo dev prepare。"""
    if not authorized: return 'unauthorized_repo'
    if val(repo, 'remote', 'get-url', 'origin') != str(expected_origin): return 'wrong_origin'
    if val(repo, 'status', '--porcelain=v1'): return 'dirty_tree'
    if val(repo, 'rev-list', '--count', 'origin/candidate..HEAD') != '0': return 'unpushed_commit'
    return 'ready'


def m06():
    registry = (WORKSPACE / 'docs/config/repo-context.yaml').read_text(encoding='utf-8')
    block = re.search(r'  - repo_id: common\n(.*?)(?=\n  - repo_id:|\Z)', registry, re.S).group(1)
    identity = {'repo_key': 'common', **{k: re.search(rf'^    {k}: (.+)$', block, re.M).group(1) for k in ('repo_path', 'repo_url')}}
    base = BASE / 'M06'
    root, seed, remote = base / 'root', base / 'seed', base / 'business.git'
    init(root)
    write(root, '.gitignore', '/' + identity['repo_path'] + '/\n')
    commit(root, 'root ignores child', ['.gitignore'])
    init(seed)
    write(seed, 'README.txt', 'business baseline\n')
    c0 = commit(seed, 'business baseline', ['README.txt'])
    git(seed, 'branch', 'candidate')
    private_remote(seed, remote)
    child = root / identity['repo_path']
    clone(remote, child)
    git(child, 'switch', '--track', 'origin/candidate')
    original = snapshot(child)
    assert prepare_guard(child, remote, True) == 'ready'
    git(child, 'fetch', 'origin')
    assert original == snapshot(child)
    advance = base / 'advance'
    clone(remote, advance)
    git(advance, 'switch', '--track', 'origin/candidate')
    write(advance, 'README.txt', 'business remote advance\n')
    advanced = commit(advance, 'advance candidate', ['README.txt'])
    git(advance, 'push', 'origin', 'HEAD:refs/heads/candidate')
    assert prepare_guard(child, remote, True) == 'ready'
    git(child, 'fetch', 'origin')
    git(child, 'merge-base', '--is-ancestor', 'HEAD', 'origin/candidate')
    git(child, 'merge', '--ff-only', 'origin/candidate')
    assert val(child, 'rev-parse', 'HEAD') == advanced
    negatives = {}
    before = snapshot(child)
    negatives['unauthorized'] = prepare_guard(child, remote, False)
    assert negatives['unauthorized'] == 'unauthorized_repo' and before == snapshot(child)
    wrong = base / 'wrong-origin'
    clone(remote, wrong)
    git(wrong, 'remote', 'set-url', 'origin', str(base / 'wrong.git'))
    wrong_before = snapshot(wrong)
    negatives['wrong_origin'] = prepare_guard(wrong, remote, True)
    assert negatives['wrong_origin'] == 'wrong_origin' and wrong_before == snapshot(wrong)
    write(child, 'dirty.txt', 'untracked preserved\n')
    dirty_before = snapshot(child)
    negatives['dirty'] = prepare_guard(child, remote, True)
    assert negatives['dirty'] == 'dirty_tree' and dirty_before == snapshot(child)
    ahead = base / 'unpushed'
    clone(remote, ahead)
    git(ahead, 'switch', '--track', 'origin/candidate')
    write(ahead, 'local.txt', 'unpushed preserved\n')
    local_head = commit(ahead, 'unpublished local commit', ['local.txt'])
    ahead_before = snapshot(ahead)
    negatives['unpushed'] = prepare_guard(ahead, remote, True)
    assert negatives['unpushed'] == 'unpushed_commit' and ahead_before == snapshot(ahead)
    assert val(root, 'status', '--porcelain=v1') == '' and remote_head(remote, 'candidate') == advanced
    DATA['results']['M06'] = {'status': 'PASS', 'level': 'local Git + explicit guard PoC', 'actual_registry_identity': identity,
        'fixture_origin': str(remote), 'first_commit': c0, 'advanced_candidate': advanced, 'unpublished_commit': local_head,
        'negative_results': negatives, 'root_status': '', 'rondo_dev_prepare': 'NOT_RUN', 'production_authentication': 'NOT_RUN'}
    save()


def m09():
    base = BASE / 'M09'
    seed, remote, temporary = base / 'seed', base / 'remote.git', base / 'temporary-finalize'
    init(seed)
    change = 'validation-archive'
    delta = ('## ADDED Requirements\n\n### Requirement: Archive fixture evidence\n'
             'The system SHALL preserve published fixture evidence.\n\n#### Scenario: Published evidence survives\n'
             '- **WHEN** a temporary working directory is removed\n- **THEN** the remote archive remains readable\n')
    proposal = '# Why\n\nVerify isolated archive.\n\n## What Changes\n\n- Add fixture evidence requirement.\n\n## Impact\n\n- Local fixture only.\n'
    write(seed, 'openspec/config.yaml', 'schema: spec-driven\n')
    write(seed, f'openspec/changes/{change}/proposal.md', proposal)
    write(seed, f'openspec/changes/{change}/tasks.md', '- [x] 1.1 Verify local archive\n')
    write(seed, f'openspec/changes/{change}/specs/fixture/spec.md', delta)
    write(seed, f'openspec/changes/{change}/evidence/fixture.json', '{"result":"PASS","mode":"local fixture"}\n')
    write(seed, 'protected.txt', 'must remain unchanged\n')
    c0 = commit(seed, 'archive fixture input', ['openspec', 'protected.txt'])
    private_remote(seed, remote)
    clone(remote, temporary)
    openspec = shutil.which('openspec.cmd', path=ENV['PATH']) or shutil.which('openspec', path=ENV['PATH'])
    assert openspec, 'OpenSpec executable missing'
    version = run([openspec, '--version'], temporary)
    archive = run([openspec, 'archive', change, '--yes', '--json'], temporary)
    archived = list((temporary / 'openspec/changes/archive').glob(f'*-{change}'))
    assert len(archived) == 1
    spec = (temporary / 'openspec/specs/fixture/spec.md').read_text(encoding='utf-8')
    assert 'Archive fixture evidence' in spec and 'SHALL' in spec
    assert (temporary / 'protected.txt').read_text() == 'must remain unchanged\n'
    changed = val(temporary, 'status', '--porcelain=v1', '--untracked-files=all')
    assert all('openspec/' in line for line in changed.splitlines())
    archived_rel = archived[0].relative_to(temporary).as_posix()
    tasks_hash = sha((archived[0] / 'tasks.md').read_text())
    evidence_hash = sha((archived[0] / 'evidence/fixture.json').read_text())
    published = commit(temporary, 'publish local archive', ['openspec'])
    git(temporary, 'push', 'origin', 'HEAD:refs/heads/master')
    assert remote_head(remote) == published
    # 删除前校验绝对路径和全部 reparse 边界；仅删除本脚本新建的单个临时 clone。
    resolved = temporary.resolve()
    assert resolved.parent == base.resolve() and resolved.name == 'temporary-finalize'
    assert BASE.resolve() in resolved.parents
    assert not any(getattr(p.lstat(), 'st_file_attributes', 0) & 0x400 for p in [resolved, *resolved.rglob('*')])
    for p in resolved.rglob('*'):
        if p.is_file():
            p.chmod(0o666)  # 仅清除已验证 fixture 内 Git 对象的 Windows 只读位。
    shutil.rmtree(resolved)
    assert not temporary.exists()
    read_tasks = val(remote, 'show', f'master:{archived_rel}/tasks.md') + '\n'
    read_evidence = val(remote, 'show', f'master:{archived_rel}/evidence/fixture.json') + '\n'
    read_spec = val(remote, 'show', 'master:openspec/specs/fixture/spec.md')
    assert sha(read_tasks) == tasks_hash and sha(read_evidence) == evidence_hash
    assert 'Archive fixture evidence' in read_spec
    DATA['results']['M09'] = {'status': 'PASS', 'level': 'local Git/OpenSpec PoC', 'version': version['stdout'].strip(),
        'archive_exit': archive['exit'], 'baseline': c0, 'published_commit': published, 'archive_path': archived_rel,
        'temporary_deleted': str(resolved), 'readback_after_delete': True, 'tasks_sha256': tasks_hash,
        'evidence_sha256': evidence_hash, 'protected_file_unchanged': True, 'rondo_finalize': 'NOT_RUN'}
    save()


def resume_m09_cleanup():
    """保留首次删除失败，只补当前专用临时 clone 的清理与独立回读。"""
    global DATA
    DATA = json.loads((OUT / 'M04-M09-local-poc-evidence.json').read_text(encoding='utf-8'))
    DATA.setdefault('recovered_errors', []).append(DATA.pop('error'))
    base = BASE / 'M09'
    remote, temporary = base / 'remote.git', base / 'temporary-finalize'
    resolved = temporary.resolve()
    assert resolved.parent == base.resolve() and resolved.name == 'temporary-finalize'
    assert BASE.resolve() in resolved.parents and resolved.is_dir()
    assert not any(getattr(p.lstat(), 'st_file_attributes', 0) & 0x400 for p in [resolved, *resolved.rglob('*')])
    archived = list((resolved / 'openspec/changes/archive').glob('*-validation-archive'))
    assert len(archived) == 1
    archived_rel = archived[0].relative_to(resolved).as_posix()
    tasks_hash = sha((archived[0] / 'tasks.md').read_text())
    evidence_hash = sha((archived[0] / 'evidence/fixture.json').read_text())
    assert (resolved / 'protected.txt').read_text() == 'must remain unchanged\n'
    published = remote_head(remote)
    for p in resolved.rglob('*'):
        if p.is_file(): p.chmod(0o666)
    shutil.rmtree(resolved)
    assert not resolved.exists()
    assert sha(val(remote, 'show', f'master:{archived_rel}/tasks.md') + '\n') == tasks_hash
    assert sha(val(remote, 'show', f'master:{archived_rel}/evidence/fixture.json') + '\n') == evidence_hash
    assert 'Archive fixture evidence' in val(remote, 'show', 'master:openspec/specs/fixture/spec.md')
    DATA['results']['M09'] = {'status': 'PASS', 'level': 'local Git/OpenSpec PoC', 'version': '1.13.2',
        'archive_exit': 0, 'published_commit': published, 'archive_path': archived_rel,
        'temporary_deleted': str(resolved), 'readback_after_delete': True, 'tasks_sha256': tasks_hash,
        'evidence_sha256': evidence_hash, 'protected_file_unchanged': True,
        'cleanup_recovery': 'cleared readonly file attributes only within validated fixture; no ACL change',
        'rondo_finalize': 'NOT_RUN'}
    DATA['completed_at'] = dt.datetime.now().astimezone().isoformat()
    save()
    print('M09 cleanup recovery and remote readback PASS')


if __name__ == '__main__':
    assert WORKSPACE == Path(r'D:\UserProgram\winning-platform-monorepo'), WORKSPACE
    if sys.argv[1:] == ['--resume-m09-cleanup']:
        resume_m09_cleanup()
        sys.exit(0)
    assert not BASE.exists(), 'Fixture exists: preserve earlier evidence; do not rerun blindly'
    BASE.mkdir(parents=True)
    try:
        for label, fn in [('M04', m04), ('M05/M07', m05_m07), ('M06', m06), ('M09', m09)]:
            fn()
            print(label + ' PASS', flush=True)
    except Exception as exc:
        DATA['error'] = str(exc)
        save()
        raise
    DATA['completed_at'] = dt.datetime.now().astimezone().isoformat()
    save()
    print(str(OUT / 'M04-M09-local-poc-evidence.json'))
