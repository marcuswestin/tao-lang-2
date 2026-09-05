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
  runs the full gate membership except the six explicitly host-only browser and native UI gates and
  never proves those gates passed.
- Run `just full-verify` from an unsandboxed normal terminal whenever Studio is in scope and before
  landing through the human merge workflow.
- Read `.artifacts/logs/<lane>/latest/summary.json` before diagnosing a red lane. A separately
  recorded retry attempt, not concatenated output, owns the final failure classification.
- A gate that passes its machine-exclusive confirmation is green evidence, remains marked
  `retried`, and emits a warning preserving the original timeout.
- `just test-flakes` and `just test-slowest` are reports, not gates.
- `just merge-with-main` is a human command. Agents prepare the branch and message file but never
  invoke, automate, or approve the command. Ro runs `just merge-with-main --execute --push --yes`;
  those are `just` long flags, not `execute=true` positional assignments.
- Write or update the message every time a branch becomes merge-ready, including when later commits
  change what the branch does. The command fails with `Merge message file does not exist` when the
  file is missing, so a branch handed over without it is not ready.
- Put its message at `.artifacts/merge/<full-feature-branch>.msg` unless passing `--message-file`.
  Write a summary of at most 72 characters, one blank line, then one or more contiguous `- ...`
  bullets. Do not add Git's squash appendix or any automated-author attribution; the command
  validates the complete final message and appends Git's generated appendix itself.
- `merge-with-main` defaults to a ref-preserving dry run. `--execute` enables mutation, `--yes`
  answers normal confirmation non-interactively, `--push` independently authorizes a
  non-interactive push, and `--skip-full-verify` is the only verification escape hatch. Preflight
  intentionally requires local `main` to equal `origin/main`. A remote feature branch that is behind
  the worktree is pushed forward during execution; only one holding commits the worktree lacks stops
  the landing. Successful execution leaves the
  invoking feature worktree clean and detached at the archived feature tip, deletes its local
  feature branch, and leaves worktree removal to archival of the owning task.
- `--abort <snapshot>` restores only command-owned local state while the snapshot still matches.
  Once a snapshot says `push-started`, the remote result may be ambiguous and automatic history
  rewriting is forbidden; inspect remote `main` and `merged/*` and follow the printed recovery
  guidance.
