# Developer environment upgrades

This is the one durable backlog for repository setup, automation, verification, worktree,
diagnostic, and host-environment improvements. Product defects belong in their product roadmap;
an entry here may link one when the developer workflow is also affected.

Every entry is its own file under [`Developer environment upgrades/`](<Developer environment upgrades/>),
named `DEVENV-NNN-<slug>.md`. This page is the index: one line per entry, in its section, with the
status the entry itself records. `_repo-lint` fails when an entry file is missing from this index,
when the index names a file that does not exist, or when two files claim the same ID.

## Agent entry rules

- Search by ID, symptom, command, and area before adding an entry. Update the existing entry instead
  of appending a duplicate.
- The owning agent consolidates updates once after delegated findings return; subagents do not edit
  this backlog independently. Keep evidence concise: an entry file is private to its branch, but this
  index is shared, so every entry still costs exactly one shared line.
- A new entry is a new file. Write `Developer environment upgrades/DEVENV-NNN-<slug>.md` with the
  entry as its `# DEVENV-NNN — Title` heading and body, and add its one line to the section below.
  Never renumber an existing entry: its ID is quoted from other documents and from commit messages.
- Choose `NNN` as one past the highest ID that exists on `main`, not one past the highest in your own
  worktree — a branch that has been open a while is behind. Two branches can still choose the same
  number, and because each entry is its own file that collision merges silently; `_repo-lint` is what
  catches it. Whoever resolves it renames the **later-merged** file and its index line, and fixes any
  reference written in that same branch. Nothing else moves.
- Record only observed problems or credible improvements with concrete evidence; ordinary product
  failures do not belong here.
- Record: **Status**, **Area**, **Impact**, **Evidence**, **Workaround**, **Proposed change**,
  **Dependencies**, **Acceptance**, and **Source**. Use `None` when there is genuinely no workaround
  or dependency.
- Statuses are `Candidate`, `Planned`, `In progress`, `Incoming`, `Blocked`, `Resolved`, and `Closed`.
  `Incoming` means another unmerged branch owns the fix; re-verify it after that branch lands before
  changing the status to `Resolved`.
- Keep the index line's status in step with the entry's own `**Status:**` when you change it; that is
  the one fact stated in two places, and `_repo-lint` does not read it for you.
- A task that adds or materially updates an entry links this index once in its handoff. A task that
  changes nothing here says nothing about developer-environment feedback.

## Current verification-lanes slice

- [DEVENV-001 — Machine-wide lane admission](<Developer environment upgrades/DEVENV-001-machine-wide-lane-admission.md>) — Resolved
- [DEVENV-002 — Structured timeout and retry outcomes](<Developer environment upgrades/DEVENV-002-structured-timeout-and-retry-outcomes.md>) — Resolved
- [DEVENV-003 — Exclusive contention confirmation](<Developer environment upgrades/DEVENV-003-exclusive-contention-confirmation.md>) — Resolved
- [DEVENV-004 — Studio smoke port-block ownership](<Developer environment upgrades/DEVENV-004-studio-smoke-port-block-ownership.md>) — Resolved
- [DEVENV-005 — Sandbox-compatible full verification](<Developer environment upgrades/DEVENV-005-sandbox-compatible-full-verification.md>) — Resolved
- [DEVENV-006 — Honest focused-test selection](<Developer environment upgrades/DEVENV-006-honest-focused-test-selection.md>) — Resolved
- [DEVENV-007 — Per-test retry ledger and reports](<Developer environment upgrades/DEVENV-007-per-test-retry-ledger-and-reports.md>) — Resolved
- [DEVENV-008 — Collision-proof test artifacts](<Developer environment upgrades/DEVENV-008-collision-proof-test-artifacts.md>) — Resolved
- [DEVENV-009 — Safe, repeatable feature landing](<Developer environment upgrades/DEVENV-009-safe-repeatable-feature-landing.md>) — Resolved

## Incoming fixes — do not duplicate

- [DEVENV-010 — Preview publication and per-session bundler cache](<Developer environment upgrades/DEVENV-010-preview-publication-and-per-session-bundler-cache.md>) — Incoming
- [DEVENV-011 — Preview and native-launch diagnosis](<Developer environment upgrades/DEVENV-011-preview-and-native-launch-diagnosis.md>) — Incoming
- [DEVENV-012 — Companion endpoint and harness correctness](<Developer environment upgrades/DEVENV-012-companion-endpoint-and-harness-correctness.md>) — Incoming
- [DEVENV-013 — Repository-owned Expo cache and fast smoke failure](<Developer environment upgrades/DEVENV-013-repository-owned-expo-cache-and-fast-smoke-failure.md>) — Incoming
- [DEVENV-014 — Interaction-test cleanup and durable manual QA](<Developer environment upgrades/DEVENV-014-interaction-test-cleanup-and-durable-manual-qa.md>) — Incoming

## Deferred project — begin after the large branches land

- [DEVENV-015 — Reliable host-browser verification](<Developer environment upgrades/DEVENV-015-reliable-host-browser-verification.md>) — Planned
- [DEVENV-016 — Studio process ownership and status](<Developer environment upgrades/DEVENV-016-studio-process-ownership-and-status.md>) — Planned
- [DEVENV-017 — Studio snapshot command consistency](<Developer environment upgrades/DEVENV-017-studio-snapshot-command-consistency.md>) — Planned
- [DEVENV-018 — Semantic facts and coverage commands](<Developer environment upgrades/DEVENV-018-semantic-facts-and-coverage-commands.md>) — Planned
- [DEVENV-019 — Idempotent workspace opening](<Developer environment upgrades/DEVENV-019-idempotent-workspace-opening.md>) — Planned
- [DEVENV-020 — Companion lifecycle and diagnostics](<Developer environment upgrades/DEVENV-020-companion-lifecycle-and-diagnostics.md>) — Planned
- [DEVENV-021 — Safe scratch scripts and concurrent staging](<Developer environment upgrades/DEVENV-021-safe-scratch-scripts-and-concurrent-staging.md>) — Planned
- [DEVENV-022 — Raw Error policy for failure mocks](<Developer environment upgrades/DEVENV-022-raw-error-policy-for-failure-mocks.md>) — Planned
- [DEVENV-023 — React Native test renderer convention](<Developer environment upgrades/DEVENV-023-react-native-test-renderer-convention.md>) — Planned
- [DEVENV-024 — Branch-local semantic cleanup](<Developer environment upgrades/DEVENV-024-branch-local-semantic-cleanup.md>) — Blocked

## Resolved or currently mitigated

- [DEVENV-025 — Worktree-safe CLI test roots](<Developer environment upgrades/DEVENV-025-worktree-safe-cli-test-roots.md>) — Resolved
- [DEVENV-026 — Opt-in underlying error diagnostics](<Developer environment upgrades/DEVENV-026-opt-in-underlying-error-diagnostics.md>) — Resolved
- [DEVENV-027 — Watchman-free package-local Jest](<Developer environment upgrades/DEVENV-027-watchman-free-package-local-jest.md>) — Resolved
- [DEVENV-028 — Non-incremental dprint in managed worktrees](<Developer environment upgrades/DEVENV-028-non-incremental-dprint-in-managed-worktrees.md>) — Resolved
- [DEVENV-029 — Materialized development profile and writable caches](<Developer environment upgrades/DEVENV-029-materialized-development-profile-and-writable-caches.md>) — Resolved

## External and observational findings

- [DEVENV-030 — Managed-shell command constraints](<Developer environment upgrades/DEVENV-030-managed-shell-command-constraints.md>) — Closed
- [DEVENV-031 — Intermittent inspection-output anomalies](<Developer environment upgrades/DEVENV-031-intermittent-inspection-output-anomalies.md>) — Candidate
- [DEVENV-032 — Hosted model and evolving mock-shape observations](<Developer environment upgrades/DEVENV-032-hosted-model-and-evolving-mock-shape-observations.md>) — Closed
- [DEVENV-033 — Conflicting color-mode warning noise](<Developer environment upgrades/DEVENV-033-conflicting-color-mode-warning-noise.md>) — Candidate
- [DEVENV-034 — Bun worker-pool test scheduling](<Developer environment upgrades/DEVENV-034-bun-worker-pool-test-scheduling.md>) — Candidate
- [DEVENV-035 — Performance-contract timeout under the full graph](<Developer environment upgrades/DEVENV-035-performance-contract-timeout-under-the-full-graph.md>) — Resolved
- [DEVENV-036 — Critical-path verification startup and host-wait concurrency](<Developer environment upgrades/DEVENV-036-critical-path-verification-startup-and-host-wait-concurrency.md>) — In progress
- [DEVENV-037 — Native Studio host coordination and bounded Hutch phases](<Developer environment upgrades/DEVENV-037-native-studio-host-coordination-and-bounded-hutch-phases.md>) — Resolved
- [DEVENV-038 — Machine-lane lease age uses mismatched clocks](<Developer environment upgrades/DEVENV-038-machine-lane-lease-age-uses-mismatched-clocks.md>) — Candidate
- [DEVENV-039 — Native Studio launch resolves the generated app before it is written](<Developer environment upgrades/DEVENV-039-native-studio-launch-resolves-the-generated-app-before-it-is.md>) — Candidate
- [DEVENV-040 — Bun dependency recovery conflicts with protected package fixtures](<Developer environment upgrades/DEVENV-040-bun-dependency-recovery-conflicts-with-protected-package-fix.md>) — Candidate
- [DEVENV-041 — Nested gate-runner tests inherit the live machine registry](<Developer environment upgrades/DEVENV-041-nested-gate-runner-tests-inherit-the-live-machine-registry.md>) — Resolved
- [DEVENV-042 — Studio smoke observes persistence before browser reconciliation](<Developer environment upgrades/DEVENV-042-studio-smoke-observes-persistence-before-browser-reconciliat.md>) — In progress
- [DEVENV-043 — Changed-files lane fails every package with no affected tests](<Developer environment upgrades/DEVENV-043-changed-files-lane-fails-every-package-with-no-affected-test.md>) — Resolved
- [DEVENV-044 — Typecheck gate runs 19 projects serially on the legacy compiler](<Developer environment upgrades/DEVENV-044-typecheck-gate-runs-19-projects-serially-on-the-legacy-compi.md>) — Resolved
- [DEVENV-045 — Agent shell habits route routine commands through harness review](<Developer environment upgrades/DEVENV-045-agent-shell-habits-route-routine-commands-through-harness-re.md>) — In progress
- [DEVENV-046 — The tao-apps suite is one 22-second process on the test critical path](<Developer environment upgrades/DEVENV-046-the-tao-apps-suite-is-one-22-second-process-on-the-test-crit.md>) — Candidate
- [DEVENV-047 — Release-bundle proof shares Metro's cache with every other worktree](<Developer environment upgrades/DEVENV-047-release-bundle-proof-shares-metro-s-cache-with-every-other-w.md>) — Candidate
- [DEVENV-048 — A fresh linked worktree cannot launch Studio until the parser is generated](<Developer environment upgrades/DEVENV-048-a-fresh-linked-worktree-cannot-launch-studio-until-the-parse.md>) — Candidate
- [DEVENV-049 — A fresh worktree cannot run `./tao` until the parser is generated](<Developer environment upgrades/DEVENV-049-a-fresh-worktree-cannot-run-tao-until-the-parser-is-generate.md>) — Candidate
- [DEVENV-050 — `tao test` under a Git-ignored path says "No Tao tests found" without the reason](<Developer environment upgrades/DEVENV-050-tao-test-under-a-git-ignored-path-says-no-tao-tests-found-wi.md>) — Candidate
- [DEVENV-051 — `sips` exits 13 inside the Claude Code Bash sandbox](<Developer environment upgrades/DEVENV-051-sips-exits-13-inside-the-claude-code-bash-sandbox.md>) — Candidate
- [DEVENV-052 — `bun --tsconfig-override` fails for scripts outside the repository](<Developer environment upgrades/DEVENV-052-bun-tsconfig-override-fails-for-scripts-outside-the-reposito.md>) — Candidate
- [DEVENV-055 — No repository command compiles a native module](<Developer environment upgrades/DEVENV-055-no-repository-command-compiles-a-native-module.md>) — Candidate
- [DEVENV-053 — Verifying a sibling worktree from an agent shell needs unsandboxed commands](<Developer environment upgrades/DEVENV-053-verifying-a-sibling-worktree-from-an-agent-shell-needs-unsan.md>) — Candidate
- [DEVENV-054 — A forced `Bun.serve` stop strands another test's in-process WebSocket dial](<Developer environment upgrades/DEVENV-054-a-forced-bun-serve-stop-strands-another-test-s-in-process-we.md>) — Resolved
- [DEVENV-056 — Visual review can lose its renderer context during preview reload](<Developer environment upgrades/DEVENV-056-visual-review-can-lose-its-renderer-context-during-preview-r.md>) — Resolved
- [DEVENV-057 — `git hash-object --stdin-paths` cannot hash a directory symlink](<Developer environment upgrades/DEVENV-057-git-hash-object-stdin-paths-cannot-hash-a-directory-symlink.md>) — Candidate
- [DEVENV-058 — The CLI's bundled `@tao/*` module directory is never filled](<Developer environment upgrades/DEVENV-058-the-cli-s-bundled-tao-module-directory-is-never-filled.md>) — Candidate
- [DEVENV-059 — Xcode 27 runtime installation can strand Apple device services](<Developer environment upgrades/DEVENV-059-xcode-27-runtime-installation-can-strand-apple-device-servic.md>) — Incoming
- [DEVENV-060 — One denied host probe crashes the capabilities report](<Developer environment upgrades/DEVENV-060-one-denied-host-probe-crashes-the-capabilities-report.md>) — Incoming
- [DEVENV-061 — `bun test` from the repository root loses subprocess output](<Developer environment upgrades/DEVENV-061-bun-test-from-the-repository-root-loses-subprocess-output.md>) — Candidate
- [DEVENV-062 — The default Codex profile cannot refresh its generated Codex configuration](<Developer environment upgrades/DEVENV-062-the-default-codex-profile-cannot-refresh-its-generated-codex.md>) — Candidate
- [DEVENV-063 — Studio preview needs the materialized Watchman profile in managed task shells](<Developer environment upgrades/DEVENV-063-studio-preview-needs-the-materialized-watchman-profile-in-ma.md>) — Candidate
- [DEVENV-064 — Generated-artifact cleanup is denied after files gain macOS provenance](<Developer environment upgrades/DEVENV-064-generated-artifact-cleanup-is-denied-after-files-gain-macos.md>) — In progress
- [DEVENV-065 — The raw-`Error` allowlist is line-precise with no way to re-derive it](<Developer environment upgrades/DEVENV-065-the-raw-error-allowlist-is-line-precise-with-no-way-to-re-de.md>) — Candidate
- [DEVENV-066 — Browser-harness gestures silently miss an occluded target](<Developer environment upgrades/DEVENV-066-browser-harness-gestures-silently-miss-an-occluded-target.md>) — Mitigated for offset gestures
- [DEVENV-067 — A failing deep-equality assertion on AST nodes can exhaust the machine's memory](<Developer environment upgrades/DEVENV-067-a-failing-deep-equality-assertion-on-ast-nodes-can-exhaust-t.md>) — In progress
- [DEVENV-068 — A child process cannot execute `ps` inside the Bash sandbox](<Developer environment upgrades/DEVENV-068-a-child-process-cannot-execute-ps-inside-the-bash-sandbox.md>) — Candidate
- [DEVENV-069 — An in-flight edit to a shared package fails other agents' test runs and names the wrong file](<Developer environment upgrades/DEVENV-069-an-in-flight-edit-to-a-shared-package-fails-other-agents-tes.md>) — Candidate
- [DEVENV-070 — This ledger no longer fits one agent read](<Developer environment upgrades/DEVENV-070-this-ledger-no-longer-fits-one-agent-read.md>) — Candidate
- [DEVENV-071 — `rg`'s `-r` is a replacement string, not grep's recursion flag](<Developer environment upgrades/DEVENV-071-rg-s-r-is-a-replacement-string-not-grep-s-recursion-flag.md>) — Candidate
- [DEVENV-072 — Shared devenv profile makes its coreutils vanish mid-command in every worktree](<Developer environment upgrades/DEVENV-072-shared-devenv-profile-makes-its-coreutils-vanish-mid-command.md>) — Candidate
- [DEVENV-073 — Gate-runner tests assume an idle machine, so contention handling fails its own suite](<Developer environment upgrades/DEVENV-073-gate-runner-tests-assume-an-idle-machine-so-contention-handl.md>) — Incoming
- [DEVENV-074 — `./agent fix` cannot format the skills it is told to format](<Developer environment upgrades/DEVENV-074-agent-fix-cannot-format-the-skills-it-is-told-to-format.md>) — Candidate
- [DEVENV-075 — A tracked process was re-identified by a name that changes at `exec`](<Developer environment upgrades/DEVENV-075-process-supervision-survival-assertions-flake-under-load.md>) — Resolved
- [DEVENV-076 — A documentation-only change selects no test suites](<Developer environment upgrades/DEVENV-076-a-documentation-only-change-selects-no-test-suites.md>) — Candidate
- [DEVENV-077 — A busy machine could admit no lane at all](<Developer environment upgrades/DEVENV-077-a-busy-machine-could-admit-no-lane-at-all.md>) — Incoming
- [DEVENV-078 — A peer's exclusive confirmation blocks every other lane without bound](<Developer environment upgrades/DEVENV-078-a-peer-s-exclusive-confirmation-blocks-every-other-lane-with.md>) — Candidate
- [DEVENV-079 — A per-test timeout measured in wall time judges the machine, not the test](<Developer environment upgrades/DEVENV-079-a-per-test-timeout-measured-in-wall-time-judges-the-machine.md>) — Resolved
- [DEVENV-080 — The prepare chain was re-paid on every lane at an unchanged tree](<Developer environment upgrades/DEVENV-080-the-prepare-chain-was-re-paid-on-every-lane-at-an-unchanged.md>) — Resolved
- [DEVENV-081 — `tao test` discarded its compiled output on every passing run](<Developer environment upgrades/DEVENV-081-tao-test-discarded-its-compiled-output-on-every-passing-run.md>) — Resolved
- [DEVENV-082 — No pseudo-terminal inside the agent sandbox](<Developer environment upgrades/DEVENV-082-no-pseudo-terminal-inside-the-agent-sandbox.md>) — Candidate
- [DEVENV-083 — The WordFlower compile was re-paid on every test invocation](<Developer environment upgrades/DEVENV-083-the-wordflower-compile-was-re-paid-on-every-test-invocation.md>) — Resolved
- [DEVENV-084 — `./agent`'s dependency repair could only ever damage the tree it repaired](<Developer environment upgrades/DEVENV-084-agent-setup-s-sandboxed-install-destroys-a-healthy-depend.md>) — Resolved
- [DEVENV-085 — Jest crawled the compile cache, so the better the cache worked the slower every run got](<Developer environment upgrades/DEVENV-085-jest-crawled-the-compile-cache-on-every-run.md>) — Resolved
- [DEVENV-086 — The compiled-app fingerprint hashes all of `packages/`, so any concurrent edit invalidates every memo](<Developer environment upgrades/DEVENV-086-the-compiled-app-fingerprint-hashes-all-of-packages.md>) — Candidate
- [DEVENV-087 — A permission pattern matched only one of git's two argument orders](<Developer environment upgrades/DEVENV-087-a-permission-pattern-matched-only-one-of-git-s-two-orders.md>) — Resolved
- [DEVENV-088 — `merge-with-main`'s preflight cannot reach `origin` from inside the sandbox](<Developer environment upgrades/DEVENV-088-merge-with-main-s-preflight-cannot-reach-origin-from-inside-the-sandbox.md>) — Candidate
- [DEVENV-089 — A fixture holding the output-capture queue through a spawn stalls its whole shard](<Developer environment upgrades/DEVENV-089-a-fixture-holding-the-output-capture-queue-through-a-spawn.md>) — Candidate
