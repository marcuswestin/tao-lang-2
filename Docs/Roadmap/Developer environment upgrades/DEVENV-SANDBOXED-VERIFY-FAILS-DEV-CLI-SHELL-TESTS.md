# DEVENV-SANDBOXED-VERIFY-FAILS-DEV-CLI-SHELL-TESTS — Sandboxed verification fails the dev-cli shell tests

- **Status:** Candidate
- **Section:** External
- **Area:** Agent sandbox, `verify-changed`, dev-cli shell activation tests.
- **Impact:** An agent cannot get a green `verify-changed` from its own shell whenever the change selects the dev-cli suite; the red gates look like a regression until the log is read.
- **Evidence:** On 2026-09-27, `./agent verify-changed` from the agent sandbox failed 19–25 dev-cli tests (enter-tao-dev-env, shell activation and setup), every one with EPERM in `prepareFixture`: the sandbox refuses writing any file named `.zshrc`, even a fixture copy under `.artifacts/scratch/`. The same tests pass on the host. Log: `.artifacts/logs/verify-changed/2026-09-27T20-07-38-147Z-65891-b13d2a07/`.
- **Workaround:** Read the log; when every failure is EPERM on `.zshrc`, rely on the host run inside `./agent unsandboxed land`.
- **Proposed change:** Name the fixture file something the sandbox allows and point the shell at it (`ZDOTDIR`), or have the gate report these tests as sandbox-skipped with the reason instead of failed.
- **Dependencies:** None.
- **Acceptance:** `verify-changed` from an agent shell passes or explicitly skips the dev-cli shell tests, and still runs them on the host.
- **Source:** Provider pairing and InstantDB auth, `feat/provider-bridges`, 2026-09-27.
