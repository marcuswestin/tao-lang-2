# Developer environment upgrades

This is the one durable backlog for repository setup, automation, verification, worktree,
diagnostic, and host-environment improvements. Product defects belong in their product roadmap;
an entry here may link one when the developer workflow is also affected.

## Agent entry rules

- Search by ID, symptom, command, and area before adding an entry. Update the existing entry instead
  of appending a duplicate.
- The owning agent consolidates updates once after delegated findings return; subagents do not edit
  this shared file independently. Keep evidence concise so concurrent branches have fewer shared
  lines to reconcile.
- Use the next `DEVENV-NNN` ID. Record only observed problems or credible improvements with concrete
  evidence; ordinary product failures do not belong here.
- Record: **Status**, **Area**, **Impact**, **Evidence**, **Workaround**, **Proposed change**,
  **Dependencies**, **Acceptance**, and **Source**. Use `None` when there is genuinely no workaround
  or dependency.
- Statuses are `Candidate`, `Planned`, `In progress`, `Incoming`, `Blocked`, `Resolved`, and `Closed`.
  `Incoming` means another unmerged branch owns the fix; re-verify it after that branch lands before
  changing the status to `Resolved`.
- A task that adds or materially updates an entry links this file once in its handoff. A task that
  changes nothing here says nothing about developer-environment feedback.

## Current verification-lanes slice

### DEVENV-001 — Machine-wide lane admission

- **Status:** Resolved
- **Area:** Parallel verification
- **Impact:** Independently computed lane widths can oversubscribe one machine and turn timing-sensitive
  tests red.
- **Evidence:** On an 18-CPU host, simultaneous lane acquisition can let both processes initially
  reserve 18 slots; later sampling changes reporting but not capacity.
- **Workaround:** Avoid overlapping repository lanes.
- **Proposed change:** Use atomic, dynamic machine-wide slot admission with fair per-lane ceilings,
  a one-slot logical floor, bounded polling backoff, and a mutex that never evicts a live owner.
- **Dependencies:** `feat/parallel-workflow-test-compat-6fb06b`; implemented by
  `feat/verification-lanes` commit `5512f785`.
- **Acceptance:** A real two-process test observes at least two lanes while aggregate admitted slots
  never exceed the injected CPU count; malformed records cannot poison accounting and an overfull
  lane set remains able to make progress.
- **Source:** 2026-09-03 parallel-workflow review.

### DEVENV-002 — Structured timeout and retry outcomes

- **Status:** Resolved
- **Area:** Verification diagnostics
- **Impact:** Graph-enforced timeouts can miss retry selection, while a deterministic retry failure can
  retain the original machine-contention label.
- **Evidence:** Graph timeouts are stored in `state.reason`, retry selection inspects only output, and
  retry output is appended to the original attempt before classification.
- **Workaround:** Inspect the original and retry logs manually.
- **Proposed change:** Record structured failure causes and a separate retry attempt; classify the final
  attempt rather than concatenated output.
- **Dependencies:** `feat/parallel-workflow-test-compat-6fb06b`; implemented by
  `feat/verification-lanes` commit `5512f785`.
- **Acceptance:** A graph timeout is selected for confirmation, and an assertion failure on retry is
  reported as a repository failure. A successful exclusive retry is accepted as green but remains
  visibly retried, while a failed retry appears once with no stale manual-retry advice.
- **Source:** 2026-09-03 parallel-workflow review.

### DEVENV-003 — Exclusive contention confirmation

- **Status:** Resolved
- **Area:** Parallel verification
- **Impact:** `jobs: 1` serializes only the retry batch; sibling worktrees can keep contending, so the
  result cannot establish whether load caused the original timeout.
- **Evidence:** The current retry leaves the caller's machine lease and every peer lane active.
- **Workaround:** Stop other worktrees and rerun the named gate manually.
- **Proposed change:** Acquire a bounded machine-wide exclusive confirmation lease that pauses new
  admissions and drains peer reservations before retrying.
- **Dependencies:** DEVENV-001; implemented by `feat/verification-lanes` commit `5512f785`.
- **Acceptance:** A multi-process test proves the retry waits for peer work and blocks new admissions;
  failure to obtain exclusivity is reported as unconfirmed contention.
- **Source:** 2026-09-03 parallel-workflow review.

### DEVENV-004 — Studio smoke port-block ownership

- **Status:** Resolved
- **Area:** Studio verification
- **Impact:** Worktrees whose hashes collide can both pass the free-port probe and then race to bind the
  same server/preview pair.
- **Evidence:** Socket reservations are released before the smoke child starts.
- **Workaround:** Supply distinct shards manually or serialize Studio smoke runs.
- **Proposed change:** Hold an atomic, stale-owner-aware cross-worktree block lease for the full smoke
  process, including explicit shards, and fail closed when either the lease or port probe is unavailable.
- **Dependencies:** Implemented by `feat/verification-lanes` commit `5512f785`; no Studio product
  changes.
- **Acceptance:** Two processes cannot own the same shard/worker block concurrently and the lease is
  released after success, failure, or interruption.
- **Source:** 2026-09-03 parallel-workflow review.

### DEVENV-005 — Sandbox-compatible full verification

- **Status:** Resolved
- **Area:** Verification lanes
- **Impact:** A managed shell cannot run the five Studio host lanes, but duplicating gate lists would
  drift and could overstate coverage.
- **Evidence:** Browser/native Studio gates require host capabilities denied by the managed sandbox;
  all other full-verification gates were measured as compatible.
- **Workaround:** Run `just full-verify` from a normal terminal.
- **Proposed change:** Add gate-owned unsandboxed metadata and one shared full-verification membership
  used by both `full-verify` and `full-verify-sandbox`.
- **Dependencies:** Implemented by `feat/verification-lanes` commit `f5705e9f`.
- **Acceptance:** The sandbox lane passes, names exactly five skips, omits dependency installation, and
  never claims full verification passed.
- **Source:** 2026-09-03 verification-lanes brief.

### DEVENV-006 — Honest focused-test selection

- **Status:** Resolved
- **Area:** Test runner
- **Impact:** A mistyped name pattern can execute zero tests and still report success; running one Jest
  file requires an undiscoverable local command.
- **Evidence:** Bun suites use `--pass-with-no-tests` so package-local zero matches do not fail the
  aggregate, and no exact-file repository command exists.
- **Workaround:** Read raw runner output and invoke package-local Jest with `--no-watchman` manually.
- **Proposed change:** Count reporter test cases across suites, fail a filtered aggregate at zero, and
  add exact-file routing for Bun and runtime Jest.
- **Dependencies:** Implemented by `feat/verification-lanes` commit `f5705e9f`.
- **Acceptance:** A nonexistent name exits nonzero; Bun and Jest file paths run through the shared lane
  with repository-local tools and Watchman disabled.
- **Source:** 2026-09-03 semantic-agent and companion implementation notes.

### DEVENV-007 — Per-test retry ledger and reports

- **Status:** Resolved
- **Area:** Test iteration
- **Impact:** Developers must rerun the full suite after a red run and have no durable per-test flake or
  duration evidence.
- **Evidence:** Existing timing history is per suite and Bun has no last-failed selector.
- **Workaround:** Rerun a remembered file or the complete test lane.
- **Proposed change:** Record Bun JUnit, Jest JSON, and a synthetic Tao Apps unit in a per-checkout
  ledger; add changed, retry, flake, and slow-test reports; never write an interrupted run; and bound
  retained JSONL history without losing recent reversal evidence.
- **Dependencies:** Implemented by `feat/verification-lanes` commit `f5705e9f`.
- **Acceptance:** Red/full/green fixture runs select the specified files, cold state runs everything,
  missing reports fall back honestly to process summaries, interrupted runs add no durable outcomes,
  and history compaction retains recent flake evidence.
- **Source:** 2026-09-03 verification-lanes brief.

### DEVENV-008 — Collision-proof test artifacts

- **Status:** Resolved
- **Area:** Test logging
- **Impact:** Concurrent `./agent test` processes can target the same millisecond-named log directory.
- **Evidence:** `RunArtifacts.runStamp` currently contains only an ISO timestamp.
- **Workaround:** Start runs in different milliseconds.
- **Proposed change:** Add PID and random entropy while retaining deterministic injected stamps in tests.
- **Dependencies:** Implemented by `feat/verification-lanes` commit `5512f785`.
- **Acceptance:** Concurrent location creation produces distinct run roots and both summaries survive.
- **Source:** 2026-09-03 freehand implementation notes.

### DEVENV-009 — Safe, repeatable feature landing

- **Status:** Resolved
- **Area:** Git workflow
- **Impact:** Manually squashing before validation can strand `main` dirty, omit the full host proof, or
  lose the repository's squash-message convention.
- **Evidence:** `git merge --abort` cannot undo `git merge --squash`; landing spans two worktrees and
  several ref-changing phases.
- **Workaround:** Follow the Git skill manually and inspect every intermediate tree.
- **Proposed change:** Add a human-only, dry-run-first `merge-with-main` command with snapshots, strict
  phase ordering, tree equality, guarded abort, and explicit push authority.
- **Dependencies:** Implemented by `feat/verification-lanes`; no Git hook.
- **Acceptance:** Unit tests cover read-only preflight, complete-message validation, atomic snapshots,
  concurrent-state refusal, the pre-push recovery boundary, and abort guards; a disposable bare
  remote plus two real Git worktrees proves squash, tree equality, push, archive, local-branch
  cleanup, and preservation of a clean detached invoking worktree until its task is archived.
- **Source:** 2026-09-03 verification-lanes brief.

## Incoming fixes — do not duplicate

### DEVENV-010 — Preview publication and per-session bundler cache

- **Status:** Incoming
- **Area:** Studio preview startup
- **Impact:** A bundler can crawl before the preview app exists, and shared file-map state can survive a
  closed session.
- **Evidence:** Fixed on `poc/semantic-agent-implementation` by commits `84511589` and `1dcf99d6`.
- **Workaround:** Restart the affected preview session.
- **Proposed change:** Re-verify the incoming ordering and lifecycle fixes after merge; do not reimplement.
- **Dependencies:** Semantic-agent branch must land.
- **Acceptance:** Reproduction tests remain green on merged `main` with isolated session caches.
- **Source:** 2026-09-03 semantic-agent implementation briefing.

### DEVENV-011 — Preview and native-launch diagnosis

- **Status:** Incoming
- **Area:** Studio diagnostics
- **Impact:** Failed preview bundles and native launch hangs previously produced weak or unbounded
  feedback.
- **Evidence:** Diagnosis endpoint/message and host/native fixes exist in commits `3c671497`,
  `42218ab2`, `a2dea067`, and `d6dde832` on `poc/semantic-agent-implementation`.
- **Workaround:** Inspect Studio lifecycle logs and bind explicitly to `127.0.0.1`.
- **Proposed change:** Re-verify after merge; do not duplicate the branch implementation.
- **Dependencies:** Semantic-agent branch must land.
- **Acceptance:** Preview failure names the bundler cause and native launch terminates within its bound.
- **Source:** 2026-09-03 semantic-agent implementation briefing.

### DEVENV-012 — Companion endpoint and harness correctness

- **Status:** Incoming
- **Area:** Companion development
- **Impact:** Endpoint preference, generated instruction ownership, and fixture source setup previously
  made device development and tests misleading.
- **Evidence:** The companion branch fixes endpoint preference/diagnostics, keeps generated instruction
  includes bare, and permits project source in the gateway harness; relevant reviewed fixes include
  `29304e7e` and `55e845f6`.
- **Workaround:** Use the branch's explicit endpoint and fixture setup.
- **Proposed change:** Re-verify the incoming behavior after merge; preserve it during shared-file
  reconciliation.
- **Dependencies:** `feat/companion-app-implementation-85b689` must land.
- **Acceptance:** Device selection tests and generated-agent checks pass on merged `main`.
- **Source:** 2026-09-03 companion implementation briefing.

### DEVENV-013 — Repository-owned Expo cache and fast smoke failure

- **Status:** Incoming
- **Area:** Expo and Studio smoke
- **Impact:** Expo can fail writing its user cache in managed worktrees, and an early Studio exit used to
  degrade into an ambiguous readiness timeout.
- **Evidence:** Commits `5c365f35` and `b43eee9c` on
  `feat/freehand-ui-sketching-implementation` move Expo state into `.artifacts/cache/expo` and report
  bounded early-exit output.
- **Workaround:** Override Expo home to a repository-owned path and inspect the process log.
- **Proposed change:** Re-verify after merge; do not copy either implementation here.
- **Dependencies:** Freehand branch must land.
- **Acceptance:** Ordinary smoke launch uses the repository cache and reports an early child exit without
  waiting for readiness timeout.
- **Source:** 2026-09-03 freehand implementation summary.

### DEVENV-014 — Interaction-test cleanup and durable manual QA

- **Status:** Incoming
- **Area:** Studio test quality
- **Impact:** Unawaited interaction updates produced React act warnings and weak cleanup, obscuring real
  failures.
- **Evidence:** The freehand branch reports awaited navigation/interactions, tighter mounted-state
  cleanup, and a manual QA/decision ledger.
- **Workaround:** Treat warning-heavy runs as suspect and perform the documented manual journey.
- **Proposed change:** Re-verify the incoming tests and records after merge; do not reproduce them here.
- **Dependencies:** Freehand branch must land.
- **Acceptance:** Focused Studio tests finish without act warnings or leaked interaction state.
- **Source:** 2026-09-03 freehand implementation summary.

## Deferred project — begin after the large branches land

### DEVENV-015 — Reliable host-browser verification

- **Status:** Planned
- **Area:** Studio browser smoke
- **Impact:** The complete simulated-user journey cannot run in the managed host when Chrome aborts with
  `SIGABRT` before exposing DevTools; ordinary `verify` intentionally omits this proof.
- **Evidence:** The smoke's two non-browser checks passed, but the browser journey never began.
- **Workaround:** From a normal terminal run
  `just studio-smoke packages/dev/studio-smoke/studio-simulated-user.test.ts review-cycle` or
  `just full-verify`.
- **Proposed change:** After Studio branches land, evaluate headless Chromium and attach-to-existing-browser
  modes, then add a reliable CI or pre-merge host lane without slowing ordinary `verify`.
- **Dependencies:** Semantic-agent, companion, and freehand Studio changes must land first.
- **Acceptance:** The full browser journey runs repeatably in its supported host and is required for
  Studio-heavy landing evidence.
- **Source:** 2026-09-03 freehand implementation summary.

### DEVENV-016 — Studio process ownership and status

- **Status:** Planned
- **Area:** Studio lifecycle
- **Impact:** `studio-stop --all` can report success while a Browser-pane server survives, and
  `studio-ps` can report `UNDETERMINED` when process inspection is denied.
- **Evidence:** Reproduced during semantic-agent development; a surviving server can make later
  verification exercise stale code.
- **Workaround:** Check lifecycle logs and ports from an unrestricted terminal before trusting a restart.
- **Proposed change:** Give every launch durable ownership metadata, stop by that ownership rather than
  unrestricted process listing, and distinguish denied inspection from stopped state.
- **Dependencies:** All Studio lifecycle branches must land first.
- **Acceptance:** Stop-all removes every owned server in browser and native modes; status never reports a
  stale process as stopped.
- **Source:** 2026-09-03 semantic-agent implementation briefing.

### DEVENV-017 — Studio snapshot command consistency

- **Status:** Planned
- **Area:** Semantic Studio tooling
- **Impact:** The CLI validates a snapshot differently from the server, diagnostic counts are not
  comparable, and entry paths can fail as raw host `ENOENT`s.
- **Evidence:** Snapshot CLI validates before parsing while the server parses directly; project-relative
  entry resolution is unspecified in the current branch implementation.
- **Workaround:** Use an absolute existing entry and compare raw diagnostics manually.
- **Proposed change:** Share one validated snapshot loader and resolve CLI entry paths against the named
  project root with typed user-facing errors.
- **Dependencies:** Semantic-agent branch must land first.
- **Acceptance:** CLI and server return the same diagnostic model for identical input; relative and invalid
  entries have pinned behavior.
- **Source:** 2026-09-03 semantic-agent implementation briefing.

### DEVENV-018 — Semantic facts and coverage commands

- **Status:** Planned
- **Area:** Semantic Studio tooling
- **Impact:** Feature agents lack direct CLI access to the fact and coverage views they need for grounded
  planning and review.
- **Evidence:** No fact/coverage CLI exists on the semantic-agent branch.
- **Workaround:** Call internal modules from temporary scripts or inspect Studio output.
- **Proposed change:** Add stable read-only CLI commands over the merged semantic model.
- **Dependencies:** Semantic-agent branch and DEVENV-017.
- **Acceptance:** Commands produce versioned machine-readable output and focused tests exercise real
  project facts and coverage.
- **Source:** 2026-09-03 semantic-agent implementation briefing.

### DEVENV-019 — Idempotent workspace opening

- **Status:** Planned
- **Area:** Language workspace
- **Impact:** Opening the same root twice can misbehave or hang, which affects long-lived tools and
  performance checks.
- **Evidence:** Observed during semantic-agent development; not isolated from concurrent Workspace work.
- **Workaround:** Reuse one open workspace per root or close it before reopening.
- **Proposed change:** Reproduce on merged `main`, then define and enforce reuse or explicit duplicate-open
  semantics.
- **Dependencies:** Freehand and semantic-agent Workspace changes must land first.
- **Acceptance:** A focused lifecycle test opens the same root twice without a hang or leaked service.
- **Source:** 2026-09-03 semantic-agent implementation briefing.

### DEVENV-020 — Companion lifecycle and diagnostics

- **Status:** Planned
- **Area:** Companion development
- **Impact:** Multiple-app selection omits the `--app` remedy, successful installation can print an
  automation-permission stack, stale companions can remain blank after Metro changes, and simulator
  failures do not clearly distinguish sandbox denial.
- **Evidence:** Four open findings from the companion implementation review.
- **Workaround:** Pass `--app`, run device tooling from a normal terminal, and reinstall/relaunch a stale
  development client.
- **Proposed change:** Reproduce after merge, improve typed remedies, suppress handled automation errors,
  and add stale-client recovery/status.
- **Dependencies:** Companion and Studio branches must land first.
- **Acceptance:** Each failure mode has a focused test or physical-device proof and names the exact user
  action.
- **Source:** 2026-09-03 companion implementation briefing.

### DEVENV-021 — Safe scratch scripts and concurrent staging

- **Status:** Planned
- **Area:** Repository hygiene
- **Impact:** Package-aware diagnostic scripts have no ignored location with normal alias resolution;
  source-tree scratch files can be accidentally committed by broad staging during concurrent work.
- **Evidence:** Intermediate semantic-agent commits contained scratch files after a read-only reviewer
  wrote into the tree and another process used broad directory staging.
- **Workaround:** Put scripts under `.artifacts`, supply explicit resolver configuration, and stage exact
  paths only.
- **Proposed change:** After active `.gitignore` changes land, add a package-local ignored scratch
  convention and durable exact-path staging guidance.
- **Dependencies:** Companion and freehand `.gitignore` changes must land first.
- **Acceptance:** A package scratch script resolves aliases/dependencies, stays untracked, and the workflow
  documentation forbids broad staging around concurrent writers.
- **Source:** 2026-09-03 semantic-agent implementation briefing.

### DEVENV-022 — Raw Error policy for failure mocks

- **Status:** Planned
- **Area:** Repository lint and tests
- **Impact:** The raw-`Error` ratchet treats realistic third-party rejection mocks like production errors,
  encouraging less faithful tests or unexplained allowlist entries.
- **Evidence:** Semantic-agent tests need to model third-party failures that genuinely reject with raw
  JavaScript errors.
- **Workaround:** Keep a narrow allowlist entry with a site-specific explanation.
- **Proposed change:** Decide between an explicit test-only exemption and a typed helper that documents
  third-party failure simulation; do not weaken production scanning.
- **Dependencies:** Semantic-agent tests must land first.
- **Acceptance:** Representative failure mocks remain faithful while a mutation introducing a production
  raw error still fails repo lint.
- **Source:** 2026-09-03 semantic-agent implementation briefing.

### DEVENV-023 — React Native test renderer convention

- **Status:** Planned
- **Area:** Companion tests
- **Impact:** Direct react-test-renderer use lacks local typings and tends to produce brittle interaction
  tests.
- **Evidence:** The companion review found no `@types/react-test-renderer`; the repository already favors
  React Native Testing Library.
- **Workaround:** Use React Native Testing Library for new tests.
- **Proposed change:** Re-check merged tests, migrate direct renderer usage where valuable, and add typings
  only if a justified low-level renderer test remains.
- **Dependencies:** Companion branch must land first.
- **Acceptance:** Tests compile without ambient gaps and assert through user-visible behavior where
  possible.
- **Source:** 2026-09-03 companion implementation briefing.

### DEVENV-024 — Branch-local semantic cleanup

- **Status:** Blocked
- **Area:** Worktree hygiene
- **Impact:** The semantic-agent worktree contains a modified WordFlower design file, and its intermediate
  history included scratch artifacts that must not reach a squash.
- **Evidence:** `Apps/WordFlower/1 - Current/Design.tao` was intentionally left modified; the briefing names
  the intermediate scratch commits.
- **Workaround:** Preserve the worktree and review its exact final squash diff.
- **Proposed change:** The owning branch decides the design-file disposition and verifies the squash omits
  scratch artifacts.
- **Dependencies:** Owned exclusively by `poc/semantic-agent-implementation`; this project must not edit
  that worktree.
- **Acceptance:** The branch lands with an intentional Design change or a clean restoration, and no scratch
  file appears in the squash.
- **Source:** 2026-09-03 semantic-agent implementation briefing.

## Resolved or currently mitigated

### DEVENV-025 — Worktree-safe CLI test roots

- **Status:** Resolved
- **Area:** CLI tests
- **Impact:** Generated runtime roots beneath package directories could fail in restrictive worktrees.
- **Evidence:** Main commit `1ac7edd8` routes the affected `tao test` CLI cases through temporary runtime
  roots.
- **Workaround:** None required.
- **Proposed change:** Preserve the shared temporary-root helper in later test changes.
- **Dependencies:** None.
- **Acceptance:** The affected CLI tests pass from linked managed worktrees.
- **Source:** 2026-09-03 main history and freehand review notes.

### DEVENV-026 — Opt-in underlying error diagnostics

- **Status:** Resolved
- **Area:** CLI diagnostics
- **Impact:** `Something went wrong.` previously hid permission and subprocess causes during workflow
  diagnosis.
- **Evidence:** Main commit `1ac7edd8` adds `TAO_DEBUG_ERRORS=1`, rendering name, details, cause, and stack.
- **Workaround:** Run the failing command with `TAO_DEBUG_ERRORS=1`.
- **Proposed change:** Preserve concise default errors and the opt-in diagnostic path.
- **Dependencies:** None.
- **Acceptance:** Existing shared error tests pin both renderings.
- **Source:** 2026-09-03 main history and freehand review notes.

### DEVENV-027 — Watchman-free package-local Jest

- **Status:** Resolved
- **Area:** Focused Jest execution
- **Impact:** Global Jest selection and Watchman state can fail in managed environments.
- **Evidence:** The repository runner already invokes its pinned local Jest through the materialized Node
  profile with `--no-watchman`; DEVENV-006 makes the exact-file path discoverable.
- **Workaround:** Use the repository test commands.
- **Proposed change:** Keep local-tool and no-Watchman routing centralized in `TestRunner`.
- **Dependencies:** DEVENV-006 for the public exact-file command.
- **Acceptance:** Runtime Jest file selection never invokes a global binary or Watchman.
- **Source:** 2026-09-03 repository inspection and companion notes.

### DEVENV-028 — Non-incremental dprint in managed worktrees

- **Status:** Resolved
- **Area:** Formatting
- **Impact:** dprint's incremental user cache may be unwritable under a managed policy.
- **Evidence:** Every current Justfile dprint invocation passes `--incremental=false` and verification is
  green under that mode.
- **Workaround:** None required for repository commands.
- **Proposed change:** Reopen only if a new command omits the flag; prefer repository-owned cache state if
  incremental formatting is deliberately restored.
- **Dependencies:** Preserve freehand formatting exclusions when that branch lands.
- **Acceptance:** Repository formatting commands do not write the user dprint cache.
- **Source:** 2026-09-03 repository inspection and freehand notes.

### DEVENV-029 — Materialized development profile and writable caches

- **Status:** Resolved
- **Area:** Managed worktrees
- **Impact:** Re-resolving devenv and writing Watchman or tool caches outside permitted roots can fail.
- **Evidence:** Root instructions use the materialized `.devenv/profile`; repository runners disable
  Watchman and use named writable cache roots. Expo's remaining cache move is incoming as DEVENV-013.
- **Workaround:** Export the materialized profile path in a managed shell as documented in `AGENTS.md`.
- **Proposed change:** Keep new tools inside the same cache/profile conventions.
- **Dependencies:** DEVENV-013 for Expo.
- **Acceptance:** Setup, focused tests, and formatting run without user-cache overrides.
- **Source:** 2026-09-03 consolidated implementation notes.

## External and observational findings

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
- **Evidence:** The test hit Bun's default five-second timeout while `_ship-bundle-proof` ran beside the
  package-test node; an immediate isolated run completed in 27 milliseconds.
- **Workaround:** Re-run the focused performance-check suite after the full lane becomes quiet.
- **Proposed change:** Give this subprocess-based contract test an explicit 30-second timeout while
  preserving its assertions and keeping actual benchmarks outside verification.
- **Dependencies:** Resolved on `feat/verification-lanes`; no scheduling policy changed.
- **Acceptance:** The focused test and a subsequent `full-verify-sandbox` pass without weakening the
  rule that only `bench` reaches the language benchmark.
- **Source:** 2026-09-04 `full-verify-sandbox` acceptance run on `feat/verification-lanes`.

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
- **Dependencies:** Implemented on `feat/verification-lanes`; the five Studio lanes still require an
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
