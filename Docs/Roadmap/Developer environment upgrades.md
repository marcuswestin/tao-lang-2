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
- [DEVENV-090 — A stale generated parser fails `runtime-jest` without naming itself](<Developer environment upgrades/DEVENV-090-a-stale-generated-parser-fails-runtime-jest-without-naming-i.md>) — Candidate
- [DEVENV-091 — A dependency tree can be unusable while every health check passes](<Developer environment upgrades/DEVENV-091-a-dependency-tree-can-be-unusable-while-every-health-check-p.md>) — Candidate
- [DEVENV-081 — `tao test` discarded its compiled output on every passing run](<Developer environment upgrades/DEVENV-081-tao-test-discarded-its-compiled-output-on-every-passing-run.md>) — Resolved
- [DEVENV-082 — No pseudo-terminal inside the agent sandbox](<Developer environment upgrades/DEVENV-082-no-pseudo-terminal-inside-the-agent-sandbox.md>) — Candidate
- [DEVENV-083 — The WordFlower compile was re-paid on every test invocation](<Developer environment upgrades/DEVENV-083-the-wordflower-compile-was-re-paid-on-every-test-invocation.md>) — Resolved
- [DEVENV-084 — `./agent`'s dependency repair could only ever damage the tree it repaired](<Developer environment upgrades/DEVENV-084-agent-setup-s-sandboxed-install-destroys-a-healthy-depend.md>) — Resolved
- [DEVENV-085 — Jest crawled the compile cache, so the better the cache worked the slower every run got](<Developer environment upgrades/DEVENV-085-jest-crawled-the-compile-cache-on-every-run.md>) — Resolved
- [DEVENV-086 — The compiled-app fingerprint hashes all of `packages/`, so any concurrent edit invalidates every memo](<Developer environment upgrades/DEVENV-086-the-compiled-app-fingerprint-hashes-all-of-packages.md>) — Candidate
- [DEVENV-087 — A permission pattern matched only one of git's two argument orders](<Developer environment upgrades/DEVENV-087-a-permission-pattern-matched-only-one-of-git-s-two-orders.md>) — Resolved
- [DEVENV-088 — `merge-with-main`'s preflight cannot reach `origin` from inside the sandbox](<Developer environment upgrades/DEVENV-088-merge-with-main-s-preflight-cannot-reach-origin-from-inside-the-sandbox.md>) — Candidate
- [DEVENV-089 — `finalize` overwrites a reviewed merge message](<Developer environment upgrades/DEVENV-089-finalize-overwrites-a-reviewed-merge-message.md>) — Candidate

### DEVENV-030 — Managed-shell command constraints

- **Status:** Closed
- **Area:** Host tooling
- **Impact:** Process substitution is denied, shell working-directory changes can persist within a tool
  session, and decorative separator commands can be interpreted unexpectedly.
- **Evidence:** Observed during companion and semantic-agent work; these are host execution semantics, not
  repository failures.
- **Workaround:** Use plain commands, explicit `workdir`, ordinary temporary files, and avoid decorative
  shell separators.
- **Proposed change:** Keep these constraints in harness-level command guidance rather than product code.
- **Dependencies:** External host policy.
- **Acceptance:** Repository automation does not depend on process substitution or inherited shell cwd.
- **Source:** 2026-09-03 companion and semantic-agent implementation briefings.

### DEVENV-031 — Intermittent inspection-output anomalies

- **Status:** Candidate
- **Area:** Host tooling
- **Impact:** One `rg` result appeared mangled and a one-off status read did not immediately show an
  untracked file, which can mislead concurrent review.
- **Evidence:** Each occurred once and was not reproduced.
- **Workaround:** Repeat the read, pin review to a commit, and run final status/diff checks after concurrent
  writers finish.
- **Proposed change:** Collect a reproducible command and raw output before changing repository tooling.
- **Dependencies:** External host behavior or concurrent filesystem timing.
- **Acceptance:** Either reproduce deterministically and open a scoped fix, or close after repeated clean
  observations.
- **Source:** 2026-09-03 companion and semantic-agent implementation briefings.

### DEVENV-032 — Hosted model and evolving mock-shape observations

- **Status:** Closed
- **Area:** Optional development services
- **Impact:** A hosted model was unavailable during one proof, and AI SDK v7 required updated mock shapes.
- **Evidence:** The semantic-agent briefing records both conditions; neither blocks local deterministic
  repository tests.
- **Workaround:** Use deterministic local doubles and current SDK contracts.
- **Proposed change:** Reopen only for a reproducible repository-owned setup or diagnostic gap.
- **Dependencies:** External service availability and third-party SDK versions.
- **Acceptance:** Core tests remain independent of hosted-model availability and mocks compile against the
  installed SDK.
- **Source:** 2026-09-03 semantic-agent implementation briefing.

### DEVENV-033 — Conflicting color-mode warning noise

- **Status:** Candidate
- **Area:** Verification diagnostics
- **Impact:** The sandbox full-verification summary repeated more than twenty Node warnings, obscuring
  meaningful gate warnings even though the bundle proof passed.
- **Evidence:** `_ship-bundle-proof` reported that `NO_COLOR` was ignored because `FORCE_COLOR` was set
  for each of its bundle subprocesses during the 2026-09-03 acceptance run.
- **Workaround:** Read the gate status and full log past the repeated warnings.
- **Proposed change:** Trace which workflow layer supplies both variables, then set one coherent color
  policy for spawned bundle processes or deduplicate this known warning in the summary.
- **Dependencies:** Re-check after the active runtime and Studio branches land; do not change bundle
  scheduling in this slice.
- **Acceptance:** The bundle proof keeps intentional color behavior without repeating the conflict
  warning, and unrelated warnings still surface.
- **Source:** 2026-09-03 `full-verify-sandbox` acceptance run on `feat/verification-lanes`.

### DEVENV-034 — Bun worker-pool test scheduling

- **Status:** Candidate
- **Area:** Test performance
- **Impact:** Replacing the package-process scheduler with Bun's worker pool is not currently safe: the
  comparison workload can fail timing-sensitive tests or fail to terminate.
- **Evidence:** With no peer Tao lanes on an 18-CPU host, the first cache-disabled package-process
  sample finished red in 10.9 seconds (one five-second bootstrap timeout and one missed overlap
  assertion). The equivalent `bun test --parallel=18 --isolate` workload had not completed after 150
  seconds and was stopped. The requested repeated cold/warm series was therefore abandoned rather
  than multiplying potentially orphaned worker processes.
- **Workaround:** Keep the current one-process-per-package scheduler and its machine-wide admission
  broker.
- **Proposed change:** After active branches land, isolate the worker-pool hang on a smaller package set,
  add a process-tree timeout to the benchmark, then collect three green cache-disabled and three green
  warm samples for both schedulers before considering simplification.
- **Dependencies:** Re-check after the large feature branches land; DEVENV-016 and DEVENV-030 own host
  process visibility and cleanup constraints.
- **Acceptance:** Both modes finish the same test-file inventory without failures or surviving workers,
  and repeated measurements show a clear wall-time win before scheduling changes are proposed.
- **Source:** 2026-09-03 measurement on `feat/verification-lanes`; Bun 1.3.13, 18 workers.

### DEVENV-035 — Performance-contract timeout under the full graph

- **Status:** Resolved
- **Area:** Test reliability
- **Impact:** The sandbox full-verification lane could fail even though the performance-contract test
  only launches four fast `just --dry-run` inspections and passes immediately by itself.
- **Evidence:** The test first hit Bun's default five-second timeout while `_ship-bundle-proof` ran beside
  the package-test node; after receiving an explicit 30-second timeout, it timed out again during a
  normal-terminal `full-verify` while an immediate isolated run completed in 107 milliseconds.
- **Workaround:** Re-run the focused performance-check suite after the full lane becomes quiet.
- **Proposed change:** Replace the four nested `just --dry-run` subprocesses with a deterministic repo-lint
  rule that follows recipe references and `{{ VARIABLE }}` gate lists while keeping actual benchmarks
  outside verification.
- **Dependencies:** Resolved on `feat/freehand-ui-sketching-implementation`; no scheduling policy changed.
- **Acceptance:** Focused tests prove direct and variable-mediated benchmark reachability, `_repo-lint`
  passes, and the full package-test lane no longer launches the nested Just inspection.
- **Source:** 2026-09-04 `full-verify-sandbox` acceptance and 2026-09-04 normal-terminal merge verification.

### DEVENV-036 — Critical-path verification startup and host-wait concurrency

- **Status:** In progress
- **Area:** Verification performance
- **Impact:** The package critical path dominates `verify`, while `full-verify` can delay that same
  25–35 second work behind shorter Studio gates and leave an 18-CPU host underused.
- **Evidence:** On 2026-09-04, `_test` and `_typecheck` measured 33.1 and 26.3 seconds while the full
  lane peaked at load 11.4 on 18 CPUs. A clean baseline `verify` took 33.5 seconds. Giving the nested
  test runner 12 slots completed in 25.8 seconds; reducing it to 9 slots regressed to 32.8 seconds.
- **Workaround:** None required; the lane remains correct, only slower than necessary.
- **Proposed change:** Preserve `_test`'s 12-worker budget, launch `_test` and `_typecheck` before
  auxiliary readers, remove the obsolete Studio-first priority, and account each mostly-waiting
  Studio smoke as one slot while retaining native `gui` exclusion and machine-wide admission.
- **Dependencies:** Implemented on `feat/verification-lanes`; the six browser and native UI lanes still require an
  unsandboxed terminal for final timing evidence.
- **Acceptance:** Focused scheduler tests prove package-first admission and three concurrent Studio
  waits beside package work; `./agent verify` remains green; an uncontended normal-terminal
  `just full-verify` is green and improves or matches the 44.6-second baseline.
- **Source:** 2026-09-04 verification timing review on `feat/verification-lanes`.

### DEVENV-037 — Native Studio host coordination and bounded Hutch phases

- **Status:** Resolved
- **Area:** Native Studio verification
- **Impact:** Native smoke and canary runs could overlap Hutch work in another worktree, hang inside
  preparation until the outer test timeout, and leave the next run with weak phase or ownership
  evidence after interruption.
- **Evidence:** A normal-terminal full verification spent 120 seconds in the native gate after
  printing `hutch install` but before `electrobun prepare complete`; a preceding run was interrupted,
  and graph-local `gui` ownership did not coordinate other worktrees. A cold acceptance worktree
  additionally proved Hutch 0.24.3's resolver could reject the two exact direct package versions
  while npm served both; the same install succeeded from a generated integrity-checked Hutch lock.
  Both Hutch 0.24.3 and 0.25.0 then blocked in `electrobun sync` while the shared home registered
  stopped projects with unheld reader markers. Hutch 0.24.3 completed sync in under two seconds
  against the same immutable store with an empty isolated project registry.
- **Workaround:** None required after the repository containment; inspect the exact timed phase in
  the gate log when a native host cannot proceed.
- **Proposed change:** Bound and instrument each Hutch phase, stop complete owned process groups on
  every exit path, and hold an identity-checked machine-wide `studio-native-host` lease through
  preparation, probe, and shutdown. Materialize the pinned native dependency lock so cold worktrees
  do not depend on Hutch re-resolving already-selected versions. Give every worktree an isolated
  mutable Hutch project registry backed by copy-on-write clones of the installed immutable store,
  and clear only the current generated project's transient locks after proving its process tree
  stopped.
- **Also observed:** from a managed shell the canary wrote an invocation-scoped
  `.artifacts/tests/studio-canary/invocations/<id>/canary.json`
  with `"status": "blocked"` within seconds, recorded its own pid in `survivingPids`, and was still
  alive 40 minutes later on a surviving `hutch-engine electrobun prepare` child, holding the whole
  `just full-verify` run open. The owned-process-group stop above should close this; re-verify it when
  the acceptance run happens.
- **Dependencies:** Implemented on `feat/native-studio-verification-reliability`; with the Expo
  preview available, command-host smoke now passes preparation and reaches the native launcher.
  Final AppKit acceptance still requires an ordinary Terminal because the Codex command host can
  deny its Watchman socket or abort the embedded Bun runtime at AppKit registration.
- **Acceptance:** Focused tests prove phase reporting, subprocess bounds and cleanup, interrupted
  reruns, two-process lease races, stale identity recovery, and protection of live old owners; final
  host lanes pass without manual state deletion or unrelated-process termination.
- **Source:** 2026-09-04 native full-verification failure and reliability handoff.

### DEVENV-038 — Machine-lane lease age uses mismatched clocks

- **Status:** Candidate
- **Area:** Verification coordination
- **Impact:** The six-hour age branch for CPU-lane records never activates, so a reused PID could keep
  a stale registration alive and under-allocate later verification work.
- **Evidence:** `MachineLanes.isLive` subtracts an epoch timestamp from monotonic `Time.nowMs()`, whose
  value is process-relative rather than wall-clock time.
- **Workaround:** Dead owners are still pruned by PID liveness; remove the registry record manually
  only after proving the recorded owner is gone.
- **Proposed change:** Replace age-only liveness with the process-start identity policy now used by
  named host resources, or compare timestamps in one clock domain while still protecting live owners.
- **Dependencies:** Keep separate from native-host leasing so no live long-running lane is pruned by
  age merely to fix the arithmetic.
- **Acceptance:** Tests cover dead owners, PID reuse, unknown identity, and a live owner older than six
  hours without relying on mixed wall and monotonic clocks.
- **Source:** 2026-09-04 native-host lease mutation review.

### DEVENV-039 — Native Studio launch resolves the generated app before it is written

- **Status:** Candidate
- **Area:** Studio launch
- **Impact:** The command a person runs most for device work opens with a red bundler error that is not
  one, which trains readers to ignore the place real bundler failures appear.
- **Evidence:** `just studio-native` logs `Unable to resolve "./_gen_tao-app/App"` once on startup and
  recovers on the next write; Metro reaches the entry before the first compile has written the generated
  tree.
- **Workaround:** None needed; the message is transient and the launch succeeds.
- **Proposed change:** Order the first compile ahead of the Metro start for the native launch path, or
  hold the entry until the generated tree exists.
- **Dependencies:** None.
- **Acceptance:** A clean `just studio-native` reaches a ready preview with no unresolved-module output.
- **Source:** 2026-09-04 companion Slice 2 work.

### DEVENV-040 — Bun dependency recovery conflicts with protected package fixtures

- **Status:** Candidate
- **Area:** Dependency installation
- **Impact:** A stale Bun link can block every verification command, while the documented clean-install
  recovery cannot remove a dependency tree containing a sandbox-protected fixture file.
- **Evidence:** After merging main, `./agent verify` failed with `EEXIST: failed to link package:
  expo-updates@29.0.20`; the prescribed `rm -rf node_modules` then stopped at Expo's
  `e2e/fixtures/project_files/.env` with `Operation not permitted` even in the approved elevated command.
- **Workaround:** Move the stale `node_modules` directory intact to a unique path under `/private/tmp`,
  without reading or deleting its contents, then run `bun install --frozen-lockfile`.
- **Proposed change:** Make the dependency workflow repair stale links idempotently, and teach its recovery
  diagnostic to recommend an atomic move when protected third-party fixture names prevent recursive removal.
- **Dependencies:** None.
- **Acceptance:** A fixture reproducing the protected-path link failure recovers through the documented
  command without reading protected content, and a second `./agent verify` dependency check is clean.
- **Source:** 2026-09-04 freehand/main merge verification.

### DEVENV-041 — Nested gate-runner tests inherit the live machine registry

- **Status:** Resolved
- **Area:** Test reliability
- **Impact:** `./agent verify` could time out two otherwise millisecond-scale gate-runner tests, including
  on its isolated retry, because the nested runner waited for capacity held by its enclosing lane.
- **Evidence:** The JSON-summary and artifact-trail tests each hit their 15-second test timeout during a
  three-lane, 32.9-load verify run, then both passed as part of the focused 221-millisecond suite when
  no outer lane owned the shared registry.
- **Workaround:** Run the gate-runner test file outside a repository verification lane.
- **Proposed change:** Give every nested `runGates` fixture its own temporary machine-registry root so a
  unit test cannot discover or wait on real repository lanes.
- **Dependencies:** Resolved on `feat/freehand-ui-sketching-implementation`.
- **Acceptance:** The focused gate-runner suite and `./agent verify` pass while another registered lane
  is present; the tests that intentionally model contention continue to use their explicit fixtures.
- **Source:** 2026-09-04 verification of the full-verify reliability fixes.

### DEVENV-042 — Studio smoke observes persistence before browser reconciliation

- **Status:** In progress
- **Area:** Test reliability
- **Impact:** The simulated Studio journey blocks otherwise green merge verification at synthetic
  sketch interactions, so it cannot yet serve as reliable merge evidence.
- **Evidence:** Hit-test diagnostics added to the lane on 2026-09-04 exposed real toolbar, gesture,
  rerender, interleaved-Snap, editor-ownership, source-identity, geometry, and transaction defects.
  Those product fixes now have focused coverage, including a real pointer-release drag-one-in target.
  The lane has not yet supplied the required ten consecutive complete normal-terminal runs, so it
  remains reliability evidence in progress rather than a green merge gate.
- **Workaround:** The full-verification graph reports `studio-smoke-simulated-user` as explicitly skipped;
  `just studio-smoke packages/dev/studio-smoke/studio-simulated-user.test.ts` reproduces it, and the deterministic catalog tests
  in the same file plus the native and canary lanes remain active.
- **Proposed change:** Run the complete journey ten consecutive times from a normal Terminal, retain
  its hit-tested preconditions and single-shot mutations, investigate any remaining nondeterminism,
  then remove the quarantine only when that acceptance is green.
- **Dependencies:** Product fixes and lane diagnostics landed with the Figma-at-home strides plan.
- **Acceptance:** `studio-smoke-simulated-user` completes the Draw, Snap, Unsnap, overlap-confirmation, and
  Undo sequence in ten consecutive normal-terminal runs before it rejoins automatic full verification.
- **Source:** 2026-09-04 normal-terminal merge verification, the explicit quarantine decision, and the
  2026-09-04 lane diagnostics from the Figma-at-home strides work.

### DEVENV-043 — Changed-files lane fails every package with no affected tests

- **Status:** Resolved
- **Area:** Verification lanes
- **Impact:** `just test-changed`, the documented ordinary iteration lane, reports red whenever a change
  touches a subset of packages, so its summary cannot be read at a glance and the real failures hide
  among sixteen spurious ones.
- **Evidence:** With 19 changed files in `parser`, `code-editor`, and `studio`, every other bun suite
  printed `--changed: 19 changed files, but no test files are affected` and `Ran 0 tests`, exited 0
  under `--pass-with-no-tests`, wrote no junit file, and the runner then recorded `test result report
  unavailable` and turned the pass into a failure (`.artifacts/logs/dev-test/2026-09-05T01-34-12-827Z-*`).
  `./agent test-retry` after a contended `_test` timeout took the same path: the dev suite ran with
  `--changed`, found no affected test files, ran 0 tests, and reported the retry as failed, so it could
  not confirm the timeout; `./agent test-file packages/dev/dev-tests/gate-runner.test.ts` passed 19 of 19.
  On a clean branch (2026-09-05, `.artifacts/logs/dev-test/2026-09-05T15-54-44-702Z-*`) the lane spawned
  all 19 bun suites, failed 18 of them the same way, and still took 21s: `runtime-jest` ran all 27 files
  and 156 tests because Jest ignores `--changedSince` when explicit test paths are also passed, so the
  changed lane never narrows its most expensive package suite. Across every recorded checkout 372 of 425
  `dev-test` runs executed 19 or more suites and 53 executed exactly one; no run selected a subset.
- **Workaround:** Run `just test-file <path>` per touched suite, and `./agent verify` for the full run.
- **Proposed change:** Treat a zero-test run under `--changed` as passed with no observations when the
  process exited 0, or drop suites whose packages have no changed files before spawning them. For the
  retry path the narrower cause is that `TestRunner.runSuites` passes `changedReference:
  prepared.changed?.reference` for every kind, while a `retry` run populates `prepared.changed` only to
  compute its advisory line; passing it solely when `prepared.kind === 'changed'` keeps a retry on the
  ledger's own file list. For `runtime-jest`, omit the positional file list in changed mode (or run
  `jest --listTests --changedSince` first and spawn nothing when it is empty) so `--changedSince` is
  honoured.
- **Dependencies:** Implemented on `feat/granular-test-selection-dfed54`: the changed lane no longer
  uses Bun's `--changed` or Jest's `--changedSince` at all. A probe showed Bun's selection also stops at
  the package boundary (a change to `packages/shared/shared-src/shared.ts` selected no `compiler`
  test), so `TestSelection.planChangedSuites` selects whole suites from `PackageGraph`, the workspace
  import graph read from each package's `@alias` imports; `package.json` was not usable because seven
  packages import a workspace package their manifest omits. `just verify` now requires `--changed` or
  `--complete`, and every lane records the tree it proved green so an identical tree is not re-run.
- **Acceptance:** A change confined to one package leaves `just test-changed` green with only that
  package's suites reported, and a clean branch reports nothing selected in well under five seconds.
- **Source:** 2026-09-04 Studio syntax lens work.

### DEVENV-044 — Typecheck gate runs 19 projects serially on the legacy compiler

- **Status:** Resolved
- **Area:** Verification performance
- **Impact:** `_typecheck` is the longest verify gate after `_test` (27.7s in the latest lane, 17.2s
  uncontended) although the work parallelizes and a native compiler is released.
- **Evidence:** 2026-09-04, linked worktree, after `_parser-gen`: `bunx tsc --build packages/*/tsconfig.json`
  17.2s wall (24.7s CPU); one `tsc -p --noEmit` per package concurrently 5.8s wall; `tsgo -p --noEmit`
  (`@typescript/native-preview` 7.0.0-dev) concurrently 1.3s wall, exit 0 and zero diagnostics for all
  19 projects. TypeScript 7.0.2 is npm `latest`; `rg` finds no `typescript` API import under `packages/`;
  every project already sets `rootDir`, `types`, and `moduleResolution: bundler`.
- **Workaround:** None; the gate is correct, only serial.
- **Proposed change:** Install TypeScript 7 under the `typescript-native` npm alias and run
  `_typecheck` and the runtime-toolchain generated-app typecheck through it, leaving `typescript` 5.9
  in place for the editor's tsserver and `bunx tsc`. Done on `feat/dev-speed-optimization-cbf7e5`:
  `just _typecheck` 1.7s uncontended; TypeScript 7 also passes the generated runtime app with the
  test's exact tsconfig.
- **Dependencies:** TypeScript 7 ships no programmatic API until 7.1, so `typescript` cannot move to 7
  while `.vscode/settings.json` points the editor at `node_modules/typescript/lib`; revisit when 7.1
  ships and fold the alias back into one dependency.
- **Acceptance:** `./agent verify` green with `_typecheck` under 5s uncontended; `just check` membership
  unchanged. Met 2026-09-04: `_typecheck` 2.2s inside a green, contended `verify` (33.9s lane).
- **Source:** 2026-09-04 development-speed review.

### DEVENV-045 — Agent shell habits route routine commands through harness review

- **Status:** In progress
- **Area:** Agent harness performance
- **Impact:** In Claude Code auto mode, every Bash call outside a narrow allow rule or the built-in
  read-only set waits about two seconds for the permission classifier; in Codex, every escalated action
  waits about three seconds for the auto-review model. The commands paying this are mostly routine.
- **Evidence:** 114 Claude Code sessions in this repository, 17,461 Bash calls: 10,266 begin with `cd`
  and 550 with `export PATH=…`; `export PATH… && <read-only command>` median 2.5s against 0.0–0.1s for
  the same command bare; `cat > file <<EOF` median 2.2s, `python3 -` heredocs 2.1s, `mkdir`/`cp`/`rm`
  1.9s, while `Edit` tool calls are approved instantly; 117 tool results were sandbox denials
  (`direnv exec .`, `bun install`). Codex: 962 auto-review turns, median 2.9s, 95% approved, dominated
  by `apply_patch` and `request_permissions`; 91 sandbox denials.
- **Workaround:** Agents already prefer `rg`, `ls`, and `git` forms that skip review. AGENTS.md tells
  sandboxed shells to prepend the profile bin themselves, which is what produces the `export PATH` prefix.
- **Proposed change:** Done on `feat/dev-speed-optimization-cbf7e5`: the SessionStart hook now runs
  `packages/dev/dev-src/cli/agent-session-start.zsh`, which runs `./agent setup` and, when Claude Code
  hands it `CLAUDE_ENV_FILE`, exports `.devenv/profile/bin` onto every later Bash tool command's PATH;
  `.rulesync/permissions.jsonc` sets `env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1` and allows
  `cd *`; AGENTS.md tells agents not to prefix `cd` or `export PATH` and to change files with the
  harness edit tool. The Codex patch reviews turned out to come from patches into a `/private/tmp`
  clone outside the workspace roots, so the `tao-workspace` profile is unchanged; work in the
  worktree instead.
- **Dependencies:** `.rulesync/permissions.jsonc`, `.rulesync/hooks.jsonc`, and `just _agent-config`
  own the generated settings. `CLAUDE_ENV_FILE` support is in Claude Code 2.1.220 (the installed CLI)
  and later.
- **Acceptance:** In new sessions the median duration of `cd`- or `export`-prefixed read-only commands
  equals the bare command's; a fresh worktree session shows no `direnv exec` sandbox denial.
- **Source:** 2026-09-04 development-speed review of Claude Code and Codex transcripts.

### DEVENV-046 — The tao-apps suite is one 22-second process on the test critical path

- **Status:** Candidate
- **Area:** Test performance
- **Impact:** `_test` wall time (29.5s) is set by `tao-apps`, a single Jest process that runs all 26 Tao
  behavior test files after a serial validate and compile phase.
- **Evidence:** 2026-09-04 verify lane: `tao-apps` 21.7s (Jest phase 15.1s, validate with 8 workers plus
  compile about 6s); next longest suites `runtime-toolchain` 13.9s, `runtime-jest` 12.6s, `studio` 12.2s;
  suite sum 104s on 18 CPUs.
- **Workaround:** `just test-changed` skips tao-apps when no `Apps/` or `.tao` file changed.
- **Proposed change:** Shard the Tao behavior tests across two or three Jest processes, or cache compiled
  apps between runs so only changed apps recompile.
- **Dependencies:** DEVENV-034 (Bun worker pool) is a separate question; revisit the `tao-apps` `cost: 8`
  reservation after sharding.
- **Acceptance:** `_test` wall under 20s uncontended with the same test inventory.
- **Source:** 2026-09-04 development-speed review.

### DEVENV-047 — Release-bundle proof shares Metro's cache with every other worktree

- **Status:** Candidate
- **Area:** Full verification
- **Impact:** `_ship-bundle-proof` can fail a green branch's landing run when another worktree bundles
  at the same moment, because both Expo exports write the same Metro cache under the system temp dir.
- **Evidence:** 2026-09-04 `just merge-with-main --execute --yes --push` on
  `feat/dev-speed-optimization-cbf7e5`: `expo export --platform ios … --clear` exited 1 with
  `ENOTEMPTY, Directory not empty: /var/folders/…/T/metro-cache/6b` while two Tao lanes were running;
  every other full-verify gate passed. DEVENV-013 moves Expo's user cache into `.artifacts/cache/expo`
  but not Metro's transformer cache, which `--clear` deletes from under a concurrent bundler.
- **Workaround:** Re-run the landing once the other lane has finished.
- **Proposed change:** Give each export a worktree-local Metro cache root (`cacheStores` in the host's
  Metro config, or `TMPDIR` under `.artifacts/tmp` for the export child) so `--clear` only touches the
  run's own directory.
- **Dependencies:** DEVENV-013 owns the Expo cache move; this is the Metro half.
- **Acceptance:** Two concurrent `just ship-bundle-proof` runs in different worktrees both pass.
- **Source:** 2026-09-04 development-speed landing run.

### DEVENV-048 — A fresh linked worktree cannot launch Studio until the parser is generated

- **Status:** Candidate
- **Area:** Worktree setup
- **Impact:** The one setup entry leaves a new worktree unable to run the product; the first Studio launch
  fails with a module error that reads like a broken checkout rather than a missing step.
- **Evidence:** In a new `.claude/worktrees/` checkout, `./agent setup` ran only `bun install`; `./dev studio
  Apps/HNReader` then exited with `Cannot find module './_gen_tao-parser/module'` until
  `bun run packages/dev/dev-src/repository-tests/ParserGenerate.ts` (the `_parser-gen` gate) had run.
  `direnv allow` was also needed first, and it must run from an unsandboxed shell because the allow file
  lives under `~/.local/share/direnv`.
- **Workaround:** Run `just _parser-gen` after `./agent setup` in a new worktree.
- **Proposed change:** Make `setup` depend on `_parser-gen`, or have `./dev studio` generate the parser
  when the generated tree is missing.
- **Dependencies:** None.
- **Acceptance:** A new linked worktree reaches a ready Studio session after `./agent setup` and
  `./dev studio Apps/HNReader` alone.
- **Source:** 2026-09-04 Studio visual design work.

### DEVENV-049 — A fresh worktree cannot run `./tao` until the parser is generated

- **Status:** Candidate
- **Area:** Worktree setup
- **Impact:** `./agent setup` is the documented one setup entry, yet the CLI it prepares fails on first
  use, so an agent's first `./tao` command in a new worktree dies with a module error unrelated to its
  task.
- **Evidence:** In a linked worktree created 2026-09-04, `./agent setup` completed with no install
  changes and `./tao fix Apps/Starters/Notebook` failed with `Cannot find module
  './_gen_tao-parser/module' from packages/parser/parser-src/parserASTExport.ts`; running
  `bun run packages/dev/dev-src/repository-tests/ParserGenerate.ts` (the `_parser-gen` recipe) fixed it.
  The stale variant is worse: on 2026-09-15 a linked worktree whose generated tree existed but predated
  the grammar ran `./tao test "Apps/Test Apps/Navigation/…"` to a bare `Something went wrong.`; only
  `TAO_DEBUG_ERRORS=1` revealed `undefined is not an object (evaluating 'AST.EntityCommandPolicy.$type')`
  at validator module load, and `just _parser-gen` fixed it.
- **Workaround:** Run `just _parser-gen`, or any lane that includes it, before the first `./tao` command.
- **Proposed change:** Have `setup` run `_parser-gen` when `packages/parser/parser-src/_gen_tao-parser`
  is missing or older than the grammar, or have `./tao` generate on demand with a one-line notice.
- **Dependencies:** None.
- **Acceptance:** In a fresh linked worktree, `./agent setup && ./tao check Apps/HNReader` succeeds
  without a manual generation step.
- **Source:** 2026-09-04 `tao create` work.

### DEVENV-050 — `tao test` under a Git-ignored path says "No Tao tests found" without the reason

- **Status:** Candidate
- **Area:** Diagnostics
- **Impact:** A project under an ignored directory looks test-less, and the person reads it as a
  discovery bug in their project rather than an ignore rule.
- **Evidence:** `tao create "…" --ai none --yes` run from `.artifacts/tmp/create-smoke` printed
  `No Tao tests found under a-reading-list` although `a-reading-list/AReadingList.test.tao` existed;
  the same command from a temp directory outside the repository found and ran the test. `findTaoFiles`
  goes through `Repo.filesUnder`, which applies Git ignore rules inside a worktree.
- **Workaround:** Run from a path Git does not ignore, or from outside the repository.
- **Proposed change:** When discovery finds nothing but the directory holds `.tao` files, say that
  Git-ignored paths are skipped and name the matching rule.
- **Dependencies:** None.
- **Acceptance:** `tao test` on an ignored directory that holds a `.test.tao` file prints a message
  naming the ignore rule.
- **Source:** 2026-09-04 `tao create` work.

### DEVENV-051 — `sips` exits 13 inside the Claude Code Bash sandbox

- **Status:** Candidate
- **Area:** Sandbox
- **Impact:** Any workflow that shells out to the system image tool — `tao create` reading a palette
  from an image, or an agent converting a screenshot — silently yields nothing in a sandboxed shell.
- **Evidence:** `sips -s format bmp -Z 48 <png> --out $TMPDIR/x.bmp` exits 13 with no output in the
  sandbox and exits 0 with a valid 24-bit BMP unsandboxed (found during the `tao create` review, 2026-09-04).
  `tao create` now reports the exit code and stderr instead of "no palette could be read".
- **Workaround:** Run image-reading smoke tests unsandboxed.
- **Proposed change:** Record `sips` as a host tool the sandbox blocks in `./agent capabilities`, so
  the denial is named rather than inferred.
- **Dependencies:** None.
- **Acceptance:** `./agent capabilities` reports whether `sips` can run in the current shell.
- **Source:** 2026-09-04 `tao create` review.

### DEVENV-052 — `bun --tsconfig-override` fails for scripts outside the repository

- **Status:** Candidate
- **Area:** Agent scratch tooling
- **Impact:** An agent cannot run a throwaway script from its scratchpad against the repository's path
  aliases, so probes end up as files inside the worktree.
- **Evidence:** `bun --tsconfig-override packages/tsconfig.base.json run <script outside the repo>` fails
  in bun 1.3.13 with `Internal error: directory mismatch for directory ".../packages/tsconfig.base.json"`.
- **Workaround:** Put scratch scripts under the ignored `.artifacts/tmp/` and import repository sources by
  absolute path; remove them afterwards.
- **Proposed change:** Document the `.artifacts/tmp/` convention for agent probes, or add a `./agent
  probe <script>` entry that runs a script with the repository's aliases.
- **Dependencies:** None.
- **Acceptance:** A documented one-line way to run a scratch TypeScript file against `@shared` and
  friends from outside the source tree.
- **Source:** 2026-09-04 `tao create` review.

### DEVENV-055 — No repository command compiles a native module

- **Status:** Candidate
- **Area:** Native builds
- **Impact:** The repository now carries native code (`packages/icloud-native`, an Expo module in
  Swift), and nothing short of a full `expo run:ios` proves it compiles. An agent has to hand-assemble
  the steps, two of which fail in the Bash sandbox.
- **Evidence:** `expo prebuild packages/runtime-toolchain --platform ios --no-install` works in the
  sandbox. `pod install --project-directory=packages/runtime-toolchain/ios` fails with `cannot load such
  file -- ./scripts/autolinking` because the Podfile's `node --print "require.resolve('expo/package.json')"`
  resolves from the shell's cwd, so the install must run from inside the `ios` directory (a subshell
  `(cd packages/runtime-toolchain/ios && pod install)` keeps the session cwd). `xcodebuild -project
  ios/Pods/Pods.xcodeproj -target TaoICloudNative -sdk iphonesimulator` with `SYMROOT`/`OBJROOT` inside
  the worktree still fails sandboxed with `Could not compute dependency graph … Operation not permitted`
  on its `XCBuildData/PIFCache` write, because Xcode's build service is a separate process the sandbox
  does not cover; unsandboxed it succeeds in about two minutes and proves the Swift module against
  ExpoModulesCore. Autolinking only finds a podspec in a top-level subdirectory of the package
  (`ios/`), never at its root.
- **Workaround:** The three commands above, with `pod install` in a subshell and `xcodebuild`
  unsandboxed.
- **Proposed change:** A `just native-module-check` (or `./agent native-check`) recipe that prebuilds
  the toolchain host, installs pods from the right directory, and compiles every workspace pod target
  for the simulator with build products under `.artifacts/`; list it beside `just claude-native` as the
  sanctioned unsandboxed native step.
- **Dependencies:** None.
- **Acceptance:** One documented command compiles `TaoICloudNative` for the simulator from a fresh
  worktree and fails loudly on a Swift error.
- **Source:** 2026-09-05 iCloud datasource provider implementation.

### DEVENV-053 — Verifying a sibling worktree from an agent shell needs unsandboxed commands

- **Status:** Candidate
- **Area:** Agent worktrees
- **Impact:** An agent whose session is rooted in one worktree but asked to land work in another cannot
  typecheck or run `./agent verify` there from the sandboxed shell; each attempt is re-run unsandboxed
  and goes through harness review.
- **Evidence:** 2026-09-05, session rooted in `.claude/worktrees/agent-response-preferences-2374d6`,
  work in `.claude/worktrees/main-landing-review-9f3a2c`: `bunx tsc --build packages/*/tsconfig.json`
  run through `sh -c 'cd <sibling> && …'` fails for all 19 projects with `TS5033: Could not write file
  '<sibling>/packages/ast-utils/tsconfig.tsbuildinfo': EPERM`, because the sandbox write allowlist
  covers only the session worktree. `bun --cwd <sibling> test <file>` reports `Script not found "test"`;
  `bun test --cwd <sibling> <file>` runs sandboxed because it writes nothing.
- **Workaround:** Run the typecheck and `./agent verify` for the sibling worktree unsandboxed; use
  `bun test --cwd <worktree> <files>` for focused tests.
- **Proposed change:** Give `./agent verify` a documented `--worktree <path>` form for verifying another
  checkout the agent owns, or allow sandbox writes under the repository's own `.claude/worktrees/*` so a
  branch an agent was asked to land can be verified in place.
- **Dependencies:** None.
- **Acceptance:** From a sandboxed agent shell rooted in one worktree, `bunx tsc --build` and
  `./agent verify` complete in a sibling worktree without an unsandboxed retry.
- **Source:** 2026-09-05 main-landing review.

### DEVENV-054 — A forced `Bun.serve` stop strands another test's in-process WebSocket dial

- **Status:** Resolved
- **Area:** Package tests
- **Impact:** Under the dev suite's `--concurrent` flag, a test that stops a `Bun.serve` with
  `stop(true)` while another test's same-process `WebSocket` client is mid-dial to a different
  server leaves that dial without an `open`, `error`, or `close` event, so the second test hangs to
  its timeout. The lane reports it as a test assertion, not contention, and it reproduces only with
  several server tests in one file.
- **Evidence:** `bun test --concurrent packages/dev/dev-tests/dev-data.test.ts` on bun 1.3.13 hung the
  sync and conformance tests 12 of 12 runs until the client bounded its dials; a socket trace showed
  the dial coinciding with another test's `close 1006 Connection ended`. The server-backed cases now
  acquire a file-local serial turn through their completed teardown while retaining concurrency
  inside the two-authority and independent-process assertions; ten consecutive ordinary
  `--concurrent` runs passed, including an eight-cycle server/WebSocket ownership stress case.
- **Workaround:** None required after the fix. Server-backed tests in this file register through the
  local ownership helper so one case's forced stop cannot overlap another case's dial.
- **Proposed change:** Implemented with an explicit serial registration queue around only the
  in-process server/WebSocket cases; bootstrap-only cases remain ordinarily concurrent.
- **Dependencies:** None.
- **Acceptance:** Met: the normal `--concurrent` file command passes repeatedly without a test-host
  dial timeout, while the independent-process CAS/auth coverage remains intact.
- **Source:** 2026-09-05 Dev datasource implementation.

### DEVENV-056 — Visual review can lose its renderer context during preview reload

- **Status:** Resolved
- **Area:** Visual review
- **Impact:** `tao review` could read the rendered review surface successfully and then fail before
  writing the bundle with `Execution context was destroyed.`
- **Evidence:** `./tao review Apps/HNReader --app HNReaderStub --output <fresh-path>` reproduced the
  failure in `StudioCdp.rendererFingerprint` when the live preview iframe reloaded between its page
  and child-frame probes.
- **Workaround:** None required after the fix; before it, retrying the whole immutable capture into a
  fresh output path could avoid the reload race.
- **Proposed change:** Retry only Chrome's transient destroyed/missing-context failures while reading
  the renderer fingerprint, with a short bound; preserve every other failure immediately.
- **Dependencies:** None.
- **Acceptance:** A focused CDP test replaces the child-frame execution context mid-fingerprint and
  observes a successful retry; the real two-cell HNReaderStub review capture completes.
- **Source:** 2026-09-06 two-week walkthrough verification.

### DEVENV-057 — `git hash-object --stdin-paths` cannot hash a directory symlink

- **Status:** Candidate
- **Area:** Verification
- **Impact:** `./agent verify` dies in `GreenTree.hashTree` before any gate runs when the working
  tree contains an untracked directory symlink.
- **Evidence:** 2026-09-07, an untracked `packages/tao-cli/modules/@tao/runtime` symlink to
  `packages/runtime` made `git hash-object --stdin-paths` exit 128 with
  `fatal: Unable to hash packages/tao-cli/modules/@tao/runtime`.
- **Workaround:** Ship a real directory and a TypeScript re-export instead of a directory symlink.
- **Proposed change:** Hash a directory symlink by its link text (or skip it after recording the
  target) so `GreenTree` can identify the working tree.
- **Dependencies:** None.
- **Acceptance:** An untracked directory symlink in the worktree does not prevent `verify --changed`
  from hashing and starting gates.
- **Source:** 2026-09-07 `@tao/runtime` CLI module wiring.

### DEVENV-058 — The CLI's bundled `@tao/*` module directory is never filled

- **Status:** Candidate
- **Area:** Packaging
- **Impact:** `TaoAppModules.runtimeRoot()` resolves only because `packages/runtime` sits beside
  `packages/tao-cli` in this repository. A CLI copied anywhere else links a created project at
  nothing, so `tao create`'s `tsconfig.json` cannot resolve `@tao/runtime` and every sidecar import
  fails to typecheck.
- **Evidence:** 2026-09-12, `packages/tao-cli/modules/@tao/` holds only `.gitkeep`, and no `Justfile`
  recipe or `./dev` command copies the runtime into it. `runtimeRoot` falls through to
  `Errors.throwHostEnvironment` in that case.
- **Workaround:** Run the CLI from the monorepo, which is the only supported way to run it today.
- **Proposed change:** A packaging step that copies `packages/runtime` (and any other `@tao/*`
  TypeScript module a created project imports) into `packages/tao-cli/modules/@tao/` as real
  directories, alongside whatever recipe builds a distributable CLI. Note DEVENV-057: a directory
  symlink there breaks `GreenTree.hashTree`, so the step has to copy rather than link.
- **Dependencies:** DEVENV-057.
- **Acceptance:** A CLI tree with no sibling `packages/runtime` resolves `@tao/runtime` from its own
  carried module and links a created project at it; `cli-tests/app-modules.test.ts` already covers
  both halves of that fallback against a synthetic tree.
- **Source:** 2026-09-12 review of the `@tao/runtime` CLI module wiring.

### DEVENV-059 — Xcode 27 runtime installation can strand Apple device services

- **Status:** Incoming
- **Area:** iOS simulator workflow
- **Impact:** After installing the iOS 27 simulator runtime, Tao cannot discover, boot, install, or
  launch any simulator even though Xcode reports the iOS 27 SDK as installed.
- **Evidence:** On macOS 27.0 with Xcode 27.0, both sandboxed and unsandboxed `xcrun simctl list
  devices available --json` failed because CoreSimulatorService became invalid and `simdiskimaged`
  was not responding. `xcrun devicectl list devices` separately timed out waiting for
  CoreDeviceService. Xcode 27 contains DeviceHub.app and no standalone Simulator.app.
- **Workaround:** Restart macOS after the runtime download, open Device Hub once, and confirm
  `xcrun simctl list devices available --json` succeeds before launching Tao.
- **Proposed change:** Support Device Hub anywhere Tao presents a simulator, keep the workspace on
  an Expo CLI with Xcode 27 support, and teach `./agent doctor` to distinguish an absent runtime
  from failed CoreSimulator/CoreDevice services with restart guidance.
- **Dependencies:** Owned by unmerged branch `feat/macos-27-device-hub`; the host restart remains a
  manual recovery step.
- **Acceptance:** On macOS/Xcode 27, `tao dev` can present Device Hub and open HNReader on an iOS 27
  simulator; `./agent doctor` names a stuck Apple service and its recovery when discovery fails.
- **Source:** 2026-09-15 HNReader simulator recovery.

### DEVENV-060 — One denied host probe crashes the capabilities report

- **Status:** Incoming
- **Area:** Agent diagnostics
- **Impact:** `./agent capabilities` can crash before reporting CoreSimulator because a different
  probe is denied, hiding the distinction the command exists to make.
- **Evidence:** In the managed shell, the command stopped at `posix_spawn '/bin/ps': EPERM` even
  though the authorized command shape is `ps -o pid=,ppid=,lstart=,command= -p <pid>`.
- **Workaround:** Run the needed capability command directly and inspect its output.
- **Proposed change:** Use the authorized `ps` executable spelling and classify a thrown probe as
  denied or unavailable without abandoning the remaining probes.
- **Dependencies:** Owned by unmerged branch `feat/macos-27-device-hub`.
- **Acceptance:** A simulated spawn failure appears as one failed capability while every other
  probe is still reported; `./agent capabilities` completes in the managed shell.
- **Source:** 2026-09-15 HNReader simulator recovery.

### DEVENV-061 — `bun test` from the repository root loses subprocess output

- **Status:** Candidate
- **Area:** Test execution
- **Impact:** An agent debugging with a direct `bun test <path>` from the repository root sees tests
  that assert on captured command output fail, while the same tests pass through the repository's own
  lanes. The failures look like a red tree and invite a hunt for a regression that is not there.
- **Evidence:** 2026-09-17, `bun test packages/dev/dev-tests` from the root reported 610 pass / 41
  fail; `just verify --changed` ran the same suite through `./dev test` in the same checkout and
  reported 651 pass / 0 fail, as did `sh -c 'cd packages/dev && bun test dev-tests/green-tree.test.ts'`
  and `./dev test-file`. A probe inside a root-cwd `bun test` shows `spawn('git', …)` with a piped
  stdout delivering no `data` event before `close`, so `CLI.run` returns an empty `stdout`; the same
  probe under `bun run` captures normally. Sandboxed and unsandboxed runs behave identically, and no
  `bunfig.toml` or `.env` file is involved. The claim is narrower than first written: it holds for tests
  that assert on captured subprocess output, not for a root-cwd `bun test` generally. On 2026-09-17
  `bun test packages/dev/dev-tests/merge-with-main.test.ts` from the root gave complete output including
  subprocess stack traces, and was the only way to see a failure while `./dev` itself was mid-edit and
  broken; `bun test --cwd packages/<name> <relative-path>` was reliable throughout.
- **Workaround:** Prefer `./dev test-file <path>` or `just test <pattern>`. When those are unavailable —
  a broken `./dev`, or a shared module mid-edit (DEVENV-068) — `bun test --cwd packages/<name>
  <relative-test-path>` resolves `@shared/test` correctly and reports the real stack, and a root-cwd
  `bun test <file>` is usable for a file that does not assert on captured subprocess output. Do not
  trust a root-cwd `bun test` for the suites that do.
- **Proposed change:** Find what the root working directory changes about Bun's test runtime, then
  either fix the capture path in `Platform.spawn` or make a root-cwd `bun test` refuse and name the
  supported entry points.
- **Dependencies:** None.
- **Acceptance:** `bun test packages/dev/dev-tests` from the repository root agrees with `./dev test`,
  or says why it cannot and points at the command that does; the documented fallbacks stay usable when
  `./dev` is broken.
- **Source:** 2026-09-17 verification deduplication; 2026-09-17 branch-wide agent findings.

### DEVENV-062 — The default Codex profile cannot refresh its generated Codex configuration

- **Status:** Candidate
- **Area:** Agent configuration
- **Impact:** Canonical `.rulesync` changes can leave `.codex/config.toml` or
  `.codex/rules/tao.rules` stale even though `./agent setup` and `just _agent-config` otherwise
  succeed, so generated-parity tests fail after the documented regeneration command.
- **Evidence:** During the 2026-09-16 verification-foundation work, both commands reported the Codex
  outputs as not writable under the default Codex workspace profile; an escalated retry retained the
  same protection boundary.
- **Workaround:** Regenerate from a host/profile allowed to update the generated `.codex` outputs,
  then run `codex-config-generation.test.ts` to prove exact parity.
- **Proposed change:** Provide a repository-owned regeneration path that can replace the generated
  Codex files without granting general writes to mutable harness configuration, or document the
  required host/profile transition in the canonical setup workflow.
- **Dependencies:** `.rulesync/permissions.jsonc`, `.rulesync/profiles.jsonc`, and
  `packages/dev/dev-src/agent-config/CodexConfigGenerator.ts`.
- **Acceptance:** Starting from deliberately stale generated Codex files, the documented setup command
  refreshes them and the exact-parity test passes in the default supported Codex workflow.
- **Source:** 2026-09-16 September remediation Wave 1.

### DEVENV-063 — Studio preview needs the materialized Watchman profile in managed task shells

- **Status:** Candidate
- **Area:** Studio preview host
- **Impact:** Studio can reach Expo successfully and then fail before browser dispatch with
  `EMFILE: too many open files, watch`, preventing the browser and native acceptance lanes from
  distinguishing product behavior from host watcher exhaustion.
- **Evidence:** During September-remediation acceptance, the task shell omitted the linked
  `.devenv/profile/bin` from `PATH`, so Metro could not find Watchman and fell back to Node watching.
  The shell reported a high `ulimit -n`, but `launchctl limit maxfiles` retained a 256 soft limit.
  The pinned `.devenv/profile/bin/watchman --version` succeeded as `2026.01.19.00`.
- **Workaround:** Run Studio acceptance from a shell that has loaded the materialized devenv profile;
  in a managed task shell, prepend this checkout's `.devenv/profile/bin` once before launching the
  lane.
- **Proposed change:** Make the Studio launch preflight resolve the pinned Watchman executable or fail
  early with the exact profile remediation before Metro falls back to the launchd-limited watcher.
- **Dependencies:** DEVENV-015 remains the later Chrome/LaunchServices boundary once Metro starts.
- **Acceptance:** A managed-shell Studio launch either uses the pinned Watchman and reaches browser
  dispatch or stops before Metro with an actionable profile diagnostic; it never ends in Node
  watcher's `EMFILE` fallback.
- **Source:** 2026-09-16 September remediation acceptance.

### DEVENV-064 — Generated-artifact cleanup is denied after files gain macOS provenance

- **Status:** In progress
- **Area:** Generated artifacts
- **Impact:** Repository gates cannot clean generated IDE, runtime, or Studio-test directories, and a
  parser-generation attempt can empty `_gen_tao-parser/module` before its replacement fails. The
  resulting `EPERM` or `EFAULT` turns cleanup into broad, unrelated test failures.
- **Evidence:** During the 2026-09-16 verification-foundation work, `verify --changed` and
  `verify --complete` failed recursively removing generated IDE, runtime-toolchain, and Studio
  scratch trees; the required unsandboxed retry failed identically. `ls -l@` showed inherited
  `com.apple.provenance` metadata throughout copied `@tao` trees. An earlier parser-generation
  attempt had already emptied its live output before the same cleanup denial surfaced. A focused
  probe then established the narrower host rule: file unlink and replacement work inside the
  checkout, while directory rename and removal fail; host-temporary directories remain removable.
  The same boundary left an old `.studio-device-trust.lock` directory undeletable, while a
  monotonic-versus-epoch age comparison prevented Studio from recognizing it as stale. On
  2026-09-17 an ordinary unsandboxed desktop shell on the same machine removed that directory with
  a plain `rmdir`, so the denial belongs to the managed task namespace, not to the checkout or its
  provenance alone.
- **Workaround:** For an emptied persistent generated tree, restore matching output from a checkout
  at the same source revision and verify that its generator reports `up to date`. Focused tests that
  do not copy and recursively remove provenance-marked trees remain usable. Keep disposable runtime
  and test roots in the host temporary directory; publish persistent generated output with
  transactional file replacement instead of checkout-directory replacement.
- **Proposed change:** The September remediation branch moves disposable runtime-test roots to host
  temp and makes parser and IDE generated-file publication rollback-capable without renaming or
  removing checkout directories. The Studio preview runtime is the exception and stays under
  `.artifacts/dev/studio-preview`: `expo start` requires `typescript` to resolve from the project
  root, and only a root inside the repository reaches its hoisted `node_modules` (a host-temp root
  failed every `./dev studio` launch). Preserve those boundaries, and separately identify why that
  task namespace prevents directory lifecycle operations.
- **Dependencies:** None.
- **Acceptance:** `verify --changed` and `verify --complete` can recursively clean the IDE, runtime,
  and Studio scratch trees; a forced generator cleanup denial leaves persistent output byte-for-byte
  intact and reports one actionable failure.
- **Source:** 2026-09-16 September remediation Wave 1 and acceptance remediation.

### DEVENV-065 — The raw-`Error` allowlist is line-precise with no way to re-derive it

- **Status:** Candidate
- **Area:** Repository lint
- **Impact:** Every edit to a file that holds allowlisted raw `Error` constructions moves the
  remaining entries, so `_repo-lint` fails with two paired errors per shifted line — one demanding a
  new entry, one demanding the old entry be dropped. The failure has nothing to do with the change
  under review, and an agent that edits such a file repeatedly pays it once per edit.
- **Evidence:** During the September follow-up branch, four separate `verify --complete` runs failed
  only on `RAW_ERROR_ALLOWLIST` drift after edits to `packages/dev/dev-src/studio/StudioCdp.ts` and
  `packages/dev/studio-smoke/studio-simulated-user.test.ts`; one run reported forty paired errors.
  Re-deriving by hand is error-prone because removing a file's entries first loses the grouping
  comment that says which block a new entry belongs to.
- **Workaround:** Re-derive the list from the lint output rather than editing it by hand: read every
  `constructs` line as an addition and every `no longer constructs` line as a removal, decide each
  new entry's comment group from the list's contents _before_ applying the removals, and rewrite the
  array sorted by path then line.
- **Proposed change:** Give `repo-lint` a `--fix` that applies exactly that re-derivation, or anchor
  each exemption to something stable — the enclosing function's name, or a trailing pragma comment
  on the construction itself — so ordinary edits above it do not invalidate it.
- **Dependencies:** None.
- **Acceptance:** Editing a file with allowlisted constructions, without adding or removing any,
  leaves `_repo-lint` green; adding one has a single supported command that records it.
- **Source:** 2026-09-17 September remediation follow-up.

### DEVENV-066 — Browser-harness gestures silently miss an occluded target

- **Status:** Mitigated for offset gestures
- **Area:** Studio browser harness
- **Impact:** `StudioCdp` dispatches real mouse input at a computed viewport point. When something
  else is painted there — a floating panel, a sticky gutter, a divider's overhanging grab area — the
  gesture reaches that instead, the step quietly does nothing, and the run fails many steps later at
  an unrelated `waitFor`. Four separate journey failures diagnosed on the September follow-up branch
  were this, each costing a full browser round trip to localise.
- **Evidence:** The simulated-user journey's left-divider drag landed on the floating agent panel;
  its folded-line click landed first on `.studio-divider-right`'s `::after` grab area and then on
  `.cm-gutterElement`; the keyboard journey's pending-surface click landed on nothing because the
  whole overlay inherited `pointer-events: none`. Every one presented as a timeout elsewhere.
- **Workaround:** None needed for offset gestures: `clickAtOffset` and `dragBy(..., { offset })` now
  scroll `nearest` rather than `center` and refuse a point that does not hit the target, naming what
  covers it.
- **Proposed change:** Extend the same hit check to centre-based `click`, `drag` and `wheel`. It was
  left off there only because those have many more call sites than could be re-proved in one branch.
- **Dependencies:** None.
- **Acceptance:** Any harness gesture whose point lands outside its target fails immediately, naming
  the covering element, instead of being absorbed by the page.
- **Source:** 2026-09-17 September remediation follow-up.

### DEVENV-067 — A failing deep-equality assertion on AST nodes can exhaust the machine's memory

- **Status:** In progress
- **Area:** Test execution
- **Impact:** One failing `toEqual` whose operands are Langium AST nodes allocates without bound until
  macOS runs out of application memory. Nothing bounds it: no repository test node carries a timeout, an
  interrupt on the wrapper command leaves the allocating child alive, and the sandbox where this happens
  denies the process inspection needed to find that child.
- **Evidence:** On 2026-09-16 macOS reported `Your system has run out of application memory` on a 128 GB
  machine; system-wide memory pressure ran 18:00:03–18:44:25 local and macOS force-quit 675 idle
  background services. macOS skipped writing its own jetsam reports (`File limit set to 0`), so no OS
  report names the culprit. The culprit was `bun test packages/parser/parser-tests/design.test.ts`,
  started through `./agent test-file` by a Codex agent lane in `~/.codex/worktrees/e91a/tao-lang-2`.
  Three runs hung the same way (17:55:57, 18:07:48, 18:25:54); two produced no log at all, their
  directories under `.artifacts/logs/dev-test/`
  (`2026-09-16T21-55-57-025Z-93582-b8a2aab4` and `2026-09-16T22-07-48-549Z-11273-444f813e`) holding only
  an empty `test-results` directory. The trigger was a failing deep-equality assertion (`toEqual`) whose
  operands were Langium AST nodes; the lane later replaced those assertions with `toHaveLength`/`toBe`,
  which fixed the tests but not the processes already running. Reproduced locally on bun 1.3.13: a
  failing `expect([nodeA]).toEqual([nodeB])` on two parsed design declarations went from 185 MB to 4.1 GB
  in two seconds (killed at a 3 GB cap), and a stray instance of the same probe reached 12.4 GB in
  fifteen seconds before it was killed. Upstream this is bun issue #34178 (`Runaway native recursion …
  allocates unboundedly until the machine dies`, 210 GB in that report); its fix, bun PR #34179, adds a
  shared-reference budget of 1 MiB per side in assertion diffs and 64 MiB in snapshots, and was still
  open and unreleased as of 2026-09-12, so there is no bun version to upgrade to. Per that PR the
  formatter prints `[Circular]` only for true cycles, so a value reachable by several paths is printed
  once per path and expands exponentially; Langium nodes are exactly that shape (`$container`,
  `$document`, `$cstNode`). bun #21277 records that a synchronous runaway is not interrupted by
  `--timeout`, so a bun-level per-test timeout cannot bound this and the bound has to be enforced by the
  parent process; bun PR #34884 records the same formatter overflowing on deeply nested values. The same
  formatter backs `console.log`, so this can also occur outside tests when something prints an AST node.
  Three repository-side reasons it ran 45 minutes instead of two:
  `packages/dev/dev-src/repository-tests/WorkGraph.ts` supports a per-node timeout (`timeoutMs`) but only
  the ship bundle proof and `studio-canary` set it in `GateCatalog.ts`, so ordinary test nodes had no
  bound; `CLI.start` in `packages/shared/shared-src/CLI.ts` signalled only the direct child, so an
  interrupt to the `./agent test-file` wrapper left the `bun test` child running; and the leftovers could
  not be found because the Codex sandbox denies process inspection
  (`zsh:1: operation not permitted: ps`). Nothing in the logs shows what finally ended it at 18:44.
- **Workaround:** Do not assert deep equality on parsed Langium nodes; assert named fields with
  `toHaveLength`/`toBe`. Stop a surviving `bun test` child directly from a shell that can inspect
  processes, because interrupting the wrapper command does not.
- **Proposed change:** Implemented on `feat/one-verification-graph`, pending that branch landing.
  `CLI.start`'s teardown stops a child's whole tracked descendant tree deepest-first, filtered by OS
  process-start identity so a reused PID cannot be signalled, escalating SIGTERM to SIGKILL after a
  grace period; it is selected by a per-call `processPolicy` of `test`, `tool` or `server`, where
  `server` signals the direct child only and `resolveProcessBounds` refuses a bound on any policy but
  `test` rather than dropping it. No policy changes spawn detachment: an earlier version detached by
  default, which would have stopped the terminal's Ctrl-C reaching `./agent` lanes, and that was
  rejected as worse than the incident. Test nodes carry a parent-enforced wall-clock bound and an
  idle-output bound, derived in `packages/dev/dev-src/repository-tests/TestNodes.ts` from each node's
  recorded duration against a floor (and, for the wall bound, a ceiling) rather than a fixed five
  minutes; the idle bound is the one that catches this class, because the runaway allocates without
  printing and bun #21277 means `bun test --timeout` cannot interrupt it. `@shared/test`'s `Expect`
  refuses `toEqual`, `toStrictEqual`, `toMatchObject`, `toContainEqual` and the snapshot matchers on a
  Langium-shaped value, through `.not`, `.resolves` and `.rejects` too, with one named escape hatch
  (`Expect.Unguarded`); the existing repo-lint rule requiring test files to import `@shared/test`
  rather than `bun:test` backstops it, and the six assertions in
  `packages/parser/parser-tests/design.test.ts` that triggered the incident were rewritten to
  `toHaveLength` plus `toBe` on identity. Explicitly not adopted: a per-process RSS cap — macOS does
  not enforce `ulimit -v`/`-d`, per-pid RSS needs `ps`, and `ps` is denied in exactly the sandbox where
  this happened (DEVENV-068).
- **Dependencies:** bun PR #34179 is unreleased, so no upgrade removes the underlying allocation.
  DEVENV-016, DEVENV-030 and DEVENV-068 own host process visibility and cleanup constraints.
- **Acceptance:** A test node that allocates without bound is stopped by its parent within a recorded
  bound and its whole process group ends, including after an interrupt; a deep-equality assertion on a
  Langium-shaped value fails immediately with a named remedy; server, Metro, simulator, and Studio
  processes are unaffected by the test-shaped stop policy.
- **Also seen:** 2026-09-17, on a machine running ten to fifteen concurrent lanes with the load
  average peaking at 33.6 on 18 CPUs, one `./agent test-file` run on
  `packages/dev/dev-tests/merge-with-main.test.ts` left the same signature — a log directory holding
  nothing but an empty `test-results/`, with no `dev.log` and no `summary.json` — and a retry of the
  same file passed cleanly. That file has no deep-equality assertion, so heavy load alone appears
  able to end a lane before it opens its log. Whatever the cause, the missing evidence is the part an
  agent hits first: the lane's own instructions say to read `summary.json` before diagnosing a red
  lane, and there is nothing to read, which makes "the machine killed the run" indistinguishable from
  "it never started". Writing the log and a provisional summary before the first child starts would
  settle that independently of the allocation fix.
- **Source:** 2026-09-16 runaway-process investigation; corroborated 2026-09-17 by the
  merge-finalization performance work.

### DEVENV-068 — A child process cannot execute `ps` inside the Bash sandbox

- **Status:** Candidate
- **Area:** Sandbox
- **Impact:** Repository code that lists processes through a subprocess sees nothing in a sandboxed lane,
  so a lane cannot find a leftover process it needs to stop, and the code path that would do it cannot
  be exercised there. This was one of the three causes in DEVENV-067.
- **Evidence:** `Platform.spawnSync('ps', { args: ['-axo', 'pid=,ppid=,lstart=,command='] })` returns
  `status: undefined` with `error: EPERM: operation not permitted, posix_spawn 'ps'`, and the same for
  `/bin/ps`, while the identical `ps` invocation typed into the sandboxed shell succeeds: the Seatbelt
  policy denies the exec to the child, not the shape of the command. `AGENTS.md` already blesses that
  exact fixed `ps` shape for an agent to run directly. Consequently `processTable()` in
  `packages/shared/shared-src/ProcessTree.ts` returns an empty list in a sandboxed lane, which makes the
  non-Darwin branch of `descendantProcesses` unusable and untestable there; on Darwin the libproc path
  (`/usr/lib/libproc.dylib` through `bun:ffi`) supplies both child PIDs and process-start identity,
  which is the stronger reason it is primary.
- **Workaround:** Rely on the Darwin libproc path, and run a process-listing probe directly in the shell
  rather than through repository code.
- **Proposed change:** Either allow `/bin/ps` for child processes in `.rulesync/permissions.jsonc`'s
  sandbox policy, or document `processTable` as a non-Darwin-only path so no lane depends on it here.
- **Dependencies:** `.rulesync/permissions.jsonc` owns the sandbox policy. DEVENV-030 and DEVENV-060 own
  the adjacent host process-visibility constraints.
- **Acceptance:** Either a sandboxed lane's `processTable()` returns the real table, or the code and its
  tests state that the non-Darwin branch is out of scope on this host and nothing in a lane relies on it.
- **Source:** 2026-09-17 process-teardown implementation.

### DEVENV-069 — An in-flight edit to a shared package fails other agents' test runs and names the wrong file

- **Status:** Candidate
- **Area:** Concurrent worktrees
- **Impact:** While several workstreams share one checkout, a momentarily half-applied edit in a shared
  package fails whatever suite another agent is running, reporting a bare `ReferenceError` from the
  broken module with nothing to say the module is not the one under test. Two agents each spent time
  debugging their own unrelated code.
- **Evidence:** Half-applied edits in `packages/shared/shared-src/CLI.ts` and in
  `packages/shared/shared-src/testing/Test.ts` each produced a bare `ReferenceError` naming a symbol in
  that file, attributed to the suite being run. One agent saw
  `ReferenceError: createSuiteState is not defined` pointing at
  `packages/dev/dev-src/repository-tests/TestRunner.ts` while running a `packages/shared` test; the same
  mid-migration state is still visible in this checkout, where `TestRunner.createSuiteState` is called by
  `packages/dev/dev-tests/test-runner.test.ts` and defined nowhere.
- **Workaround:** `bun test --cwd packages/<name> <relative-test-path>` resolves `@shared/test` correctly
  and shows the real stack; otherwise wait for the shared module to load again, for example
  `until bun test <file> 2>&1 | grep -q 'expect() calls'; do sleep 5; done`.
- **Proposed change:** Have the test runner say when a failure came from a module outside the requested
  suite — that a shared module failed to load and a worktree-mate may be mid-edit — and record the
  `--cwd` idiom where agents will find it. Expect this routinely now that parallel workstreams share a
  checkout.
- **Dependencies:** DEVENV-061 owns the root-cwd `bun test` caveat that constrains the fallback.
- **Acceptance:** A deliberately broken shared module produces a failure that names the module that
  failed to load and distinguishes it from the suite under test.
- **Source:** 2026-09-17 branch-wide agent findings.

### DEVENV-070 — This ledger no longer fits one agent read

- **Status:** Candidate
- **Area:** Repository documentation
- **Impact:** The entry rules require searching this document by ID before adding an entry, but at about
  1,240 lines and roughly 31k tokens it exceeds an agent harness's per-read limit, so every task that
  touches it pays two paged reads and that context.
- **Evidence:** A 2026-09-17 read of this file was truncated at its per-read cap and had to be continued
  by offset; the file is the largest document under `Docs/Roadmap/`.
- **Workaround:** Read it in pages, or grep for the one relevant ID and read the highest heading to find
  the next free number.
- **Proposed change:** Add an ID-to-title index at the top, or move `Resolved` and `Closed` entries into a
  companion file, so an agent can find the next free ID and the one relevant entry without paging the
  whole backlog.
- **Dependencies:** None; the entry rules and section headings are part of the same change.
- **Acceptance:** An agent can determine the next free ID and read any single entry without exceeding one
  read.
- **Source:** 2026-09-17 branch-wide agent findings.

### DEVENV-071 — `rg`'s `-r` is a replacement string, not grep's recursion flag

- **Status:** Candidate
- **Area:** Agent tooling
- **Impact:** `rg -rn <pattern> <path>` prints every match with the matched text replaced by the literal
  `n`, so the output reads as genuine source and can be quoted into a document or a review as fact.
- **Evidence:** `rg -rn TAO_STUDIO_CHROME_PATH packages/` printed lines such as
  `Platform.runtimeProcess.env['n']`, because `-r` consumed `n` as the replacement string rather than
  combining with `-n` as `grep -rn` does.
- **Workaround:** `rg` recurses by default; pass no `-r`, and use `-n` alone for line numbers.
- **Proposed change:** One clause in the `AGENTS.md` search bullet noting that `rg` recurses by default
  and that `-r` means replace.
- **Dependencies:** None.
- **Acceptance:** The search guidance names the `-r` difference where it tells agents to prefer `rg` over
  `grep -r`.
- **Source:** 2026-09-17 branch-wide agent findings.

### DEVENV-072 — Shared devenv profile makes its coreutils vanish mid-command in every worktree

- **Status:** Candidate
- **Area:** Worktrees and shell environment
- **Impact:** A tool shell resolves `dirname`, `basename`, and the other profile-provided coreutils
  through `.devenv/profile`, which every linked worktree symlinks to the primary checkout's single
  profile. While another worktree or the primary checkout re-resolves that profile, those binaries
  stop resolving everywhere at once. In a shell pipeline the failure is per-invocation
  `command not found` rather than a nonzero exit, so the surrounding loop keeps running and reports
  a confidently wrong result instead of failing.
- **Evidence:** On 2026-09-17, with `./agent verify --changed` running in this worktree, a
  `while read` loop checking bridge paths emitted `(eval):2: command not found: dirname` once per
  iteration and reported all 160 repository `from` bridges as missing. `sed` and `awk`, which
  resolve from `/usr/bin`, were unaffected throughout. Re-running the identical pipeline after the
  lane finished resolved `dirname` from
  `.devenv/profile/bin/dirname` and reported 1 missing of 160. `ls -la .devenv/` shows
  `profile -> /Users/ro/code/tao-lang-2/.devenv/profile`, so the profile is shared mutable state
  rather than per-worktree.
- **Workaround:** Do not build repository checks out of shell pipelines over profile coreutils while
  a lane runs. Write the check as a `bun` script using `node:path` and `node:fs`, which depends only
  on the already-resolved `bun` binary; that is how the bridge-path check was finally run.
- **Proposed change:** Establish whether a linked worktree can hold its own profile symlink
  generation, or whether profile re-resolution can publish atomically so the old generation stays
  readable until the new one is complete. Failing both, have `./agent` expose the hazard: a
  `command not found` for a profile-provided binary should be a named, actionable diagnostic rather
  than an ordinary shell miss.
- **Dependencies:** None.
- **Acceptance:** A profile re-resolution in one worktree leaves every other worktree's tool shell
  resolving profile coreutils continuously, or a shell that loses them says so with a diagnostic
  naming the profile.
- **Source:** 2026-09-17 bridged-sidecar file-reference validation.

### DEVENV-073 — Gate-runner tests assume an idle machine, so contention handling fails its own suite

- **Status:** Candidate
- **Area:** Verification diagnostics
- **Impact:** `packages/dev/dev-tests/gate-runner.test.ts` and `verification-concurrency.test.ts` assert
  an exact warning list and the presence of `.artifacts/timings/durations.json`. When the host is busy,
  the runner does the right thing — it adds a contention warning and declines to teach the timings store
  from measurements taken under load — and those assertions fail. `verify --complete` therefore cannot go
  green on a machine that several agents share, which is this repository's normal condition, so the merge
  gate is unreachable for reasons unrelated to the branch under test.
- **Evidence:** On 2026-09-18, `bun test packages/dev/dev-tests` failed four tests on a tree whose only
  difference from `main` was one validator diagnostic and one ledger entry, neither under `packages/dev`
  or `packages/shared`. `gate-runner.test.ts:157` received one extra warning,
  `machine contention: no other Tao lane registered; load peaked at 75.0 on 18 CPUs`; `gate-runner.test.ts:299`
  and `:326` and `verification-concurrency.test.ts:240` each failed `ENOENT ... /.artifacts/timings/durations.json`.
  All four pass when the file is run alone on an idle machine. Across four `verify --complete` runs the
  failure set tracked host load, shrinking from four to one as the load average fell from 86.5 to 18.8.
- **Workaround:** Run the file alone to confirm the tests themselves are sound; treat a `dev` suite red
  whose failures are all timings-store or warning-list assertions as a host-load artifact, and confirm by
  re-reading the warning text for a contention line.
- **Proposed change:** Let these tests state the contention precondition rather than assume it: inject the
  load reading the runner samples so a test can pin an idle or a contended machine, and assert warnings by
  subset against the injected condition instead of exact equality. A test that needs real timings should
  force the teach-the-store path rather than depend on the host being quiet.
- **Dependencies:** DEVENV-001 and DEVENV-003 own the runner behavior these tests exercise; this entry is
  about the tests' assumptions, not that behavior.
- **Acceptance:** `bun test packages/dev/dev-tests` and the `dev` node of `verify --complete` pass on a
  host under sustained load from other worktrees, and a genuine timings-store regression still fails them.
- **Source:** 2026-09-18 bridged-sidecar file-reference validation, found while gating that branch. Found
  independently the same day on the subagent-delegation branch, which fixed the
  `verification-concurrency.test.ts:240` quarter of it: two lanes at once is contention by
  `MachineLanes.ts:285`'s own definition, so `GateRunner.ts:317` passes `recordTimings: false` and the
  store the test demanded is exactly what the design withholds. That test now asserts what each outcome
  requires — no store when a summary reports contention, a whole one when none does — and passed twenty
  consecutive isolated runs where it had been failing about half. The three `gate-runner.test.ts`
  assertions this entry names are untouched and still carry the issue.

### DEVENV-074 — `./agent fix` cannot format the skills it is told to format

- **Status:** Candidate
- **Area:** Sandbox policy
- **Impact:** Claude Code's Bash sandbox denies writes under `agents/skills/`, which is also where
  every project skill lives. Editing a skill and running the repository's own formatter therefore
  fails on the file the change is about, and the failure names an OS error rather than a policy, so
  it reads as a broken formatter. Every instruction-editing task pays it.
- **Evidence:** After adding `agents/skills/delegation/SKILL.md`, `./agent fix` exited 1 with
  `Error writing file '…/agents/skills/delegation/SKILL.md': Operation not permitted (os error 1)`
  and `Had 1 error formatting.`; the same command outside the sandbox formatted the file and
  reported `Formatted 1 file. 0 fixed, 124 unchanged`.
- **Workaround:** Run `./agent fix` unsandboxed after editing a skill. The harness's own edit tools
  write these paths normally; only Bash is denied, so the restriction bites exactly one command.
- **Proposed change:** Decide which the policy means. If skills are protected against shell writes
  on purpose, `fix` should say so — detect the denial on a known-protected path and print the
  unsandboxed retry — rather than surfacing `os error 1`. If the protection is incidental, exempt
  the repository's own formatter, whose writes are reviewable in the diff either way.
- **Dependencies:** None.
- **Acceptance:** Editing a project skill and running `./agent fix` either succeeds, or fails with a
  message naming the sandbox and the command to rerun.
- **Source:** 2026-09-17 subagent delegation branch.

### DEVENV-075 — Process-supervision survival assertions flake under load

- **Status:** Candidate
- **Area:** Test execution
- **Impact:** Two tests in `packages/shared/shared-tests/process-supervision.test.ts` fail
  intermittently on a loaded machine, and both are in `_test`, so they red `verify --complete` at
  random. This is the `packages/shared` counterpart to DEVENV-073's `packages/dev` assertions: a
  complete lane on a busy machine now needs several attempts for reasons unrelated to the branch.
- **Evidence:** Eight isolated runs at load 17.85 on 18 CPUs gave one failure, and two later
  `verify --complete` runs failed on it. The assertions are `isAlive(sibling.grandchild)`
  (`process-supervision.test.ts:107`) and `isAlive(server.grandchild)` (`:123`); both assert that a
  backgrounded `sleep 300` grandchild still runs just after its `/bin/sh` parent was signalled.
  Over-signalling is ruled out: `descendantProcesses` walks parentage, on darwin through libproc, so
  a sibling that merely shares the caller's process group is never in the owned tree. The PID parse
  is ruled out: `startTree` waits for a complete `^(\d+)\n` line and for both PIDs to carry
  identities before returning. That leaves the identity match, where `sameProcess` compares the
  recorded `command` as well as `startedAt`. One attempt to exploit that — waiting for the
  grandchild's identity to report an exec'd `sleep` before recording it — was disproved: the
  predicate never became true and all twenty-five runs timed out in that wait, so whatever
  `ProcessTree.identities` reports as that process's `command`, it does not contain `sleep`. That
  change was reverted, not kept.
- **Workaround:** Re-run the file; it passes alone most of the time. Do not treat it as a regression
  from a branch that does not touch `packages/shared/`.
- **Proposed change:** Establish what `ProcessTree.identities` actually records as `command` for a
  forked-then-exec'd child, then make the recorded identity stable across that transition. The
  survival checks are the point of both tests and must not simply be relaxed.
- **Dependencies:** Shares a cause shape with DEVENV-073, but in `packages/shared` and about process
  identity rather than the timings store.
- **Acceptance:** Twenty consecutive isolated runs pass on a machine under comparable load.
- **Source:** 2026-09-18 subagent delegation branch, after merging main.

- **Source:** 2026-09-18 bridged-sidecar file-reference validation, found while gating that branch.

### DEVENV-076 — Simultaneous worktree finalizations collapse verification throughput

- **Status:** Candidate
- **Area:** Parallel verification
- **Impact:** Every agent finishing its task runs the repository's heaviest lane at the same moment,
  so the fair share per lane falls to one or two slots and a lane that takes well under a minute
  alone takes many minutes. This is the largest single component of "finalizing takes far longer
  than expected", and it grows with the number of active worktrees rather than with the change.
- **Evidence:** 260 recorded non-`dev-test` lane runs across every checkout, bucketed by how many
  other lane runs overlapped them: one lane median 37.8s (p90 88.1s), two 54.7s (p90 207.5s), three
  75.8s (p90 390.4s), four 691.3s, five 366.3s — superlinear, not proportional. On 2026-09-17 at
  17:01 local, `ps` showed eight gate-runner processes plus a `full-verify` and a
  `merge-with-main`, and `~/.cache/tao/machine-lanes` held 13 live lane records — none stale —
  holding **two admitted slots between them** while 16 of 18 CPUs' worth of budget went unissued.
  A control `verify --complete` started in this worktree at that moment took **721.5s against a
  32.5s uncontended median, 22x**, reporting `13 Tao lanes ran at once; load peaked at 36.2 on 18
  CPUs`; within it `_test` took 266.6s against ~34s, `_fix-tao` 107.5s against 3.3s, and
  `_compile-word-flower-app` 18.1s against 0.65s. Two candidate causes to separate: the fair-share
  floor gives each of 13 lanes a ceiling of one or two slots, and every admission decision takes
  the single advisory registry lock, so 13 contenders may spend admission in lock contention rather
  than in work.
- **Workaround:** Verify when the machine is quiet, or read the `contention` block in
  `summary.json` before treating a slow lane as a regression.
- **Proposed change:** Admit whole heavy lanes machine-wide in arrival order rather than splitting
  the machine between all of them at once, so two or three lanes run at full width and the rest
  queue with a printed position; reconcile admitted slots with real CPU use, since 13 lanes holding
  one slot each drove load to 28 on 18 CPUs, which means a slot does not describe what a suite
  actually spawns.
- **Dependencies:** `MachineLanes.ts` `fairAllocations` and the `WorkGraph` reservation path;
  builds on DEVENV-001 rather than replacing it.
- **Acceptance:** With ten lanes requested at once, the median completion time of the first three is
  within 1.5x of the uncontended median, and total wall time for all ten beats today's fair-share
  behavior.
- **Source:** 2026-09-17 merge-finalization performance investigation.

### DEVENV-077 — Merge finalization is a prose protocol with no command behind it

- **Status:** Candidate
- **Area:** Agent harness performance
- **Impact:** "Finalize and prepare the merge" is a deterministic sequence — land commits, refresh
  the affected roadmap documents, integrate `main`, verify, write `.artifacts/merge/<branch>.msg`,
  report — but it exists only as prose in `AGENTS.md` and the `verification-lanes` skill, so an
  agent interprets it one model turn at a time at the point in a session where its context, and
  therefore its per-turn latency, is largest.
- **Evidence:** Finalization is not a terminal step but a loop: across 16 worktrees the same branch
  re-enters it a median of 5 and a mean of 7.4 times, driven by Ro's corrections, by retries after a
  red lane, and by the agent's own re-entry after a background job reports — and every round replays
  the whole protocol, because nothing persists what the previous round established. 119 such
  stretches across this repository's Claude Code transcripts,
  17.0h wall: 58.6% is model generation and 41.4% is command execution; a stretch that reaches
  `merge-with-main` averages 39 assistant turns and 22 tool calls, and 45% of all turns issue no
  tool call at all. Those 45 stretches ran 50 `full-verify` and 46 `verify` invocations on top of
  the `full-verify` that `merge-with-main` runs itself, about three full passes each, with one
  stretch running six. Median cached context re-read per turn is 357k tokens; in the top quartile
  (630k) mean per-turn model time is 11.0s against 4.0–5.4s in the lower three. Waiting on
  backgrounded gates with `until [ -s … ]; do sleep 15; done` accounted for 6.0% of the total,
  and commands blocked in permission review for 11.3%, still 37% of finalization Bash calls
  carrying the `cd`/`export`/`VAR=` prefixes DEVENV-045 asked agents to drop.
- **Workaround:** Run the superset lane once and let `merge-with-main`'s own `full-verify` be the
  evidence; edit tracked documents before verifying, never after, so the green-tree record survives.
- **Proposed change:** Add `./agent finalize`, which asserts the branch and clean worktree,
  integrates `origin/main`, runs one verification lane, drafts `.artifacts/merge/<branch>.msg` from
  `git log <base>..HEAD` for the agent to edit, and prints the short list of judgments that remain
  (which roadmap documents to refresh, what the message should say). Point `AGENTS.md` and the
  `verification-lanes` skill at the command instead of restating the sequence.
- **Dependencies:** `MergeWithMain.ts` already owns the landing half; this is the preparation half.
  The green-tree records in `GreenTree.ts` already make a repeated lane free when the tree is
  unchanged, so the redundant passes come from ordering, not from missing caching.
- **Acceptance:** A finalization from a clean feature branch completes in under ten model turns and
  one verification lane, and the written merge message passes `merge-with-main`'s own validation
  unedited.
- **Source:** 2026-09-17 merge-finalization performance investigation.

### DEVENV-078 — Nothing serializes landing, so ready branches convoy into each other

- **Status:** Candidate
- **Area:** Human merge workflow
- **Impact:** Several agents reach "ready to merge" together, each runs the full suite on its own
  branch, one lands, and the rest must integrate the new `main` and verify again — by which time
  another has landed. Landing K branches costs work that grows with K rather than with the change,
  and it spends that work in exactly the window when every lane is slowest.
- **Evidence:** `main`'s own history shows the convoy: of 92 inter-merge gaps under six hours, 25%
  are under five minutes and 43% under fifteen, against a `merge-with-main` verified window of two
  to five minutes uncontended and far longer under load. `inspectMergePreflight` requires exactly
  one `main` worktree and requires it to equal `origin/main`, and `MergeWithMain.ts` takes no lock
  of any kind, so two concurrent `--execute` runs stage a squash in the same shared `main` checkout
  and are caught only afterwards by `Repository state changed unexpectedly while preparing the
  staged squash` — after both have already paid a `full-verify`. `stabilizeAndVerify` restarts the
  whole lane when `origin/main` moves and gives up after three passes.
- **Workaround:** Land one branch at a time by agreement, and re-run `merge-with-main` after the
  preflight rejects a stale `main`.
- **Proposed change:** Take a machine-wide landing lease for the whole preflight-to-push window, so
  a second landing queues with a printed position instead of racing. Inside the lease, verify the
  integration tree — `main` plus the branch — once, and treat the branch-side lane as iteration
  evidence rather than the gate, which removes both the pre-merge pass and the restart. Consider
  landing several ready branches as one verified batch that commits as separate squashes, so K
  branches cost one pass.
- **Dependencies:** DEVENV-076 (the lanes a batch would run); `MergeWithMain.ts` preflight and
  `stabilizeAndVerify`; the lease can reuse the registry in `MachineLanes.ts`.
- **Acceptance:** Two `merge-with-main --execute` runs started together land one after the other
  with one verification pass each and no `Repository state changed unexpectedly` failure; landing
  three ready branches costs one full verification, not three.
- **Source:** 2026-09-17 merge-finalization performance investigation.
