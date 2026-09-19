---
name: verification-lanes
description: >-
  Choose and use Tao test, verification, retry, sandbox, reporting, and human merge workflows.
---

# Verification Lanes

- Each verification scope is its own command, not a flag, so it completes under `./agent verify<TAB>`
  and widens in the order the names sort: `verify-changed` is the iteration lane (the fix, typecheck,
  and lint gates plus the test suites the branch diff reaches), `verify` runs the same gates over
  every suite and is the gate before a commit that goes to review and before the merge, `verify-full`
  adds the browser, native, and bundle lanes, and `verify-full-sandbox` runs that membership in a
  managed shell. A work-in-progress commit may stand on `verify-changed`. `--no-cache` is the one flag
  they all take; `./agent verify --complete` stays accepted as the explicit spelling of bare `verify`.
- The changed scope selects whole suites from the workspace import graph: a package source change
  selects that package and every package importing it, a test file selects its own suite, an app
  change runs the Tao behavior tests under that app, and a path no rule owns widens the run to
  everything and says which path did it. It prints what it selected, why, and what it skipped.
- Every verification lane records the tree it proved green, keyed by the whole visible tree of this
  checkout together with the resolved `.devenv/profile` toolchain. Re-running it on a byte-identical
  tree with the same toolchain skips the gates the record covers, one gate at a time, printing the
  earlier run's evidence for each; add `--no-cache` to run them anyway. A record written by one lane
  is read by any lane whose gates it contains, which is why the `--green-tree` lists differ. A red or
  interrupted run records nothing, and neither does a run whose tree changed under it — that run
  fails and names the paths that changed, because several agents may be editing one checkout.
- The saving is per gate, never a lane that declines to start. Every lane in the `Justfile` contains
  `_parser-gen` and `_compile-word-flower-app`, which are generators and so never skippable, so no
  lane a person runs is ever skipped wholesale — and that is the point rather than a shortfall. A
  lane that stood on a record without running its generators would report PASSED over a tree whose
  generated output it never made, which is exactly what `just verify && just clean && just verify`
  would produce. A generator skipped gate-by-gate still costs only its stamp check.
- Four kinds of node are deliberately never skipped on a record, each for something the tree hash
  cannot see: a generator, whose output tree is Git-ignored, so a fresh checkout hashes identically
  to one that has it; a node whose verdict depends on the host (the Studio smokes, the native shell,
  the canary, the bundle proof); a test node covering a file `just report-test-stats` has seen flip
  without changing; and a reader of a generated tree in a lane that does not run that tree's
  generator, since nothing there attests the tree is current. A fixer is the exception that proves
  the rule: it rewrites the tree and is still recordable, because it declares `canonicalises` and
  the run additionally checks that the prepare phase left the tree byte-identical. Do not add a
  time-to-live to records instead; the backstop for what a tree cannot describe is a scheduled
  `just verify-full --no-cache` on `main`.
- Nothing verifies the same bytes twice, so do not run a lane again "to be sure". After
  `verify --complete`, a `verify-full` at that same tree runs only the host-dependent gates; and the
  merge command proves the staged squash by comparing it to the tree `verify-full` already proved
  rather than by running a second lane.
- Bare `just test` is the changed scope: the test suites alone, without the fix and typecheck gates.
  Reach for `just test-changed` only to pass a ref, when the branch base is not the default merge
  base with `origin/main` or local `main`.
- Use `just test-retry` after a red complete run, or `just retry`, which is the same recipe under the
  shorter name. It selects files, not individual test names, and always prints how much green
  coverage it omitted.
- `just test <target>` takes one optional target and resolves it by existence, not by shape: an
  argument that exists on disk is a file or directory to run, anything else is a test-name pattern.
  The recipe prints which reading it chose, so check that line before reading the result. A name that
  matches zero tests is an error.
- A test-name pattern narrows a scope rather than replacing it. `just test "<name>"` runs the suites
  the branch diff reaches, filtered to that name; `just test-all "<name>"` is the same filter over
  every suite, including the Tao behavior suite, which is told to pass on no match because a name
  that selects plenty elsewhere normally selects no journey. A filtered run is never full-run
  evidence: it skipped most of the tests in the suites it scheduled.
- Use `just test-all` for the complete package and Tao app suite. It establishes the per-checkout
  ledger's full-run boundary whether green or red. Bare `just test` is the changed scope, which is a
  heuristic over the branch diff and can be green while a suite the change broke never ran.
- A new worktree has a cold `.artifacts/testing/ledger.json`; retry therefore selects everything.
- Bare `just test`, `test-changed`, `verify-changed`, and `test-retry` are iteration aids, never
  merge evidence.
  Repository gates never consult the ledger.
- The runner detects when changed or retry work deserves a complete pass and prints the reason; do
  not maintain a second trigger list in instructions.
- Run `./agent verify-full-sandbox` immediately before a merge when working in a managed shell. It
  runs the full gate membership except the five explicitly host-only browser and native UI gates (the
  simulated-user journey, `studio-smoke-simulated-user`, is a separate quarantine skip, not a
  host-only gate; `just studio-smoke packages/dev/studio-smoke/studio-simulated-user.test.ts`
  reproduces it) and never proves those gates passed.
- Run `just verify-full` from an unsandboxed normal terminal whenever Studio is in scope and before
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
- `just report-test-stats` prints both ledger reports, suspected flakes and slowest tests, in one
  run; one `limit` bounds both. They are reports, not gates.
- A lane does not fail on a test the ledger has already watched contradict itself. A test node whose
  every failure is a test with two or more recorded outcome reversals at an unchanged file identity
  is reported `passed`, keeping its non-zero exit code; the summary names each demoted test with the
  evidence, and the verdict line ends `— tolerating N known flakes`. Read those names before calling
  such a lane green: a tolerated failure is still a failure, it just is not this branch's. Tolerance
  is withdrawn automatically when the test fails three runs in a row or its file changes, and a node
  that timed out, crashed, or reported nothing per-test is never tolerated at all.
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
  bullets, each free to wrap onto indented continuation lines. Do not add Git's squash appendix or
  any automated-author attribution; the command validates the complete final message and appends
  Git's generated appendix itself.
- `merge-with-main`'s flags only remove work. `--skip-verify-full` omits `just verify-full` on the
  feature branch, so the staged squash gets `just verify --complete` instead; `--skip-verify` omits
  that staged-squash pass; `--skip-all` implies both, asks once with No as the default, and needs a
  terminal, so there is no way to land unverified non-interactively. The staged-squash tree-equality
  assertion runs under every combination including `--skip-all`, because the squash must be the tree
  that was verified. `./dev merge-with-main --dry-run` reports the plan and changes nothing.
  Preflight intentionally requires local `main` to equal `origin/main`. It does not require a worktree
  on `main`: a checkout on main is somewhere to stage the squash, not a precondition, so execution
  creates one under `.artifacts/merge/main-worktree` and removes it when the landing completes, while
  a dry run only names where it would go. More than one main worktree is still refused. A failed
  landing keeps the created worktree, because its staged squash is what `--abort` restores from, and
  the next run then finds it as an ordinary main worktree. `--skip-verify-full` is refused when the
  worktree has to be created, because that flag moves verification into it and a fresh worktree has no
  installed dependencies. A remote feature branch that is behind
  the worktree is pushed forward during execution; only one holding commits the worktree lacks stops
  the landing. Successful execution leaves the invoking feature worktree clean and detached at the
  archived feature tip, deletes its local feature branch, and leaves worktree removal to archival of
  the owning task.
- `--abort <snapshot>` restores only command-owned local state while the snapshot still matches.
  Once a snapshot says `push-started`, the remote result may be ambiguous and automatic history
  rewriting is forbidden; inspect remote `main` and `merged/*` and follow the printed recovery
  guidance.
