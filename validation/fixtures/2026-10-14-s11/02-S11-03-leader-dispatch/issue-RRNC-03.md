# RRNC-03 — S11-03 Squad Leader dispatch test

## Purpose
Verify that a Squad Leader can be dispatched and run even while a Worker
Agent in the same Squad holds the shared `in_place` `local_directory` lock.

## Instructions for Agent (Squad Leader)
1. Read this Issue body, your `instructions` field, and your assigned Run ID.
2. Confirm you are running on `D:\multica-poc\rr-fixture` (Squad Project `local_directory`).
3. In `poc/`:
   - Create `leader-dispatch.txt` with: `Run ID=<run_id>\nAgent=<agent_id>\nUTC=<iso8601>\nstatus=received\n`
   - Sleep/loop 30-60 seconds to keep the Run active
   - Update `leader-dispatch.txt` with: `Run ID=<run_id>\nAgent=<agent_id>\nUTC=<iso8601>\nstatus=done\nelapsed=<seconds>\n`
4. Do NOT delegate, update status, mention, or create additional Issues.
5. Final comment must include: Issue ID, Run ID, Agent ID, start UTC, end UTC,
   whether the Issue was running while the Worker held the directory lock.
6. Hard constraints:
   - Only touch `D:\multica-poc\rr-fixture\poc/` and `business-service/`.
   - Do not `commit`/`push`/`clean`/`reset`.
   - Do not access real TFS, Git remote, PR, business repos, other workspaces.
