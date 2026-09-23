# DEVENV-A-MERGE-OF-MAIN-LEAVES-THE-CODEX-CONFIG-MISSING-UNTIL-SETUP-RUNS — A merge of main leaves the Codex config missing until setup runs

- **Status:** Candidate
- **Section:** External
- **Area:** Landing, generated harness files, worktrees
- **Impact:** `main` at `174e49a5` stopped tracking `.codex/config.toml` and made it a per-machine
  file that `./agent setup` renders. A worktree whose branch still tracked it loses the file when it
  merges that `main` — the merge deletes it and nothing regenerates it — and the next `verify-full`
  fails inside the landing lock with a bare `ENOENT` from `codex-config-generation.test.ts`, which
  never mentions `./agent setup`. Every worktree that crosses that commit pays one failed landing.
- **Evidence:** 2026-09-23, `./agent land` of `feat/ios-simulator-host-26f553` integrated `174e49a5`;
  `verify-full` failed at `packages/cli/agent-cli/agent-cli-tests/codex-config-generation.test.ts:329`
  with `ENOENT: no such file or directory, open '…/.codex/config.toml'`. `./agent setup` rendered the
  file in 2.5s and the retried landing passed. Measured: the failure, the rendered file, the retry.
- **Workaround:** Run `./agent setup` after merging `main`, before landing.
- **Proposed change:** Have the landing's preflight (and `./agent doctor`) check that every generated,
  untracked harness file exists and name `./agent setup` when one is missing; failing that, have the
  test report the missing file with that remedy instead of an `ENOENT`.
- **Dependencies:** None.
- **Acceptance:** Deleting `.codex/config.toml` and running `./agent land` refuses before the lock,
  naming `./agent setup`.
- **Source:** 2026-09-23, landing the iOS Simulator host for `A9`.
