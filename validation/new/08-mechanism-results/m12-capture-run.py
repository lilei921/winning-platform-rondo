"""Capture the authorized M12 command without changing its source or configuration."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess

base = Path('D:/UserProgram/winning-platform-monorepo/projects/multica/validation/new/08-mechanism-results')
script = base / 'm12-runtime-fallback.py'
inputs = [script, base / 'm12-index-snapshot.py', base / 'm12-fixed-source.mjs', base / 'M12-index-commit-audit.json']
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
before = {str(p): digest(p) for p in inputs}
env = os.environ.copy()
# Avoid Python attempting to write imported bytecode beside read-only inputs.
env['PYTHONDONTWRITEBYTECODE'] = '1'
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
result = subprocess.run(['python', str(script)], cwd=Path.cwd(), env=env, capture_output=True)
finished = datetime.datetime.now(datetime.timezone.utc).isoformat()
stdout = Path('M12-command-stdout.log')
stderr = Path('M12-command-stderr.log')
stdout.write_bytes(result.stdout)
stderr.write_bytes(result.stderr)
evidence = Path('M12-runtime-fallback-evidence.json')
manifest = {
    'level': 'isolated mechanism PoC in real Runtime; not production orchestration acceptance',
    'issue_id': '01a1d352-18e5-715e-bcf7-39b7850c4cdb',
    'task_id': os.environ.get('MULTICA_TASK_ID'),
    'runtime_id': 'c55feddd-7910-480a-8f9f-9d6180b1f061',
    'runtime_name': 'Codex (lileipc)',
    'runtime_id_source': 'multica runtime list --output json; correlate with issue runs',
    'command': ['python', str(script)],
    'cwd': str(Path.cwd()),
    'started_at_utc': started,
    'finished_at_utc': finished,
    'exit_code': result.returncode,
    'process_environment_override': {'PYTHONDONTWRITEBYTECODE': '1'},
    'input_sha256_before': before,
    'input_sha256_after': {str(p): digest(p) for p in inputs},
    'stdout': {'path': str(stdout.resolve()), 'bytes': stdout.stat().st_size, 'sha256': digest(stdout)},
    'stderr': {'path': str(stderr.resolve()), 'bytes': stderr.stat().st_size, 'sha256': digest(stderr)},
    'evidence': {'path': str(evidence.resolve()), 'exists': evidence.exists(), 'sha256': digest(evidence) if evidence.exists() else None},
}
Path('M12-runtime-execution-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'exit_code': result.returncode, 'stdout_bytes': len(result.stdout), 'stderr_bytes': len(result.stderr), 'evidence_exists': evidence.exists()}))
raise SystemExit(result.returncode)
