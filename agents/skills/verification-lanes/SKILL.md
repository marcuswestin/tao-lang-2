---
name: verification-lanes
description: >-
  Choose and use Tao test, verification, retry, sandbox, reporting, and human merge workflows.
---

# Verification Lanes

- Use `just test-changed` for ordinary iteration; pass a ref only when the branch base is not the
  default merge base with `origin/main` or local `main`.
- Use `just test-retry` after a red complete run. It selects files, not individual test names, and
  always prints how much green coverage it omitted.
- Use `just test "name"` for one name-filtered test and `just test-file <path>` for one exact Bun or
  runtime Jest file. A name that matches zero tests is an error.
- Use `just test` for the complete package and Tao app suite. It establishes the per-checkout
  ledger's full-run boundary whether green or red.
- A new worktree has a cold `.artifacts/testing/ledger.json`; retry therefore selects everything.
- `test-changed` and `test-retry` are iteration aids, never merge evidence. Repository gates never
  consult the ledger.
- The runner detects when changed or retry work deserves a complete pass and prints the reason; do
  not maintain a second trigger list in instructions.
- Run `./agent verify` before every commit.
- Run `./agent full-verify-sandbox` immediately before a merge when working in a managed shell. It
  runs the full gate membership except the five explicitly host-only Studio gates and never proves
  those gates passed.
- Run `just full-verify` from an unsandboxed normal terminal whenever Studio is in scope and before
  landing through the human merge workflow.
- Read `.artifacts/logs/<lane>/latest/summary.json` before diagnosing a red lane. A separately
  recorded retry attempt, not concatenated output, owns the final failure classification.
- A gate that passes its machine-exclusive confirmation is green evidence, remains marked
  `retried`, and emits a warning preserving the original timeout.
- `just test-flakes` and `just test-slowest` are reports, not gates.
- `just merge-with-main` is a human command. Agents prepare the branch and message file but never
  invoke, automate, or approve the command.
- `merge-with-main` defaults to a ref-preserving dry run. Its output names the explicit execution,
  verification-skip, and push flags; never substitute `--yes` for a less-strict choice. Preflight
  intentionally requires local `main` to equal `origin/main`, and successful execution removes the
  invoking feature worktree and invalidates its shell directory.
