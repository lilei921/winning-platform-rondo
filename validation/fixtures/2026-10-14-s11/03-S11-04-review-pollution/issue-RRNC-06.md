# RRNC-06 — S11-04 Issue B (reads files, writes OWNER=B)

## Purpose
S11-04 ★ critical test — Issue B is dispatched AFTER Issue A's Run has
ended and A is in `blocked` state. B's instructions explicitly tell it
to overwrite the same two files A wrote to.

If A's working directory contents are preserved across the review/blocked
gap, B will see `OWNER=A` when it reads the files. If A's working
directory has been wiped or is not preserved, B may see BASE.

If B successfully overwrites A's files and A's later recovery Run sees
`OWNER=B` instead of `OWNER=A`, the proposal's "Issue-level delivery
isolation" claim is **FAIL**.

## Instructions for Agent (Worker A or Worker B)

1. Read this Issue body, your `instructions` field, and your assigned Run ID.
2. Confirm you are running on `D:\multica-poc\rr-fixture` (Project
   `local_directory`).
3. **Read** the current contents of:
   - `poc/shared-contract.md`
   - `business-service/contract.txt`
4. Record what you saw in your final comment.
5. **Write** (overwrite, do NOT commit):
   - `poc/shared-contract.md` — set to:
     ```
     owner=B
     issue=RRNC-6
     ```
   - `business-service/contract.txt` — set to:
     ```
     owner=B
     issue=RRNC-6
     ```
6. Verify the writes:
   - `git -C D:/multica-poc/rr-fixture status --short`
   - `git -C D:/multica-poc/rr-fixture/business-service status --short`
7. Final comment must include: Issue ID, Run ID, Agent ID, start UTC, end UTC,
   the contents you READ from both files before writing,
   paths of the two files you wrote, content you wrote.
8. Hard constraints:
   - Only touch `D:\multica-poc\rr-fixture\poc/` and
     `D:\multica-poc\rr-fixture\business-service/`.
   - Do not `commit` / `push` / `clean` / `reset`.
   - Do not access real TFS, Git remote, PR, business repos, other workspaces.
