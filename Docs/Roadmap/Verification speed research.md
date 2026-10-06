# Verification speed: research notes (2026-10-05)

Working notes for the plan an orchestrating agent will implement. Numbers marked M were measured
from run records or logs; I means inferred from reading code. No local tests or gates were run.

## 1. Why landings failed today

- 9 landings recorded in `~/.cache/tao/machine-lanes/history/landings.jsonl`: 1 passed (11:01),
  8 failed 17:02–20:49. Five of the eight died in `just verify-full` after 11–28 min each; two in
  `land-barrier`; one in main integration (M).
- Every one of those ran the local `./dev land` route, which runs `land-barrier` then `verify-full`
  on this machine (`Justfile:466-477`), even though 63e70f0f4 (14:43) made the hosted route the
  default. The branches predate it or the agents did not switch (M for the route, I for why).
- The only green `verify-full` of the day ran with `--jobs 4` (14:07): makespan 1122 s, serial floor
  262 s, 241 gates (M). Every 18-wide run on the same tree hit the 300 s wall timeout on 25–31 nodes
  at once: all compiler shards, 7 tao-cli shards, all project-tooling partitions, ides/studio,
  runtime-jest, expo-host (M; summary.json of `bootstrap-caching-performance-9b0909` 20:21 run:
  cpuCount 18, peakLanes 4, peakLoadAverage 26.2, makespan 1490 s, serial floor 1174 s).
- Ledger history shows flakes are rare (≈58 failed of 25,062 events, reversals ≈1). The failures
  are timeouts under oversubscription plus real breakage, not flaky tests (M).

## 2. dead-exports: 3 s → 101 s

Same work every run: knip over 2,111 tracked `.ts/.tsx` files, `_gen_*` and `*.tao.ts` ignored
(`.config/knip.json`), 0 findings in every log (M). No new tests and no generated code analysed.
The growth tracks machine load across the day: 3 s at 14:07 (`--jobs 4`), 5 s at 15:29–16:43,
14–16 s at 16:50–17:28, 27 s 17:45, 55 s 18:56, 101 s 20:21 (M, `runs.jsonl`). Two mechanisms:

1. CPU starvation. The node is cost 1 with no `serial`, needs `_fix-tao`, so it starts in the
   middle of the test fan-out; knip is a separate `node` process building a full TypeScript
   program (`DeadExports.ts:811`) competing with 18+ Bun test processes at load 26–33 on 18 cores.
2. A 120 s lock wait. Before and after knip it calls `inspectMaintainedNativeBindings`
   (`DeadExports.ts:633-645`), which falls back to `FS.withFileMutationLock` on
   `packages/apps/stdlib/@tao/device/files` when the publisher lock exists
   (`maintained-native-bindings.ts:215-252`); `FILE_MUTATION_LOCK_TIMEOUT_MS = 120_000`
   (`FS.ts:951`). The two 127–129 s failures (19:46, 20:50) are exactly that timeout:
   "Timed out waiting for the file mutation lock …/files.tao-file-mutation.lock" (M). In the 19:46
   run `studio-smoke-native` (194 s) ran concurrently and is the plausible holder (I).

The same inspection runs twice per compile (`compiler.ts:133,190`) and in every
`ProjectTooling.refresh` (`ProjectToolingService.ts:130,196,346,704`). It walks and sha256-hashes
every `.d.ts` of the pinned declaration packages, including the `typescript` package
(102 `.d.ts`, 3.6 MB) plus the generated output trees (`maintained-native-bindings.ts:133-157,
298-364`). Per call that is a few MB of reads and hashing; across a lane it runs thousands of
times, and under a concurrent publisher it serialises on a 120 s lock (M for sizes, I for
per-call cost).

## 3. Scheduling collapse (from the first analysis, still the main lever)

- Fresh worktrees have no `.artifacts/timings/durations.json`; `planShards` then runs big suites
  whole with the 300 s floor (`TestNodes.ts:106-119`, `TestShards.ts`). CI already seeds timings
  from `.github/verify/durations.json`; local lanes do not.
- `resolveCapacity` = all CPUs (`WorkGraph.ts:859`); `MachineLanes` admits 2 broad lanes; costs do
  not describe TS-program or child-spawning nodes. Result: 18–30 heavyweight processes at once.
- Green records are keyed by the whole tree (`GreenTree.ts`), so no reuse across commits.

## 4. Slow suites: duplicated coverage and fixed costs (scout reports, spot-checked)

### cli/tao-cli (ledger 762 s)
- One `ProjectTooling.refresh` on a tiny fixture costs 1.2–2.5 s (M, JUnit XML), ~6 s when a
  sidecar imports `@tao/runtime`, ~13 s with a DataProvider or `.tsx` view. Builds refresh twice
  (`build-command.ts:80,149`).
- Overlaps: check-command vs check-command-cli assert the same five diagnostics on the same
  fixtures (`check-command.test.ts:80,195,211,17,65` vs `check-command-cli.test.ts:63,47,78,20,33`);
  six syntax-error tests each pay a fixture+refresh; the cold-then-replayed check-cache baseline
  repeats in four files; Firebase starter string assertions repeat in creation-firebase and
  create-command; "second build same digest" and the full web export repeat in
  build-project-dependencies and build-clean-cli; app-modules:49 refreshes Native Bridge and then
  spawns `tsc` on it (two TypeScript programs, 11.9 s; today's most repeated failing test line).
- Candidates (I unless noted): bridge-* five files → one fixture, ~65 s; instantdb-push inputs
  once per file, ~35 s (M 42 s today); check-cache copy a pre-stamped tree, ~25 s; merge
  check-command syntax tests and CLI duplicates, ~13 s; builds compile-only where export is
  covered elsewhere, 10–20 s; creation-firebase fold journeys, ~15 s; app-modules drop one
  program, ~5 s. Total ≈170 s of 762 s.

### Studio, dev-cli, Jest runtime, e2e-testing
- No literal sleeps. Two real polling budgets: `ManagedMobileFixture.ts:227` waits a hard-coded
  30 s (`timeoutMs: 30_000`), ManagedMobileDiagnostics waits ~10 s. ~40 s for a timeout option (M).
- studio-dev (148 s): two release compiles of `TaoStudioClient.tao` plus two `Bun.build`s
  (`studio-dev.test.ts:137,164,618`); :618 likely redundant with :137, 15–30 s (I).
- studio-preview-session: 11 of 12 tests open a real session and compile; studio-edit-to-preview:
  7 compiles of the same Garden fixture, 6 avoidable with one session per `Describe`, 20–30 s (I).
  preview-session :175/:699 overlap edit-to-preview :106/:131/:154.
- Jest: native-bridge-demo compiles the same app 7 times (`compile-app.tsx` has no cache), ~12 s;
  expo-host runtime.test.ts does ~30 `generateApp` calls incl. WordFlower twice and spawns 6 `tsc`
  typechecks; studio-scenario-e2e spawns 3 cold `bun -e` generations.
- skills-snippets: each snippet copies the Pantry starter and spawns `./tao check` (42 s); batch
  into one copy and one check, ~30 s (I).
- The "two copies" of Jest files in the ledger are one file under its old and new path (rename
  2bc908665); the ledger keeps stale paths (also `packages/dev`, `packages/studio`,
  `packages/tao-cli`, pre-split check-cache). Any plan must dedupe the ledger before using it.

### tao-apps (205–212 slot-s, 24 shards)
- Compile happens once in `tao-apps:prepare` (`test-command.ts:67-109`, worker pool, 28 s local /
  53 s CI); each shard runs one Jest process with `--maxWorkers` = entry files
  (`test-command.ts:592-612`), and almost every app root is exactly one Jest file (M).
- Real test work across all apps ≈15 s; 25 "first tests" cost 3.6–4.9 s each (≈100 s); Jest boot
  ≈2 s each; shard time minus Jest time is 3.5–22 s, median ~9 s, spent in the CLI (M). Likely:
  every shard deletes the transform cache `size.json` and re-measures up to 25k files under one
  shared lock at exit (`jest-transform-cache.ts:62-107`), plus `HostDependencies.ensure` and the
  binding identity check (I).
- The shared-run cache never hits: the fingerprint returns `undefined` whenever any `.tao` source
  matches `\brequires\b` (`test-cache.ts:243-246`), which real declarations and even comments in
  WordFlower do, so `reused` is always false and prepare recompiles every run (M for code, I for
  effect).
- Merging the 22 test apps into ~4 saves the same shard overhead as simply planning fewer shards
  (raise `fixedMs: 800` at `GateCatalog.ts:246` to the measured 4–9 s, or one `--shared-run` with
  TAO_TEST_JOBS=4) and additionally breaks the README scope contract, per-project config, journey
  names and ledger history. Prepare only shrinks with fewer `app` declarations, since each app pays
  a fresh workspace, stdlib parse and binding inspection (`Workspace.ts:92-107,149`). Estimate:
  70–160 slot-s from fewer processes, 28–53 s from a working shared-run cache, 0–5 s from folder
  merging alone (I).

### validator (ledger 368 s, 667 tests, 0.55 s/test) and language/project-tooling
- Two validator paths: in-memory `accepts`/`rejects` share one session per file
  (`validator-tests/test-validate.ts:10`) but still re-validate every reachable file incl. Prelude
  (`validator.ts:394`); disk-backed `acceptsFiles`/`rejectsFiles`/`checksFiles`/`withValidationParse`
  (~164 call sites; use-and-imports 45, workspace-structure 28, package-publications 23) write a
  temp dir and call `Workspace.validate`, which opens new Langium services and re-parses the
  Prelude per call (`Workspace.ts:86-106`, `workspace-utils.ts:32-39`).
- `design.test.ts` builds a fresh session for each of 27 `Validator.validateCode` calls
  (`validator.ts:485-490`), ~11 s (I).
- On a temp dir without `.git`, `Packages.createContext` → `Repo.filesUnder` → `tryGetRoot` spawns a
  synchronous `git rev-parse` that fails and is not cached, twice per test (`Repo.ts:33,76-81`).
- Project-tooling: every miss in `ProjectTypeScriptProgramSession` is `ts.createProgram` with a
  fresh host and no `oldProgram` (`ProjectTypeScriptProgram.ts:112,152`); one-shot `refresh` has no
  session (`ProjectToolingService.ts:124-125,284`). ProjectFileWatch's 12 tests use one-shot refresh
  per event (test 1 alone ≈7 cold programs) plus ≈4.4 s of fixed sleeps; ProjectToolingService has
  37 cold refreshes in 23 tests; the receipt support helper runs watch → ≤4 warm refreshes → mutate
  → refresh → force → repair → warm again per registered test (`ProjectRefreshReceiptTestSupport.ts:46-85`),
  5 tests in ProjectRefreshReceipt and 5 more in ProjectRefreshReceiptInputs;
  ProjectNativeRefreshReceipt copies the whole `typescript` package (`:75`).
- Candidates (I): memoize native inspection per process 40–100 s validator + ~1 s per refresh;
  shared validator workspace with `sourceOverrides` 30–60 s; design onto shared session 11 s; merge
  the three generatedOutput receipt tests into one watch 40–100 s of 247; FileWatch on a program
  session and condition waits 20–40 s; process-wide TypeScript `SourceFile` cache for lib/node_modules
  `.d.ts` (unmeasured, helps every program); drop duplicate cold-parity calls 6 s.
- Unexplained from reading: use-and-imports ≈2.9 s/test, workspace-structure ≈1.5 s/test. Profile
  one file with `bun --cpu-prof-md` before planning around them.

## 5. Cross-cutting: the maintained native-binding inspection

`inspectMaintainedNativeBindings` runs on every `Workspace.validate` (`Workspace.ts:149,239`),
twice per compile (`compiler.ts:133,190`), in every `ProjectTooling.refresh`/watch
(`ProjectToolingService.ts:130,196,346,704`), in every `tao test` prepare and shard, and twice in
dead-exports. Each call re-walks the generator directory, reads and sha256-hashes the pinned
TypeScript engine `node_modules/typescript/lib/typescript.js` (9.1 MB, `maintained-native-bindings.ts:273,322`),
walks and hashes the pinned `.d.ts` trees (`:133-157,335`; typescript alone 102 files, 3.6 MB),
reads the manifests twice (`:232,236`) and walks both output trees (`:355-364`). Nothing is memoized
across calls by design (`:256-257`). When the generated outputs are missing or a publisher lock
exists it runs under `FS.withFileMutationLock` with a 120 s timeout (`:252`, `FS.ts:951`); the
generated outputs are absent in this worktree and in the primary checkout (scout claim, unverified
here). Per-call cost is unmeasured; at ~13 MB of reads plus hashing it is plausibly 50–200 ms
uncontended and far more under I/O contention, over thousands of calls per lane (I). Measure one
validator file under `bun --cpu-prof-md` before and after a process-level memo keyed on
(generator identity, manifest bytes, engine mtime/size) to size it. The stale-detection tests
(`workspace-native-cache.test.ts`, ProjectNativeRefreshReceipt) must keep an uncached path.

## 6. Ledger hygiene before planning
`.artifacts/testing/ledger.json` keeps entries under renamed paths (`packages/dev`, `packages/studio`,
`packages/tao-cli`, `runtime-toolchain-tests/*.jest-test.tsx`, pre-split `check-cache.test.ts`), so
suite totals double-count. Prune entries whose file no longer exists before using it to rank work.

## 7. Dependency edges (own inspection, green run 14:07, `--jobs 4`)
- Prepare chain is short when quiet: `_fix-just-fmt` 0.02 s → `_fix-dprint` 0.8 s → `_parser-gen` 0.04 s →
  `_fix-tao` 4.6 s (serial, single-threaded) → `_compile-word-flower-app` 6.4 s and
  `_ide-extension-build` 8.4 s (M). Under load each stretches (dead-exports waited 6.5 s on `_fix-tao`
  in the 20:21 run).
- Dependency waits recorded per node (M, latency not slot waste): `tao-apps:prepare` blocked 24
  shards for 1673 node-s (≈70 s each, so prepare took ≈70 s in that run, not the 28 s seen at
  8 workers); `_compile-word-flower-app` blocked 74 nodes (880 node-s); `_fix-tao` 145 nodes
  (672 node-s); `_ide-extension-build` 68 nodes (193 node-s); `_parser-gen` 147 nodes. Capacity
  waits dwarf these: 166,392 node-s at width 4 across 241 nodes, i.e. the lane is work-bound, not
  edge-bound, once width is sane.
- Over-constraint found: `DEFAULT_METADATA` reads `gen-app`, `gen-ide`, `gen-parser`, `tao`, `ts`
  (`GateCatalog.ts:128`), so every untuned suite (≈30 small ones) and every studio lane
  (`studioLane` reads `gen-app`, `:365`) waits for the WordFlower compile and the IDE extension
  build although only `_typecheck`, `ship-bundle-proof` and the smokes consume them. Cheap nodes
  that could fill the first 15 s of slots wait instead. Gain ≈10–15 s of makespan quiet, more under
  load (I).
- Fixers in verify lanes write the tree (`_fix-dprint` writes `ts`, `_fix-tao` writes `tao`), which
  is what forces the serial chain and the landing refusal "Verification changed the tree". Check-mode
  equivalents (`_dprint-check`, `_tao-check`) exist; a lane built on them has no writer edges except
  `_parser-gen`. Gain ≈5–6 s serial floor plus one failure class (I).

## 8. Fixture sharing (own inspection)
Call sites in test files (exact `rg` counts): `Workspace.open` 166, `ProjectTooling.refresh` 62,
`runCheck` 54, `Workspace.compile` 51, `generateApp` 44, `compileFiles` 27, `Workspace.validate` 26,
`runCreate` 21, `compileAndRenderApp` 18, `runFix` 18, `ProjectTooling.watch` 18, `LSPWorkspace.open` 17.
Each `Workspace.open` is fresh Langium services plus a Prelude parse; each compile/validate adds the
native inspection. Files with the most compile verbs: expo-host runtime.test.ts 38, create-command 21,
studio-render-occurrences 17, check-command 15, emitted-module-cache 13, fix-command 12, files.test 10.
WordFlower is compiled by `_compile-word-flower-app`, tao-apps prepare, expo-host runtime.test.ts
(twice), studio-scenario-e2e (cold `bun -e`), keyboard-navigation smoke and qa-screenshots; HNReader by
studio-real-app, preview-latency, preview-performance, feed-hnreader, sketch-catalog; the Studio client
by studio-dev (twice) and network-simulation. The `gen-app` source class already names the lane-level
WordFlower output; a "golden compiled fixtures" prepare node (WordFlower, HNReader, Pantry, Studio
client) that tests read instead of recompiling is the structural version of every per-file
`beforeAll` compile cache (I; which tests can accept a prebuilt tree needs per-site reading).

## 9. Host lanes (own inspection)
verify-full runs ten host nodes: studio-smoke (launch/ownership), studio-proof-real-app (HNReader
compile, insert, undo, publish, Metro drag, publication-off preview), studio-smoke-simulated-user
(3 tests, 1795 lines, browser editor), studio-smoke-native (the same file with `--native`, `gui`),
keyboard-navigation-smoke (generated keyboard navigation incl. WordFlower in a real browser),
studio-dialog-browser, studio-agent-browser, studio-network-simulation, studio-canary (`gui`),
ship-bundle-proof (Expo iOS exports, cost 3, 180 s timeout). Measured slot-s in the green run:
real-app 193, simulated-user 117, network-sim 26, keyboard 24, agent-browser 23, canary 17, smoke 12,
ship-bundle 11, native 9 = 432 (M). All are `hostDependent`, never recorded green, unsandboxed, and
the two `gui` nodes hold a machine-wide lease that serializes across worktrees. What they prove is
Studio (ides/studio, ides/studio-tooling, expo-host Metro/preview), runtime keyboard behaviour
(apps/runtime, compiler emit) and the release export; a change confined to validator, parser,
cli, services or Docs changes none of their inputs. Path-gating them (run when ides/, packages/apps,
compiler emit, or Apps/HNReader|WordFlower change; otherwise rely on the last green on main) removes
up to 193 s from the tail and 432 slot-s, and frees the gui lease for the worktree that needs it (I).
studio-smoke-simulated-user and studio-smoke-native are the same scenario on two shells by design.

## 10. Scheduling replay (delegated, static; replay.py over the two summary.json files)
Spot-checked: every `cli/tao-cli#N` in the green run has `expectedMs: null` (summary.json), so the
scheduler ranks them at cost×1 s. The replay reproduces the green run (1121.6 s simulated vs 1121.7
recorded, same tail node tao-cli#12 starting at 893 s). Critical path 262 s = serialFloor; area bound
976 s at width 4. Findings (S = simulated):
- Start-order ranking is the largest cheap lever: ranking by true durations gives 1027 s @4, 708 @6,
  482 @9, 362 @12, 267 @18 (floor 262). Missing timing history is also why ides/studio and the
  receipts partition are never sharded.
- Width beyond 12 loses to inflation: 456 s (recorded order) / 371 s (true order) at 18 vs 468/362 at 12.
- Prepare chain is ~5.4 s; first test node starts at 0.8 s. `tao-apps:prepare` (cost 8, clamps all 4
  slots) waited 32.7 s on capacity, ran ~36 s; first tao-apps shard at 75 s.
- Splitting ides/studio or receipts only helps at narrow width (the 262 s path moves to a 242–261 s
  sibling). Removing host GUI lanes helps every width ≤12: −143 s @4, −77 @6, −55 @9, −13 @12.
- Top 10 nodes = 53% of 3261 s work: ides/studio 248, receipts 247, project-tooling#1 233,
  tao-cli#12 228, proof-real-app 193, tao-cli#4 138, simulated-user 118, tao-cli#1 115,
  project-tooling:native 110, tao-cli#5 108.
- 18-wide run: 26 wall-clock timeouts; starvation victims runtime-jest 68→1112 s, expo-host 69→491,
  canary 17→317, proof-real-app 193→577, ides/studio 248→1096. Only ides/studio, receipts and
  project-tooling#1 are within 20% of the 300 s bound even solo.
Not modelled: broker, GUI lease, retries, fail-fast, timeouts; inflation assumes 12 usable cores.

## 11. Per-process fixed costs (delegated, static call-site counts; estimates unless "exact")
Spot-checked: Workspace.ts:149/239/292 and compiler.ts:133/190 call `inspectMaintainedNativeBindings`
(so compile = 3 inspections, compileTestPlan = 2); Repo.ts caches the root only on success (:29, :42).
| Tax | Calls per full lane (est.) | Top directories |
|---|---|---|
| native-binding inspect (13 MB hashed each) | ~2,500 | compiler-tests ~600, tao-cli ~600–900, project-tooling ~250 |
| fresh Workspace + Prelude parse | ~900–1,000 | compiler-tests ~200, validator ~190, source-actions ~170 |
| `ts.createProgram` without `oldProgram` | ~150–200 | tao-cli ~90, project-tooling ~40–60 |
| `git rev-parse` spawns (host temp dirs, failure uncached) | ~800 | validator ~360, project-tooling ~280 |
| temp projects / ProjectIdentity.ensure | ~1,500–2,000 dirs, ~700 identity writes | verification, studio-tooling, tao-cli (`withTaoFiles` 546, `mkTestDir` 1,194 exact sites) |
| child spawns | ~350–500 | dev-cli 133 sites, tao-cli 96, agent-cli 81; `runTaoCliForTest` is in-process |
Validator: 181 multi-file helper sites each open a Workspace in a host temp dir; single-source tests
share one `Validator.createSession` and pay nothing — the model for the fix. tao-apps: 44 `.test.tao`
files (exact) → ~88 prepare inspections + 1 per shard.
Three memoisations removing the most calls: (1) process-level cache of the inspection keyed on
options + stat fingerprint (path,size,mtime,inode) of inputs, caching only the hashing step and
never the verdict (observers/lock-recapture are race guards; ~2,300 of ~2,500 passes); (2) negative
cache for `tryGetRoot` once the marker walk reaches `/` (~800 spawns); (3) process-wide
Prelude/stdlib parse + TypeScript lib SourceFile reuse. Tests that deliberately exercise the cold
path and must stay bypassable: compiler-tests/workspace/workspace-native-cache, project-tooling
ProjectNativeRefreshReceipt + ProjectNativeBindingsService, tao-cli maintained-bindings-cache +
native-bindings.

## 12. Change blast radius over 80 main commits (delegated, static; selection_savings.py)
Spot-checked: `EVERYTHING_PATHS` includes bun.lock and `devenv.*` (TestSelection.ts:125–131, :261);
GUI lanes are not part of `planChangedSuites`. CI seed: suites 2,352 s (tao-cli 1,051 = 45%),
static gates 114 s, host GUI 570 s. Under today's rules the median commit needs 100% of the suite
lane (mean 70%); 46/80 need ≥90%; only 20 trip explicit EVERYTHING (bun.lock 6, .github 5,
tsconfig.base 2, devenv.nix 2), 26 more reach ≥90% through the package import graph. A one-file
edit in 20 of 37 packages (shared, apps/runtime, stdlib, providers/*, compiler, language/*,
ai/generation, native-bindings) selects ≥97% of cost; `shared` is imported by 36/37 packages.
Where selection helps it helps a lot: 20 commits need <20% (7 need zero; nine are Docs/agents/.md
only). Conclusion: package-closure keys for green records buy little; savings must come from
file-level closure (per test file / per app) and from sharding tao-cli. GUI lanes run on 100% of
landings today; selection-implied they'd run on ~75% (67% under a tighter path rule).
Caveat: Python reimplementation of TestSelection/PackageGraph against the current checkout's graph,
old-layout paths counted as EVERYTHING (conservative), tao-apps charged in full when selected.

## 13. CI shape and failure ordering (delegated, static; seed + runs.jsonl + 45 summaries)
Spot-checked: unknown units weigh 30 s (VerifyPartition.ts:38,79); unsharded nodes fall back to
`suiteMs / shardCount` (TestNodes.ts:221–223); `--skip-unsandboxed` drops `requiresUnsandboxed`
gates (GateRunner.ts:175–176, 225).
- The 12 partitions are balanced by construction (288–290 s planned) but the plan is wrong twice:
  the 6 `language/project-tooling:*` partition nodes each carry the whole suite's 180 s (1,080 s
  phantom), and shards are weighted `suite/count` not by file cost (tao-cli = 93 shards of ~11 s
  planned; check-cache alone ~87 s raw). Real imbalance ≈2.7× (partitions 1–6 ≈108 s real vs 288).
  Equal-cost weighting would cut the max partition ~25% (≈367 → ≈276 s serial node-s); the floor is
  runtime-jest at 106 s unshardable. Fix: weight nodes by ledger file cost (GateRunner.ts:248–252).
- Every partition also pays `tao-apps:prepare` (~54 s) outside the plan.
- CI never runs the nine host lanes (all `requiresUnsandboxed`; studio-smoke-native and canary also
  macOS) — 534 s of seed entries that never execute. The hosted route proves nothing about browser
  smokes, native shell, canary or `gui`.
- Seed hygiene: stale `native-bindings`, `providers/icloud`, `providers/instantdb`; no `#k` or
  `project-tooling:*` entries; `_hosted-crud-test` unseeded.
- Failure ordering (57 runs, 45 with summaries; 95 contention, 24 repository, 13 assertion kinds):
  real failures concentrate in studio-smoke-simulated-user (3/8), _typecheck (2/23), ides/studio
  (2/18), _ide-extension-build (2/40), _compile-word-flower-app (2/40), dead-exports (2/26, both
  lock timeouts). compiler (9/29), validator (8/28), project-tooling (4/18) failures were all
  timeouts/contention. Proposed order: prepare → cheap static gates (typecheck, ide-build,
  word-flower compile, dead-exports, repo-lint, doctor) → shared/dev-cli/ides-studio/expo-host →
  simulated-user at t=0 (gui serial floor) → long tail (tao-cli, runtime-jest, tao-apps,
  project-tooling, compiler). Moves dead-exports out of the serial `land-barrier` front.
- Contention-only failed runs on 2026-10-05: confirmed 1, plausible up to ~6 of 27 failed runs;
  21 had a real failure.

## 14. Fixed waits and child processes (delegated; PARTIALLY UNVERIFIED)
The report's wait totals do not reproduce: it claims 82 s of class-1 fixed sleeps (dev-cli 51.9 s);
literal `Time.sleep(n)` in test code sums to 13.4 s across 93 calls (dev-cli 0.9 s), and its
"class 3" budgets are timeout caps, not time paid on the happy path. Usable conclusions only:
fixed sleeps are not a lever (<15 s whole-lane); `until()` polls (701 sites) return early; the
largest literal budgets are 900 s (account-server ManagedMobileDiagnostics), 600 s ×2
(verification), 300 s (studio-smoke). Spawn inventory is consistent with §11: `CLI.run` 285 sites
(dev-cli 80, agent-cli 66, tao-cli 37), `CLI.mustRun` 53, raw `spawn` 26; `runTaoCliForTest` 87
sites in-process. Programs spawned: tao CLI, node, bun, git, xcrun/simctl, npx, sh, xcodebuild.
If spawn cost matters later, measure it rather than trusting this inventory.

## 15. Cache inventory (delegated, static; spot-checked)
Spot-checked: the only `oldProgram` use in production code is native-bindings
typescript-api-source.ts:663; `STAMP_VERSION = 6` (check-cache.ts:55) while the main checkout's
stamp on disk is version 5, so it is dead against current code.
| Cache | Key / scope | Hit evidence |
|---|---|---|
| Per-gate green records (GreenTree.ts) | sha256 of the whole visible tree + devenv profile link; `storage` submodule not hashed; per checkout, also ~/.cache/tao/green | 25 key dirs = 25 distinct trees, 529 records; reuse only on identical tree (one verify-changed → verify handoff of 30 records); never across a changed tree |
| Whole-lane record (Finalize.ts) | same key, lane ∈ verify-or-wider, generated outputs must match; does not travel between checkouts | merging main always forces a real `verify --complete` (Finalize.ts:1162) |
| `tao check` stamp | toolchain + project tree + markers; v6; projects with dependency roots or sidecars never stamped | main stamp v5 (dead); 2 worktrees dead; 1 worktree v6 with 30 entries |
| Tao test fingerprint (test-cache.ts) | packages/profile/stdlib/parser/sources hash + absolute paths; VERSION 5 | never hits for tao-apps: 9/9 shared runs on main since 10-04 have no fingerprint (`requires` bail at :243–246 matches comments in WordFlower.tao:228/:333 and real declarations in Native Bridge App.tao, Package Access.tao, Component Aliases.tao); full packages hash paid every run for nothing |
| Jest transform cache | per checkout identity, 16 identities / 1 GiB shared cap, FIFO by mtime | main identity sits at the 256 MiB per-identity cap (268,423,059 of 268,435,456 B, 14,049 files); eviction by write time removes hot entries first; new worktree starts cold |
| Bun transpiler cache | default; not pinned anywhere except tao-standalone | unknown |
| TS program session + refresh receipt (ProjectToolingService.ts:125/132/141) | in-process, filled only under watch | never hits in one-shot refresh; even under watch no `oldProgram` reuse |
| Timings + ledger | per checkout; CI seeds from .github/verify | seed cli/tao-cli 1,051 s vs local 644 s; seed ledger 34 missing files, 491/864 test files seeded; main ledger shares 0 keys with seed (pre-move paths) |
| Compile stamp (CompileApp.ts) / TestCompiler store | input+output hash per checkout | works (seed times word-flower compile at 155 ms); TestCompiler interns after compiling, never skips it |
`--no-cache` stops lane/gate record reads and sets TAO_TEST_NO_CACHE (disables check stamp, test
fingerprint, compile stamp) but not Jest or Bun caches.
Fixes ranked by the report: (1) make the tao-apps fingerprint hit (search the `requires ./` closure,
match only real declarations; test that a sibling edit invalidates); (2) per-suite green keys over
package + dependency closure + toolchain + generated evidence (rejected before for undeclared-read
risk; §12 says the closure is so wide it would rarely pay anyway — per-file closure is the version
worth testing); (3) pass `oldProgram` in `ProjectTypeScriptProgram.program()` (low risk).
Unsafe/narrow: `hashEntry` drops the `storage` submodule pointer; `_hosted-crud-test` is recordable
without `hostDependent`.
