# RRNC-01 — S11-02 Worker A Long-Run

## Purpose
Verify that when two Worker Agents share an `in_place` `local_directory`, Multica native mechanism (`waiting_local_directory` lock) serializes them even when both Agent `max_concurrent_tasks >= 1`.

## Instructions for Agent
1. Read this Issue body, your `instructions` field, and your assigned Run ID.
2. In fixture path `D:\multica-poc\rr-fixture` (project `local_directory`):
   - Create `poc/lock-A-start.txt` with: `Run ID=<run_id>\nAgent=<agent_id>\nUTC=<iso8601>\ncwd=<abs_path>\n`
   - Sleep/loop 30-60 seconds to keep the Run active
   - Create `poc/lock-A-end.txt` with: `Run ID=<run_id>\nAgent=<agent_id>\nUTC=<iso8601>\nelapsed=<seconds>\n`
3. Final comment must include: Issue ID, Run ID, Agent ID, start UTC, end UTC.
4. Hard constraints:
   - Only touch `D:\multica-poc\rr-fixture\poc/` and `business-service/`.
   - Do not `commit`/`push`/`clean`/`reset`.
   - Do not access real TFS, Git remote, PR, business repos, other workspaces.
