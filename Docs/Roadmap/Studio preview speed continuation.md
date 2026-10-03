# Studio preview speed continuation

Handoff written 2026-09-29 for the next implementation branch. Start from the committed tip of
`feat/studio-preview-workspace-reuse`, not from `main`. This document is the handoff for the Studio
preview latency work; [Tao tooling performance](<Tao tooling performance.md>) contains broader
language and tooling measurements. Do not treat older CLI benchmarks as edit-to-paint timings.

## Current state

1. `4eb41b8a` reuses a Studio preview `Workspace` across ordinary revisions and uses a syntax-only
   check for drafts. Its roadmap changes describe remaining incremental compilation work.
2. `9c86b215` adds browser Studio `--preview-publication on|off`, default `on`. In `off`, the first
   compile still creates `TaoStudioPublication.ts`; later compiles keep that file byte-identical.
   Studio sends current cell identities and source versions over the runtime bridge, skips exact
   publication acknowledgments and their iframe reload retry, and keeps Draw/Edit interaction mode
   after a Fast Refresh bridge remount. Native/device launches reject `off`. This is an experiment:
   `off` cannot prove that an iframe applied the exact latest revision and may leave an unnoticed
   stale preview. Source-action version and occurrence checks remain in place.
3. The branch includes `main` through `94ec269f`; the integration commit was `65efbbd1`. Before
   this handoff document, the tree was clean. `./agent check`, `./agent verify-changed`, `./agent
   verify`, and `./agent unsandboxed finalize` passed. The final `finalize` integrated `main` and
   verified that exact tree. A real Metro smoke run passed four cases, including publication-off
   Draw then Code edits without an iframe `load`. An earlier HNReader Feed smoke timeout passed on
   a complete isolated rerun. None of these runs measured the speed gain. This handoff document
   has not been verified; the Developer requested a commit and prompt before any further gate.
4. The branch is deliberately unlanded. Its reviewed merge message is
   `.artifacts/merge/feat/studio-preview-workspace-reuse.msg`; that ignored artifact does not travel
   to a fresh worktree, so the successor branch needs its own message and `finalize` result.

## Where to look

- `packages/ides/studio/studio-src/StudioPreviewSession.ts`: reused workspace and preview compile.
- `packages/apps/expo-host/expo-host-src/runtime.ts`: generated file publication, stable marker,
  browser bootstrap, runtime updates, whole-app updates, and generated preview root.
- `packages/ides/studio/studio-src/client/matrix/StudioPreviewMatrix.ts` and
  `StudioPreviewBridge.ts`: retained iframes, runtime messages, acknowledgement behavior.
- `packages/apps/runtime/TaoRuntime-src/TR-studio-preview.tsx`: preview mount and applied messages.
- `packages/ides/studio-tooling/studio-tooling-src/StudioDev.ts` and
  `packages/cli/dev-cli/dev-cli-src/dev.ts`: launch flag and Metro/Watchman setup.
- `packages/ides/studio-tooling/studio-smoke/studio-real-app.test.ts`: real Metro continuity tests.
- `packages/compiler/compiler-src/workspace/` and `packages/language/parser/`: parse, link,
  validation, and compile graph work to inspect before designing partial compilation.

## First actions in the successor branch

1. Create a **new named `feat/` branch and its own worktree from the committed handoff tip**, using
   the repository's supported worktree/branch workflow. Do not edit this branch or assume its
   ignored `.artifacts/` files follow you. Run `./agent help` first and inspect the new worktree's
   `git status --short --branch` and `./agent board` before a machine-wide lane.
2. Verify the inherited tree before changing code. Run these from the new worktree root, in order:

   ```sh
   ./agent verify-changed
   ./agent verify
   ./agent unsandboxed studio-smoke packages/ides/studio-tooling/studio-smoke/studio-real-app.test.ts studio-publication-handoff
   ```

   `verify` may reuse an exact-tree green record; report that as reuse, not a fresh run. The browser
   smoke owns its temporary project and Chrome instance. If the new worktree lacks generated parser
   output and a command says it cannot find `_gen_tao-parser/module`, run `./agent parser-gen`, then
   retry the original command. On any failure, read the `./agent` report and named log; distinguish
   a deterministic product failure from host contention. Do not increase a timeout as a diagnosis.
3. For a human feel test, run one mode at a time and stop Studio with Ctrl+C between trials:

   ```sh
   ./agent unsandboxed studio Apps/HNReader --preview-publication on
   ./agent unsandboxed studio Apps/HNReader --preview-publication off
   ```

   Compare repeated Tao code saves, Draw moves, Code-then-Draw transitions, iframe reload count,
   interaction state, errors, and whether the preview actually shows each final edit. The first
   compile always writes the marker in both modes; compare subsequent edits. This flag changes the
   `./agent unsandboxed studio` launch behavior only for browser Studio, as authorized by the
   feature request.

## Work to resume after baseline verification

1. **Measure the real edit-to-paint critical path in both modes.** Timestamp editor save,
   `StudioCompileCoordinator` queue/start/end, workspace parse/link/validate/codegen, generated
   file publication, Watchman notification, Metro transform/HMR send, iframe module application,
   React render, and paint. Record warm/cold runs, which `.tao` file changed, on/off flag, machine
   load, p50/p95, and exact iframe reload count. The older tooling report measured Langium parsing
   at roughly 14ms for a 37-file graph; it does **not** prove compilation or parsing dominates this
   loop. Do not pursue a new compiler language without a measured dominant CPU slice.
2. **Resolve the Code-to-Draw source-version mismatch.** During a preliminary publication-off smoke
   that performed a Code edit before a Draw move, the frame reported a 463-character source version
   while the active editor reported 485 characters, and Studio correctly rejected the Draw action
   as stale. The temporary tab-refresh workaround was removed. The committed smoke performs Draw
   before Code, so it proves both paths work but not that Code-then-Draw works. Reproduce with
   exact editor text, disk text, draft/save events, manifest source versions, and frame identity;
   compare default `on` with `off` before attributing this to the flag. Preserve stale-source and
   occurrence guards. Add a focused regression only after identifying the real cause.
3. **Implement the next measured, independently evaluable speed step.** Favor changed-file
   parse/compile and writing only genuinely changed generated modules when dependency and manifest
   semantics allow it. A changed `.tao` file can affect imported views, app roots, scenario/fixture
   manifests, and removed outputs; a naive timestamp skip can silently publish stale code. Explore
   Langium's in-memory incremental document updates and a dependency-aware invalidation graph in
   the existing `Workspace` before replacing the parser or compiler language. Consider a fast
   compile lane with deferred full validation only if diagnostics, rollback, and Draw source safety
   remain clear. Keep each step separately runnable for a feel test.
4. After new code, commit only reviewed task paths; run the focused test, `./agent
   verify-changed`, `./agent verify`, the real Metro smoke, and `./agent unsandboxed finalize`.
   Read and edit the successor branch's merge message when `finalize` asks. Review the full diff.
   The successor may propose landing only after the Developer has tried the visible behavior and
   explicitly authorizes landing. `./agent unsandboxed land` is the landing command.

## Results from `feat/studio-preview-latency-next`

Measured on 2026-09-29 on the Developer's machine under ordinary load; warm figures exclude the
first edit after launch. Run the harness with
`./agent unsandboxed studio-smoke packages/ides/studio-tooling/studio-smoke/studio-preview-latency.test.ts <run-id>`.

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
   can hit it too. Fixing it means patching Metro or reloading a cell that falls out of sync. The
   harness waits for cells to stop loading before its first edit and records every cell load in its
   failure diagnostics.
5. **Fast draw.** A toolbar toggle beside the mode button connects only the first scenario's preview,
   so no other cell has an iframe. It is the way to feel a single-preview Studio before deciding what
   the multi-cell matrix should cost.

## Next slices

Each slice is measured on its own with the latency harness, so each gain is attributable.

1. **Next slice**, in this order. The first two are fixes, because an edit that blanks the preview or
   throws cannot be timed. Steps 3, 6, and 7 are experiments: measure each and keep only the ones that
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
   5. Cache emitted modules per file, reusing a module whose source and dependencies did not
      change. Expected to save most of the 50ms emit phase on a one-file edit. It is compiler-side
      and independent of the other steps, so it can move or run in parallel.
   6. Let a refreshed design reach the running app. `RuntimeAppDefinition.design` caches the design once
      per app object (`TR-navigation-app.ts`), so today only a new app object, built when the app shell
      re-runs, shows a design edit.
   7. Re-render only what a design edit affects: a design store versioned per color and per style, with
      each element subscribing to the names its styles resolved. It builds on step 6, whose
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

## Completion bar

The successor can report completion when it has a committed, clean, independently runnable branch;
repeatable edit-to-paint numbers for both flag modes; a proven explanation and fix (or explicit
baseline classification) for Code-then-Draw; no accidental iframe reload on compatible edits;
source-action safety retained; focused, repository, and real Metro evidence for the exact tip; a
reviewed merge message and successful `finalize`; and a concise statement of the measured speed
gain and remaining dominant slice. Do not report test success or a stable marker as a measured
latency improvement. Landing remains a separate Developer decision.
