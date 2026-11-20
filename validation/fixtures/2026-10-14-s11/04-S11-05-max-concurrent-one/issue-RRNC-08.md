# RRNC-08 — S11-05 Issue A (writes OWNER=A, then blocked) — variant with `max_concurrent_tasks=1`

## Purpose
S11-05 — same scenario as RRNC-05 (S11-04 Issue A) but the POC Agent's
`max_concurrent_tasks` is set to `1` for this round. The hypothesis to
test: if the only isolation failure is concurrent overlap, then with
`max_concurrent=1` (no overlap possible) A's `blocked` working tree
should be preserved from B's later write.

If A's later Recovery Run (RRNC-10) sees `OWNER=A` instead of `OWNER=B`,
then `max_concurrent=1` is sufficient. If A sees `OWNER=B`, then the
issue is structural to the `in_place` model (sequential reuse of the
same working tree), not concurrency — the proposal's "Round Robin +
Multica native lock" model is still UNSAFE.

## Instructions for Agent (Worker A)

1. Read this Issue body, your `instructions` field, and your assigned Run ID.
2. Confirm you are running on `D:\multica-poc\rr-fixture` (Project
   `local_directory`).
3. **Write** the following to two uncommitted files (do NOT commit, do NOT
   push, do NOT clean, do NOT reset):
   - `poc/shared-contract.md` — overwrite its content with:
     ```
     owner=A
     issue=RRNC-8
     ```
   - `business-service/contract.txt` — overwrite its content with:
     ```
     owner=A
     issue=RRNC-8
     ```
4. Verify the writes:
   - `git -C D:/multica-poc/rr-fixture status --short` shows the
     `poc/shared-contract.md` modification
   - `git -C D:/multica-poc/rr-fixture/business-service status --short` shows
     the `contract.txt` modification
5. **Do NOT** set Issue status — the test harness will set you to `blocked`
   after this Run ends.
6. Sleep 30-60 seconds to keep the Run active.
7. Final comment must include: Issue ID, Run ID, Agent ID, start UTC, end UTC,
   paths of the two files you wrote, content you wrote, and the Agent's
   current `max_concurrent_tasks` (from `multica agent get` if available,
   else just say "max_concurrent=1 round").
8. Hard constraints:
   - Only touch `D:\multica-poc\rr-fixture\poc/` and
     `D:\multica-poc\rr-fixture\business-service/`.
   - Do not `commit` / `push` / `clean` / `reset`.
   - Do not access real TFS, Git remote, PR, business repos, other workspaces.
