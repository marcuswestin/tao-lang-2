---
name: verification-lanes
description: >-
  Choose and use Tao test, verification, retry, sandbox, reporting, and human merge workflows.
---

# Verification Lanes

- `verify` has two scopes and refuses to run without one. `./agent verify --changed` is the
  iteration lane: the fix, typecheck, and lint gates plus the test suites the branch diff reaches.
  `./agent verify --complete` runs the same gates over every suite and is the gate before a commit
  that goes to review and before the merge. A work-in-progress commit may stand on `--changed`.
- The changed scope selects whole suites from the workspace import graph: a package source change
  selects that package and every package importing it, a test file selects its own suite, an app
  change runs the Tao behavior tests under that app, and a path no rule owns widens the run to
  everything and says which path did it. It prints what it selected, why, and what it skipped.
- Every verification lane records the tree it proved green, keyed by the whole visible tree of this
  checkout together with the resolved `.devenv/profile` toolchain. Running the same lane, or a lane
  it contains, on a byte-identical tree with the same toolchain prints the earlier run's evidence and
  stops instead of running; add `--fresh` to run anyway. A red or interrupted run records nothing,
  and neither does a run whose tree changed under it — that run fails and names the paths that
  changed, because several agents may be editing one checkout.
- Three kinds of node are deliberately never skipped on a record: one that rewrites the tree or fills
  a generated directory, one whose verdict depends on the host (the Studio smokes, the native shell,
  the canary, the bundle proof), and a test node covering a file `just test-flakes` has seen flip
  without changing. Do not add a time-to-live to records instead; the backstop for what a tree cannot
  describe is a scheduled `just full-verify --fresh` on `main`.
- Nothing verifies the same bytes twice, so do not run a lane again "to be sure". After
  `verify --complete`, a `full-verify` at that same tree runs only the host-dependent gates; and the
  merge command proves the staged squash by comparing it to the tree `full-verify` already proved
  rather than by running a second lane.
- Use `just test-changed` for the test suites alone, without the fix and typecheck gates; pass a
  ref only when the branch base is not the default merge base with `origin/main` or local `main`.
- Use `just test-retry` after a red complete run. It selects files, not individual test names, and
  always prints how much green coverage it omitted.
- Use `just test "name"` for one name-filtered test and `just test-file <path>` for one exact Bun or
  runtime Jest file. A name that matches zero tests is an error.
- Use `just test` for the complete package and Tao app suite. It establishes the per-checkout
  ledger's full-run boundary whether green or red.
- A new worktree has a cold `.artifacts/testing/ledger.json`; retry therefore selects everything.
- `test-changed`, `verify --changed`, and `test-retry` are iteration aids, never merge evidence.
  Repository gates never consult the ledger.
- The runner detects when changed or retry work deserves a complete pass and prints the reason; do
  not maintain a second trigger list in instructions.
- Run `./agent full-verify-sandbox` immediately before a merge when working in a managed shell. It
  runs the full gate membership except the five explicitly host-only browser and native UI gates (the
  simulated-user journey, `studio-smoke-simulated-user`, is a separate quarantine skip, not a
  host-only gate; `just studio-smoke packages/dev/studio-smoke/studio-simulated-user.test.ts`
  reproduces it) and never proves those gates passed.
- Run `just full-verify` from an unsandboxed normal terminal whenever Studio is in scope and before
  landing through the human merge workflow.
- Read `.artifacts/logs/<lane>/latest/summary.json` before diagnosing a red lane. A separately
  recorded retry attempt, not concatenated output, owns the final failure classification. A node that
  fails again on its isolated retry is classified `repository`, not `machine-contention`. The other
  failure kinds name their cause: `native-host-busy` (another worktree holds the native host),
  `hutch-install-timeout`, `electrobun-prepare-timeout`, `native-probe-timeout`, `native-runtime-exit`,
  `test-assertion`, `environment-setup`, `optional-tooling`, `sandbox-restriction`, and
  `user-interruption`.
- A gate that passes its machine-exclusive confirmation is green evidence, remains marked
  `retried`, and emits a warning preserving the original timeout.
- `just test-flakes` and `just test-slowest` are reports, not gates.
- `just merge-with-main` is the landing command, and it takes no flag to do its job: the plain
  invocation verifies, squashes, commits, and pushes. Agents prepare the branch and message file and
  never land on their own initiative, never automate the command, and never decide a merge is
  warranted; they run it only when Ro asks for that merge in the current request, and say which
  verification evidence stood behind it.
- Write or update the message every time a branch becomes merge-ready, including when later commits
  change what the branch does. The command fails with `Merge message file does not exist` when the
  file is missing, so a branch handed over without it is not ready.
- Completing the work means completing everything before that command: commits landed, worktree
  clean, `verify --complete` and the reachable host lanes run, affected roadmap and ledger documents
  refreshed, and the message written. Do this unprompted, and repeat it after every round of Ro's
  corrections so the message never describes an earlier state of the branch.
- Put its message at `.artifacts/merge/<full-feature-branch>.msg` unless passing `--message-file`.
  Write a summary of at most 72 characters, one blank line, then one or more contiguous `- ...`
  bullets. Do not add Git's squash appendix or any automated-author attribution; the command
  validates the complete final message and appends Git's generated appendix itself.
- `merge-with-main`'s flags only remove work. `--skip-full-verify` omits `just full-verify` on the
  feature branch, so the staged squash gets `just verify --complete` instead; `--skip-verify` omits
  that staged-squash pass; `--skip-all` implies both, asks once with No as the default, and needs a
  terminal, so there is no way to land unverified non-interactively. The staged-squash tree-equality
  assertion runs under every combination including `--skip-all`, because the squash must be the tree
  that was verified. `./dev merge-with-main --dry-run` reports the plan and changes nothing.
  Preflight intentionally requires local `main` to equal `origin/main`. A remote feature branch that is behind
  the worktree is pushed forward during execution; only one holding commits the worktree lacks stops
  the landing. Successful execution leaves the invoking feature worktree clean and detached at the
  archived feature tip, deletes its local feature branch, and leaves worktree removal to archival of
  the owning task.
- `--abort <snapshot>` restores only command-owned local state while the snapshot still matches.
  Once a snapshot says `push-started`, the remote result may be ambiguous and automatic history
  rewriting is forbidden; inspect remote `main` and `merged/*` and follow the printed recovery
  guidance.
