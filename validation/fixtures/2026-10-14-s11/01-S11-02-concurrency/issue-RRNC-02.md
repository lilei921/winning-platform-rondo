# RRNC-02 — S11-02 Worker B Long-Run

## Purpose
Same as RRNC-01, but executed by Worker B in parallel, to verify Multica serializes them via `waiting_local_directory` lock.

## Instructions for Agent
1. Read this Issue body, your `instructions` field, and your assigned Run ID.
2. In fixture path `D:\multica-poc\rr-fixture` (project `local_directory`):
   - Create `poc/lock-B-start.txt` with: `Run ID=<run_id>\nAgent=<agent_id>\nUTC=<iso8601>\ncwd=<abs_path>\n`
   - Sleep/loop 30-60 seconds to keep the Run active
   - Create `poc/lock-B-end.txt` with: `Run ID=<run_id>\nAgent=<agent_id>\nUTC=<iso8601>\nelapsed=<seconds>\n`
3. Final comment must include: Issue ID, Run ID, Agent ID, start UTC, end UTC.
4. Hard constraints: same as RRNC-01.
