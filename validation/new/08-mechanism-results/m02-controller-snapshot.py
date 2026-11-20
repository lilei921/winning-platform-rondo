"""只读比较 TEST-7 二级仓在独立 Run 前后的身份与脏修改。"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

OUT = Path(__file__).resolve().parent
ROOT = Path(r'C:\Users\lilei\multica_workspaces\rondo-test-8ef6a0bcf15d\test-7-96ff82e8f4e9\workdir\winning-platform-monorepo')
CHILD = ROOT / 'winning-dps-df-common'
GIT = r'D:\UserApp\Git\bin\git.exe'


def git(repo, *args):
    p = subprocess.run([GIT, '-C', str(repo), *args], capture_output=True, text=True, encoding='utf-8', timeout=30)
    if p.returncode:
        raise RuntimeError(p.stderr)
    return p.stdout.strip()


def snapshot(repo):
    return {'path': str(repo), 'head': git(repo, 'rev-parse', 'HEAD'), 'branch': git(repo, 'branch', '--show-current'),
            'common_dir': git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'),
            'origin': git(repo, 'remote', 'get-url', 'origin'),
            'status': git(repo, 'status', '--porcelain=v1', '--untracked-files=all'),
            'diff_sha256': hashlib.sha256(git(repo, 'diff', '--binary').encode()).hexdigest()}


label = sys.argv[1]
assert label in ('before', 'after')
data = {'root': snapshot(ROOT), 'child': snapshot(CHILD),
        'child_files': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in CHILD.iterdir() if p.is_file()}}
target = OUT / f'M02-TEST7-{label}-independent.json'
assert not target.exists(), 'Preserve existing snapshot'
target.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
if label == 'after':
    before = json.loads((OUT / 'M02-TEST7-before-independent.json').read_text(encoding='utf-8'))
    assert data == before, 'TEST-7 snapshot changed during independent Run'
print(json.dumps({'snapshot': str(target), 'identical_to_before': label == 'after', 'data': data}, indent=2))
