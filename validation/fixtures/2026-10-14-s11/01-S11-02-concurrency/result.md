---
title: S11-02 Concurrency — Evidence
contract: S11-RR-POC
status: fail
created_at: 2026-10-14
updated_at: 2026-10-14
---

# S11-02 Result — Round Robin + Multica Native Lock = UNSAFE

> 归档说明（2026-10-15）：本目录中的 JSON、日志和临时文本证据已清理，仅保留结果记录。

## Verdict

**FAIL** — Round Robin dispatch + Multica native `local_directory` lock is
**NOT** safe for serializing two concurrent Worker Agents on the same
`in_place` `local_directory`. File pollution observed in real execution.

The proposal's central hypothesis is **refuted**: Multica's
`waiting_local_directory` lock is **per-daemon-process**, not global across
all daemon processes. When two or more daemon processes run on the same host
(observed here), the lock does not serialize tasks across them.

## Hypothesis under test

> Squad Coordinator doesn't manage WAIT/Capacity; only does Round Robin.
> Multica native mechanisms (the `local_directory` lock) serialize
> concurrently-routed tasks. The Squad can be slimmed down to pure RR.

## Observed behavior — concurrent file writes

| Time (Beijing) | Event | Source |
| --- | --- | --- |
| 14:23:50.349 | Worker A (d957) wakeup | profile daemon log |
| 14:23:50.669 | **Worker A: `local_directory: lock acquired`** by profile daemon | profile daemon log |
| 14:23:54.383 | Worker B (e923) wakeup | main daemon log |
| 14:23:54.697 | **Worker B: `local_directory: lock acquired`** by main daemon | main daemon log |
| 14:26:31 | Worker B wrote `poc/lock-B-start.txt` (UTC 06:26:31) | file content |
| 14:27:24 | Worker A wrote `poc/lock-A-start.txt` (UTC 06:27:24) | file content |
| 14:27:47 | Worker B wrote `poc/lock-B-end.txt` (UTC 06:27:47, elapsed=76s) | file content |
| 14:28:09 | Worker A wrote `poc/lock-A-end.txt` (UTC 06:28:09, elapsed=45s) | file content |

**Overlapping active writes**:
- Worker A active during 14:27:24 → 14:28:09 (45s)
- Worker B active during 14:26:31 → 14:27:47 (76s)
- **Concurrent window**: 14:27:24 → 14:27:47 = **23 seconds** of overlapping writes
  to the same shared `in_place` `local_directory`.

## Root cause — two daemon processes, no cross-daemon lock

`Get-Process multica` shows **two** `multica.exe` daemon processes from
`C:\Users\lilei\.multica\bin\multica.exe` running simultaneously on the same
host:

| PID | Log file | Role (inferred) | Lock-grabbed for |
| --- | --- | --- | --- |
| 30748 | `~/.multica/daemon.log` | main daemon (daemon_id=01a01965-...) | Worker B (e923) |
| 49696 | `~/.multica/profiles/desktop-api.multica.ai/daemon.log` | profile daemon | Worker A (d957) |

Both daemons:
- Use the **same** `daemon_id` (`01a01965-2f6a-72fe-899f-3e7556c5d51d`)
- Hold the **same** `local_directory` lock for `D:\multica-poc\rr-fixture`
- Run agents on the **same** `runtime_id` (`857171d7-...`)

The lock is checked in **each daemon's own log** — neither daemon knows the
other exists. Each independently believes it has the lock. Both agents run
in parallel, both write to the shared directory.

`multica daemon status` reports `active_task_count: 1, resource_wait_task_count: 0`
from the perspective of PID 30748 only — it is blind to PID 49696's task.
The `Squad DS01` Round Robin dispatch sent both wakeups into the same runtime
at the same daemon-id, but Multica's native lock guarantees only "no two
tasks on the same local_directory **within a single daemon**" — not globally.

## Implication for the proposal

The proposal's claim that "Multica's native lock provides sufficient
serialization" is **not safe** in real deployments. The lock is not a global
synchronization primitive; it is per-daemon state. Any deployment that:

- Runs the Multica desktop app alongside a CLI daemon, **or**
- Operates a multi-user shared host, **or**
- Survives a daemon restart while a task is in flight

will see exactly this overlap. S11-04 (★ critical review-period pollution)
will likely also fail because the lock is per-daemon.

## Action items

1. S11-02 = **FAIL**. Mark in §6 result table.
2. **Do not** relax the Squad WAIT/Capacity model. The Coordinator's
   `squad_concurrency + per_member_max_concurrent` remains the only
   known-safe single-host serialization gate until Multica provides a
   global lock primitive.
3. Run S11-03 (Leader dispatch while Worker busy) — expect similar fail
   because the lock will not protect the third agent either.
4. Run S11-04 (★ critical file pollution during review period) — this is
   the headline scenario and will produce the strongest evidence.
5. Run S11-05 (max_concurrent=1 variant) — does tightening the Agent
   cap recover safety? Hypothesis: yes, but at the cost of throughput.

## Evidence files in this directory

- `lock-A-start.txt` — Worker A first write (14:27:24)
- `lock-A-end.txt` — Worker A last write (14:28:09, elapsed 45s)
- `lock-B-start.txt` — Worker B first write (14:26:31)
- `lock-B-end.txt` — Worker B last write (14:27:47, elapsed 76s)
- `daemon-main.log` — main daemon (PID 30748) full log; shows B's
  lock acquisition and 182 task trace entries for e923
- `daemon-profile.log` — profile daemon (PID 49696) full log; shows
  A's lock acquisition and 84 task trace entries for d957
- `daemon-status-t3.json` — final daemon status, active_task_count=0
- `issue-RRNC-01-final.json` — RRNC-1 in_review (Worker A done)
- `issue-RRNC-02-final.json` — RRNC-2 in_progress (Worker B done, agent
  left no status write per default)
- `RRNC-1-task-trace.log` — earlier evidence trace
- `RRNC-2-comments.json` — earlier evidence comments
- `daemon-logs-t1.log`, `daemon-logs-t2-late.log` — earlier daemon snapshots
