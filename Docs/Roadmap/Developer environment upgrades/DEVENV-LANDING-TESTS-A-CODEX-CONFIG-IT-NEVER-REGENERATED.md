# DEVENV-LANDING-TESTS-A-CODEX-CONFIG-IT-NEVER-REGENERATED — A landing tests a Codex config it never regenerated

- **Status:** Candidate
- **Section:** External
- **Area:** Landing, generated harness config
- **Impact:** `./agent land` merges `main` into the branch and then runs `verify-full`, which includes
  `codex-config-generation.test.ts`'s check that the worktree's git-ignored `.codex/config.toml`
  equals a fresh render. When the incoming `main` changed what the renderer produces, the
  worktree's copy is stale and the landing fails, although the branch changed nothing there. Every
  landing that integrates such a change fails the same way until someone reruns setup.
- **Evidence:** 2026-09-23, landing `feat/standalone-tao-cli-release`: the merge brought
  `174e49a5` (agent file watching) and `verify-full` failed only on
  `Codex config generation > keeps the machine-local Codex profile identical to a fresh render`
  (`packages/cli/agent-cli/agent-cli-tests/codex-config-generation.test.ts:329`). `./agent setup`
  regenerated the file, the test passed, and the tracked tree did not change.
- **Workaround:** Run `./agent setup` in the worktree and land again.
- **Proposed change:** Have the landing regenerate git-ignored harness config after integrating
  `main` and before verifying, or have the test compare against a render into a temporary path
  rather than the checkout's machine-local copy.
- **Dependencies:** None.
