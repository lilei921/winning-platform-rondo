# RRNC-09 — S11-05 Issue B (reads files, writes OWNER=B) — variant with `max_concurrent_tasks=1`

## Purpose
S11-05 — same scenario as RRNC-06 (S11-04 Issue B) but the POC Agent's
`max_concurrent_tasks` is set to `1`. If `max_concurrent=1` serializes
A and B (no overlap), and B's Run starts AFTER A's Run is fully
complete, the question is whether A's working tree is still
preserved from B's overwrite.

If B reads `OWNER=A` (i.e. A's previous write is still on disk) and
then writes `OWNER=B`, A's later Recovery Run (RRNC-10) should see
`OWNER=A` again ONLY if the runtime reverts the working tree. The
runtime does not do that (no per-Issue worktree was created), so we
expect RRNC-10 to see `OWNER=B` again — the same FAIL as S11-04.

## Instructions for Agent (Worker A)

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
     issue=RRNC-9
     ```
   - `business-service/contract.txt` — set to:
     ```
     owner=B
     issue=RRNC-9
     ```
6. Verify the writes:
   - `git -C D:/multica-poc/rr-fixture status --short`
   - `git -C D:/multica-poc/rr-fixture/business-service status --short`
7. Final comment must include: Issue ID, Run ID, Agent ID, start UTC, end UTC,
   the contents you READ from both files before writing,
   paths of the two files you wrote, content you wrote, and the Agent's
   current `max_concurrent_tasks`.
8. Hard constraints:
   - Only touch `D:\multica-poc\rr-fixture\poc/` and
     `D:\multica-poc\rr-fixture\business-service/`.
   - Do not `commit` / `push` / `clean` / `reset`.
   - Do not access real TFS, Git remote, PR, business repos, other workspaces.
