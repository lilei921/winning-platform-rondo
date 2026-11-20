---
title: S11-03 Leader Dispatch — Evidence
contract: S11-RR-POC
status: fail
created_at: 2026-10-14
updated_at: 2026-10-14
---

# S11-03 Result — Leader Dispatches While Worker Busy, But Per-Task Workdir + Agent Absolute Paths Bypass the Lock

> 归档说明（2026-10-15）：本目录中的 JSON、日志和临时文本证据已清理，仅保留结果记录。

## Verdict

**FAIL** — Squad Leader **could** be dispatched and **did** run while Worker A
held the `local_directory` lock in the profile daemon. This is the
**opposite** of what the proposal's hypothesis predicts (the proposal assumes
the lock should serialize). More importantly, both the Leader and Worker A
**wrote to the same shared `D:\multica-poc\rr-fixture\poc/` directory** while
their agents were simultaneously active.

The lock is **per-daemon-process**, NOT global. The Main daemon (PID 30748)
never even tried to acquire the lock for the Leader — it gave the Leader a
**per-task workdir** at `C:\Users\lilei\multica_workspaces\...`. The
per-task workdir is the only "isolation" mechanism that exists, and it is
**trivially bypassed** by Agents that use absolute paths to write to the
shared `in_place` `local_directory`.

## Hypothesis under test

> Multica native `local_directory` lock prevents concurrent Agent writes
> on the same `in_place` `local_directory`, regardless of which Squad
> role (Leader or Worker) is dispatched.

## Observed behavior

### Setup
- Squad `DS01` Round Robin dispatched two tasks for the same project:
  - **Worker A (RRNC-4)** — assigned to `S11 Worker A` (79e4eee1) at 14:35:57
  - **Leader (RRNC-3)** — assigned to Squad `DS01` (979f6c0f) at 14:36:32
- Project `6d065e40-...` `local_directory` resource bound to
  `D:\multica-poc\rr-fixture` (`in_place`)

### Lifecycle (Beijing time)

| Time | Event | Daemon | Source |
| --- | --- | --- | --- |
| 14:35:58.458 | Worker A task f440 received | profile (49696) | profile daemon log |
| 14:35:58.462 | **`local_directory: lock acquired`** for `D:\multica-poc\rr-fixture` | profile (49696) | profile daemon log |
| 14:36:04.288 | Worker A starting agent, **workdir=D:\multica-poc\rr-fixture** | profile (49696) | profile daemon log |
| 14:36:33.703 | Leader task 7d07 received | **main (30748)** | main daemon log |
| 14:36:33.703 | Leader task context — **`reuse_workdir=false`** | main (30748) | main daemon log |
| 14:36:37.060 | Leader starting agent, **workdir=C:\Users\lilei\multica_workspaces\rr-native-c-7d086bc43298\rrnc-3-31466d08caf3\workdir** (per-task workdir, NOT the project `local_directory`) | main (30748) | main daemon log |
| 14:37:52.275 | **Leader wrote `poc/leader-dispatch.txt` to `D:\multica-poc\rr-fixture\poc\` (UTC 06:37:52, status=received)** | main (30748) | file content |
| 14:38:03 | **Worker A wrote `poc/lock-A-start.txt` to `D:\multica-poc\rr-fixture\poc\` (UTC 06:38:03)** | profile (49696) | file content |
| 14:38:50.299 | Leader wrote `poc/leader-dispatch.txt` (UTC 06:38:50, status=done, elapsed=58) | main (30748) | file content |
| 14:39:21 | Worker A wrote `poc/lock-A-end.txt` (UTC 06:39:21, elapsed=78) | profile (49696) | file content |
| 14:40:01.322 | Leader agent finished, task completed | main (30748) | main daemon log |
| 14:40:25.784 | Worker A agent finished, task completed | profile (49696) | profile daemon log |

### Key observation — same shared directory, two daemons, no global lock

The Main daemon (PID 30748) **never logged** a `local_directory: lock acquired`
for the Leader task. The Main daemon's lock-state for the Leader is empty:

```
$ grep "01a13920" ~/.multica/daemon.log | grep -i lock
(no results)
```

The Main daemon saw the Leader as a fresh task with no `local_directory`
resource (because the resource is bound to the project, but the project's
resource `daemon_id=01a01965-...` is the Main daemon's daemon_id, while the
profile daemon saw a *different* resource instance for the same `local_path`).
The Main daemon routed the Leader to a **per-task workdir** at
`C:\Users\lilei\multica_workspaces\rr-native-c-7d086bc43298\rrnc-3-31466d08caf3\workdir`.

But the Leader agent itself **chose to write to the absolute path**
`D:\multica-poc\rr-fixture\poc\leader-dispatch.txt`, completely bypassing
the per-task workdir. The file is present in the shared `D:\multica-poc\rr-fixture\poc/`
directory — verifiable evidence:

```text
$ cat D:/multica-poc/rr-fixture/poc/leader-dispatch.txt
Run ID=01a13920-7d07-7be5-a8a1-31466d08caf3
Agent=c504a0d5-a97d-46ea-bc75-b7cd12afdded
UTC=2026-10-14T06:37:52.275Z
status=done
elapsed=58
```

### Overlapping writes to `D:\multica-poc\rr-fixture\poc/`

| Window (Beijing) | Who | File | UTC |
| --- | --- | --- | --- |
| 14:37:52 → 14:38:50 | Leader (main daemon) | `leader-dispatch.txt` (status=received → done) | 06:37:52.275 → 06:38:50.299 |
| 14:38:03 → 14:39:21 | Worker A (profile daemon) | `lock-A-start.txt` (06:38:03), `lock-A-end.txt` (06:39:21) | 06:38:03 → 06:39:21 |

**Concurrent writes to the same shared directory**:
- Leader wrote `leader-dispatch.txt` (status=received) at 14:37:52
- Worker A wrote `lock-A-start.txt` at 14:38:03 (11s after Leader's first write)
- Leader updated `leader-dispatch.txt` (status=done) at 14:38:50
- Worker A wrote `lock-A-end.txt` at 14:39:21

The Leader was actively writing to the shared directory while Worker A
was actively writing to the same shared directory — **simultaneously**, on
**two different daemon processes** with **no cross-daemon lock coordination**.

## Root cause — three independent isolation failures

1. **Lock is per-daemon-process, not global.** The profile daemon (49696)
   acquired the lock for `D:\multica-poc\rr-fixture` at 14:35:58; the main
   daemon (30748) had no knowledge of that lock and dispatched the Leader
   without any serialization against it.

2. **Per-task workdir is the only "isolation" mechanism, and it is
   cosmetic.** The Main daemon gave the Leader a per-task workdir at
   `C:\Users\lilei\multica_workspaces\...` — but the Agent itself can
   write anywhere, including the shared `D:\multica-poc\rr-fixture\poc/`.
   The workdir only constrains relative-path writes.

3. **The Leader's own self-report misinterpreted the evidence.** The
   Leader's final comment claimed "Worker A 锁已先释放" because it saw
   the OLD `poc/lock-A-end.txt` from S11-02 (UTC 06:28:09Z, ~10 minutes
   before this run). It did not notice the new RRNC-4 Worker A was
   actively writing `poc/lock-A-start.txt` at 06:38:03Z. This is itself
   a finding: the proposed "shared in_place directory" model makes it
   impossible for an Agent to distinguish stale state from current state
   by file inspection alone.

## Implication for the proposal

The proposal's claim that "Multica's native `local_directory` lock is a
sufficient serialization primitive" is **structurally false**:

- The lock is per-daemon-process state, not a global synchronization
  primitive. Two daemons (or two CLI instances, or a desktop app + CLI
  daemon) can each acquire it for the same `local_path`.
- The per-task workdir fallback (used by the Main daemon in this run)
  does not provide isolation either — Agents can use absolute paths to
  write to the shared `in_place` `local_directory`.

Therefore **S11-03 = FAIL** and the lock is unsafe as a single-host
serialization gate. The Squad Coordinator's `squad_concurrency +
per_member_max_concurrent` model remains the only known-safe way to
serialize concurrent runs on the same `in_place` `local_directory`.

## Action items

1. S11-03 = **FAIL**. Mark in §6 result table.
2. S11-04 (★ critical review-period pollution) is now expected to FAIL too
   for the same structural reason.
3. S11-05 (max_concurrent=1 variant) is the only remaining variant that
   *might* recover safety — but only if a single daemon handles all
   dispatches for the project (i.e. the per-daemon lock works when there's
   only one daemon). The hypothesis to test: with one daemon only, the
   per-daemon lock DOES serialize Agents — and the S11-02/03 failure was
   specifically caused by the two-daemon topology, not by Round Robin.

## Evidence files in this directory

- `leader-dispatch.txt` — Leader agent's write to `D:\multica-poc\rr-fixture\poc/`
  (Run ID 01a13920, Agent c504a0d5, UTC 06:37:52.275Z, elapsed=58s)
- `lock-A-start.txt` — Worker A (RRNC-4) first write to shared `poc/`
  (Run ID 01a1391f-f440, Agent 79e4eee1, UTC 06:38:03Z, cwd=D:\multica-poc\rr-fixture)
- `lock-A-end.txt` — Worker A (RRNC-4) last write
  (UTC 06:39:21Z, elapsed=78s)
- `issue-RRNC-03.md` — Leader fixture (Squad Leader RRNC-3 instructions)
- `issue-RRNC-04.md` — Worker A fixture (RRNC-4 instructions)
- `RRNC-3-comments.json` — Leader final comment (full JSON)
- `RRNC-4-comments.json` — Worker A final comment (full JSON)
- `RRNC-3-task-trace.log` — main daemon (PID 30748) full task trace for 01a13920
- `RRNC-4-task-trace.log` — profile daemon (PID 49696) full task trace for 01a1391f-f440
- `daemon-main-S11-03.log` — main daemon log, all entries mentioning either task
- `daemon-profile-S11-03.log` — profile daemon log, all entries mentioning either task
