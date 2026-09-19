# DEVENV-091 — A dependency tree can be unusable while every health check passes

- **Status:** Candidate
- **Area:** Dependency installation, diagnostics
- **Impact:** A worktree's dependencies became unusable mid-session with no `./agent setup`, repair,
  or install invoked. Both checks a reader would reach for said the tree was fine: `./agent doctor`
  reported `PASS dependencies: installed and complete against the frozen lockfile`, and
  `bun install --frozen-lockfile` reported `Checked 1302 installs across 1384 packages (no changes)`.
  Meanwhile 16 of 18 suites failed. The documented recovery works, but nothing points the reader at
  it, and the two commands that should have caught the state actively argued against it.
- **Evidence:** On 2026-09-19 in `verification-scheduling-evidence-92b890`, `just verify` passed
  every suite at 16:26. Twenty minutes later, with only documentation edits and two commits in
  between, the same lane failed 16 suites on
  `error: Cannot find package 'langium' from .../packages/parser/parser-src/tao-value-converter.ts`,
  classified `environment-setup`. `packages/parser/node_modules/langium` was absent; root
  `node_modules` was absent entirely (not the healthy five of DEVENV-084). `bun install
  --frozen-lockfile` alone changed nothing and did not repair it — only
  `rm -rf node_modules && bun install --frozen-lockfile` did, after which the lane passed 32 of 32.
  The trigger was never identified: nothing in the session ran an install, and DEVENV-084's `--force`
  repair path — the known cause of this symptom — is resolved and was not reached.
- **Workaround:** `rm -rf node_modules && bun install --frozen-lockfile` from an unsandboxed shell.
  Do not trust `bun install` alone: without the removal it reports success and repairs nothing.
- **Proposed change:** Make the dependency probe verify a package it can actually resolve rather than
  a stamp — `DependencyHealth` already knows the shape — so `./agent doctor` cannot report
  `installed and complete` against a tree whose workspace links are gone. Then have the lane
  classify `Cannot find package` as the dependency failure it is and print the `rm -rf` recovery,
  rather than the generic `environment-setup`.
- **Dependencies:** DEVENV-084 owns the repair path that produced this symptom from a known cause;
  this entry is the same symptom without one.
- **Acceptance:** A worktree whose workspace links are missing fails `./agent doctor`, and the first
  suite failure names the dependency tree and the recovery instead of `environment-setup`.
- **Source:** 2026-09-19 verification-scheduling acceptance-measurement attempt.
