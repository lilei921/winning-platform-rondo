---
title: S11-06 Multi-Squad / Two-Daemon RR — NOT_RUN
contract: S11-RR-POC
status: not_run
created_at: 2026-10-14
updated_at: 2026-10-14
---

# S11-06 — NOT_RUN (per agreed scope)

> 归档说明（2026-10-15）：验证过程数据已清理，仅保留结果记录。

## Status

**NOT_RUN** — out of scope for this round per the agreed test plan.

## Reason

The proposal states:

> S11-06 (optional) — Two Squads / 2 Daemons / 2 Local Directories
> 4 Issues routed by RR rules; verify two independent directory
> isolation; runtime does not cross hosts.
>
> Two-host / cross-OS E2E requires two Daemons each pointing at
> their own Local Directory; **single-machine simulation of two
> Squads only proves the control-plane allocation rule, not host
> isolation or load distribution.**

User's confirmed scope for this round was a single-machine POC
(Windows + `D:\multica-poc\rr-fixture`), and S11-06 was explicitly
marked NOT_RUN.

The current run already incidentally observed two `multica.exe`
daemons running on the same host (PID 30748 main, PID 49696
profile). That two-daemon-on-one-host topology was the proximate
cause of the S11-02 / S11-03 failures (per-daemon lock, no cross-
daemon coordination), so the spirit of S11-06 was partly tested in
S11-03 — but as a *finding*, not as a planned multi-Squad scenario.

## What would be required to run S11-06 properly

- A second Windows or Linux machine
- A second `multica` daemon on that machine
- A second Project with a separate `local_directory` on the second
  host
- Two Squads (`DS01`, `DS02`) and four Issues (`RR-1`–`RR-4`) with
  the deterministic mapping `RR-1→DS01, RR-2→DS02, RR-3→DS01,
  RR-4→DS02`

This is deferred to a future round; current results (S11-02/03)
already cover the key risk that S11-06 was designed to test.
