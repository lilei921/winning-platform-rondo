---
title: S11-01 Squad vs Agent Concurrency Thresholds — Evidence
contract: S11-RR-POC
status: pass
created_at: 2026-10-14
updated_at: 2026-10-14
---

# S11-01 Result — Squad Has No Native Concurrency Threshold

> 归档说明（2026-10-15）：本目录中的 JSON、日志和临时文本证据已清理，仅保留结果记录。

## Verdict

**PASS** — POC Squad `DS01` (`979f6c0f`) has **no** independent
`capacity` or `max_concurrent_tasks` field. The only concurrency
controls are at the **Agent** level (e.g. `max_concurrent_tasks: 2`
on Worker A, `max_concurrent_tasks: 1` on Worker B). The runtime
also has its own daemon-level concurrency, and the project resource
binding has `execution_mode` (e.g. `in_place`).

Therefore the proposal's "Squad does RR only; Multica native mechanisms
serialize" claim must rest on Agent, Runtime/Daemon, and
`local_directory` lock — not on Squad-level capacity.

## Hypothesis under test

> Squad-level `capacity` / `max_concurrent_tasks` exists in Multica
> and can be relied on to serialize concurrent dispatches. If it
> does NOT exist, then concurrency control falls to Agent / Daemon /
> `local_directory` lock, each of which has different semantics.

## Observations

| Object | Field | Value | Source |
| --- | --- | --- | --- |
| Squad `DS01` (979f6c0f) | `capacity` | (field absent) | `squad-ds01.json` |
| Squad `DS01` (979f6c0f) | `max_concurrent_tasks` | (field absent) | `squad-ds01.json` |
| Agent Worker A (79e4eee1) | `max_concurrent_tasks` | `2` (initial; set to `1` in S11-05, then restored to `2`) | `agent-worker-a.json` |
| Agent Worker B (e9230d97) | `max_concurrent_tasks` | `1` | `agent-worker-b.json` |
| Agent Squad Leader (c504a0d5) | `max_concurrent_tasks` | `1` | `agent-leader.json` |
| Runtime (any) | (concurrency) | not exposed as a per-Runtime field; controlled by Daemon process config | (not in fixture) |
| Project `6d065e40-…` | `local_directory.execution_mode` | `in_place` | `project-resources.json` |

## Implication for the proposal

- The proposal's claim that "Squad only does Round Robin, Multica
  native mechanisms serialize" is **factually correct** at the
  Squad level — Squads have no concurrency primitives of their own.
- The serialization, however, must be supplied by Agent
  `max_concurrent_tasks`, Runtime/Daemon-level caps, and
  `local_directory` lock. As S11-02 / S11-03 / S11-04 / S11-05
  show, **none of these three are sufficient** on their own for the
  "Round Robin + native lock" model the proposal is testing.
- Therefore the "Squad is RR-only" framing is **descriptively
  accurate but operationally insufficient** for the proposal's
  stated safety claim.

## Evidence files in this directory

- `squad-ds01.json` — full Squad `DS01` definition
- `agent-leader.json` — Squad Leader agent definition
- `agent-worker-a.json` — Worker A agent definition
- `agent-worker-b.json` — Worker B agent definition
- `project-resources.json` — Project `6d065e40-…` resource bindings
  (including `local_directory` and `daemon_id`)
