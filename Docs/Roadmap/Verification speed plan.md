# Verification speed plan

Status: plan, 2026-10-06. Owner: the Developer. Evidence: `Docs/Roadmap/Verification speed research.md`
(sections cited as §n below; its replay and selection scripts live in `.artifacts/verification-speed/`
of the `feat/verification-speed` worktree), the 2026-10-05 sequential
diagnostic handoff from the Studio preview task, and DEVENV-094 / DEVENV-113.

## What the research established

1. **Work is not the problem; amplification is.** The whole lane is about 2,500 s of sequential test
   time (handoff table) and a quiet 4-slot run finishes in 1,122 s. The same scopes take 5–21× longer
   when run alongside the rest of the graph (handoff: compiler workspace 32 s → 699 s, preview
   receipts 34 s → 399 s). An 18-wide run at load 26 produced 31 timeouts of nodes that take under
   70 s alone (§3, §10).
2. **The scheduler starts the longest nodes last.** Every `cli/tao-cli#N` shard, `ides/studio`, the
   project-tooling partitions and all host lanes have no recorded duration, so they rank at
   cost×1 s and the 228 s shard starts at 893 s of a 1,122 s run. Ranking by true durations alone is
   simulated at 1,027 s @4 slots, 362 s @12 (vs 468), 267 s @18 (floor 262) (§10).
3. **A few per-process taxes are paid thousands of times per lane.** ~2,500 maintained-native-binding
   inspections (13 MB hashed each), ~800 `git rev-parse` spawns from host temp dirs whose failure is
   never cached, ~1,000 fresh Workspaces each re-parsing the Prelude, 150–200 TypeScript programs built
   without `oldProgram` (§5, §11). The 120 s file-mutation lock fallback behind that inspection is what
   failed `dead-exports` at 127–129 s (§2).
4. **Several caches cannot hit.** The tao-apps shared-run fingerprint has been empty on every main run
   since 10-04; the one-shot project-tooling TypeScript program never reuses a prior program; the Jest
   transform cache sits at its cap and evicts hot entries first (§15).
5. **Change-based selection buys little at package granularity.** The median main commit needs 100% of
   the suite lane because `shared` is imported by 36 of 37 packages; only ~25% of commits (docs,
   agents, dev-cli-only) need under 20% (§12). Savings must come from per-file closure, not package keys.
6. **CI's partition plan is misbalanced 2.7×** by phantom weights (six project-tooling partition nodes
   each charged the whole 180 s suite) and equal-cost shards; CI never runs the nine host lanes, and
   all host-lane seed entries are dead weight (§13).
7. **Duplicated coverage** is worth 400–600 slot-seconds across tao-cli, validator, project-tooling and
   Studio, mostly from every test compiling its own fixture app or opening its own Workspace (§4, §8).
8. **Fixed sleeps are not a lever** (<15 s per lane) (§14).

## Rules for every slice

- One agent per slice, each orchestrating its own subagents; the file ownership below is the
  conflict boundary. A slice that must touch another slice's file asks the Developer first.
- Iterate with `verify-changed` and focused test files (narrow lanes never wait on the machine lock).
  Prove on GitHub with `open-pr`; land with `open-pr --auto-merge` once the Developer authorizes.
  Local `verify-full` only where a slice changes host lanes, and then only queued as usual.
- Every slice records before/after evidence from CI (`./agent ci-timings`) and, where a local run
  happens anyway, the landing's `summary.json` schedule and contention blocks. No slice claims a
  speed-up from a narrow run.
- Preserve assertions and timeout semantics. A cache may skip hashing or parsing, never a verdict.
- Do not land the twelve-macOS-runner workflow as it stands (cherry-pick `2806811b8`): it renames
  the aggregate check to `CI stage`, and `merge-pr` waits for a check named `Verify`
  (`MergePrCommand.ts:32`), so landing it blocks hosted landing for every branch until all host
  gates are admitted. Slice D reshapes it.

## Group 1 — start now, in parallel

### A. Timing-informed scheduling and seed hygiene
- **Why:** finding 2 and 6; cheapest large win, pure scheduler and data.
- **Owns:** `packages/testing/verification/verification-src/{WorkGraph,TestNodes,VerifyPartition,RunTimings,TestLedger}.ts`,
  the node-weighting lines in `GateRunner.ts` (~248–252), `.github/verify/durations.json`,
  `.github/verify/ledger.json`, `.artifacts/timings` handling.
- **Do:** (a) weight every node (shards, file partitions, host lanes) by the ledger cost of the files
  it holds, scaled to the suite's recorded total, instead of `suite/count` or `cost×1 s`; (b) give
  unsharded and unseeded nodes a cold-start estimate from the seed rather than `null`; (c) seed
  per-node entries for `#k` shards and `project-tooling:*` / `ides/studio:*` partitions; (d) remove
  stale seed and ledger keys (`native-bindings`, `providers/*`, pre-rename paths); (e) record
  durations for the `:prepare`/`:finalize` nodes; (f) cap default local width at 12 (replay: width
  18 loses to inflation).
- **Expect:** local makespan −20–25% at 12 slots, −8% at 4; CI longest partition −25%
  (≈367 → ≈276 node-s). **Effort:** small. **Measure:** replay script in
  `.artifacts/verification-speed/replay.py` against the next landing's `summary.json`; `ci-timings`.

### C. Memoise the per-process taxes
- **Why:** finding 3; the single largest reducer of CPU and lock contention, and the cause of the
  dead-exports lock timeouts.
- **Owns:** `packages/apps/native-bindings/native-bindings-src/maintained-native-bindings.ts`,
  `packages/shared/shared-src/Repo.ts`, Prelude/stdlib loading in
  `packages/compiler/compiler-src/workspace/`, `packages/shared/shared-src/FS.ts` lock constants.
- **Do:** (a) process-level cache of the inspection's hashing step keyed on normalised options plus a
  stat fingerprint (path, size, mtime, inode) of its inputs; the observers and lock/recapture loop
  stay; the five cold-path tests named in §11 must still exercise the cold path (bypass via
  `stdlibRoot`/`sourceRoots`); (b) negative cache for `Repo.tryGetRoot` once the marker walk reaches
  `/`; (c) process-wide parsed Prelude/stdlib shared across Workspaces; (d) reduce the inspection's
  120 s lock fallback to a bounded wait that reports who holds it.
- **Expect:** removes ~2,300 of ~2,500 hashing passes and ~800 spawns per lane; the sequential-vs-
  parallel amplification should drop measurably (the handoff's 15–21× compile scopes are the
  benchmark). **Effort:** medium. **Measure:** one `bun --cpu-prof-md` run on a validator file and a
  receipt file before/after (needs the Developer's permission for a local run); CI partition times.

### D1. CI shape: Linux `Verify` restored, macOS additive
- **Why:** unblocks CI-only landing for every other branch while the macOS runners are proven.
- **Owns:** `.github/workflows/verify.yml`, `Justfile` `verify-full-ci`, `CiGateAdmission.ts`,
  `agents/skills/verification-lanes/references/hosted-verification.md`, `OpenPrCommand.ts`.
- **What needs macOS (static inventory, 2026-10-06):** almost nothing inside the test suites. Only
  `studio-smoke-native` and `studio-canary` carry `requiresMacOS` (GateCatalog.ts:604, :616;
  ≈54 s of seed time). Inside suites the Darwin-only content is one real `swift -e` call in
  `watchos.test.ts` and one `plutil` test in dev-cli, both early-returning on Linux, so they cannot
  be separated by file. The seven browser gates (≈480 s seed) and `ship-bundle-proof` (36 s) are
  `requiresUnsandboxed`/`hostDependent` but not macOS-flagged; whether they can run on a Linux
  runner with Chrome and Watchman is the open question that decides the macOS matrix's size.
  Two native gates (`studio-host-control-smoke`, `studio-mac2-acceptance`) are not in the lane at all.
- **Do:** split the cherry-picked workflow into two jobs: ~18 `ubuntu` partitions running
  `verify-full-ci` with the portable membership, aggregated under the required name `Verify`; and a
  `macos-26` matrix (up to 5 partitions, the hosted concurrency ceiling on non-Enterprise plans)
  running the two macOS-flagged gates, the browser gates until they are proven on Linux, and the
  Darwin branches of the portable suites, aggregated as `CI macOS`, required only once proven. Keep
  `CI_HOST_GATES` staging. The macOS matrix is gate-shaped, so plan it from gate durations, not
  suite shards; with ≈570 s of host-gate work five partitions are ample and two may do. Confirm the
  plan's macOS concurrency and minute multiplier (macOS minutes cost ~10× Linux) before fixing the counts.
- **Expect:** hosted landing stays open; macOS proof grows one gate at a time; the twelve-macOS
  design's cost (12 runners × ~10 min at 10× Linux pricing per run) is avoided. **Effort:** medium.
  **Measure:** first green macOS run; `ci-timings` for both matrices.

### G. Fail cheap first
- **Why:** §13: real failures cluster in typecheck, ide-extension build, word-flower compile and the
  simulated-user smoke; the serial `land-barrier` spent 76 s to report a lint error a focused run finds
  in 0.7 s.
- **Owns:** `Justfile` `land`/`land-barrier`, `packages/cli/dev-cli/dev-cli-src/dev.ts` landing
  path, gate `priority` values in `GateCatalog.ts` for `_*` prepare and static gates only.
- **Do:** run `_typecheck`, `_ide-extension-build`, `_compile-word-flower-app`, `dead-exports`,
  `_repo-lint`, `_doctor-json` as the first parallel wave of the lane instead of a serial barrier;
  start `studio-smoke-simulated-user` at t=0 as the `gui` serial floor; replace line-number-keyed
  browser error allowlists with a stable exception mechanism.
- **Expect:** failed landings report in <1 min instead of 1–20 min; no change to green time.
  **Effort:** small.

## Group 2 — after Group 1 lands (or in parallel if the Developer accepts the policy decisions)

### E. Path-gate the host lanes locally
- **Why:** §9/§10: 432 slot-s and up to 193 s of tail; removing them helps every width ≤12; they
  prove Studio, keyboard emit and the release export, which validator/parser/cli/docs changes never touch.
- **Owns:** host-lane entries in `GateCatalog.ts` (`studioLane`, `studioSmoke`, ship-bundle), the
  GUI branch of `TestSelection.ts`, `MachineLanes` GUI lease.
- **Do:** run host lanes when `packages/ides/**`, `packages/apps/**`, compiler emit, or
  `Apps/HNReader|WordFlower` changed since the last green on main; otherwise record them as
  inherited from main's last green. Needs the Developer's policy decision; §12 estimates 75% of
  commits would still run them, so the saving is for the quarter that would not.
- **Effort:** small-medium. **Verification:** local `verify-full`, queued.

### B. Caches that cannot hit
- **Owns:** `packages/cli/tao-cli/cli-src/test-cache.ts`, `TaoAppSharedRun.ts`,
  `ProjectTypeScriptProgram.ts` (`oldProgram`), `jest-transform-cache.ts` eviction, tao-apps shard
  count and `fixedMs` in `GateCatalog.ts`.
- **Do:** make the tao-apps fingerprint hit (search the `requires ./` closure, match real
  declarations only; test that a sibling edit invalidates); pass `oldProgram`; evict the Jest cache
  by last use; cut tao-apps to ~6 shards and fix `fixedMs` (800 ms vs measured 4–9 s).
- **Expect:** 70–160 slot-s and 28–53 s per lane on unchanged apps; project-tooling one-shot
  refresh cost down. **Effort:** small-medium.

### F1/F2. Consolidate duplicated coverage: tao-cli, project-tooling
- **Owns:** the respective `*-tests/` directories only, plus shared fixture helpers they introduce.
- **Do (§4, §8):** golden compiled fixtures (WordFlower, HNReader, Pantry, Studio client) produced
  once by a `gen-app` prepare node and read by tests instead of recompiled; one Workspace per
  fixture directory instead of per test; merge the receipt-* files' repeated warm-ups; drop tests
  that only re-prove a lower layer's assertion.
- **Expect:** tao-cli ≈170 slot-s, project-tooling 60–180 slot-s. **Effort:** medium per suite;
  two agents, disjoint directories.

## Group 3

### F3/F4. Consolidate validator and Studio/Jest coverage
- Validator: 181 multi-file helper sites each open a host-temp Workspace; move them to the shared
  `Validator.createSession` pattern the single-source tests already use (90–170 slot-s).
- Studio/Jest: ≈110 slot-s of repeated client compiles and preview-session setup.

### D2. Admit host gates on the macOS matrix one at a time
- The cherry-pick's staging order: studio-smoke, studio-proof-real-app, simulated-user,
  keyboard-navigation, dialog-browser, agent-browser, network-simulation, smoke-native, canary.
  Browser gates need Chrome/CDP and Watchman on the runner; native and canary need a GUI session
  hosted runners have not yet proven. Each admission is its own CI proof; the omission list is
  reported until the macOS check can be made required.

### S. Per-file closure for green records
- §12: package closure is too coarse. Prototype keys of (test file, its import closure, toolchain,
  generated evidence) for the three heaviest suites and measure hit rate over the last 80 main
  commits with `.artifacts/verification-speed/selection_savings.py` adapted to file closure.
  Rejected before for undeclared-read risk; the prototype must include a drift guard run.

## Group 4

- **Admission tuning:** run `just admission-experiment --provision 10 --lane verify` (DEVENV-094)
  on a quiet machine to settle `ADMITTED_LANES = 2` and reconcile slots with real child counts.
- **Instrumentation** (handoff item 1): per-node active child count, lock wait, prepare wait, and
  queue wait recorded in `summary.json`, so the next amplification is attributed, not guessed.
- **Cancellation and no-progress cleanup** from the Metro branch, extracted after review.
- **Larger Tao test apps:** not worth it (§4); revisit only if tao-apps remains a tail after B.

## Decisions the Developer owns

1. Whether CI-only landing (portable proof on Linux, host lanes pending macOS admission) is
   acceptable as the interim landing route for other branches. Recommendation: yes, immediately.
2. Whether host lanes may be inherited from main's last green when a change does not touch their
   inputs (slice E).
3. macOS partition count against the GitHub plan's concurrency and cost.
4. Permission for the two profiling runs in slice C.
