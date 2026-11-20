---
title: S11-04 Review-Period Pollution — Evidence
contract: S11-RR-POC
status: fail
created_at: 2026-10-14
updated_at: 2026-10-14
---

# S11-04 Result — Review-Period Pollution (Issue in `blocked` is NOT isolated from subsequent Issues)

> 归档说明（2026-10-15）：本目录中的 JSON、日志和临时文本证据已清理，仅保留结果记录。

## Verdict

**FAIL** — A subsequent Issue (B / RRNC-6) successfully overwrote files in the
shared `in_place` `local_directory` while the prior Issue (A / RRNC-5) was in
`blocked` state. A's later Recovery Run (RRNC-7) saw `OWNER=B / issue=RRNC-6`
in both files, confirming that A's working-directory contents were **not
preserved** across the review/blocked gap.

This **structurally** invalidates the proposal's "Issue-level delivery
isolation" claim: in the `in_place` model, all active Issues share a single
working tree, and the `blocked` state provides no filesystem-level
isolation from subsequently dispatched Issues.

## Hypothesis under test

> Setting an Issue to `blocked` (or `in_review`) freezes its working
> directory contents; subsequent Issue dispatches cannot pollute the
> frozen working tree.

## Observed behavior

### Setup
- Project `6d065e40-...` `local_directory` = `D:\multica-poc\rr-fixture` (`in_place`)
- All three Issues dispatched to the same agent `S11 Worker A` (79e4eee1) via
  Round Robin (single profile daemon 49696).
- All three Runs reported `work_dir: D:\multica-poc\rr-fixture` — **same shared working tree**.

### Lifecycle (Beijing time)

| Time | Event | Issue | Source |
| --- | --- | --- | --- |
| 14:44:12 | RRNC-5 Run starts, writes `owner=A / issue=RRNC-5` to both files | RRNC-5 | run `started_at` |
| 14:45:19 | RRNC-5 files confirmed on disk: `owner=A / issue=RRNC-5` | RRNC-5 | filesystem |
| 14:46:10 | RRNC-5 Run ends; agent slept 45s per spec | RRNC-5 | run `completed_at` |
| 14:46:55 | RRNC-5 status → `blocked` (by test harness) | RRNC-5 | status command |
| 14:47:50 | RRNC-6 Run dispatched (B starts) | RRNC-6 | run `created_at` |
| 14:47:51 | RRNC-6 reads both files — sees `owner=A` (A's content preserved so far) | RRNC-6 | RRNC-6 final comment |
| 14:49:17 | RRNC-6 ends, overwrites both files with `owner=B / issue=RRNC-6` | RRNC-6 | run `completed_at` |
| 14:50:23 | RRNC-7 Run dispatched (A's recovery read) | RRNC-7 | run `created_at` |
| 14:51:54 | RRNC-7 ends, reads both files — sees **`owner=B / issue=RRNC-6`** | RRNC-7 | RRNC-7 final comment |

### Key observation — A's working tree was NOT preserved

| Time | File | Content | Reason |
| --- | --- | --- | --- |
| 14:46:10 (RRNC-5 done) | `poc/shared-contract.md` | `owner=A / issue=RRNC-5` | A's write |
| 14:47:51 (RRNC-6 reads) | `poc/shared-contract.md` | `owner=A / issue=RRNC-5` | A's content still on disk |
| 14:49:17 (RRNC-6 done) | `poc/shared-contract.md` | `owner=B / issue=RRNC-6` | B's overwrite |
| 14:51:54 (RRNC-7 reads) | `poc/shared-contract.md` | `owner=B / issue=RRNC-6` | B's content visible to A |

The state transition `A's content → B's content` happened **inside the
gap** between A's Run completion and A's recovery Run. From A's perspective,
its previous `owner=A` write was silently overwritten by another Issue's
write. The `blocked` status did not prevent this — neither the runtime
nor the filesystem offered any isolation.

### Worktree state at end of test

```
$ cat D:/multica-poc/rr-fixture/poc/shared-contract.md
owner=B
issue=RRNC-6

$ cat D:/multica-poc/rr-fixture/business-service/contract.txt
owner=B
issue=RRNC-6

$ git -C D:/multica-poc/rr-fixture status --short
 M poc/shared-contract.md
?? .claude/
?? .multica/
?? CLAUDE.md

$ git -C D:/multica-poc/rr-fixture/business-service status --short
 M contract.txt
```

Both files in the shared `in_place` working tree still carry B's content.
A's original `owner=A / issue=RRNC-5` content is gone from disk; it never
reached the Git index (no commit) and was overwritten by B before A's
recovery Run started.

## Root cause

The Multica `local_directory: in_place` execution mode shares a single
working tree across all Issues in the project. The `blocked` status is a
*workflow* state — it does not snapshot the filesystem, lock the
working tree, or branch the Git workspace. As long as the workspace uses
`in_place` mode with no per-Issue worktree, subsequent Issue dispatches
have full read/write access to the same files.

The proposal's "Round Robin + Multica native lock" model does not provide
any extra mechanism to prevent this. The lock in S11-02/03 was either
per-daemon (S11-03) or did not engage for the same Issue across blocked
state (S11-04 is dispatched after the prior Issue is `blocked`, not
concurrently, so the lock would not have helped even if global).

## Implication for the proposal

- "Issue-level delivery isolation" is **FAIL**: a `blocked` Issue's working
  tree contents are not preserved against writes from subsequently
  dispatched Issues.
- The proposal must either:
  1. Use per-Issue worktrees (not `in_place`), or
  2. Treat the `local_directory` as **shared mutable state** and
     guarantee safety through protocol only (commits/pushes/branch
     names that prevent collisions), or
  3. Acknowledge that "isolation" is an application-level concern, not a
     Multica runtime concern.

S11-05 will test (3) by reducing `Agent.max_concurrent_tasks=1` and
checking whether the same two-Issue sequence still fails. The hypothesis
to test: with `max_concurrent=1`, both A and B still run sequentially on
the same `in_place` worktree, so the gap between A's Run and A's recovery
Run is unavoidable and the same `owner=B` overwrite must still occur.

## Action items

1. S11-04 = **FAIL**. Mark in §6 result table.
2. S11-05 (max_concurrent=1 variant) is structurally expected to FAIL too
   for the same reason: `max_concurrent=1` controls overlap, not
   sequential reuse of the same `in_place` worktree.
3. S11-06 (off-hours pause) and S11-07 (cross-project port) — both
   marked NOT_RUN per the agreed scope.

## Evidence files in this directory

- `issue-RRNC-05.md` — Issue A fixture (writes `OWNER=A`)
- `issue-RRNC-06.md` — Issue B fixture (reads A, writes `OWNER=B`)
- `issue-RRNC-07.md` — Issue A Recovery Run fixture (read-only verify)
- `RRNC-5-comments.json` — RRNC-5 final comment (writes `owner=A`)
- `RRNC-6-comments.json` — RRNC-6 final comment (reads `owner=A`, writes `owner=B`)
- `RRNC-7-comments.json` — RRNC-7 final comment (reads `owner=B`, FAIL verdict)

## Run identity table

| Issue | Run ID | Agent | Start UTC | End UTC | Result |
| --- | --- | --- | --- | --- | --- |
| RRNC-5 (A) | `01a13927-76c8-7c44-b8ca-2305d7116fcb` | 79e4eee1 | 06:44:12Z | 06:46:10Z | wrote `owner=A` |
| RRNC-6 (B) | `01a1392a-d433-7082-b926-eecd714ccce2` | 79e4eee1 | 06:47:51Z | 06:49:17Z | saw `owner=A`, wrote `owner=B` |
| RRNC-7 (A recovery) | `01a1392d-2a78-797c-80c2-c0fbefef2e4e` | 79e4eee1 | 06:51:16Z | 06:51:54Z | saw **`owner=B`** (FAIL) |
