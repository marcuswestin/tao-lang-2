# Studio preview speed continuation

Handoff written 2026-10-03 for the successor of `feat/studio-preview-latency-next`. Start a new
`feat/` branch and worktree from that branch's tip, not from `main`. This document owns the Studio
preview latency project; [Decisions - Project folder layout](<Tao CLI workflows/Decisions - Project folder layout.md>)
owns the project folder layout work this project also carries. [Tao tooling performance](<Tao tooling performance.md>)
holds broader language and tooling measurements; do not treat older CLI benchmarks as edit-to-paint
timings.

## Current state

The successor worktree is `feat/studio-preview-speed`, created from exactly `8ecf581e7`, with no
landing authorized. Its activation and decided folder layout are implemented: every scenario and the whole-app preview now
default to no iframe, with per-cell lightning toggles and server-persisted app activation in
`.tao/local/studio/session.json`. Selection and its Tao ProductHost/feed boundary use focused names;
the old browser focus/tabs and viewport import once into the project session. Fast draw and
off-screen suspension are removed, and real smokes explicitly activate their cells. The decided
layout implementation is recorded in the [layout decisions](<Tao CLI workflows/Decisions - Project folder layout.md#implementation-state>).

The first activation/layout checkpoint passed the complete Studio and Studio-tooling source suites
and `verify-changed` across source, compiler, runtime, CLI, and app checks. The final project gates
and integration state are recorded in the task checkpoint.
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
