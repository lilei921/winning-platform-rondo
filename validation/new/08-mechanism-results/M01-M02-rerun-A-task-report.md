M01 / M02 Run A: native checkout failure

- Issue: TEST-4 / 01a1d2f7-1170-7db0-88a9-cf4af76d8a6f
- Task: 01a1d2f7-1194-711e-8a65-d94092ff9604
- M01: FAIL. First native checkout returned exit 1, stderr: `checkout failed: repo is configured but not synced`.
- M02 same Task: NOT_RUN. M02 cross Run: NOT_RUN / pending controller Run B. M02 overall: NOT_RUN; no PASS claim.
- All identity/resource prerequisites matched. Resource ref: main. Root was absent before the attempt and remains absent afterward.
- Exact invocation: `& "$env:MULTICA_CLI_PATH" repo checkout <configured-root-URL> --ref main` from this Task workdir. Full sanitized argv, timestamps, exit code and separate stdout/stderr are in JSON.
- Error category: checkout_repository_sync_state. Native output does not establish authentication, network, URL-validation or daemon-timeout causes.
- No checkout path returned; root HEAD, branch, origin/main, .git and common-dir cannot be measured. Controller's earlier main hash is not treated as this run's result.
- Re-entry, dirty-tree preservation, registry/ignore checks and all M02 fixture work were NOT_RUN after the mandatory stop. No root/child markers or marker hashes exist. No child repository or fixture was created.
- No retry, root clone, fresh/reset/clean, cache/config/credential/production changes, remote write, push, PR or commit was performed. Only this test Issue's workflow status and final result delivery were changed.
- M01 unpushed-commit coverage: NOT_RUN. Cold-cache preparation: NOT_RUN. Four business Agent types: NOT_RUN. Real business repository authentication: NOT_RUN.
- Versions: Multica 0.8.1 / b1ea927de; Git 2.54.0.windows.1; Rondo 1.2.20 / Node v22.22.2.
- Initial login-shell profile emitted an AuthorizationManager warning before CLI issue get (CLI exit 0). Validation commands used PowerShell -NoProfile; no policy or profile was changed.
- Environment evidence stores only token/daemon-port presence and selected identity IDs; no raw environment, token, daemon port value or credentials were persisted.

Workdir: `C:\Users\lilei\multica_workspaces\rondo-test-8ef6a0bcf15d\test-4-d94092ff9604\workdir`

Expected root path (absent; not a returned checkout path): `C:\Users\lilei\multica_workspaces\rondo-test-8ef6a0bcf15d\test-4-d94092ff9604\workdir\winning-platform-monorepo`

The current Run A cannot supply a fixture for a subsequent read-only Run B. Controller action is required before another independent checkout validation; this agent did not change repository sync state or start another Run.
