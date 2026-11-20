---
title: S11-05 max_concurrent_tasks=1 Variant — Evidence
contract: S11-RR-POC
status: fail
created_at: 2026-10-14
updated_at: 2026-10-14
---

# S11-05 Result — `max_concurrent_tasks=1` Does NOT Fix Review-Period Pollution

> 归档说明（2026-10-15）：本目录中的 JSON、日志和临时文本证据已清理，仅保留结果记录。

## Verdict

**FAIL** — Even with `Agent.max_concurrent_tasks=1` (which guarantees no
concurrent overlap between A and B), A's `blocked` working tree was
**still** overwritten by B, and A's later Recovery Run saw `OWNER=B`.
The hypothesis to test — "with `max_concurrent=1` the only isolation
failure is concurrent overlap, so the `blocked` state should preserve
A's working tree" — is **falsified**.

The `max_concurrent=1` knob controls *overlap*, not *sequential reuse*
of the `in_place` working tree. Once any Agent Run (B) has written to
the shared files, the working tree carries B's content until either
(a) the files are reverted by a human, (b) a new commit reverts them,
or (c) the workspace switches to per-Issue worktrees. None of those
are runtime guarantees.

## Hypothesis under test

> If the only isolation failure in S11-04 was *concurrent overlap*
> between A and B, then setting `Agent.max_concurrent_tasks=1` for
> the round and dispatching A and B sequentially should preserve
> A's `blocked` working tree from B's overwrite.

## Setup

- Project `6d065e40-...` `local_directory` = `D:\multica-poc\rr-fixture` (`in_place`)
- `Agent.max_concurrent_tasks` set to `1` (verified via `multica agent get`) for
  S11 Worker A (`79e4eee1`) before RRNC-8 dispatch
- All three Issues (RRNC-8 A, RRNC-9 B, RRNC-10 A recovery) dispatched to
  S11 Worker A sequentially
- Same fixture baseline as S11-04 (both files reset to
  `BASE / owner=TBD / issue=TBD` before this test)
- After S11-05, `max_concurrent_tasks` restored to `2` (verified)

## Observed behavior

### Lifecycle (Beijing time)

| Time | Event | Run | Notes |
| --- | --- | --- | --- |
| 14:55:40 | RRNC-8 dispatched | `01a13931-ffcd` | profile daemon, `work_dir: D:\multica-poc\rr-fixture` |
| 14:57:42 | RRNC-8 files written: `owner=A / issue=RRNC-8` | — | filesystem |
| 15:01:40 | RRNC-8 Run ends (~6 min, including 45s sleep) | — | run `completed_at` |
| 15:01:54 | RRNC-8 → `blocked` | — | test harness |
| 15:02:00 | RRNC-9 dispatched | `01a1393a-…` (different ID, see below) | profile daemon |
| ~15:03 | RRNC-9 reads both files — sees `owner=A / issue=RRNC-8` | — | (A's content still on disk) |
| ~15:04 | RRNC-9 ends, overwrites both files with `owner=B / issue=RRNC-9` | — | filesystem |
| 15:05:00 | RRNC-9 → `blocked` | — | test harness |
| 15:05:06 | RRNC-10 dispatched | `01a1393a-a10d-75ac-802a-6c5de8fdf336` | **main daemon**, `work_dir: C:\Users\lilei\multica_workspaces_desktop-api.multica.ai\…\rrnc-10-…\workdir` (per-task workdir) |
| 15:11:15 | RRNC-10 reads both files (via absolute path) — sees **`owner=B / issue=RRNC-9`** | — | FAIL |

### Key observation — A still saw B's content despite `max_concurrent=1`

| Time | `poc/shared-contract.md` | `business-service/contract.txt` |
| --- | --- | --- |
| 14:57:42 (after RRNC-8) | `owner=A / issue=RRNC-8` | `owner=A / issue=RRNC-8` |
| ~15:04 (after RRNC-9) | `owner=B / issue=RRNC-9` | `owner=B / issue=RRNC-9` |
| 15:11:15 (RRNC-10 read) | `owner=B / issue=RRNC-9` | `owner=B / issue=RRNC-9` |

There was **zero overlap** between RRNC-8 and RRNC-9 — the
`max_concurrent=1` knob did its job in that respect. But RRNC-9 was
dispatched AFTER RRNC-8 completed and AFTER RRNC-8 was set to
`blocked`, so there was a 4-minute gap. RRNC-9 still successfully
overwrote A's files. RRNC-10 (A's recovery) then read the files and
saw B's content, not A's.

This is the **same FAIL as S11-04**, despite the concurrency knob
being set to its minimum. The isolation failure is **not** a
concurrency issue — it's a **shared working tree** issue.

### RRNC-10 was dispatched to a per-task workdir (different daemon!)

RRNC-10 was unexpectedly dispatched to the **main daemon**
(PID 30748) instead of the profile daemon (49696) that handled
RRNC-8 and RRNC-9. As a result, its `work_dir` was a per-task
workdir at
`C:\Users\lilei\multica_workspaces_desktop-api.multica.ai\…\rrnc-10-…\workdir`,
NOT the project `local_directory`.

The agent still used absolute paths
(`D:\multica-poc\rr-fixture\poc/shared-contract.md` and
`D:\multica-poc\rr-fixture\business-service\contract.txt`) to read
the files, so it observed the same shared state. This is the same
"per-task workdir is cosmetic, absolute paths bypass it" finding
from S11-03 — re-confirmed in S11-05.

This also reveals a related **non-determinism**: which daemon
handles a given Issue is not stable across runs. The Main daemon
(30748) picked up RRNC-10 after the profile daemon (49696) had
handled RRNC-8 and RRNC-9. This means:

- The Main daemon never tried to acquire the `local_directory` lock
  for `D:\multica-poc\rr-fixture` in this test (consistent with
  S11-03 — the Main daemon gives the Agent a per-task workdir by
  default and only acquires the project lock if the resource's
  `daemon_id` matches the Main daemon's id).
- The profile daemon (49696) DID acquire the lock for RRNC-8 and
  RRNC-9 (sequential, no contention).
- But this lock would not have helped anyway: A and B are
  sequential, not concurrent. The lock is irrelevant to the
  review-period gap.

## Root cause

Same as S11-04:

The Multica `local_directory: in_place` execution mode shares a
single working tree across all Issues. `blocked` is a workflow state
without filesystem-level guarantees. `max_concurrent_tasks` controls
overlap, not sequential reuse. Once any Run (B) writes to the shared
files, the working tree carries B's content; the next Run (A's
recovery) sees B's content, not its own prior write.

## Implication for the proposal

- `max_concurrent_tasks=1` does not address the review-period
  pollution. The proposal must either provide per-Issue worktrees,
  or accept that "isolation" is an application-level concern.
- The non-deterministic daemon selection (profile vs. main) for
  sequential runs is a **separate finding** for the proposal: the
  `daemon_id` of the resource binding controls which daemon picks up
  which Issue, and there's no global lock across daemons anyway
  (per-daemon lock from S11-03). Combined with the cosmetic per-task
  workdir, this means there is essentially **no isolation primitive
  available** in the current `in_place` model for the proposal to
  rely on.

## Action items

1. S11-05 = **FAIL**. Mark in §6 result table.
2. S11-06 and S11-07 = **NOT_RUN** per the agreed scope (single-machine
   POC, not two-daemon two-OS; no per-Issue worktree infrastructure
   available for S11-07).
3. Restore `max_concurrent_tasks` to 2 (done at 15:12:39, verified).

## Evidence files in this directory

- `issue-RRNC-08.md` — Issue A fixture (`max_concurrent=1` variant)
- `issue-RRNC-09.md` — Issue B fixture (`max_concurrent=1` variant)
- `issue-RRNC-10.md` — Issue A Recovery Run fixture (`max_concurrent=1` variant)
- `RRNC-8-comments.json` — RRNC-8 final comment (writes `owner=A`)
- `RRNC-9-comments.json` — RRNC-9 final comment (reads `owner=A`, writes `owner=B`)
- `RRNC-10-comments.json` — RRNC-10 final comment (reads `owner=B`, FAIL verdict)

## Run identity table

| Issue | Run ID | Daemon | Work dir | Start UTC | End UTC | Result |
| --- | --- | --- | --- | --- | --- | --- |
| RRNC-8 (A) | `01a13931-ffcd-7155-acf6-b982da846c25` | profile (49696) | `D:\multica-poc\rr-fixture` | 06:55:42Z | 07:01:40Z | wrote `owner=A` |
| RRNC-9 (B) | (see `RRNC-9-comments.json`) | profile (49696) | `D:\multica-poc\rr-fixture` | ~07:02Z | ~07:04Z | saw `owner=A`, wrote `owner=B` |
| RRNC-10 (A recovery) | `01a1393a-a10d-75ac-802a-6c5de8fdf336` | **main (30748)** | `C:\Users\lilei\multica_workspaces_…\rrnc-10-…\workdir` (per-task) | 07:05:09Z | 07:11:15Z | saw **`owner=B`** (FAIL, absolute-path bypass) |
