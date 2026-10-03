# Studio preview speed continuation

Handoff written 2026-10-03 for the successor of `feat/studio-preview-latency-next`. Start a new
`feat/` branch and worktree from that branch's tip, not from `main`. This document owns the Studio
preview latency project; [Decisions - Project folder layout](<Tao CLI workflows/Decisions - Project folder layout.md>)
owns the project folder layout work this project also carries. [Tao tooling performance](<Tao tooling performance.md>)
holds broader language and tooling measurements; do not treat older CLI benchmarks as edit-to-paint
timings.

## Current state

1. The branch carries Next slice steps 1–4 (`709a58700`, `b49ea2df3`, `e36cdd8df`, `25369076f`),
   then a `WIP: route project .tao state through ProjectLocal` commit, then this handoff. The WIP
   commit is an untested first pass at the folder layout and fails the tests it has not updated;
   the decisions document's "Implementation state" says what it does and does not do.
2. Neither `./agent verify` nor `finalize` has run on this tip; steps 1–4 ran their focused tests
   and, where the step says so, a real Metro smoke. The branch is unlanded, and
   landing waits for the Developer's explicit authorization.
3. The edit-to-paint harness runs with
   `./agent unsandboxed studio-smoke packages/ides/studio-tooling/studio-smoke/studio-preview-latency.test.ts <run-id>`.
   Under the machine's usual load (load average near 100 during this branch) timings are
   indicative only; record the load beside every number.

## The work, in order

1. **First, together:** preview activation (below, and Next slice step 5) and the project folder
   layout (the decisions document). They meet at `.tao/local/studio/session.json`, where the active
   previews persist, so build the layout's `local/` path before or with the activation's
   persistence.
2. The rest of step 5: the activation gate, the lagging-cell watchdog, then the sequential-loading
   measurement.
3. Next slice steps 6–8, each measured on its own.
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
   scenario name and a short hint to activate it, and has no iframe, so it loads no bundle and
   registers no HMR client.
2. **The toggle** is an icon-only button in each cell's header: a tiny lightning bolt. Active, the
   bolt is filled a subtle yellow; inactive, it is a grey outline with no fill. It carries
   `aria-pressed`, and its label and tooltip read "Activate preview" or "Deactivate preview".
   Deactivating removes the cell's iframe.
3. **Naming in code.** `StudioActivePreview` (`studio-src/client/StudioApp.ts:139`) already means
   the selected cell, so the new set needs another name, such as live previews; keep "Activate" as
   the words the developer sees.
4. **Persistence.** The set of activated cell ids (`cellId`, `StudioApp.ts:143`) per app lives in
   `.tao/local/studio/session.json`, read and written by the Studio server: the handshake carries
   it, and the client reports each change. An id no longer in the manifest is dropped. The
   selected cell (`StudioApp.ts:133`) and editor tabs (`StudioEditorTabs.ts:147`) move into the same
   file under the layout decision.
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
migration and tests; each of steps 5–8 measured, kept or dropped on its numbers; source-action
safety retained; focused, repository, and real Metro evidence for the exact tip; a reviewed merge
message and successful `finalize`; and a concise statement of the measured gain and the remaining
dominant slice. Do not report test success as a measured latency improvement. Landing remains a
separate Developer decision.
