# Plan - Verification orchestration

Audited at commit `34e47c1c` (Fix edge case of stale generated files), 2026-09-01. Every finding
below was produced read-only and verified against code at that commit — file:line references drift,
so re-verify each claim against the current tree before acting on it. Findings carry a **Done** /
**Skipped** / **Blocked on the Developer** marker as they land; where re-verification contradicts a finding,
the tree wins and the finding is corrected in place.

This plan makes every test and verification workflow run through one dependency-aware, prioritized
scheduler; restores live TUI feedback to humans for `check`, `verify`, and `full-verify`; and gives
agents a terse output contract backed by known artifact files instead of streamed terminal noise.
It makes concrete the open Roadmap.md items "Dev loop: run the `full-verify` Studio lanes through
`./dev gates` with distinct `--worker` indices" (Smaller follow-ups) and the output half of "Harden
`tao test`", and it acts on the simplification plan's deferred gate items (oversubscription
evidence, per-gate timing history). When a slice lands, reconcile the corresponding Roadmap.md
entry in the same change.

## Status

| Workstream                                 | State    |
| ------------------------------------------ | -------- |
| W1. Scheduler core (Part 3.1)              | **Done** |
| W2. Reporters and output modes (Part 3.2)  | **Done** |
| W3. Gates on the graph (Part 3.3)          | **Done** |
| W4. The full-verify lane (Part 3.4)        | **Done** |
| W5. `tao test` output (Part 3.5)           | **Done** |
| W6. Docs, help, and roadmap reconciliation | **Done** |

Known pre-existing failures surfaced by W4, and how they resolved. The old serial
`_full-verify-studio` aborted at its third lane, so two of these had never run once:
`_full-verify-simulated` failed on the editor-selection defect tracked in Roadmap.md ("Make
`just full-verify` pass its simulated-user lane"); `_full-verify-native` failed on the same defect
through the Electrobun shell (first-ever run); and `./dev studio-canary` printed its full report,
then hung because a launch-owned process survived shutdown. Merging `main` at `33a49ea4` ("Make
Studio full verification reliable") closed two of them — the native lane passes and the canary
exits on its own once `completeNativeProbe` stops Hutch — and quarantined the simulated lane from
the graph with its reason in the rollup while its palette-to-preview drop is repaired
(`just _full-verify-simulated` runs it directly). The per-node timeout on the canary stays as a
regression bound. Measured after the merge: `just full-verify` completes unattended in 31.9s wall,
16 passed, 0 failed, 3 skipped — the Studio lanes overlap the package gates, so the full lane now
costs what `verify` alone used to.

## How to execute

- Work in independently landable slices; the workstream order in Part 3 minimizes rework. Run
  focused tests while working and `./agent verify` before every commit.
- The guardrails below override individual findings. When a finding and a guardrail collide, the
  guardrail wins; note the skip rather than forcing the change.
- Preserve every currently proven behavior: the existing `test-runner.test.ts` and
  `gate-runner.test.ts` contracts stay green or are consciously superseded by a stronger test in
  the same change.
- Scheduling changes need timing evidence. Capture a baseline before restructuring a lane (one
  `just check`, one `just verify`, one `just full-verify` wall-time per node) and compare after;
  the timings store (Part 2.4) makes this automatic once it lands.
- `agents/skills/` is outside the agent sandbox's write allowlist; editing the dev-automation
  skill needs an unsandboxed retry of that one write.

## Guardrails — verified keep-as-is

1. **`./tao`, `Justfile`, and `./dev` stay distinct** (the Developer's ruling, simplification plan Part 4.1).
   The Justfile remains the human menu discovered via `just --list`; recipes stay composed with
   each part invocable stand-alone. Do not collapse surfaces or delete public recipes for lack of
   callers.
2. **The Justfile remains the definition point for which gates belong to which lane**
   (`dev-automation` skill; `GateRunner.ts` header). `./dev` owns how they run and how the result
   is reported. This plan adds per-gate _metadata_ (dependencies, cost, resources) on the `./dev`
   side; lane _membership_ stays in the Justfile.
3. **The smoke lane stays outside `verify`** (simplification plan guardrail 6). This plan
   parallelizes `full-verify`'s studio lanes; it does not move them into `verify`.
4. **`fix` mutates the tree and must complete before any tree-reading node runs** in the same
   lane. Parallelism inside `fix` is allowed only across provably disjoint file classes
   (Part 2.3); parallelism across the fix/read boundary is never allowed.
5. **Pattern-filtered `dev test` runs still skip the tao-apps suite** and still say so in the
   summary (`TestRunner.ts:215-225`, `TestResultSummary.ts:48-52`).
6. **The gate summary JSON is versioned** (`GateSummary.version`). Shape changes bump the version;
   the planned hosted gate (`Docs/Roadmap/Enforcement and diagnostics surface/`) and any CI will
   consume this artifact, so treat it as a published contract.
7. **The native Studio shell and the canary contend on GUI resources, not ports**
   (`Justfile` `_full-verify-studio` comment; Roadmap.md Smaller follow-ups). They may serialize
   against each other while everything else runs; do not force them fully serial with the browser
   lanes, and do not run them concurrently with each other.
8. **`just studio-test` stays** even though the TestRunner discovers the same suite — it is a
   human-facing focused entry point, exactly the composability the Developer's Justfile ruling protects.
9. **`_parser-gen` stays a prerequisite of every recipe that reads the generated parser**
   (simplification plan 4.2: recipe-dropping was rejected because `_ide-extension-build` is also
   reached standalone). The content stamp makes repeats ~0.01s; the graph may add explicit edges
   but must not remove the recipes' own prerequisites.
10. **Per-suite scheduling stays hand-overridable.** Measured durations refine ordering; they do
    not replace the `cost` reservation (CPU width) or the ability to pin a priority.

## Part 1 — Findings (the current state)

### 1.1 Two runners, one of them the model

- `packages/dev/dev-src/repository-tests/TestRunner.ts` is the exemplar: `runSuiteProcesses`
  (`:110-141`) is a priority + weighted-slot scheduler (`SUITE_SCHEDULING` `:64-74`: tao-apps
  priority 5 / cost 12, runtime-jest 4/4, runtime-toolchain 3/3), capacity from `--jobs` →
  `TAO_DEV_TEST_JOBS` → `cpuCount`, head-of-line hold so cheap suites cannot jump a wide
  reservation. Two output modes over one scheduler: an Ink dashboard (`TestTUI.ts`, default) and
  interleaved lines. Per-suite logs land in `.artifacts/logs/dev-test/<stamp>/`.
- `packages/dev/dev-src/repository-tests/GateRunner.ts` (behind `just check` / `just verify`) is a
  flat FIFO worker pool (`:106-125`): no priorities, no costs, no dependency edges, no TUI. It
  writes per-gate logs and a versioned JSON summary, classifies failures
  (environment-setup / optional-tooling / sandbox-restriction / repository), and prints one terse
  rollup — the reporting is right; the scheduling and streaming are not.
- Neither runner models dependencies. Ordering is emergent: serial Justfile prerequisites
  (`verify: fix _compile-word-flower-app`) followed by a flat pool.

### 1.2 Serial chains that could be graphs

- `just verify` = `fix` (serial: `_parser-gen` → `dprint fmt` → `./tao fix` → `just --fmt`) →
  `_compile-word-flower-app` (serial) → 5 gates in a flat pool. Nothing in the pool starts until
  both serial prefixes finish, although `_repo-lint`, `_typecheck`, and `_runtime-pack-check` need
  neither the WordFlower compile nor (in `check`) the fix pass.
- `just full-verify` is fully serial: `verify` → `doctor` → `dead-exports` →
  `_full-verify-studio`, and `_full-verify-studio` runs five slow Studio lanes one after another,
  aborting the remaining lanes on the first failure, with no per-lane log and no rollup.
  `StudioSmoke.resources()` (`StudioSmoke.ts:29-43`) already derives per-shard/worker ports
  (base 42000, 128 per shard, 2 per worker) and artifact roots, so the three browser lanes are
  parallel-safe today with distinct `--worker` indices.
- `fix` itself is three formatters over disjoint file classes run serially: dprint owns TS/JSON/MD
  (`config/dprint.jsonc` plugins), `./tao fix` owns `.tao`, `just --fmt` owns the Justfile.

### 1.3 Output is identical for humans and agents, and wrong for both

- There is no agent/human mode switch anywhere: no env var, and `HCI.isInteractive`
  (`shared-src/HCI.ts:77`) is only consulted by prompts. `./agent verify` is a byte-identical
  passthrough to `just verify`.
- `GateRunner.runJustRecipe` (`:184-202`) streams every gate's full output to the terminal _and_
  writes it to the log file. Agents get the whole firehose; humans get interleaved prefixed lines
  instead of the dashboard `dev test` already has. The user-facing regression: running `verify` or
  `full-verify` loses the TUI feedback `just test` provides.
- `_test` under `./dev gates` runs with `--output tui` into a pipe (`dev.ts:30` has no TTY check),
  so Ink box-drawing frames land in `.artifacts/logs/verify/<stamp>/test.log` and are re-streamed
  line-prefixed to the terminal — a dashboard rendered inside a stream.
- `./tao test` buffers the entire Jest run in memory and dumps all of it at the end even on
  success (`test-command.ts:31-35`): no incremental progress, no log file, full noise for agents.
- Artifact coverage is partial: gates and `dev test` write logs; `verify` alone writes
  `summary.json`; `doctor --json` goes only to stdout; `dead-exports`, `_repo-lint`,
  `_typecheck`, `_dprint-check`, `_runtime-pack-check` standalone, and every
  `_full-verify-studio` lane write nothing. No lane has a stable "latest" path an agent can check
  without parsing a timestamped directory listing.

### 1.4 Scheduling is static and blind

- `SUITE_SCHEDULING` weights are hand-tuned constants. No timing record exists anywhere in the
  repository, so weights drift silently as suites grow, and the gate pool cannot order by
  duration at all. The simplification plan (Part 4.2) already asked for "a one-line per-gate
  timing history so future gate-cost questions have data".
- Oversubscription is structural and unmeasured: the gate pool sizes itself to `cpuCount`, and
  `_test` inside it saturates `cpuCount` again while `tsc --build` runs beside it. `./tao test`'s
  internal pool (`TAO_TEST_JOBS`) is invisible to the outer scheduler that reserved `cost: 12`
  for it.
- Baseline measured at audit: the `verify` gate phase is ~21.4s wall with `_typecheck` (~21.3s)
  and `_test` (~21.4s) fully overlapped; the serial prefixes and `full-verify`'s serial studio
  lanes dominate everything else.

### 1.5 Newer flows outside the infrastructure

Arrived with `c03abaea` (Execute the repository simplification plan) or later, and not integrated:
`full-verify` composition, `_full-verify-studio` lanes, `dead-exports`, `doctor` in a lane,
`studio-canary` (tri-state pass/fail/blocked vocabulary the gate model cannot express),
`studio-release-check` (`UNVERIFIED` state, release lane), `_runtime-pack-check` (in daily lanes;
The Developer decision pending on demotion), `_bench-check` (duplicates the `performance-checks` suite that
`8a74aacb` moved into the TestRunner). The WordFlower `3 - MVP` / `4 - Revolution` and
`Apps/Tao Future/*` spec Justfiles name the intended future `tao` surface (`test-ci --output
json`, `test-watch`, `design check`) — target vocabulary for the seams this plan builds, nothing
to execute.

## Part 2 — Target design

### 2.1 One scheduler core: `WorkGraph`

Extract `TestRunner.runSuiteProcesses` into a general scheduler module in
`packages/dev/dev-src/repository-tests/` (suggested name `WorkGraph.ts`, export `WorkGraph`).
A node declares:

```ts
type WorkNode = {
  name: string
  /** just recipe or explicit command; both run through CLI.start with piped output. */
  run: { command: string; args: string[]; cwd?: string; env?: Record<string, string> }
  /** Names of nodes that must pass before this node starts. */
  needs?: readonly string[]
  /** Worker slots reserved while running (CPU width). Default 1. */
  cost?: number
  /** Hand-pinned start-order override. Default 0; measured durations refine within a priority. */
  priority?: number
  /** Named exclusive resources (e.g. 'gui'); nodes sharing one never run concurrently. */
  resources?: readonly string[]
  /** True for nodes that rewrite the source tree; the graph auto-orders every non-mutating
   *  node in the same run after every mutating node. */
  mutatesTree?: boolean
}
```

Scheduling policy, generalizing the proven `runSuiteProcesses` loop:

- **Ready set** = nodes whose `needs` have all passed. A failed node marks its transitive
  dependents `skipped` with reason `dependency failed: <name>`; independent nodes keep running so
  one summary reports everything (this also fixes `_full-verify-studio` aborting four lanes on
  the first failure).
- **Order within the ready set**: `priority` descending, then **critical-path rank** descending,
  where `rank(node) = expectedMs(node) + max(rank of nodes needing it, 0)` and `expectedMs` comes
  from the timings store (Part 2.4) with the static `cost`-scaled default as cold-start fallback.
  This is the "longest work first, so each stage finishes as a whole as fast as possible"
  behavior, derived from data instead of hand-tuned constants.
- **Admission**: a node occupies `min(cost, capacity)` slots; keep the existing head-of-line hold
  (a wide node that does not fit blocks cheaper nodes from jumping) and the existing capacity
  resolution (`--jobs` → `TAO_DEV_TEST_JOBS` → `cpuCount`).
- **Resources**: before starting, a node acquires every named resource; contended nodes wait
  without consuming slots. This expresses "native shell and canary serialize on `gui`" without
  serializing them against browser lanes.
- **Budget passthrough**: when a node's command is a nested runner, the graph exports the node's
  reserved width to it (`TAO_DEV_TEST_JOBS` for `./dev test`, `TAO_TEST_JOBS` for `./tao test`),
  so `cost` becomes an enforced bound instead of a guess and the oversubscription noted in 1.4 is
  closed structurally.
- **Cancellation**: Ctrl-C kills running children (`CLI.StartedCommand.dispose`), marks the rest
  `skipped: interrupted`, writes the summary and logs for what did run, and exits non-zero.

`TestRunner` becomes the first consumer: suites are nodes with no `needs`, keeping
`SUITE_SCHEDULING` as priority/cost seed values. Its observable behavior (discovery, per-suite
args, pattern handling, summary) is unchanged; `test-runner.test.ts` proves it.

### 2.2 One reporting layer, three modes

The scheduler emits events (`planned`, `start`, `output`, `complete`, `done`); reporters consume
them. Modes, selected once and uniformly for `./dev test`, `./dev gates`, and everything built on
them:

- **`tui`** — the Ink dashboard, generalized from `TestTUI.ts` to render any `WorkNode` set:
  status-colored tiles, last output lines, elapsed, plus a lane header (done/running/pending
  counts, elapsed, projected remaining from the timings store). This restores live TUI feedback
  to `check`, `verify`, and `full-verify`.
- **`lines`** — today's interleaved prefixed streaming, kept for dumb terminals and the Expo dev
  loop (`expo-dev-loop/Run.ts:43`).
- **`quiet`** — the agent contract: no live streaming of node output. Print a one-line header
  (lane, node count, log root), one line per node completion (`name: status in 3.2s — log:
  <path>`), the existing warning lines, the rollup, the first failure's last 40 lines, and the
  summary JSON path. Everything else is in files.

Selection: explicit `--output tui|lines|quiet` wins; otherwise TTY stdout → `tui`, non-TTY →
`quiet`. `TAO_OUTPUT_MODE` env overrides the default for harnesses that want it pinned. Because
agent harnesses run commands without a TTY, `./agent verify` becomes terse automatically while
`just verify` in a terminal gets the dashboard — no `./agent`-specific code path, honoring the
passthrough design. The nested `_test` gate inherits non-TTY and self-selects `quiet`, which also
fixes the Ink-frames-in-gate-logs defect.

### 2.3 Lane graphs

The Justfile keeps declaring membership; a catalog module on the `./dev` side (suggested:
`GateCatalog.ts`) maps recipe names to metadata (`needs`, `cost`, `resources`, `mutatesTree`).
An unknown gate defaults to `{ cost: 1 }`, so a new recipe is runnable before it is tuned.
`./dev gates` builds `WorkNode`s from its arguments plus the catalog. The serial recipe prefixes
dissolve into the graph:

- **check**: `_parser-gen` → { `_compile-word-flower-app`, `_tao-check`, `_ide-extension-build` };
  `_compile-word-flower-app` → `_test`; `_repo-lint`, `_dprint-check`, `_typecheck`,
  `_runtime-pack-check` start at t=0. The `check` recipe becomes a single `./dev gates` call that
  now also names `_parser-gen`, `_compile-word-flower-app` as graph members.
  **Corrected during W3:** the t=0 claim was wrong for readers of generated trees. `_parser-gen`
  and `_compile-word-flower-app` delete and rewrite `_gen_*` directories that `_typecheck`
  compiles (`packages/parser/tsconfig.json` includes `parser-src/**`;
  `packages/runtime-toolchain/tsconfig.json` includes `_gen_tao-app/**`), so both generators are
  `mutatesTree: true` and every reader waits ~1.2s for them — a real race removed, per
  `ParserGenerate.ts`'s own header hazard note.
- **verify**: split `fix` into `_fix-dprint`, `_fix-tao` (needs `_parser-gen`), `_fix-just-fmt` —
  three private recipes over provably disjoint file classes, all `mutatesTree: true`; the public
  `fix` recipe keeps its current serial spelling for standalone human use (or delegates to the
  same graph — implementer's choice, keep `just fix` behavior identical either way). Every
  tree-reading gate is auto-ordered after the fix nodes by `mutatesTree`; the rest of the graph
  matches check minus the skipped gates. Expected win: dprint (the slowest fix step) overlaps
  `_fix-just-fmt` and `_parser-gen`; gates begin the moment the last fix node ends.
- **full-verify**: one graph and one summary for everything: the verify graph plus `doctor`,
  `dead-exports`, and five studio nodes — `studio-smoke-launch` (worker 0),
  `studio-proof-real-app` (worker 1), `studio-smoke-simulated` (worker 2; quarantined from the graph since `33a49ea4`, runnable standalone) in parallel;
  `studio-smoke-native` and `studio-canary` with `resources: ['gui']`. Studio nodes get high
  priority (they dominate wall time) and moderate cost (~3) so package gates fill the remaining
  slots. All lanes now produce per-node logs and appear in the rollup; a failing lane no longer
  hides the others. `studio-canary`'s blocked/manual checks map to `skipped` with a reason in the
  rollup; its own JSON artifact stays the detail record.

Worker indices are passed explicitly per node (`./dev studio-smoke --worker N`); remember `just`
has no named-argument syntax — pass positionals in declaration order when a recipe composes
another recipe.

### 2.4 Timings store and duration-informed ordering

`.artifacts/timings/durations.json`, owned by the scheduler: per node name, an exponential moving
average, sample count, last duration, last run timestamp. Updated after every run (any lane);
read at planning time for `expectedMs` and the TUI's projected-remaining. Additionally append one
compact line per run to `.artifacts/timings/history.jsonl` (`{lane, stamp, nodes: {name: ms}}`) —
the per-gate timing history the simplification plan asked for, and the evidence base for future
cost tuning. Corrupt or missing files are treated as cold start, never as an error. `.artifacts`
is already git-ignored.

### 2.5 The artifact contract for agents

Uniform per run: `.artifacts/logs/<lane>/<stamp>/` holds one `<node>.log` per node plus
`summary.json` (GateSummary bumped to version 2: adds per-node `needs`, `resources`, `expectedMs`,
and the lane name), and the runner refreshes a `.artifacts/logs/<lane>/latest` symlink after
writing. `verify` keeps writing `.artifacts/logs/verify/summary.json` as today (contract for the
future hosted gate) in addition to the stamped copy. `full-verify` persists `doctor --json`
output as its `doctor` node log. `quiet` mode prints these paths; `./agent help` gains two lines
stating where summaries and logs land and that they are the first place to look on failure.

### 2.6 `tao test` output

Scoped to output and budgeting only — filters and watch stay with the "Harden `tao test`"
roadmap item:

- Stream the Jest child incrementally instead of buffering (`stdio` piped with `onOutput`,
  line-buffered), keeping full output on failure.
- Non-TTY / `--output quiet`: write full output to a log under the run root, print compact
  progress (validate/compile/run phase lines already exist) plus the Jest summary line and the
  log path on failure; print nothing bulky on success.
- Honor `TAO_TEST_JOBS` when exported by an outer graph (already implemented) and document the
  contract next to the shared `TAO_TEST_*` env keys.

### 2.7 Future lanes (what this design must absorb without rework)

Adding a lane = one Justfile recipe (membership, human menu) + one catalog entry (metadata). The
scheduler, reporters, artifact contract, and timings come for free. Anticipated lane types and
what they need, all expressible in the node vocabulary above:

- **Device suites** (Android emulator, iOS simulator): `resources: ['android-emulator']` /
  `['ios-simulator']`, plus a boot node others depend on.
- **Local-stack suites** (InstantDB-backed tests): a `start-local-instantdb`-style node as a
  dependency, `resources: ['instantdb']`.
- **Benchmarks**: `resources: ['exclusive-cpu']` modeled as `cost: <capacity>` so nothing runs
  beside them.
- **Hosted gate / CI** (`Docs/Roadmap/Enforcement and diagnostics surface/`): consumes
  `summary.json` v2 and `quiet` output; the spec Justfiles' `test-ci --output json` vocabulary is
  this seam.
- **Release lanes** (`studio-release-check`, `studio-package`): stay outside daily lanes; when
  composed, their `UNVERIFIED` tri-state maps to `skipped` with a reason, like the canary.
- **Parameterized nodes** (a future per-app compile or per-app test lane with a selectable
  target): node names are the timings keys and the log names, so a parameterized node must carry
  the parameter in its name (`compile-app:WordFlower`, not `compile-app`) — otherwise timing
  history, logs, and critical-path estimates blend across targets. Today every lane node has
  fixed arguments, so nothing enforces this yet; adopt the convention with the first
  parameterized lane. Target selection itself stays a Justfile/CLI concern (defaults changed at
  invocation), invisible to the scheduler.

## Part 3 — Workstreams

Ordered; each independently landable with `./agent verify` green.

### W1 — Scheduler core (M)

Extract `WorkGraph` from `runSuiteProcesses` with `needs`, `resources`, `mutatesTree`,
critical-path ranking, dependency-failure skips, and budget passthrough. Port `TestRunner` onto
it with behavior preserved. New `dev-tests/work-graph.test.ts` proving: dependency ordering,
failure-skip propagation, resource mutual exclusion, mutates-tree barrier, rank ordering from
injected timings, budget env export, and the two existing scheduling contracts
(`test-runner.test.ts:28`, `:45`) — which stay green untouched.

### W2 — Reporters and output modes (M)

Event stream from the scheduler; `quiet` reporter; TTY-based default selection with `--output`
and `TAO_OUTPUT_MODE`; generalize the Ink dashboard to arbitrary nodes; unify log writing and
summary JSON (v2) + `latest` symlink into one reporter-side module shared by `dev test` and
`dev gates`; timings store read/write. `dev test` keeps its human TUI and gains the quiet mode;
`dev gates` gains the TUI. The `formatGateSummary` rollup, failure classification, and exit-code
rules move over unchanged (`gate-runner.test.ts` keeps proving them).

### W3 — Gates on the graph (M)

`GateCatalog` with the check/verify metadata from 2.3; `_fix-dprint` / `_fix-tao` /
`_fix-just-fmt` recipes; rewrite `check` and `verify` recipe bodies as single `./dev gates`
invocations naming the full membership; remove the now-graphed serial prefixes. Verify the
WordFlower compile → `_test` edge holds (the tao-apps suite and stale-generated-file handling —
see `34e47c1c` — are the reason the compile precedes tests today; re-derive before changing).
Baseline and after timings recorded in the commit message.

### W4 — The full-verify lane (M)

`full-verify` becomes one `./dev gates` graph per 2.3: doctor + dead-exports + five studio nodes
with worker indices and the `gui` resource; per-node logs; one rollup and summary JSON; doctor
JSON persisted. Delete `_full-verify-studio`. Reconcile Roadmap.md's Smaller follow-up entry
(the `--worker` item) in the same change. Watch for browser-lane flakiness under load: smoke
tests carry a 180s bun timeout (`StudioSmoke.ts:52`); if contention pushes lanes toward it, lower
studio-node costs is the wrong fix — raise them so fewer package gates run beside the lanes.

### W5 — `tao test` output (S/M)

Per 2.6, in `packages/tao-cli` (disjoint from W1-W4; can proceed in parallel with any of them).
Covered by `cli-tests/test-command-cli.test.ts` extensions: quiet-success stays under a line
budget, failure path names the log file, full output preserved in it.

### W6 — Docs, help, and roadmap reconciliation (S)

- `agents/skills/dev-automation/SKILL.md`: the graph/catalog split (guardrail 2 wording), the
  output-mode contract, the artifact contract, and the "adding a lane" checklist (unsandboxed
  write).
- `packages/studio/README.md` Verification section: the new full-verify shape and artifact roots.
- `./agent help`: summary/log locations.
- Roadmap.md: absorb the `--worker` Smaller follow-up; note the `tao test` output half landed
  under "Harden `tao test`"; add this plan to the Records list while it remains live.
- This plan's Status table and inline markers updated as each workstream lands.

## Part 4 — Small cleanups riding along

- **Done** (W3). Dropped the `_bench-check` prerequisite from `bench`: it duplicated the
  `performance-checks` suite that `8a74aacb` deliberately moved into the TestRunner. The perf
  test stays in the suite as the surviving guard, and
  `performance-checks/language-performance.test.ts` now asserts no verification lane names
  `bench`.
- **Done** (W4). `doctor --json` persisted when run through a lane: `full-verify` runs a private
  `_doctor-json` recipe, so the node's own log at `.artifacts/logs/full-verify/latest/doctor-json.log`
  is the versioned report. Standalone `just doctor` unchanged.
- **Skipped — needs the Developer.** `_runtime-pack-check` demotion to a release lane is already a recorded
  The Developer decision from the simplification plan (Part 7); this plan does not move it, only schedules
  it like any other gate.

## Part 5 — Assumptions made without the Developer (flag if wrong)

1. Auto-selecting output mode by TTY (with explicit flag/env overrides) is acceptable for every
   lane, including `./agent` passthroughs — no separate agent flag is introduced.
2. `fix` parallelization across dprint / `./tao fix` / `just --fmt` is safe because their file
   classes are disjoint (1.2); if `./tao fix` ever grows a non-`.tao` output, the three nodes
   must re-serialize.
3. `full-verify`'s studio lanes may overlap the package gates (subject to cost tuning); only the
   `gui` pair stays mutually exclusive.
4. GateSummary v2 may extend the schema additively; the hosted-gate consumer does not exist yet,
   so no migration is needed beyond the version bump.
5. The plan keeps `./agent`'s TypeScript layer as-is; the "thin `./agent` to zsh" simplification
   item (Part 4.1 there) remains open and untouched, so the two changes stay independently
   landable.
