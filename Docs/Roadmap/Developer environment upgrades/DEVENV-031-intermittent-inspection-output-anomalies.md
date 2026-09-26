# DEVENV-031 — Intermittent inspection-output anomalies

- **Status:** Candidate
- **Section:** External
- **Area:** Host tooling
- **Impact:** One `rg` result appeared mangled and a one-off status read did not immediately show an
  untracked file, which can mislead concurrent review.
- **Evidence:** The original observations each occurred once. On 2026-09-26 in `feat/clerk-follow-through`,
  `codex-config-generation.test.ts` twice received empty stdout with exit0 from `CLI.run('git',
  {args: ['ls-files', '.claude', '.codex', '.cursor', '.rulesync'], cwd: Repo.getRoot()})` while direct
  Git still listed the files. The unchanged test subsequently passed twice. A test-context probe
  observed the correct root, no Git directory/index overrides, equal473-byte async/sync results,
  and stdout before child completion. No cause or code repair was established; do not attribute
  this to the account-server alias change or to async capture without further evidence.
- **Workaround:** Repeat the read, pin review to a commit, and run final status/diff checks after concurrent
  writers finish.
- **Proposed change:** Collect a reproducible command and raw output before changing repository tooling.
- **Dependencies:** External host behavior or concurrent filesystem timing.
- **Acceptance:** Either reproduce deterministically and open a scoped fix, or close after repeated clean
  observations.
- **Source:** 2026-09-03 companion and semantic-agent implementation briefings.
