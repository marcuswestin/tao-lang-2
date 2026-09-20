# Developer environment upgrades — archive

This is the closed record of [`Developer environment upgrades.md`](<Developer environment upgrades.md>).
An entry arrives here once it has been addressed: `Resolved` when the repository or host behaves as
the entry's acceptance describes, `Closed` when the entry was withdrawn, superseded, or found not to
be a repository problem. Entry files live in
[`Developer environment upgrades/Archive/`](<Developer environment upgrades/Archive/>); this page is
their index, and `_repo-lint` holds both indexes to their files exactly as it does the open backlog.

## Archive rules

- Archiving is part of the change that addresses an entry, not a later tidy-up. Set the entry's
  `**Status:**`, `git mv` its file into `Developer environment upgrades/Archive/`, and move its index
  line here. An addressed entry never stays in the open index.
- Keep the file whole: same ID, same filename, every field, and the evidence that settled it. Name the
  branch or commit that settled it in **Evidence** or **Dependencies**, and append
  `- **Archived:** <YYYY-MM-DD>` as the last field.
- Never reuse an archived ID. The next free ID is one past the highest that exists on `main` across
  both indexes.
- An archived entry that regresses moves back to the open backlog under its original ID, with the new
  evidence appended. Do not open a second entry for it.
- `Incoming` means another unmerged branch owns the fix; it is archived only after that branch lands
  and the fix is re-verified here.
- Keep this index in ID order, one line per entry, its status matching the entry's own.

## Entries

- [DEVENV-001 — Machine-wide lane admission](<Developer environment upgrades/Archive/DEVENV-001-machine-wide-lane-admission.md>) — Resolved
- [DEVENV-002 — Structured timeout and retry outcomes](<Developer environment upgrades/Archive/DEVENV-002-structured-timeout-and-retry-outcomes.md>) — Resolved
- [DEVENV-003 — Exclusive contention confirmation](<Developer environment upgrades/Archive/DEVENV-003-exclusive-contention-confirmation.md>) — Resolved
- [DEVENV-004 — Studio smoke port-block ownership](<Developer environment upgrades/Archive/DEVENV-004-studio-smoke-port-block-ownership.md>) — Resolved
- [DEVENV-005 — Sandbox-compatible full verification](<Developer environment upgrades/Archive/DEVENV-005-sandbox-compatible-full-verification.md>) — Resolved
- [DEVENV-006 — Honest focused-test selection](<Developer environment upgrades/Archive/DEVENV-006-honest-focused-test-selection.md>) — Resolved
- [DEVENV-007 — Per-test retry ledger and reports](<Developer environment upgrades/Archive/DEVENV-007-per-test-retry-ledger-and-reports.md>) — Resolved
- [DEVENV-008 — Collision-proof test artifacts](<Developer environment upgrades/Archive/DEVENV-008-collision-proof-test-artifacts.md>) — Resolved
- [DEVENV-009 — Safe, repeatable feature landing](<Developer environment upgrades/Archive/DEVENV-009-safe-repeatable-feature-landing.md>) — Resolved
- [DEVENV-025 — Worktree-safe CLI test roots](<Developer environment upgrades/Archive/DEVENV-025-worktree-safe-cli-test-roots.md>) — Resolved
- [DEVENV-026 — Opt-in underlying error diagnostics](<Developer environment upgrades/Archive/DEVENV-026-opt-in-underlying-error-diagnostics.md>) — Resolved
- [DEVENV-027 — Watchman-free package-local Jest](<Developer environment upgrades/Archive/DEVENV-027-watchman-free-package-local-jest.md>) — Resolved
- [DEVENV-028 — Non-incremental dprint in managed worktrees](<Developer environment upgrades/Archive/DEVENV-028-non-incremental-dprint-in-managed-worktrees.md>) — Resolved
- [DEVENV-029 — Materialized development profile and writable caches](<Developer environment upgrades/Archive/DEVENV-029-materialized-development-profile-and-writable-caches.md>) — Resolved
- [DEVENV-030 — Managed-shell command constraints](<Developer environment upgrades/Archive/DEVENV-030-managed-shell-command-constraints.md>) — Closed
- [DEVENV-032 — Hosted model and evolving mock-shape observations](<Developer environment upgrades/Archive/DEVENV-032-hosted-model-and-evolving-mock-shape-observations.md>) — Closed
- [DEVENV-035 — Performance-contract timeout under the full graph](<Developer environment upgrades/Archive/DEVENV-035-performance-contract-timeout-under-the-full-graph.md>) — Resolved
- [DEVENV-037 — Native Studio host coordination and bounded Hutch phases](<Developer environment upgrades/Archive/DEVENV-037-native-studio-host-coordination-and-bounded-hutch-phases.md>) — Resolved
- [DEVENV-041 — Nested gate-runner tests inherit the live machine registry](<Developer environment upgrades/Archive/DEVENV-041-nested-gate-runner-tests-inherit-the-live-machine-registry.md>) — Resolved
- [DEVENV-042 — Studio smoke observes persistence before browser reconciliation](<Developer environment upgrades/Archive/DEVENV-042-studio-smoke-observes-persistence-before-browser-reconciliat.md>) — Resolved
- [DEVENV-043 — Changed-files lane fails every package with no affected tests](<Developer environment upgrades/Archive/DEVENV-043-changed-files-lane-fails-every-package-with-no-affected-test.md>) — Resolved
- [DEVENV-044 — Typecheck gate runs 19 projects serially on the legacy compiler](<Developer environment upgrades/Archive/DEVENV-044-typecheck-gate-runs-19-projects-serially-on-the-legacy-compi.md>) — Resolved
- [DEVENV-054 — A forced `Bun.serve` stop strands another test's in-process WebSocket dial](<Developer environment upgrades/Archive/DEVENV-054-a-forced-bun-serve-stop-strands-another-test-s-in-process-we.md>) — Resolved
- [DEVENV-056 — Visual review can lose its renderer context during preview reload](<Developer environment upgrades/Archive/DEVENV-056-visual-review-can-lose-its-renderer-context-during-preview-r.md>) — Resolved
- [DEVENV-070 — This ledger no longer fits one agent read](<Developer environment upgrades/Archive/DEVENV-070-this-ledger-no-longer-fits-one-agent-read.md>) — Resolved
- [DEVENV-075 — A tracked process was re-identified by a name that changes at `exec`](<Developer environment upgrades/Archive/DEVENV-075-process-supervision-survival-assertions-flake-under-load.md>) — Resolved
- [DEVENV-079 — A per-test timeout measured in wall time judges the machine, not the test](<Developer environment upgrades/Archive/DEVENV-079-a-per-test-timeout-measured-in-wall-time-judges-the-machine.md>) — Resolved
- [DEVENV-080 — The prepare chain was re-paid on every lane at an unchanged tree](<Developer environment upgrades/Archive/DEVENV-080-the-prepare-chain-was-re-paid-on-every-lane-at-an-unchanged.md>) — Resolved
- [DEVENV-081 — `tao test` discarded its compiled output on every passing run](<Developer environment upgrades/Archive/DEVENV-081-tao-test-discarded-its-compiled-output-on-every-passing-run.md>) — Resolved
- [DEVENV-083 — The WordFlower compile was re-paid on every test invocation](<Developer environment upgrades/Archive/DEVENV-083-the-wordflower-compile-was-re-paid-on-every-test-invocation.md>) — Resolved
- [DEVENV-084 — `./agent`'s dependency repair could only ever damage the tree it repaired](<Developer environment upgrades/Archive/DEVENV-084-agent-setup-s-sandboxed-install-destroys-a-healthy-depend.md>) — Resolved
- [DEVENV-085 — Jest crawled the compile cache, so the better the cache worked the slower every run got](<Developer environment upgrades/Archive/DEVENV-085-jest-crawled-the-compile-cache-on-every-run.md>) — Resolved
- [DEVENV-087 — A permission pattern matched only one of git's two argument orders](<Developer environment upgrades/Archive/DEVENV-087-a-permission-pattern-matched-only-one-of-git-s-two-orders.md>) — Resolved
- [DEVENV-092 — A landing staged its squash in a shared checkout, where another agent committed it](<Developer environment upgrades/Archive/DEVENV-092-a-landing-staged-its-squash-in-a-shared-checkout.md>) — Resolved
- [DEVENV-095 — Merge finalization is a prose protocol with no command behind it](<Developer environment upgrades/Archive/DEVENV-095-merge-finalization-had-no-command-behind-it.md>) — Resolved
- [DEVENV-100 — Finalize never accepts a `verify-full` green record](<Developer environment upgrades/Archive/DEVENV-100-finalize-never-accepts-a-verify-full-green-record.md>) — Resolved
- [DEVENV-104 — `./dev` restores dependencies without satisfying `./agent`'s install stamp](<Developer environment upgrades/Archive/DEVENV-104-dev-restores-dependencies-without-satisfying-agent-s-install-stamp.md>) — Resolved
