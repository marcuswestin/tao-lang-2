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
- Every verification lane records the tree it proved green. Running the same lane, or a lane it
  contains, on a byte-identical tree prints the earlier run's evidence and stops instead of running;
  add `--fresh` to run anyway. A red or interrupted run records nothing.
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
- `just merge-with-main --execute --push --yes` is the landing command; those are `just` long flags,
  not `execute=true` positional assignments. An agent runs it on its own judgment once the branch is
  ready, and says which verification evidence stood behind it and which gates did not run. It is a
  judgment, never a rhythm: do not automate it, and do not land a branch Ro is still reviewing.
  **Whether to land it yourself** below owns that judgment.
- Write or update the message every time a branch becomes merge-ready, including when later commits
  change what the branch does. The command fails with `Merge message file does not exist` when the
  file is missing, so a branch handed over without it is not ready.
- `./agent finalize` does everything before that command: it asserts the branch and a clean tree,
  integrates `main`, runs a verification lane **only** when no green record already covers this exact
  tree, drafts the merge message from the branch's own commits, and prints what remains. It is cheap
  and safe to re-run, because it records what it established at `.artifacts/merge/<branch>.state.json`
  and redoes only what changed. Run it instead of performing the sequence by hand, and run it again
  after every round of Ro's corrections. `--check` previews without touching anything.
- Completing the work still means completing it: commits landed, worktree clean, affected roadmap and
  ledger documents refreshed, the reachable host lanes run, and the message reviewed. `finalize`
  drafts the message from commit subjects — it cannot know what the branch was *for*, so the draft is
  a starting point you edit, never the message you hand over.
- `./agent board` answers what no other command does: every worktree's branch, cleanliness, merge
  message, finalize state and last proof, beside the machine-wide lane and lease registry, led by
  whether this machine is busy and whether that is this checkout's own doing. Read it before
  concluding that a slow lane is a regression, and before landing, to see who else is close.
- Put its message at `.artifacts/merge/<full-feature-branch>.msg` unless passing `--message-file`.
  Write a summary of at most 72 characters, one blank line, then one or more contiguous `- ...`
  bullets. Do not add Git's squash appendix or any automated-author attribution; the command
  validates the complete final message and appends Git's generated appendix itself.
- `merge-with-main` defaults to a ref-preserving dry run. `--execute` enables mutation, `--yes`
  answers normal confirmation non-interactively, `--push` independently authorizes a
  non-interactive push, and `--skip-full-verify` is the only verification escape hatch. Execution
  takes a machine-wide landing lease and holds it from preflight through push, so a second landing
  waits its turn and prints who holds it rather than racing; `--refuse-if-busy` fails fast instead of
  waiting. It lands through a disposable integration worktree rather than the shared `main` checkout,
  and verifies that integration tree once — the branch-side lane is iteration evidence, not the gate.
  Preflight requires `origin/main` to be reachable, and requires a local `main` ref, when one exists,
  to agree with it. A remote feature branch that is behind
  the worktree is pushed forward during execution; only one holding commits the worktree lacks stops
  the landing. Successful execution leaves the invoking feature worktree clean and detached at the
  archived feature tip, deletes its local feature branch, and leaves worktree removal to archival of
  the owning task.
- `--abort <snapshot>` restores only command-owned local state while the snapshot still matches.
  Once a snapshot says `push-started`, the remote result may be ambiguous and automatic history
  rewriting is forbidden; inspect remote `main` and `merged/*` and follow the printed recovery
  guidance.

## Whether to land it yourself

The question is not how substantial the change is. It is whether the gates can prove it.

- **Land it yourself** when the gates that ran green cover the change: documentation, roadmap, agent
  instructions, developer tooling, and test-only changes always; product code whose behavior the
  suites actually exercise.
- **Bring it to ready and hand the landing to Ro** when the change reaches what no gate proves —
  Studio's or an app's visible behavior, a language surface Ro has not seen, native or device paths,
  or anything covered only by the lanes a person runs: `./dev studio-manual-checks`, a device
  install, and everything named in `FULL_VERIFY_SKIPPED`. Say exactly what needs looking at and why
  the gates do not settle it.
- A green `full-verify` is not by itself an answer. A change can pass every gate and still be one Ro
  wants to see first, because the thing it changed is the thing Ro is designing.
- When the two pull against each other, ask. A landing Ro did not want costs more than a question.

## Working inside a busy machine

- Never background a gate and then poll for its output in a sleep loop. Run it in the foreground
  with a timeout. The poll costs a model turn per iteration and rounds the wait up to its sleep, and
  the gate is no faster for being backgrounded.
- Refresh the roadmap, ledger, and spec documents the work changed **before** verifying. A tracked
  edit made after a green lane changes the tree that lane proved, so the next lane runs everything
  again from nothing.
- A lane that is slow is usually not a regression. Read the `contention` block in
  `.artifacts/logs/<lane>/latest/summary.json` before diagnosing anything: it names how many lanes
  shared the machine and what the load reached.
