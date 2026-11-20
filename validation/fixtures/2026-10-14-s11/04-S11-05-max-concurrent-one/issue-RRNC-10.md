# RRNC-10 — S11-05 Issue A Recovery Run (read-only verify) — variant with `max_concurrent_tasks=1`

## Purpose
S11-05 — A's Recovery Run reads the two files and reports what it sees.

Expected per the S11-04 structural analysis: A will see `OWNER=B`,
because the in_place model reuses the same working tree across
sequential Runs and nothing reverts B's overwrite. If A sees
`OWNER=A`, then `max_concurrent=1` plus sequential dispatch somehow
preserved A's prior write — that would be an unexpected finding
favoring the proposal.

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
   - the Agent's current `max_concurrent_tasks`
6. Hard constraints:
   - Only touch `D:\multica-poc\rr-fixture\poc/` and
     `D:\multica-poc\rr-fixture\business-service/` (read-only).
   - Do not `commit` / `push` / `clean` / `reset` / `write`.
   - Do not access real TFS, Git remote, PR, business repos, other workspaces.
