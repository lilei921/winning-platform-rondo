# RRNC-07 — S11-04 Issue A Recovery Run (verify what A sees)

## Purpose
S11-04 ★ critical test — A is reactivated with a new Run. A's recovery
Run reads the two files and reports what it sees.

If A sees `OWNER=B` (i.e. B's write overwrote A's content), then A's
working directory was NOT isolated from B during the review period —
**Delivery Isolation = FAIL**, and the proposal's "Round Robin + Multica
native lock" is UNSAFE.

If A sees `OWNER=A` (its own write preserved), then either A's working
directory is somehow isolated (unlikely given the shared in_place model),
or the files were not modified by anyone else.

## Instructions for Agent (Worker A)

1. Read this Issue body, your `instructions` field, and your assigned Run ID.
2. Confirm you are running on `D:\multica-poc\rr-fixture` (Project
   `local_directory`).
3. **Read** the current contents of:
   - `poc/shared-contract.md`
   - `business-service/contract.txt`
4. **DO NOT WRITE OR MODIFY** these files. Your job is read-only verification.
5. Final comment must include:
   - Issue ID, Run ID, Agent ID, start UTC, end UTC
   - the contents you READ from both files
   - explicit verdict: did you see `OWNER=A`, `OWNER=B`, or `BASE`?
   - `git -C D:/multica-poc/rr-fixture status --short` and
     `git -C D:/multica-poc/rr-fixture/business-service status --short` output
6. Hard constraints:
   - Only touch `D:\multica-poc\rr-fixture\poc/` and
     `D:\multica-poc\rr-fixture\business-service/` (read-only).
   - Do not `commit` / `push` / `clean` / `reset` / `write`.
   - Do not access real TFS, Git remote, PR, business repos, other workspaces.
