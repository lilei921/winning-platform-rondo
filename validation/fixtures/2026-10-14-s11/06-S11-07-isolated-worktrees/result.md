---
title: S11-07 Per-Issue Worktree / Cross-Submodule Isolation — NOT_RUN
contract: S11-RR-POC
status: not_run
created_at: 2026-10-14
updated_at: 2026-10-14
---

# S11-07 — NOT_RUN (no per-Issue worktree infrastructure available)

> 归档说明（2026-10-15）：验证过程数据已清理，仅保留结果记录。

## Status

**NOT_RUN** — the precondition for S11-07 (per-Issue worktrees for
the root repo AND each independent business submodule) is not in
place.

## Reason

The proposal states:

> Only run if a per-Issue independent root-repo + per-related
> business-submodule + recovery-path mechanism already exists.
>
> If only the root-repo `worktree` is used, and the independent
> business submodule has no synchronized isolation, it **must not**
> be considered a pass.

> **PASS:** real, sustained Issue-level full-workspace isolation
> evidence. If this isolation is not implemented, mark `NOT_RUN` —
> do not build a complete system just to validate.

User's confirmed scope for this round was a single-machine POC
without per-Issue worktree infrastructure. The fixture uses two
**independent** Git repos (root `rr-fixture` and submodule-style
`business-service/`) but with `in_place` `execution_mode` — the
runtime does not create per-Issue worktrees, so no S11-07 isolation
exists to test.

The S11-04 and S11-05 results already demonstrate that under
`in_place` mode with no per-Issue worktree, A's `blocked` working
tree is not preserved from B's overwrite. That finding is the
"if only root worktree, no synchronized submodule isolation" case
the proposal warns about — so the negative result of S11-04/05
already covers the spirit of S11-07's negative precondition
without needing an additional dedicated run.

## What would be required to run S11-07 properly

- Per-Issue worktree creation at runtime, including:
  - One worktree per Issue on the root repo
  - One worktree per Issue on each related independent submodule
  - Recovery path that maps a blocked Issue back to its worktree
- A fixture that exercises the recovery path (A blocked, B
  modified, A recovered) on the worktree infrastructure

This is deferred to a future round; current results (S11-04/05)
already cover the key risk that S11-07 was designed to test, and
the proposal explicitly says not to build a complete system just
to validate.
