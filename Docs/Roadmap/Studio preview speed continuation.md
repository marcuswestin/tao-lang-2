# Studio preview speed continuation

Original handoff written 2026-10-03 for the successor of `feat/studio-preview-latency-next`, which
started from that branch's tip rather than main. This document owns the Studio
preview latency project; [Decisions - Project folder layout](<Tao CLI workflows/Decisions - Project folder layout.md>)
owns the project folder layout work this project also carries. [Tao tooling performance](<Tao tooling performance.md>)
holds broader language and tooling measurements; do not treat older CLI benchmarks as edit-to-paint
timings.

## Current state

The successor branch `feat/studio-preview-speed`, created from exactly `8ecf581e7`, landed on
2026-10-04 and is preserved at `origin/merged/studio-preview-speed`. Its activation and decided folder layout are implemented: every scenario and the whole-app preview now
default to no iframe, with per-cell lightning toggles and server-persisted app activation in
`.tao/local/studio/session.json`. Selection and its Tao ProductHost/feed boundary use focused names;
the old browser focus/tabs and viewport import once into the project session. Fast draw and
off-screen suspension are removed, and real smokes explicitly activate their cells. The decided
layout implementation is recorded in the [layout decisions](<Tao CLI workflows/Decisions - Project folder layout.md#implementation-state>).

The first activation/layout checkpoint passed the complete Studio and Studio-tooling source suites
and `verify-changed` across source, compiler, runtime, CLI, and app checks. The final project gates
and integration state are recorded in the task checkpoint.
The landing integration with main `3bcd71647` retains bare render support and moves the incoming
Syntax2 app's project identity and TypeScript base configuration to the decided store/cache layout.
The later integration with main `580f88cc5` preserves HNReader's split source modules while applying
incoming configured-value separators in their datasource and navigation owners. Its new bridge
diagnostic fixture extends `.tao/cache/typescript/tsconfig.json`, retaining the decided layout.
The first full host landing lane exposed obsolete smoke assumptions. The agent-panel smoke now
keeps its intentional zero-preview setup and waits for its expanding cloud control to receive input;
the network smoke selects the named cell without pressing its activation bolt; the simulated-user
fixture installs its persisted session store and activates only previews its current journey uses.
Their focused browser runs pass (21 assertions in 6.2s, 5 in 12.8s, and 102 in 29.7s), with an
independent five-file review. The launch smoke now uses an isolated authored keyboard-navigation
project with the decided project layout, retaining its real CLI readiness, session, process, port,
and teardown assertions. Its focused host run passes all 14 assertions in 6.7s while the Developer's
HNReader Studio remains live at the same PID and port. Unproved shutdown retains the disposable
project with an ownership receipt. [The archived launch-smoke ledger entry](<Developer environment upgrades/Archive/DEVENV-STUDIO-LAUNCH-SMOKE-USES-SHARED-PROJECT.md>)
records the fix. The native canary's Just recipe also now uses that disposable default instead of
opening checked-in HNReader; explicit project/app overrides remain available. The shared helper
prepares the decided project layout before either real CLI or native launch discovers it. Its quiet
native probe passes all six capabilities and shutdown, retaining the window-server lease while
removing the obsolete shared HNReader reservation. The ordinary full landing lane passed before
pushing.
Mutation checks caught deliberately removed activation serialization and callback rewiring. A real
browser run exposed an empty session-save response; the endpoint now returns JSON, with a real HTTP
regression. The corrected real-app Metro smoke passes all four journeys (run
`activation-layout-final-20261003`, 46.1 seconds); both toggle screenshots, including a rendered
active preview, were inspected in its `home/studio/launches/browser/screenshots/` artifacts.
Final review corrected revision changes during activation, shared home-state concurrency,
linked-parent migration hazards, compile-error recovery, ordered focus/tab writes, manifest pruning,
and browser-registration cleanup. The activation baseline below is measured; it is not an A/B
speed claim. The activation gate and watchdog are now implemented: registration waits for a
settled publication and exact acknowledgements from connected active cells, bounded by one
30-second deadline. A lagging cell reloads at most once after its peers acknowledge, with the
existing navigation timeout retained as a backstop. Restored activation begins after the message
listener is wired; pending cells do not deadlock the gate. Focused lifecycle and revision tests pass.
On 2026-10-04 the Developer accepted all four layout recommendations: defer the adapter storage API,
use `desktop-host/`, move home preferences to `~/.tao/studio/prefs.json`, and place generated apps in
each project's cache. These accepted choices are implemented alongside the remaining speed work.
Selective design subscriptions (step 8) are explicitly deferred; steps 5–7 remain in this project's
current execution scope. The refresh-indicator investigation below is closed at the Developer's request.

Follow-up on 2026-10-04: one preview press now retains the source selection and scroll when
language-server readiness replaces the visible editor. The editor tracks which view consumed the
reveal and does not echo host-driven selection updates back during tab teardown. A focused browser
regression closes the source tab, presses once, releases a delayed language connection, and checks
the selected line and exact selected text after the editor DOM is replaced. Disabling view-aware
replay makes the regression fail; restoring it passes. Focused editor/navigation tests and read-only
source/type checks pass. The regression is an explicit headless lane:

```sh
./agent unsandboxed studio-smoke --run-id source-navigation packages/ides/studio-tooling/studio-smoke/studio-preview-source-navigation.test.ts
```

### Speed recovery after landing, 2026-10-04

The Developer requested recovery on top of landed main. `feat/studio-preview-performance` starts
from `f27f8bb0e`; the historical annotation checkpoint remains available at `a3ba19d51` in its
own comparison worktree. Squashing did not erase that history. The earlier HNReader fixture and
main's split source modules differ, so their timings cannot establish an isolated change's gain.

The recovery shares explicit preview acquisitions with the resident project-tooling watch,
coalesces a notification burst into one active and one pending refresh, and retains the preview
workspace even when Studio supplies source overrides. Unchanged Langium documents retain their
canonical identity and skip parsing; changed sources, reachable membership, and project topology
still refresh linking and validation. Parser and workspace tests prove zero unchanged parses,
one parse for one imported edit, one source read per batch, deletion-only visibility recovery,
and cold-result parity. Their deliberate reuse and invalidation mutations fail the tests.

The watched tooling cache audits saved authored inputs, actual consumed discovery and text,
configuration, host inputs, and generated outputs. Unknown resolution inputs take the cold path;
forced attachment refreshes remain authoritative. A reused result preserves its completed
revision and reports an empty output delta. Native diagnostic replay compares against saved native
diagnostics, preserving the combined Tao and TypeScript warnings and hints. Validation reuse is
bounded to one batch: type inference reuses completed results for identical linked AST inputs during
synchronous validation, and type reports replay in their original position. Requirement graphs share
only compatible ownership and ordered inputs. Structural checks, entry-specific marker checks,
foreign-file disk checks, and diagnostic order remain authoritative. Per-entry workspace order is
preserved; the attempted broader structural-report cache could not serve those differing orders and
was removed.

Host export discovery still reads the current installed packages on every refresh. A watched
session retains completed mappings only when ordered roots, discovered names, ownership, options,
and every consumed filesystem observation match, including missing paths and manifest text.
Inconsistent observations and guard failures take the cold path. Forced refresh and the final watch
disposal clear the mapping; standalone calls retain no mapping. Native declaration checks remain
authoritative even when an alias path stays unchanged. Synchronous manifest reads use the native
resolver's filesystem lookup model. App classification and identity indexes also share work within
one validation batch, guarded by exact AST identities, package context, and stable file ordering;
they are discarded before another build or relink.

Descendant traversal now also snapshots each exact Tao-file AST once per completed validation
batch. App placement checks and node validation share the read-only list while every check still
runs in its original position. A fresh batch obtains a fresh list. Eleven batch-validation tests
pass; bypassing the list in app validation fails the work-count assertion while diagnostic parity
remains covered. This establishes eliminated traversal work, not an isolated paint-time gain.

The real Metro harness now includes HNReader's actual `storyCard` padding edit through Studio's
editor, observed as computed padding and subsequent paint, alongside the one-file editor and
HNReader watched-file cases. Each runs with publication checks on and off. Ordinary verification
checks repeated work and parity; `./agent unsandboxed performance-check` separately measures the
language and real-preview cases under one exclusive machine lease. Missing activity evidence or
observed contention makes qualification inconclusive. The periodic repository pass owns when to
run it, and `pipeline-performance` owns guidance for future save/watch and pipeline edits.

An argument-binding memo was measured separately and removed: it added another lifetime and
clone boundary without a consistent compiler gain. The retained changes are the bounded refresh,
incremental documents, batch inference and app indexes, and audited watched host mappings above.
Selective design subscriptions remain deferred.

Quiet calibration on 2026-10-05 used run
`performance-48636607-5d39-43a4-8fb1-bae60885a528`. All 48 actual saves passed, with no iframe
reloads or recorded revision errors. Each case retains eight rows and discards the first; p50 is
the median of seven warm rows and p95 is their nearest-rank maximum. The exclusive lane recorded
173 host observations, load 4.43–8.47 on 18 CPUs, with no competing registered lane. The language
benchmark passed its existing budgets. Profiling was disabled.

| Case                                     | Source→published p50 / p95 ms | Save→paint p50 / p95 ms | Source ceiling p50 / p95 ms | Total ceiling p50 / p95 ms |
| ---------------------------------------- | ----------------------------- | ----------------------- | --------------------------- | -------------------------- |
| One-file, publication on                 | 135 / 144                     | 386 / 474               | 175 / 200                   | 500 / 650                  |
| One-file, publication off                | 137 / 145                     | 389 / 447               | 175 / 200                   | 500 / 600                  |
| HNReader watched-file, publication on    | 484 / 499                     | 1447 / 1463             | 625 / 675                   | 1800 / 1975                |
| HNReader watched-file, publication off   | 546 / 608                     | 840 / 931               | 700 / 825                   | 1100 / 1250                |
| HNReader editor padding, publication on  | 458 / 561                     | 736 / 849               | 600 / 775                   | 950 / 1150                 |
| HNReader editor padding, publication off | 470 / 578                     | 730 / 829               | 600 / 800                   | 950 / 1125                 |

The executable ceilings include rounded headroom for ordinary variation and cover source
publication independently of total paint. The HNReader watched-file publication-on case had an
858ms median HMR-to-DOM interval; it must not mask a compiler regression when that interval falls.
Both stage budgets must pass. Missing cases, malformed samples, absent activity evidence, or
contention cannot qualify a run; a busy correctness smoke does not establish speed.

These results do **not** restore or establish parity with the historical 266–289ms HNReader
totals above. Main now includes fresh project/native validation, and HNReader's source and fixture
corpus changed. Current matched-main comparisons retained their raw reports but were contaminated
by external host load, including a continuously observed spike to 33.42; they establish no
isolated end-to-end gain. Deterministic regressions prove the eliminated work and cold-result
parity. In the current normal padding case, source publication remains the largest phase, followed
by Metro delivery and paint. Further compiler/native validation reduction is a separate measured
slice, rather than a reason to weaken these guards.

Final qualification, committed-tip verification, and integration are recorded below when complete.

Two unchanged eligible repeats did not meet every tail ceiling: run
`performance-5934e698-a28d-45fd-b5b8-d1bb2e751430` (load 5.04–7.87, no peers) exceeded the
one-file source p95 limits and HNReader publication-off source and total p95; run
`performance-b487fc7b-b083-44cc-ae89-903371823868` (load 3.49–5.36, no peers) exceeded only
HNReader publication-on source p95, at 821ms against 675ms. Both passed the language budgets and
all six preview correctness cases. Their failures remain preserved; the ceilings were not raised.
Diagnostic run `speed-tail-diagnosis-20261005` found unique preview revisions and 22 of 24 emitted
modules reused after startup, with no unexpected full cold revision. Warm profiled HNReader
publication-off medians were approximately 270ms for project Tao validation, 31ms for the first
input audit, 26ms for receipt capture, 20ms for config, 19ms for native TypeScript, and 122ms for
preview generation. These diagnostic timings include profiling overhead and establish the remaining
work owners, not a new latency qualification.

The first normal six-case run with descendant traversal reuse,
`performance-d26665c4-e326-40a8-8832-2789b0a3612b`, became inconclusive when load reached 10.98
on 18 CPUs near its final case. All six correctness cases and the language budgets passed. Its
recorded HNReader publication-on source p95 was 822ms and padding publication-off total p95 was
1357ms, both over their ceilings. Host contamination prevents qualification; neither the failures
nor the missing gain is hidden by changing the ceilings.

Pre-document-cache run `performance-81d97ca2-6668-4045-8096-3faec7c0a62f` also completed all
six correctness cases and the language stage, but load reached 31.58 on 18 CPUs. It is an
ineligible comparison, with twelve budget breaches preserved in its report. A later qualifying
run must stand on its own; comparing against this loaded run cannot establish the cache's gain.

The Developer authorized document-level validation reuse on 2026-10-05. The implementation keeps
workspace/file checks and foreign implementation checks authoritative, while explicitly eligible
local node checks and the later type pass may replay diagnostics at their original positions.
The parser owns a conservative dependency snapshot: canonical transitive AST identities, resolved
reference targets, and ordered explicit and implicit candidate membership. Unknown or unresolved
dependencies remain cold. Each Workspace owns the reusable reports; package/physical topology,
release inputs, entry context, build failures, and dependency changes invalidate them. Batch
inference, requirement graphs, and app indexes retain their current shorter lifetime. Ten parser
snapshot tests, five report-reuse tests, eleven batch-validation tests, and eleven incremental
Workspace tests pass. An unchanged six-entry refresh performs no eligible local or type checks,
while global and foreign checks still run for each entry. Disabling reuse fails that work witness;
removing dependency comparisons produces stale transitive type diagnostics and fails cold parity.
The physical ownership signature detects an external marker symlink retarget even when ASTs and
reference targets stay identical. Unknown inputs still take the cold path.

The cache's work test also exposed false topology invalidation: parsing expands the package index
with runtime-discovered roots, so comparing that expanded index with a fresh disk scan incorrectly
reported a change on every refresh. Workspace now compares successive fresh disk-scan baselines
and retains its consumed physical-path audit. Unchanged scans remain stable; module additions and
symlink retargets still invalidate. The mounted-color recovery assertion now checks the fixture's
actual typed `DesignColorEntry` and its restored `#fff` atom, as warm and cold parses do.

Root membership capture preserves the original parser reachability: unloaded root candidates are
ordered signature observations, while only canonical loaded roots enter the AST dependency vector.
Imports, folders, and requirements remain strict. The regression keeps an unrelated invalid library
root unloaded, retains available snapshots, and detects root membership changes without changing
the loaded AST or target vectors. Snapshot publication observes import selections without writing
the semantic bindings owned by linking.

Post-cache qualification `performance-eeb03565-7a2d-4cc0-b003-e812ed91e474` passed the language
budgets and all six real-save cases in 161.8s. Its 165 continuous observations recorded no peers and
load 3.84–6.73 on 18 CPUs. All independent source and paint ceilings passed:

| Case                              | Source p50/p95 | Total p50/p95 |
| --------------------------------- | -------------- | ------------- |
| One-file, publication on          | 143/167ms      | 406/442ms     |
| One-file, publication off         | 154/177ms      | 415/513ms     |
| HNReader, publication on          | 533/585ms      | 796/830ms     |
| HNReader, publication off         | 514/557ms      | 804/843ms     |
| HNReader padding, publication on  | 441/570ms      | 703/846ms     |
| HNReader padding, publication off | 568/641ms      | 834/877ms     |

This qualifies the complete implementation under the existing ceilings; it does not isolate the
document cache's numerical gain. Deterministic work counts prove reuse, and cold-result parity and
mutation checks prove invalidation. The old approximately 270ms result has not been reproduced on
the current corpus. Partial source-text parsing is still unimplemented; current parser reuse is
whole-document reuse. Selective design subscriptions remain deferred.

After main integration, `performance-9c5987a2-54b4-4463-9ef0-4dc64daeba20` was eligible and
failed the fixed guard. Its 171 observations recorded no peers and load 2.61–8.25 on 18 CPUs.
Language budgets, all six correctness cases, and all direct-edit preview budgets passed. Padding
publication-on recorded source 686/726ms and total 956/995ms; publication-off recorded source
727/877ms and total 1022/1177ms. These exceed six independent ceilings. The earlier qualifying
pass remains evidence for its tree; it does not cancel this failure or establish stable speed on
the integrated tree. This failure blocked the landing proposal; the ceilings remain unchanged.

The follow-up removes repeated physical-boundary reads within one dependency publication. Each
publication owns a fresh observation scope, keyed by filesystem operation and exact logical path;
descriptors remain independent, and no observation survives into another build. Twelve parser
tests pass. Three files sharing an owner and module perform seven underlying operations, including
one owner realpath, one module realpath, and one marker stat/realpath pair. Their descriptors match
uncached reads. Concurrent requests share pending and failed observations; later scopes recheck
removed markers and recover from unavailable reads. Existing marker-retarget and warm/cold parity
proofs remain green. These operation counts establish avoided work, not a measured latency gain.

The complete follow-up then qualified in `performance-e5b1be24-d1ba-4aab-a7ac-b76a159da585`:
161.2s, 164 continuous observations, load 3.07–4.73 on 18 CPUs, no peers or admission breaches.
Language budgets and all six real-save cases passed the unchanged ceilings:

| Case                              | Source p50/p95 | Total p50/p95 |
| --------------------------------- | -------------- | ------------- |
| One-file, publication on          | 141/156ms      | 406/445ms     |
| One-file, publication off         | 141/164ms      | 435/467ms     |
| HNReader, publication on          | 545/555ms      | 814/862ms     |
| HNReader, publication off         | 517/572ms      | 774/833ms     |
| HNReader padding, publication on  | 459/580ms      | 713/874ms     |
| HNReader padding, publication off | 486/610ms      | 759/910ms     |

The preceding attempt `performance-bb1bf0b4-3805-4d77-a606-baef12fa9794` was inconclusive:
load reached 16.82 after its passing language stage, so no Studio cases were admitted. Both that
report and the eligible failure remain retained. The passing result establishes the current
implementation's guard qualification; differing host conditions do not isolate the boundary
deduplication's latency gain. Approximately 270ms remains unreproduced on the current corpus.

The first changed-suite gate found a real caller-lifetime regression: Studio's declaration scope
check parsed before/after source concurrently through one mutable parser context, allowing both
results to observe the newer canonical AST. It now compares independent syntax-only trees, which
are the inputs that this authored-change check needs. Nineteen focused tests pass, including
overlapping allowed and rejected requests. The host-command expected list now includes the new
performance operation (eight tests pass). The missing-result guard fixture now supplies a real
suite inventory and proves that the report-promising node actually ran before asserting failure;
its forty-one focused tests pass. These corrections preserve the failed broad report rather than
attributing deterministic failures to its recorded host contention.

The caller inventory also corrected two retained-AST lifetimes. Scenario relocation inspects its
destination through an independent standalone parse, preserving the linked source build whose
references it still consumes. Wrap/group/extract actions now parse the source and same-directory
siblings as one completed batch, then pass that batch's document and ASTs to the patch operation.
Six relocation tests and fifty session tests pass; real-session proposals match cold patches and
extraction respects sibling-owned names. Restoring either old lifetime pattern fails its new
witness. Existing project-view insertion still passes its separate regression.

Separate existing follow-up: parsing a consumer root before a library root can clear the
consumer's requirement aliases before linking. A cold fixture with Library publishing
`@ui/Widget` and Consumer requiring `@ui as @parts` then importing from `@parts` reported
`Cannot resolve import path '@parts'.` when Library was loaded last. The clearing and load/link
control flow predate `f27f8bb0e`; the historical commit was inspected, not executed for this
finding. Batch-validation coverage retains distinct roots and contexts with Consumer loaded
last. Fix the alias lifetime separately, with both entry orders covered.

### Activation baseline, 2026-10-03

Run `activation-baseline-final-20261003`, alone with no other tests or agents from this task.
Each case made eight edits; warm figures discard the first. All 32 edits passed, with zero iframe
loads across every activated cell and no recorded `RevisionNotFoundError`. HNReader scrolled among
three active cells during edits, returning the measured cell into view before awaiting its paint:
Chrome withholds iframe animation-frame callbacks off-screen even after the DOM changes.

| Case                              | Active cells | Source→published p50 ms | Total p50 / p95 ms | One-minute load min–max / 18 CPUs |
| --------------------------------- | ------------ | ----------------------- | ------------------ | --------------------------------- |
| One-file, editor, publication on  | 1            | 26                      | 179 / 249          | 2.79–2.86                         |
| One-file, editor, publication off | 1            | 27                      | 184 / 198          | 2.91–3.08                         |
| HNReader, disk, publication on    | 3            | 156                     | 288 / 328          | 2.88–3.13                         |
| HNReader, disk, publication off   | 3            | 165                     | 308 / 382          | 2.87–4.96                         |

Stage samples, browser events, Metro messages, cell counts and cell loads are retained under
`.artifacts/tests/studio-smoke/preview-latency/`. The earlier off-screen measurement attempt failed
the paint wait after successfully applying the DOM edit, and is excluded. These figures establish
a new baseline; differences from the historical loaded-machine runs below are not attributable gains.
The prior corrected repeat (`activation-baseline-visible-20261003`, load 3.78–4.92) measured
183/184ms one-file medians and 306/321ms HNReader medians, illustrating run-to-run spread.

### Concurrent startup retained, 2026-10-04

The sequential-loading experiment used six previews of the same view, persisted activation,
fresh browsers, warmed Metro, balanced mode order, and two-frame paint timestamps. Run
`preview-loading-ab-corrected-20261004` passed eight opens; the first pair was discarded.
Concurrent first/last paint medians were 1231/1446ms; sequential medians were 1089/1885ms.
All three retained pairs made the last preview slower with sequential loading, so it failed the
keep bar and was removed. Concurrent restored startup remains. These measurements were contended
(one-minute load 21.9–34.0 on 18 CPUs), and do not establish an absolute startup budget.
The measured result and exact counterfactual patch are preserved under
`.artifacts/checkpoint/preview-loading-counterfactual/`; the maintained loading smoke checks that
all six persisted activations load and paint concurrently.
Its final run `preview-loading-final-20261004` passes, with first/last paint at 720/852ms. This is
a concurrent-startup regression result, not a new sequential comparison.

The real-app smoke `preview-pointer-shield-20261004` passes all four journeys, including the dark
inactive viewport and computed preview/canvas cursors. A child-list observer now shields frames
mounted during an asynchronous refresh before pointer input can reach them; the smoke retains its
zero app-input assertion during unfocused canvas panning.

### Emitted-module reuse measured separately, 2026-10-04

Step 6 was measured with step 7 held off. The session-owned cache reuses validated modules,
retains dependency and output-plan invalidation, recopies sidecars, and rebuilds the manifest and
policy. Unresolved ordinary references prevent reuse; intentional TypeScript bridge heads follow
the parser's existing exemption. A real HNReader overlay regression failed before that narrow
exemption and passes with uncached output and diagnostic parity afterward. Shared fingerprint work
is computed once per compile rather than repeated for each module.

Both the quiet cache-off control (`emitted-cache-control-off-quiet-20261004`) and optimized cache-on
run (`emitted-cache-optimized-20261004`) passed all 32 edits, without iframe reloads or recorded
`RevisionNotFoundError`. Each case uses eight saves and discards the first for warm statistics.

| Case                      | Cache-off source→published / total p50 ms | Cache-on source→published / total p50 ms |
| ------------------------- | ----------------------------------------- | ---------------------------------------- |
| One-file, publication on  | 28 / 181                                  | 21 / 175                                 |
| One-file, publication off | 27 / 192                                  | 21 / 180                                 |
| HNReader, publication on  | 142 / 282                                 | 119 / 453                                |
| HNReader, publication off | 153 / 314                                 | 129 / 285                                |

HNReader reused 21 of 23 modules; total fingerprint, copy and emit work was approximately 5ms,
with approximately 1.5ms spent emitting the two misses. The source-to-publication phase improved
in both HNReader modes. The publication-on run had a 227ms HMR-to-DOM median, making its total worse;
it does not establish an end-to-end gain in that mode. Observed one-minute load was 4.1–6.5 for
the control and 5.2–7.3 for the optimized run on 18 CPUs. Earlier high-load comparisons are excluded
from gain claims. Final delivery measurements must retain the same phase boundary distinctions.

### Live design delivery, 2026-10-04

Step 7 publishes designs by declaration identity and gives mounted app hosts a coarse revision
subscription. A cached app reads the latest design rather than keeping its first snapshot.
Generated source modules register a weakly retained cohort with monotonic per-file epochs, so a
coedited consumer and design can arrive in either order: old consumers retain their compatible
snapshot, and consumers awaiting a newer design suspend. The preview acknowledges a revision only
after the content commits beneath that Suspense boundary. Ordinary unknown style names still fail.
Focused regressions cover both arrival orders, same-source reverts, deleted and previously unvisited
consumers, multiple mounted generations, and acknowledgment after suspension.
An intermediate disk publication can rename a bundle before its consumer file changes. Resolution
tries eligible snapshots newest first and falls back only for a missing bundle, color, or size;
ordinary invalid clauses and unknown names without a compatible snapshot still fail. Interaction
subscriptions inspect the same eligible candidates, retaining an old conditional bundle's press
response. Only successfully resolved snapshots become the last valid render. Structural supersets
replace snapshots whose complete lookup structure they preserve; regressions prove that 80 literal
edits and 80 additive-name edits avoid retaining 80 copies. Renames, changed references, and other
incomparable shapes remain until their cohort is released. Arbitrary historical dynamic-color
fallback can still require growing incompatible history; a finite cap or active-read lifetime policy
is a later product decision, alongside the deferred delivery work, rather than an implicit eviction.

The independent design smoke `design-delivery-final-20261004` passes all three cases: eight color
and font-size saves, followed by a coordinated style-bundle and consumer rename. Computed DOM
styles and two animation frames establish paint. Warm medians were 181ms for imported designs in
two focused previews, 200ms for an imported design in a navigated whole-app preview, and 252ms for
same-file designs in two focused previews; load was 4.0–5.9 on 18 CPUs. All cases had zero iframe
reloads and no browser console errors. These are delivery measurements, not an A/B speed claim.

Focused previews retain their counters. The whole-app test proves retained navigation, not local
view state: its counter resets after an imported design edit in the pre-step-7 baseline too.
Installed Metro follows the non-component design module's inverse imports and reevaluates the app
module, which builds a new app/navigation generation. A stable exported design object alone does
not stop that traversal. Isolating design delivery from the app module belongs with the deferred
step-8 delivery/subscription work; no Metro patch or hot-update containment is included here.
The final source-navigation smoke `source-navigation-final-tip-20261004` also passes the delayed
language-connection, one-press selection and scroll regression.

The separate maintained harness `design-delivery-latency-final-20261004` passes all 32 saves,
with zero iframe reloads and no recorded `RevisionNotFoundError`. Its warm results (first save
discarded) are below. Load was 5.6–6.3 on 18 CPUs; no other task tests ran concurrently.

| Case                      | Source→published p50 ms | Total p50 / p95 ms |
| ------------------------- | ----------------------- | ------------------ |
| One-file, publication on  | 21                      | 187 / 206          |
| One-file, publication off | 20                      | 179 / 193          |
| HNReader, publication on  | 120                     | 266 / 283          |
| HNReader, publication off | 122                     | 289 / 314          |

Compared with the separate quiet cache-off control, HNReader source-to-publication improved from
142/153ms to 120/122ms. Total medians changed from 282/314ms to 266/289ms, with run-to-run HMR and
host-load variation still material. These final delivery results cover the combined retained
slices; they do not attribute the total difference to step 7. Parse/link/validation work remains
the dominant compiler-side slice; the next planned work is measured Langium document reuse.

Final acceptance also exposed fixture application being owned by an app hook while the cell's
provider outlived an app remount. The cell Host now owns fixture work and stable datasource
wrappers; a genuine provider rebind still retires the old application. Renderer regressions cover
retained live handles, updated rows, pending auth, rebinds, and a fresh Host. Same-declaration storage
changes invalidate the application too; app-owned binding changes retain the intentional initial
binding. The final real-app smoke `fixture-generation-final-20261004` passes all four journeys:
Keep/Undo/Keep, persisted reopen, source/visual edits, and both publication modes without retained
browser failures. The renderer fixture suite passes all ten regressions.

The final fixture-generation latency run `fixture-generation-latency-final-20261004` also passes
all 32 saves without iframe reloads or recorded revision errors. Warm source-to-publication medians
are 22/20ms for one-file publication on/off and 123/128ms for HNReader; total p50/p95 values are
184/194, 183/187, 270/329, and 271/321ms, respectively. Load spans 4.2–7.2 on 18 CPUs. This is
final-source regression evidence; the separately measured cache control remains the gain comparison.
The final design repeat `fixture-generation-design-repeat-20261004` passes all three cases and
124 assertions, with warm paint medians 171/170/236ms. Its immediately preceding run passed both
focused cases but timed out activating the whole-app cell before any design saves; that failed
attempt is excluded from delivery timing claims.
The smoke helper's 15-second activation wait was shorter than the readiness gate's 30-second
deadline. It now allows 45 seconds including registration and saving, and reports the button's
pending/error state and Studio status on failure. This aligns the harness with the product deadline.
The corrected helper passes `activation-deadline-design-final-20261004`, all three cases and
124 assertions, with warm paint medians 174/180/241ms and no iframe reloads or browser errors.

Integration with main `854427134` retains its tooling refresh and output planner alongside preview
reuse. Shared identity and lock state belong in `store/`; generated configuration and transient
locks belong in `cache/`. Selected declarations contribute per-file cache signatures, so a
variable-length edit does not invalidate unrelated modules through shared source offsets.
Generated app publication supplies an owned host dependency link when there is no local npm
environment, preserving declared dependency precedence after the move into project cache.
Release checks stop at the nearest project marker and leave unpinned boundaries untouched rather
than inheriting a containing project's pin or migrating home state.
The Developer approved this integration, including dependencies and the lockfile, and authorized
future incoming branch merges. Direct dependency changes still require approval. Integrated Metro
measurements are recorded below. Readiness requires exact-tree repository verification and
finalization before proposing landing; the task checkpoint records their outcomes.

### Integrated acceptance, 2026-10-04

On integrated main `854427134`, `integrated-real-app-final-20261004` passes all four journeys and
80 assertions in 117.6 seconds, including persisted reopen, edit/undo, drag refresh, and
publication-off edits. Both activation screenshots were inspected: the outlined inactive bolt is
beside the preview name, the blank viewport uses the dark Studio surface and pressable activate
control, and the active bolt is filled yellow. The initial integrated real-app attempt passed
three journeys but its publication-off fixture used the retired `Project.tao` declaration and
failed before startup. The corrected fixture creates the project marker and identity; that failed
attempt is excluded from complete acceptance.

`integrated-source-navigation-20261004` passes the delayed-language-connection one-press reveal
regression. `integrated-loading-20261004` restores all six active previews and measures first/last
paint at 758/874ms; this remains concurrent-startup regression evidence, not an A/B comparison.
The first integrated design repeat passed the whole-app and same-file cases but logged a transient
missing-bundle error in the imported focused case during its coordinated bundle/consumer rename.
Its timings are excluded from final acceptance. The intermediate-publication regression failed
before correction and passed afterward. Review then corrected redundant snapshot retention and
conditional interaction subscriptions; their regressions also failed before the fixes. Final
runtime design and interaction suites pass 34 and 43 tests, respectively.

`integrated-design-final-20261004` passes all three cases and 128 assertions after those corrections,
including retained focused counters after the coordinated rename. Imported focused, imported
whole-app, and same-file focused warm paint medians are 583/567/606ms, with load 5.4–6.6 on 18 CPUs.
No iframe reloads or browser console errors were recorded. These integrated timings differ from
the earlier pre-main delivery baseline; they do not establish a speed gain or attribute the change
to one slice. The previous corrected repeat passed under load 37–48, with medians 2630/2589/781ms;
it is acceptance evidence only and excluded from timing comparisons.

The final packaged agent-only desktop proof builds and executes its command successfully in 9.6s.
Its first integrated attempt stopped before startup because main's release checks reject the proof
app's old inline spacing and the runtime correction had type errors. The same spacing now lives in
a named design bundle, and the type errors are corrected; the complete proof was repeated.

The first integrated 32-save harness, `integrated-latency-20261004`, passes all four cases with
zero iframe reloads or recorded revision errors, but exposes a performance regression requiring
diagnosis before readiness. Warm source-to-publication medians are 236/237ms for one-file
publication on/off and 2177/2585ms for HNReader; total p50/p95 values are 513/556, 511/532,
2486/3482, and 2855/3078ms. Load is 5.3–6.6 on 18 CPUs. These are moderate-load measurements,
not the earlier heavily contended design repeat; they cannot be presented as an improvement over
the pre-main source-to-publication medians of about 20ms and 123ms. Exact stage attribution and
a corrected repeat are required before final verification and finalization.

The bounded three-save attribution probe, `integrated-tooling-phases-20261004`, records fresh
workspaces opening in about 1.5ms, Tao validation taking 370–764ms, native TypeScript program
construction taking 180–228ms, and diagnostics taking 827–1310ms over 365 files. Watch and preview
refreshes repeat the same pipeline, with later requests waiting 1.4–2 seconds under the project
mutation lock. Load was 17.4–18.2 on 18 CPUs; these figures attribute the work and do not establish
a quiet-host speed comparison. The preceding full probe passed all 32 saves under load 20–60;
its timings are excluded from improvement claims.

The selected correction retains one native TypeScript program for a watched project only while
its effective configuration, root files, and every recorded filesystem input still match current
bytes and resolution probes. Tao validation, generated publication, configuration parsing, and
diagnostic mapping remain fresh. Root and extended configuration text, effective compiler options,
root files, and every observed filesystem value take part in the reuse audit. External sidecar checks stay uncached. Workspace object reuse
was rejected for this correction: it would save only the measured 1.5ms and would retain a package
index whose requirement additions have no invalidation API. The first corrected three-save probe records a cold
native program and eight unchanged-program reuses: audits take 12–20ms and diagnostic retrieval
0.3–0.5ms, while Tao validation and duplicate watcher refreshes remain. This was under load 7.6–13.2
on 18 CPUs; its short end-to-end sample is not the final 32-save comparison. Watch-session lifecycle
and existing refresh behavior pass 21 focused tests; the checker suite passes eight, including
ordered cold-diagnostic parity after source, generated contract, package-resolution, config, and
mapping changes. Independent cache review found an omitted raw-configuration identity: a
semantically neutral extended-config edit failed the new regression before correction. The corrected
cache passed review and complete `verify-changed` before commit `b0f544a19` (43 passed gates, no
failures, one explicit skip). The final integrated measurements follow below.

Main `883ea9ee8` adds managed-loop publication identities, native ownership isolation, and
Firebase-first project creation. Integration retains those behaviors while adapting incoming
connection files and Hosted Firebase metadata to the decided project layout. Cleanup guards now
check `local/sessions/owner.json`; the desktop development loop uses `cache/dev/desktop-host/`.
The merged Firebase and auth configuration overrides also participate in the emitted-module
fingerprint. Four independent changed/removed-configuration regressions failed before correction,
preventing unchanged Tao sources from retaining a previous backend's generated configuration.
Exact merged-source acceptance and final readiness outcomes belong to the task checkpoint.

The final source at `6829f0b64` passes the real-app smoke `final-main-real-app-20261004`
(four journeys, 80 assertions, 98.9s), the one-press source-navigation regression (4.7s), and
concurrent restored loading of all six previews (first/last paint 749/865ms). Both fresh activation
screenshots were inspected and shown. `final-main-design-20261004` passes all three cases and
128 assertions, including the coordinated bundle/consumer rename, with zero iframe reloads or
browser console errors. Imported focused, imported whole-app, and same-file focused warm paint
medians are 584/589/639ms at load 6.8–7.6 on 18 CPUs. The packaged agent-only desktop proof also
builds and executes its command successfully in 8.9s; this is command-host proof, not foreground
native UI or device acceptance.

The final harness `final-main-latency-20261004` passes all 32 saves in 102.4s, with no iframe reloads
or recorded `RevisionNotFoundError`. No other tests or agents from this task ran concurrently.
Each case uses eight saves; warm statistics discard the first.

| Case                      | Source→published p50 / p95 ms | Total p50 / p95 ms | One-minute load min–max / 18 CPUs |
| ------------------------- | ----------------------------- | ------------------ | --------------------------------- |
| One-file, publication on  | 242 / 275                     | 502 / 547          | 6.35–6.47                         |
| One-file, publication off | 239 / 246                     | 492 / 512          | 6.88–6.90                         |
| HNReader, publication on  | 717 / 828                     | 1463 / 1480        | 7.53–7.97                         |
| HNReader, publication off | 782 / 823                     | 1076 / 1111        | 7.09–8.32                         |

The correction closes much of the first integrated regression, but does not restore the pre-main
HNReader total median of about 270ms. These end-to-end runs also span the newer main integration,
so they are not a pure A/B attribution to the native-program cache. The audited warm native phase
measurements above establish that cache's narrower effect. Fresh Tao validation and duplicate
watch/preview refreshes under the project lock remain compiler-side work. Publication-on additionally
has a 606ms HMR→DOM median, versus 148ms with publication off; a compiler gain is not proof of an
equivalent paint gain. Raw stage samples, machine load, browser events, and Metro messages remain
under `.artifacts/tests/studio-smoke/preview-latency/`. Selective design subscriptions remain deferred;
the closed refresh-indicator investigation is not reopened.

Finalization fetched main `b1dbd7a2c`, adding portable install pins, setup discovery of pinned
project dependencies, browser discovery, and readiness-message fixes. Integration keeps skills
version merging alongside project-root install keys, and adapts the incoming setup/offer readers
and their fixtures to `store/lock.jsonc`. Its final exact-tree verification and acceptance outcomes
are recorded in the task checkpoint. The latency table above remains measured at `6829f0b64`;
later integration is not silently assigned those timings.
The renewed real-app smoke `final-install-merge-real-app-20261004` passes all four journeys and
80 assertions in 86.5s after this integration, including persisted reopen, drag-refresh state,
edit/undo, and publication-off rendering. Focused setup, missing-install, portable-pin, and lock
merge tests pass, and the semantic integration review found no actionable issues.

### Refresh indicator diagnostic, 2026-10-04 — closed

The Developer closed this investigation on 2026-10-04. The following is its historical evidence;
further indicator investigation is outside this project's current scope.

The installed Expo web indicator shows on HMR `update-start`, requests hiding on `update-done`,
and deliberately pads its presentation with a 400ms minimum and a 150ms fade. Its DOM remains
another 250ms after its shown class is removed; DOM presence is not visible refresh work.
The indicator does not own the next-save gate. Tao draft writes and compilation are serialized,
and a connected phone can separately delay an editor save while it applies the preceding revision.

A temporary isolated one-file editor diagnostic (`refresh-indicator-paired-20261004`) recorded
HMR, badge class/transition, draft request/response, DOM and two-frame paint events in both publication
modes, with eight edits per mode and no 500ms pause before the following edit. No other checks or
task agents ran during measurement; observed one-minute load was 5.37–5.66 on 18 CPUs.
All 16 edits painted with the badge's shown class present, and all 14 following edits began while
the badge was shown. Draft HTTP responses took 31–53ms; warm save-to-paint was 163–206ms.
After the last paint, opacity finished fading 265ms later with publication on and 258ms later off;
DOM removal followed at 341ms/336ms. Neither mode reloaded an iframe or recorded
`RevisionNotFoundError`. This disproves an indicator-based save gate in this fixture, but does not
reproduce or explain the reported roughly two-second HNReader delay. That requires an HNReader
save/compile/HMR trace, distinguishing visual padding from the actual queued work.
Raw timelines are retained under `.artifacts/tests/studio-smoke/preview-latency/refresh-indicator-*.json`.

A follow-up copied-HNReader feed diagnostic (`refresh-indicator-hnreader-phone-20261004`) exercised
the shipping app's phone scenario with five cells activated. Both modes passed eight editor saves,
zero iframe reloads and no `RevisionNotFoundError`. All 16 edits painted with the badge shown;
publication-on sent four following draft requests while the preceding badge was still shown.
Warm save-to-paint ranged from 619ms to 1079ms. The first publication-off save took 3620ms,
including 3169ms awaiting the Studio draft response, before Metro's update started at 3335ms.
These are contention-affected diagnostic timings: observed load was 18.54–23.70 on 18 CPUs, and
the workflow board reported three lanes elsewhere. They are not a comparison against the baseline.
The first badge hide or removal after each paint occurred within 223ms; this run still does not
reproduce a two-second post-paint linger. A quiet HNReader compile-queue trace remains the next
diagnostic. The initial two attempts selected the stub app, which excludes the shipping app's phone
scenario; those attempts failed before edits and are excluded. Only copied authored inputs were edited.

Historical handoff state:

1. The branch carries Next slice steps 1–4 (`709a58700`, `b49ea2df3`, `e36cdd8df`, `25369076f`),
   then a `WIP: route project .tao state through ProjectLocal` commit, then this handoff. The WIP
   commit is an untested first pass at the folder layout and fails the tests it has not updated;
   the decisions document's "Implementation state" says what it does and does not do.
2. Neither `./agent verify` nor `finalize` has run on this tip; steps 1–4 ran their focused tests
   and, where the step says so, a real Metro smoke. The branch is unlanded, and
   landing waits for the Developer's explicit authorization.
3. The edit-to-paint harness runs with
   `./agent unsandboxed studio-smoke --run-id <run-id> packages/ides/studio-tooling/studio-smoke/studio-preview-latency.test.ts`.
   Under the machine's usual load (load average near 100 during this branch) timings are
   indicative only; record the load beside every number.

## The work, in order

1. **First, together:** preview activation (below, and Next slice step 5) and the project folder
   layout (the decisions document). They meet at `.tao/local/studio/session.json`, where the active
   previews persist, so build the layout's `local/` path before or with the activation's
   persistence.
2. The rest of step 5: the activation gate, the lagging-cell watchdog, then the sequential-loading
   measurement.
3. Next slice steps 6–7, each measured on its own. Step 8 is deferred by the Developer.
4. Commit reviewed paths, update this document, run `./agent verify-changed`, `./agent verify`,
   the real Metro smokes, and `./agent unsandboxed finalize`; review the merge message and the full
   diff; propose landing. Do not land.
5. The later slices under Next slices stay for after this project lands. When the whole project is
   finished, remind the Developer to review the syntax and structure of Tao tests and scenarios
   (Next slices item 6).

## Preview activation, specified

The Developer's decisions: show every preview but render none until the developer activates it;
each preview has its own toggle, off by default; the active set is per developer and per project.

1. **Every preview starts inactive**, the whole-app cell included. An inactive cell shows its
   scenario name and a pressable lightning icon plus "activate" inside the viewport. It has no iframe,
   so it loads no bundle and registers no HMR client.
2. **The toggle** is an icon-only button at the top left of each cell's header, before its preview
   name: a tiny lightning bolt. Active, the bolt is filled a subtle yellow; inactive, it is a grey
   outline with no fill. It carries
   `aria-pressed`, and its label and tooltip read "Activate preview" or "Deactivate preview".
   Deactivating removes the cell's iframe. Preview controls use the pointer cursor; empty canvas uses
   the open hand for panning. The inactive viewport uses Studio's dark surface color.
3. **Naming in code.** "Active" now means activated. Rename `StudioActivePreview`
   (`studio-src/client/StudioApp.ts:139`), which means the selected cell, to `StudioFocusedPreview`,
   along with its file, its `onActivate` callback, its tests, and the
   `tao-studio:active-cell:<project>:<app>` key (`StudioApp.ts:133`), so "active" and "activate"
   refer only to the toggle.
4. **Persistence.** The set of activated cell ids (`cellId`, `StudioApp.ts:143`) per app lives in
   `.tao/local/studio/session.json`, read and written by the Studio server: the handshake carries
   it, and the client reports each change. An id no longer in the manifest is dropped. The focused
   preview (`StudioApp.ts:133`) and editor tabs (`StudioEditorTabs.ts:147`) move into the same file
   under the layout decision.
5. **Fast draw goes**, with its browser setting and its `?taoStudioPreviews` override:
   `studio-src/client/matrix/StudioPreviewMatrix.ts:23-64` (`connectedCells` at `:62` becomes the
   activated cells), `StudioApp.ts:526-538`, `StudioShell.ts:25` and `:399` with the
   `.studio-fast-draw` button, and the tests at `studio-tests/studio-client.test.ts:2066-2070` and
   `studio-tests/studio-mount-lifecycle.test.ts:39` and `:123`.
6. **An active cell is never suspended.** `observePreviewVisibility`
   (`matrix/StudioPreviewConnection.ts:284-311`, called from `StudioPreviewCellView.ts:188`) swaps
   an off-screen cell to `about:blank` and reloads it on return, and that reload is what registers a
   cell mid-update. Remove it for active cells;
   `studio-tooling/studio-smoke/studio-network-simulation.test.ts:121` and `:176` describe it.
7. **Tests that assume every cell loads** must activate the cells they use, through the toggle or a
   seeded `session.json`: `studio-smoke/studio-real-app.test.ts`,
   `studio-smoke/studio-preview-latency.test.ts`, `studio-smoke/studio-datasource-edit.test.ts`,
   and the Jest matrix tests under `packages/ides/studio/studio-tests/`.
8. **Proof:** a focused test per behavior (default off, toggle on and off, persistence across a
   Studio restart, no suspension); then the HNReader race case under real Metro with several cells
   active, editing while scrolling, with no `RevisionNotFoundError`. Show the Developer a screenshot
   of both toggle states.
   The focused control lane checks pointer and Space/Enter activation, and a second press during a
   pending save, for scenario and whole-app previews:

   ```sh
   ./agent unsandboxed studio-smoke --run-id preview-activation packages/ides/studio-tooling/studio-smoke/studio-preview-activation.test.ts
   ```

## Where to look

- `packages/ides/studio/studio-src/client/matrix/`: `StudioPreviewMatrix.ts` (cells, iframes,
  `src` at `:162` and the whole app at `:238`), `StudioPreviewConnection.ts`,
  `StudioPreviewCellView.ts`, `StudioPreviewBridge.ts`.
- `packages/ides/studio/studio-src/StudioPreviewSession.ts`: reused workspace and preview compile.
- `packages/apps/expo-host/expo-host-src/runtime.ts`: generated file publication, browser bootstrap,
  runtime and whole-app updates, generated preview root.
- `packages/apps/runtime/TaoRuntime-src/TR-studio-preview.tsx`: preview mount and applied messages.
- `packages/ides/studio-tooling/studio-tooling-src/StudioDev.ts` and
  `packages/cli/dev-cli/dev-cli-src/dev.ts`: launch and Metro/Watchman setup.
- Metro 0.84.6's HMR internals, for the race: `metro/src/HmrServer.js`,
  `metro/src/IncrementalBundler.js` (`updateGraph`), `metro/src/DeltaBundler/DeltaCalculator.js`
  (`getDelta`), and `metro/src/Server.js` (bundle requests also call `updateGraph`). Read them in
  `node_modules`; a Metro patch is a dependency change and needs the Developer's approval.

## Results from `feat/studio-preview-latency-next`

Measured on 2026-09-29 on the Developer's machine under ordinary load; warm figures exclude the
first edit after launch. Run the harness with
`./agent unsandboxed studio-smoke --run-id <run-id> packages/ides/studio-tooling/studio-smoke/studio-preview-latency.test.ts`.

1. **Edit-to-paint, real Metro, 8 edits per case, 0 iframe loads in every passing case.**

   | Case                              | Save→source | Source→published | Published→HMR | HMR→DOM | DOM→paint | Total p50 / p95 |
   | --------------------------------- | ----------- | ---------------- | ------------- | ------- | --------- | --------------- |
   | One-file app, editor save, on     | 2           | 36               | 90            | 50      | 35        | 204 / 277       |
   | One-file app, editor save, off    | 2           | 38               | 83            | 48      | 42        | 221 / 282       |
   | HNReader + Studio view, disk, on  | 1           | 218              | 113           | 61      | 35        | 423 / 462       |
   | HNReader + Studio view, disk, off | 1           | 194              | 93            | 65      | 14        | 415 / 449       |

   Publication `off` is not measurably faster than `on`: the difference is inside run-to-run noise
   (one-file totals ranged 190–242ms p50 across five runs). For a real app, Tao's compile inside
   source→published is the largest slice; Metro's published→HMR is the second, and Metro batches file
   changes for a fixed 30ms before it starts.
2. **In-process HNReader compile phases** (warm median ms, reused workspace, Studio-view edit):
   parse 35, validate 45, bridge metadata 2 (was 10), emit 50 (was 54), publish 10; total 141 (was
   154, same result across two A/B runs each). The removed bridge work re-read and re-parsed every
   root `.tao` file per compile to rediscover a project root the package index already held
   (HNReader 15ms median, WordFlower 3.5ms, Data MVP 2.6ms measured alone). Studio render identities
   also stopped hashing the whole file once per render.
3. **Code-then-Draw is fixed.** Only publication `off` failed. The Code save's runtime update applied
   fresh source versions; Metro's Fast Refresh then re-ran the frame's bootstrap effect, which paired
   the byte-stable marker's first-compile versions with the new revision, so the next Draw action was
   correctly rejected as stale. The bootstrap response now carries its own revision's versions and
   never replaces a newer applied revision. The real-app smoke performs Draw after Code.
4. **Edit failures.** Editing the file that declares HNReader's datasources (then `HNReader.tao`,
   now `Data.tao`) blanked the preview in both modes: Fast Refresh rebinds each store to a new
   declaration, which starts its cell overlay empty, while the fixture hook applied only once. The hook
   now reseeds when a store's declaration changes, and a focused view, which takes its arguments once
   per mount, remounts with the new rows' handles; `studio-datasource-edit.test.ts` proves it under
   real Metro. Editing runtime source while Studio ran raised
   `runtime capture domain 'navigation' is registered exactly once` in every cell, because a hot
   reload re-ran the module's top-level registration; a module now replaces its own registration. The
   harness still edits a Studio view, so it times an ordinary edit. Not fixed: an HNReader cell
   often stops applying edits after its first or second one. Its frame gets two overlapping
   `update-start` messages for one edit, then Metro answers the next with `RevisionNotFoundError`,
   and the web client reports "Expo CLI and the web client are out of sync" and applies nothing
   more. Metro 0.84's source shows the likely race: every cell of one bundle shares an HMR client
   group, a cell that registers runs its initial update for the whole group outside the group's
   serial change queue, and when that overlaps a file-change update, the later `updateGraph` call
   leaves the group on a revision id the earlier one deleted. It needs a cell that registers during
   an update: Studio suspends a cell scrolled out of view to `about:blank` and reloads it when it
   returns, and the harness recorded two suspended HNReader cells resuming during the edit itself,
   so it hits HNReader's many cells and never the one-file app, and a user scrolling while editing
   can hit it too. Step 5 of the next slice fixes it in Studio, without patching Metro. The
   harness waits for cells to stop loading before its first edit and records every cell load in its
   failure diagnostics.
5. **Fast draw.** A toolbar toggle beside the mode button connects only the first scenario's preview,
   so no other cell has an iframe. It is the way to feel a single-preview Studio before deciding what
   the multi-cell matrix should cost.

## Next slices

Each slice is measured on its own with the latency harness, so each gain is attributable.

1. **Next slice**, in this order. The first two are fixes, because an edit that blanks the preview or
   throws cannot be timed. Steps 3, 7, and 8 are experiments: measure each and keep only the ones that
   help.
   1. Done: fix the blank preview after editing the datasource file (`Data.tao`) by reseeding
      fixtures when Fast Refresh rebinds a store.
   2. Done: fix the `runtime capture domain 'navigation' is registered exactly once` error a hot
      reload raised from the module-level registration in `TR-navigation-app.ts`.
   3. Done, kept: the preview bundles a manifest of only `scenarios` and `fixtures`, without source
      ranges, so an edit that changes a file's length leaves `TaoStudioManifest.ts` byte-identical;
      Studio keeps the whole manifest in process. The harness now makes every edit longer than the
      last, since the same-length markers it used never moved a range. One-file app warm p50,
      publication on: 275 and 216ms against 689ms with the full manifest; the machine was loaded and
      the spread is wide, so the gain is indicative only.
   4. Done, in part: a compile's new config no longer re-renders every view. The generated preview
      root holds one `<TaoApp />` element per mounted cell, so React skips the app below the bridge;
      Fast Refresh still re-renders the views an edit changed. `publishLens` still changes with the
      config on purpose: the Lens panel matches samples by source version, and the cheap Lens
      wrappers re-render to report the new one. Scenarios with steps still remount per compile,
      since a code edit can change what a replayed step does; changing that is a product decision.
      Not timed: the machine ran at load average ~100, and the HNReader cases hit the Metro race
      above. A Jest test proves the view renders once across a new config while the Lens reports
      both revisions.
   5. Render only the previews the developer activates, which removes the Metro HMR race above.
      Studio lists every scenario's preview, but none renders until its own Activate toggle is on,
      and each starts off; [Preview activation, specified](#preview-activation-specified) has the
      details. The active set is per developer and per project, so it lives in
      `.tao/local/studio/session.json` under
      [Decisions - Project folder layout](<Tao CLI workflows/Decisions - Project folder layout.md>).
      Fast draw, which connects only the first scenario's preview, goes, along with its
      browser setting and its `?taoStudioPreviews` override: activating one preview does the same.
      An active preview keeps its iframe when scrolled out of view, so scrolling no longer registers
      a cell mid-update. Activating a preview while an update is in
      flight waits, with a timeout, until every connected cell has applied it. A cell still behind
      the latest published revision a few seconds after the others reloads once, the backstop for
      any registration that still overlaps an update. Patching Metro was ruled out: making
      `IncrementalBundler.updateGraph` fall back to the graph's latest revision stops the
      `RevisionNotFoundError`, but `DeltaCalculator.getDelta` gives pending changes to whichever
      caller asks first, and a cell's bundle request asks too (`Server.js`), so the cells already
      connected would receive an empty update and silently miss the edit. A correct patch keeps a
      per-graph log of deltas so each client group catches up from its own revision: a fork of
      Metro's bundler internals to carry across upgrades. Retrying after `RevisionNotFoundError`
      was ruled out for the same reason: a retry from the latest revision delivers an edit two HMR
      updates raced over, but not one a bundle request took first, and a resuming cell's bundle
      request is this race's trigger.

      Then measure loading active previews one at a time, in order, against all at once. Today
      Studio sets every cell's `src` together (`StudioPreviewMatrix.ts`); the first cell paints
      first only because the cells, same-site frames in one renderer, execute one bundle each on a
      shared main thread. Expected, inferred rather than measured: the first preview paints sooner,
      since it no longer shares the thread with other cells parsing the same bundle; the last
      paints at about the same time, or a little later where downloads stop overlapping; Studio's
      own UI stays responsive between cells; and fewer cells register with Metro at once. Keep it if
      the first preview is faster and the last is no slower than noise.
   6. Cache emitted modules per file, reusing a module whose source and dependencies did not
      change. Expected to save most of the 50ms emit phase on a one-file edit. It is compiler-side
      and independent of the other steps, so it can move or run in parallel.
   7. Let a refreshed design reach the running app. `RuntimeAppDefinition.design` caches the design once
      per app object (`TR-navigation-app.ts`), so today only a new app object, built when the app shell
      re-runs, shows a design edit.
   8. Re-render only what a design edit affects: a design store versioned per color and per style, with
      each element subscribing to the names its styles resolved. It builds on step 7, whose
      measurement decides whether it is worth doing. It pays off only with a delivery path that skips
      re-running the app shell: either the generated design module accepts its own hot update and
      replaces the store's values, or Studio sends a design change over the runtime bridge.
2. **Slice after.** Reuse Langium documents across compiles. Langium 4.3 (the pinned version) offers
   document-level reuse only, through `DocumentBuilder.update(changed, deleted)`; no LL(k) parser
   reparses a text range. Stages, each measured:
   1. Keep one preview `Workspace` and its services across compiles, feeding source overrides through
      an overlay file system instead of opening a new workspace whenever overrides are present. Split
      the 35ms parse phase into service creation, reads, parsing, and linking first.
   2. Replace the delete-and-rebuild in `linkDocuments` with `update`, translating reachable-set
      changes into deleted documents. Langium's `isAffected` relinks only documents with a reference
      into a changed file, so folder visibility and sibling discovery, which resolve names outside the
      reference index, need their own invalidation (relink the folder, or reset every document; an
      unchanged document then still skips its reparse).
   3. Per-document validation and emit caches, which need Tao's own dependency tracking, since a
      file's diagnostics can depend on other files beyond Langium references.

   Expected, inferred rather than measured: parse 35ms → about 8–15ms, the whole compile about
   15–20% faster before validate and emit become per-document. Stay on Langium 4.3.x: a 4.4.0
   report shows large regressions on unclosed calls, which mid-edit saves produce.
3. **After this project: Langium 4.4.** Measure Studio preview speed on 4.3.x with the latency harness,
   including a half-typed save that leaves a call unclosed; then, with the Developer's approval for
   the version change, update to 4.4 and measure the same cases again to see whether a difference
   is noticeable.
4. **After this project lands: evaluate stable render ids.** A render id is a file path plus source
   offsets, which generated modules and design styles embed, so an edit that changes length shifts
   every later id in the file. Every Studio edit therefore carries the source versions it was made
   against, and the server refuses one made against an outdated preview ("Wait for the refreshed
   preview"). Evaluate an id that survives edits, with the server resolving it to the current source
   position when an edit arrives: whether edits could then apply while a compile is in flight, what
   keeping ids stable across edits costs (written tags, or the server tracking elements between
   revisions), and how it interacts with tags, which are unique only within their block.
5. **After this project lands: one tag rule in every environment.** `#tag` and `#tag[n]` must behave
   the same in every environment and every step, and `#tag` must fail when it matches more than one
   element. `./tao test` already does: every tag step requires exactly one match
   (`requireSingleMatch`, `requireSingleTag`, and the journey event adapter in
   `expo-host-src/testing/test-runner.tsx`), proven by the runtime test "rejects a tag without a row
   index when it matches more than one element". The host drivers do not: Playwright
   (`host-control-playwright.ts` `locatorFor`), Appium XCUITest, Appium UiAutomator2, and Appium Mac2
   default a missing `occurrence` to 1, `HostControl.ts` documents that default, and
   `PlaywrightHostControl.host.spec.ts` asserts it. Make an omitted occurrence on a tag target
   require exactly one match in every driver, update that spec, and prove it on each host lane.
   Internal probes that observe tags without an index (`__tao_navigation_title`, ready and receipt
   markers) must stay unique or name an occurrence. Today `[n]` exists only in `select #tag[n]`;
   whether other steps accept it is a language decision for the Developer.
6. **When this whole project is finished: review test and scenario syntax.** The Developer reviews the
   syntax and structure of Tao tests and scenarios as a whole.

## Completion bar

The successor can report completion when it has a committed, clean branch with: previews inactive
by default behind their toggles, persisted per developer and project; no `RevisionNotFoundError`
in the HNReader race case under real Metro; the folder layout of the decisions document, with its
migration and tests; each of steps 5–7 measured, kept or dropped on its numbers (step 8 deferred by
the Developer on 2026-10-04); source-action
safety retained; focused, repository, and real Metro evidence for the exact tip; a reviewed merge
message and successful `finalize`; and a concise statement of the measured gain and the remaining
dominant slice. Do not report test success as a measured latency improvement. Landing remains a
separate Developer decision.

## Production dependency-link preservation

The stable-link slice retains owned generated dependency symlinks during Studio incremental
publication when their logical paths and exact targets are unchanged. Every publication still
audits the managed dependency environments and the actual owned symlinks. Missing links are
repaired, retargeted and removed links are reconciled, and failed publication restores removed
links. An unchanged ownership manifest is not rewritten. Ordinary full-tree generation keeps
its unlink-and-recreate behavior because its directory synchronizer rejects destination symlinks.

Identical publication suppression and Metro timer reductions are separate follow-up slices;
preview-first compilation and affected-document validation remain experimental.

Validation: 11 generated-link tests and 24 runtime publication tests pass. Disabling retention
fails four lifecycle/work-count assertions. The real HNReader editor-padding smoke passes eight
saves in each publication mode with zero iframe loads. Both periodic timing attempts were
inconclusive: first another verification lane was active at load 12.6 on 18 CPUs, then load
17.6 still exceeded quiet admission. The correctness smoke ran at load 22.7–40.1; its
save-to-paint medians (4856ms checks on, 9040ms off) are not speed qualification or a comparison
with the earlier experimental pipeline. A quiet periodic run remains required to establish
current numerical budget compliance. No ceiling was changed.

## Approved Metro timer experiment, 2026-10-05

The Developer approved a narrow, reproducible patch for the Expo host's exact Metro 0.84.5
installation and Expo file-map fork 57.0.3. Studio's Metro child defaults to `TAO_STUDIO_FAST_HMR=true` and
`TAO_STUDIO_FAST_FILE_MAP=true`; setting either variable to `false` retains that timer's upstream
behavior. Ordinary app launches retain the upstream defaults unless explicitly opted in.

The HMR patch changes only its debounce delay from 50ms to 0ms. The file-map patch replaces the
30ms polling interval with one event-triggered 1ms flush, waits for already-observed processing,
and cancels pending work on shutdown. It preserves Metro's HMR queue, revision handling, event
aggregation, and recrawl logic. The rejected revision fallback and revision-error retry remain
ruled out for the reasons above.

The upstream waits collect nearby events and reduce repeated work. Shortening them can produce
more refresh cycles or expose intermediate states during multi-file writes; queue serialization
alone does not make a publication atomic. The exact choice of 30ms and 50ms has no documented
rationale in the inspected upstream source. Actual installed-module tests must cover batching,
delayed processing, deletion/recreation, recrawl, shutdown, and queued HMR edits. Real Metro
burst-save and latency evidence is required before reporting this experiment as ready to land.
The pinned patches must reproduce through frozen setup and be reassessed on a Metro upgrade.
Standalone host staging carries the root patch registrations and their exact version pins;
installed-host setup copies the captured patch bytes and includes them in its install identity.

Integration evidence: six actual-installed-module timer tests, 72 Studio launch cases, eight
standalone packaging cases, and eleven installed-host cases pass. Frozen setup reproduces the
patches. The real Metro burst smoke handles three paired two-file saves and a later follow-up
save, with final content present, no observed HMR errors, and no iframe reloads.

After integrating stable dependency links, sixteen HNReader padding saves pass with each timer
configuration. Publication-to-HMR p50 is 122/132ms with upstream timers and 50/53ms with fast
timers (publication checks on/off). Total p50 is 5924/5028ms upstream and 3876/3663ms fast, but
load ranges differ (16.6–20.7 versus 14.0–18.8 on 18 CPUs), and the control overlapped a focused
runtime test. These totals cannot establish the patch's save-to-paint gain or budget compliance.
The existing ceilings remain unchanged; quiet periodic qualification is still outstanding.

A later sequential repeat, with no other local lane from this task, passed another sixteen saves
per timer configuration. With publication checks on, upstream versus fast p50 was 2660 versus
2597ms total, 2513 versus 2502ms source-to-publication, and 86 versus 26ms publication-to-HMR.
With checks off, the corresponding p50 values were 2859 versus 2572ms total, 2682 versus 2498ms
source-to-publication, and 119 versus 28ms publication-to-HMR. Loads were 4.5–7.2 upstream and
7.2–9.6 fast on 18 CPUs. This supports a shorter post-publication wait, with compilation still
dominating. It is not periodic quiet-machine admission or proof of meeting the existing ceilings.

## Confirmed-failure verification cleanup

The Developer approved cancelling running verification peers once a broad lane confirms a
failure. The failing result remains the cause; pending work is not started and cancelled peers
remain incomplete even if their cleanup exits successfully. Owned processes receive termination,
then identity-checked survivors receive a force-stop after three seconds. Verification retains
its leases and the landing lock until owned process cleanup completes, avoiding overlap with
another landing. A confirmed fail-fast halt also skips contention retry and resume work.
Targeted collect-all runs and uncertain-timeout classification retain their existing behavior.

Focused proof passes 32 work-graph cases, 44 test-runner cases, nine failure-policy cases,
42 gate-runner cases, and 32 machine-lane cases. The process regression verifies termination of
the owned peer and its descendant while an unrelated detached process stays alive. Targeted
collect-all requests retain their artifact paths but register as narrow machine lanes; narrow
lanes remain admissible during landing priority, and broad verification continues to yield.

## Identical-publication production slice, 2026-10-05

Preview generation compares the exact non-marker path-to-code map and publication metadata with
its last successful output. The metadata includes source versions, the full Studio manifest,
dependency environments, app/project identity, and publication-check mode. A successful identical
compile retains the published revision while its compile-attempt revision still advances.
Generated-file repair and dependency-link audits still run; equality is not permission to skip
checking or repairing the output tree. Reset, session close/reopen, and non-preview generation
clear reuse state. Managed mobile publications retain their per-attempt nonce behavior.

Studio activation, phone save acknowledgements, and device freshness use the published revision
when a compile retains it. Diagnostics and compile completion still report the attempt. Focused
lifecycle regressions pass, including 30 runtime cases after integrating stable links, 12 session
cases, and 28 device-gateway cases. The integrated HNReader padding smoke completed sixteen saves
without iframe reloads. Save-to-paint p50 was 2690/2750ms (publication checks on/off), with
source-to-publication p50 2553/2579ms at load 5.5–7.6 on 18 CPUs. These results do not meet
the existing speed ceilings or establish a gain against the earlier experimental pipeline.
Full portable verification remains required; no ceiling was changed.

Landing-gate diagnosis corrected the HNReader feed smoke to compare the applied publication
revision with the published revision exposed on the status element, rather than with the latest
compile attempt. All four real HNReader journeys pass. The simulated-user journey passes 102
assertions. The Developer subsequently approved increasing all timing-out execution budgets:
Studio smoke tests now allow ten minutes, server readiness five minutes, and activation waits two
minutes. Runtime journeys have a two-minute base and five-minute cap; Bun tests have a four-minute
base and ten-minute cap. Suite processes allow twenty to thirty minutes, and source-mutation lock
waits five minutes. Assertions and performance ceilings remain unchanged. Scoped reruns pass all
982 validator cases, 370 Expo-host cases, and 273 runtime
cases after the initial full run timed out under contention.

Targeted checks had registered as broad test lanes and were also blocked by the landing-priority
window. Collect-all requests now use narrow admission while retaining their artifact paths;
narrow developer lanes can proceed during landing priority. Broad verification still yields,
and resource leases are unchanged. The deterministic machine-lane regression covers both sides.

A subsequent changed-scope gate still failed despite the larger execution budgets: validator
cases waited five minutes on the shared maintained-source mutation lock, while Studio and skills
processes reached twenty minutes. The failed run also reported a process-identity inspection
error during timeout cleanup. It was stopped after failure and is not verification evidence.
Mutation waiters now inspect an existing owner before creating another fsynced claim file and
poll at 50ms; atomic acquisition and identity-safe stale reclamation remain unchanged. Compiler
and validator batches no longer use Bun's blanket concurrency flag, while independent suites
retain scheduler parallelism. The focused shared scope passes 108 cases, the gate catalog passes
27 cases, and all 982 validator cases pass in 96 seconds at load up to 13.8 on 18 CPUs.
The receipt repair scope passes three cases in 55 seconds, the skills scope thirteen in 49
seconds, and Studio edit-to-preview seven in 87 seconds. These recoveries do not replace the
required broad landing gate.

The Developer requested controlled diagnostics before the next landing attempt. The opt-in
`TAO_VERIFY_NO_TIMEOUTS=true` removes execution watchdogs; cleanup grace periods, explicit timeout
behavior fixtures, and performance assertions retain their contracts. `TAO_VERIFY_JOBS=1` is a
separate diagnostic concurrency ceiling. `just diagnose-verification` runs the full automated
membership sequentially, prints each part's included files or command and result with elapsed
time, streams node logs while processes are running, and records no green-tree verification proof.
Jest prints test and hook progress in this mode. Explicitly reviewed completed node names can be
retained with `TAO_VERIFY_DIAGNOSTIC_COMPLETED`; it affects only that diagnostic lane. A fix must
rerun affected earlier parts. Ordinary full verification ignores the diagnostic resume list.

Record the sequential node and file durations, investigate any part that stops making progress,
and commit the resulting shard and scheduling adjustments before the next full run. Final
verification and authorized landing use normal parallel scheduling with execution watchdogs
disabled and live-log monitoring; sequential diagnostics are not landing evidence.

The controlled sweep exercised every quiet automated part across resumable runs. Original failures
remain in the run artifacts: two fixtures could stall without contention (an obsolete cache claim
expectation and equal admission timestamps), and deliberate-timeout/capacity fixtures needed
explicit diagnostic-independent inputs. Corrected focused reruns pass. The diagnostic runner also
treated its intentionally absent green snapshot as generated drift; generated-proof comparison
now applies only when that proof configuration is present. Normal verification retains drift
rejection and ignores diagnostic resume.

Serial costs identify scheduling work rather than a measured commit-by-commit regression:
Tao CLI 624.7s, project tooling 461.2s, compiler 210.3s, development CLI 188.6s, Studio 186.0s,
and runtime Jest 139.3s. The CLI total includes a subsequently repaired 30s timeout fixture.
Bun blanket concurrency now matches the scheduler's granted slots, replacing an implicit allowance
of twenty simultaneous tests inside a two-slot reservation. Compiler emission-cache, workspace,
preview and app-output work, project watch/service work, and Studio session/edit work have named
cohorts for cold checkouts. The 101.6s watch file is split into saved-input/dependency, topology,
and refresh groups; the 85.9s preview-session file is split into receipt, source, scenario and
watch groups. These moves preserve test bodies and assertions. Measured history continues to
balance the remainder; no fixed machine-specific shard count was added.

Diagnostic Tao preparation logs identify each submitted, completed or failed file with elapsed
time including queueing; they do not claim actual worker start times. The next full parallel gate
must establish correctness and actual scheduling results for the committed rebalance. Sequential
batch measurements are not a qualified speed gain, and existing performance ceilings remain.

The first committed parallel diagnostic-policy landing attempt was interrupted after13minutes
after the real Metro drag smoke's local30-second compile polling budget expired. This was a
missed watchdog override, not a captured rendering/state failure. Browser smoke polling and
manual overall wait deadlines now honor the diagnostic policy; ordinary budgets, deliberate
timeout fixtures, per-attempt retry cadence and performance assertions remain unchanged.
The corrected real Metro drag journey passes independently in22seconds. Retain the interrupted
run and compare identical test/group membership across sequential and parallel artifacts; for
example, the split receipt group passed33.9s sequentially and399.4s in that parallel run.

## Metro hosted-landing integration, 2026-10-06

The outstanding Metro slice integrated current main and its hosted verification route. Frozen
setup reproduces the pinned patches. All six installed-module timer regressions pass; the real
paired-file burst and follow-up save smoke passes in20.6seconds with no observed HMR errors or
iframe reloads. These are focused integration checks, not portable merge proof.

The standalone performance attempt was inconclusive at quiet admission: another host complement
was active and load was34.6 on18 CPUs. Retain that result; no performance ceiling changed and no
new save-to-paint gain is claimed. Hosted Verify and the local host-only complement own landing
proof. Earlier sequential-versus-parallel research evidence remains in the verification handoff.

Hosted retry correction, 2026-10-06: the first Verify run (37420417279, PR 32) found strict typing and shared-boundary lint defects in the installed-module timer tests, plus incoming root-instruction budget and formatter drift defects. The run was cancelled after those failures were observed. Repairs preserve assertions and timer behavior; the retry still requires hosted Verify and the host-only complement on its new head.

The cancellation command now accepts `--all-workflows --sha <commit>` to stop other workflows on an already-failed owned PR head. It excludes completed runs and runs on other heads; six cancellation/landing-fix checks pass. This stopped the remaining native-parity run on the first failed head. The repaired six installed-module timer checks, typecheck and lint pass; hosted retry proof is still pending.

The local iteration run stopped on a stale incoming hook-policy assertion after 10m49s, under peak load 54.8 on 18 CPUs. The corrected hook file passes 15 checks. The external-watch topology file passes all five checks unchanged in a separate 47.5s run, versus 149.2s with a helper-observation timeout during the contended run. No watchdog or assertion was weakened. Main's matching instruction/hook corrections were integrated; hosted Verify and the host-only complement remain the final merge proof.

Hosted queue continuation, 2026-10-06: retry 37423918637 on head 5050a8a7 was cancelled before contributor agreement or partition planning executed; the aggregate failed because those prerequisite jobs were cancelled, with no portable tests run. The owned complement was stopped and exact-head cancellation confirmed no remaining workflows. With the Developer reserving the CI queue for this slice, a fresh hosted attempt will provide the missing complete portable and host proof.

## Production preview speed integration, 2026-10-06 — in progress

The approved [execution plan](<Studio preview speed execution plan.md>) integrates checkpoint
`4efc6ff2a` on a separate feature branch. Browser Studio uses conservative preview-first admission,
complete source/tooling receipt audits, successful source baselines and independent publication
checks. Full work follows authenticated paint with a one-second quiet window and a ten-second
first-pending maximum; running synchronous work remains non-preemptible. Invalidations, failed
attempts, rejected delivery and loss of all registered previews release authoritative recovery.
Close drains admitted and queued compilation before flushing pending work and disposing resources.

Compiler-owned direct scalar padding is limited to publication-off browser previews without native
consumers. Source/member/index/prior-value/provenance checks and immutable span shifts guard the
update. Fresh browser or native registrations publish pending overlays first. Main's native memo,
locking and separately invoked final freshness audit remain intact. Its unchanged-installation
memo hit, visible-change rehash, explicit-root cold path and publisher-barrier regressions pass;
no additional useful duplication has been demonstrated, so another inspection cache is excluded.
Unchanged source-read reuse and extra whole-document replay remain preserved at the POC checkpoint
and are restored out of production plumbing.

Focused source evidence passes: real preview-session lifecycle and publication (nine cases),
project/session identity (52), server boundaries (29), gateway lifecycle (31), compiler padding
(seven), runtime padding (six), scheduler (ten), eligibility (seven), input classification (two),
receipt audit (one), bridge/protocol/coordinator, runtime publication guards and main native memo.
Deliberate mutations fail their intended stale-source, first-deadline, timer cleanup, final-consumer,
close-drain, fresh-realm, failed-registration and whole-app paint-identity witnesses. Typecheck and
lint pass. These checks establish iteration evidence, not merge or performance qualification.

Current real-Metro editor trials remain diagnostic. One contended default padding trial painted
all eight edits and reached final source/manifest parity, but failed its all-direct assertion with
five deliveries: quiet releases and multi-second event-loop lag caused full attempts to consume
later saves. The failed artifact is retained; no qualified gain follows from it. A later width,
invalid-to-valid and rapid-save trial exposed a harness-world mismatch in its rapid paint poll;
that poll is corrected and needs a fresh run. Successful screenshots, authenticated computed
padding/paint, failure samples, rapid/revert/burst, retained-state, whole-app, multiple-preview,
fresh-activation and actual-full-overlap proof remain part of completion acceptance.

All six canonical performance cases and their ceilings are preserved. A separate production-default
padding qualification requires seven real warm delivery/paint receipts plus eventual authoritative
source parity, rather than fabricated generated modification times. Quiet admission, paired
main/feature trials, current-main integration, the changed-scope gate and final integrated review
remain outstanding. The control is pinned to a named feature branch to prevent the repository's
main-mirror sync from moving an unmeasured detached baseline. No push, CI or landing is authorized.
