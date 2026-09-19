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
  runs the full gate membership except the explicitly host-only browser and native UI gates, and
  never proves those gates passed. `studio-smoke-simulated-user` is one of them: it is an ordinary
  member of `VERIFY_FULL_GATES` again, no longer quarantined, and
  `just studio-smoke packages/dev/studio-smoke/studio-simulated-user.test.ts` runs it alone.
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
  invocation verifies, squashes, commits, and pushes. An agent runs it on its own judgment once the
  branch is ready, and says which verification evidence stood behind it and which gates did not run.
  It is a judgment, never a rhythm: do not automate it, and do not land a branch Ro is still
  reviewing. **Whether to land it yourself** below owns that judgment.
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
  drafts the message from commit subjects — it cannot know what the branch was _for_, so the draft is
  a starting point you edit, never the message you hand over.
- `./agent board` answers what no other command does: every worktree's branch, cleanliness, merge
  message, finalize state and last proof, beside the machine-wide lane and lease registry, led by
  whether this machine is busy and whether that is this checkout's own doing. Read it before
  concluding that a slow lane is a regression, and before landing, to see who else is close.
- Put its message at `.artifacts/merge/<full-feature-branch>.msg` unless passing `--message-file`.
  Write a summary of at most 72 characters, one blank line, then one or more contiguous `- ...`
  bullets, each free to wrap onto indented continuation lines. Do not add Git's squash appendix or
  any automated-author attribution; the command validates the complete final message and appends
  Git's generated appendix itself.
- The landing touches no checkout but the invoking one. It builds the squash commit with
  `git commit-tree` from the verified feature tree and moves `refs/heads/main` with `git update-ref`
  and an expected old value, so nothing is staged anywhere and two landings cannot interleave: the
  loser is refused and told to merge main and retry. A failed landing therefore leaves no commit and
  no staged state behind at all.
- No worktree may have `main` checked out while landing, and the command refuses if one does. A
  checkout that exists to show what `main` holds is detached at its tip
  (`git worktree add --detach <path> main`); every landing moves such a mirror forward itself while
  it is still clean and still where main was, and leaves an edited one alone with a warning. Treat a
  mirror as read-only: give it a branch of its own before working in it.
- `merge-with-main`'s flags only remove work. `--skip-verify-full` omits `just verify-full` on the
  feature branch, so `just verify --complete` runs on the branch instead; `--skip-verify` omits that
  fallback pass; `--skip-all` implies both, asks once with No as the default, and needs a terminal,
  so there is no way to land unverified non-interactively. The tree assertion runs under every
  combination including `--skip-all`, because the commit that lands must carry the tree that was
  verified. `./dev merge-with-main --dry-run` reports the plan and changes nothing. Preflight
  intentionally requires local `main` to equal `origin/main`, and requires `main` to be merged into
  the branch, which is what makes the squash the feature tree. A remote feature branch that is behind
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
  the gate is no faster for being backgrounded. **Reporting while a lane runs** below owns the one
  case that overrides this: a lane too long to wait out, with Ro waiting on it.
- Refresh the roadmap, ledger, and spec documents the work changed **before** verifying. A tracked
  edit made after a green lane changes the tree that lane proved, so the next lane runs everything
  again from nothing.
- A lane that is slow is usually not a regression. Read the `contention` block in
  `.artifacts/logs/<lane>/latest/summary.json` before diagnosing anything: it names how many lanes
  shared the machine and what the load reached.

## Reporting while a lane runs

A finalize whose verification runs for many minutes is the one place where backgrounding a gate is
right, because Ro is waiting on it and a silent agent is indistinguishable from a stuck one. What
backgrounding buys is the turn in which to say something; it does not buy the right to say nothing.

- Decide by how long the run is, not by which is tidier. A gate that finishes inside a minute runs
  in the foreground with a timeout. `finalize`'s verification lane, `verify-full`, and the landing
  run in the background with a report attached.
- Report about every 20 seconds, from the moment the lane starts until it reports its own verdict.
  Each note is one line: what finished since the last note, what is running now, and anything that
  has already failed. Do not wait to be asked, and do not wait for something interesting — a note
  that says only that the same node is still running is the report Ro wants, because it dates the
  silence.
- Take progress from the backgrounded command's own output and from the run's stamp directory,
  `.artifacts/logs/<lane>/<stamp>/`, where each node's `.log` lands as that node completes. `latest`
  and `summary.json` are written when the lane finishes, so never wait on them for progress and
  never read the previous run's `latest` as if it were this one's.
- Report what the run printed, not a verdict of your own. A node that timed out under load is the
  runner's to classify on its isolated retry: say it failed, say the retry decides, and leave it
  there. Nothing is green or red before its summary exists.
- Stop reporting when the lane reports. Then give the outcome once, with the evidence that stands
  behind it and the gates that did not run, as any finished lane is reported.
- This overrides nothing else. Do not background a gate that would have finished in the foreground,
  and never add a sleep loop whose only product is a progress note.
