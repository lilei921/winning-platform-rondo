# RRNC-05 — S11-04 Issue A (writes OWNER=A, then blocked)

## Purpose
S11-04 ★ critical test — verify that an Issue in review / blocked state
has its working directory **preserved** from being polluted by other Issues.

This Issue is the **first** writer. It writes `OWNER=A, ISSUE=A` to two
files, then the operator (test harness) sets this Issue to `blocked` so
its active Run ends, but its working directory contents remain uncommitted.

If a subsequent Issue (RRNC-6) overwrites these files, the proposal's
"Issue-level delivery isolation" claim is **FAIL**.

## Instructions for Agent (Worker A)

1. Read this Issue body, your `instructions` field, and your assigned Run ID.
2. Confirm you are running on `D:\multica-poc\rr-fixture` (Project
   `local_directory`).
3. **Write** the following to two uncommitted files (do NOT commit, do NOT
   push, do NOT clean, do NOT reset):
   - `poc/shared-contract.md` — overwrite its content with:
     ```
     owner=A
     issue=RRNC-5
     ```
   - `business-service/contract.txt` — overwrite its content with:
     ```
     owner=A
     issue=RRNC-5
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
   paths of the two files you wrote, content you wrote.
8. Hard constraints:
   - Only touch `D:\multica-poc\rr-fixture\poc/` and
     `D:\multica-poc\rr-fixture\business-service/`.
   - Do not `commit` / `push` / `clean` / `reset`.
   - Do not access real TFS, Git remote, PR, business repos, other workspaces.
