# Tao Roadmap

Open work only. Completed work is recorded under `Docs/Archive/`.

`Apps/WordFlower/README.md` owns the tranche mechanics language features are built through. The
language target and the program that reaches it — first MVP, then Revolution — are owned by
`Docs/Roadmap/Tao Revolution/`: `Decisions.md`
(what Tao becomes), `Process.md` (how the program proceeds, step by step), and `Coverage.md` (which
app feature and Tao test proves each capability).

The public MVP release has its own two lists: `Docs/MVP Roadmap/Agent MVP Roadmap.md` for the work
agents can execute without a new decision, and `Docs/MVP Roadmap/Developer MVP Roadmap.md` for the
judgments that are the Developer's. Both point back into this file and into `Docs/Roadmap/` for context.
[The staged release plan](<Docs/MVP Roadmap/Plan - Staged public releases.md>) owns five cumulative
public releases and supersedes older all-at-once launch scope. [The QA register](Docs/QA/README.md)
tracks on-demand coverage and evidence; later roadmap work is not automatically a release-1 blocker.

## Tao tooling performance

- [ ] Make the `tao` commands interactive-grade.
  - An uncached `tao check` of WordFlower takes 20-27s against 14ms of actual parsing; the causes are
    product defects that also set the floor of every verification lane. Measurements, root causes,
    the floor of the current stack, the phased fix, and the stack alternatives considered live in
    [`Docs/Roadmap/Tao tooling performance.md`](Docs/Roadmap/Tao%20tooling%20performance.md).

## Real-host testing

- [ ] Prove the additive [real-host testing prototype](Docs/Roadmap/Real-host%20testing%20prototype.md)
      on browser, simulator, and physical-device UI before proposing replacement of existing suites.

## Documentation cleanup

Two scoped passes over the repository's own records. Both are bookkeeping, not language work, and
neither blocks a tranche.

- [ ] Reorganize this roadmap by category and size
  - `Toward v1` and `Backlog` are flat lists that mix multi-week workstreams with one-line
    follow-ups, so nothing can be scanned for what to pick up next. Group entries by area and mark
    their rough size, keeping this file the single index of open work.
- [ ] Rework the rest of the markdown set
  - Part 6 of the simplification plan holds the per-page dispositions, the archive moves, and the
    document-map rewrite. Not started.
  - Covers `Docs/Spec/` and the remaining `Docs/Roadmap/` folders: archive the landed declaration-model
    records, de-duplicate the design-system open questions and the project-ID contract into one
    home each, settle the descriptor-identity draft, and write down the draft-suffix convention plus
    an authoritative map of what every document is for. An audit produced concrete per-file
    dispositions, but it predates the tranche 4 documentation edits, so re-verify each finding
    against the current files before acting on it.

## Subagent delegation

How agents in this repository delegate, and at which model tier. The guidance, the profiles, the
three harnesses' defaults, and the fan-out and second-opinion procedures have landed;
`Docs/Roadmap/Subagent delegation/Plan - Subagent delegation.md` owns what is left and the
calibration period that ends the "ask the Developer" clause.

- [ ] Decide whether the two fan-outs get saved `Workflow` scripts. The plan states the case against
      shipping them unasked: one harness only, unprovable without a supervised run, and a fan-out at
      September's scale is the machine-contention problem rather than a use of it.
- [ ] Benchmark a few representative tasks with and without delegation, once load-aware admission
      lands and the machine is quiet enough for the measurement to mean anything.
- [ ] End calibration when the delegation log says the routing table is right, then delete the
      "ask the Developer" clause and the three logging hooks.

## The Tao Revolution program

The language target is decided except for explicitly open or deferred questions recorded below and in
active workstream ledgers (`Docs/Roadmap/Tao Revolution/Decisions.md`); the steps below are
`Process.md`'s sequence as open work, in order. The dialect tranche is absorbed (`1 - Current` and
`2 - Next` are byte-identical, both `Tranche status: absorbed`), so everything written anywhere is
now written once, in the final dialect. Each step lands per the tranche definition of done: behavior
tests written in Tao, green in Current, for every construct introduced.

- [x] Rewrite `4 - Revolution` in the decided dialect (Process step 2)
  - WordFlower's Revolution tier re-expressed per `Decisions.md`, with the `Apps/Tao Future/` apps
    as sibling references.
  - `Apps/WordFlower/4 - Revolution/Open questions.md` carries the eleven questions the rewrite could
    not answer from `Decisions.md` — chiefly whether empty argument lists on containers are omitted
    (§9 says yes, §10's own example and the implementation say no, and `3 - MVP` inherits whichever
    wins), whether the visibility ladder is §1's two words or the implemented five, and whether
    `DynamicSelectionNav` is a decided nav kind. Its Q1, the authority cluster, is `R5` in
    `Docs/MVP Roadmap/Developer MVP Roadmap.md` rather than a new question. Three internal contradictions in
    `Decisions.md` were amended in the same change: `TabNav` → `SelectionNav`, the missing `overlay`
    presentation mode, and two parameter lists still written `Name is Type`.
  - `Coverage.md` rows for the tier remain unwritten; step 3 owns that file.
- [ ] Consolidate the `Apps/Tao Future/` apps to the decided dialect (Process step 3)
  - The three demos are design D's dialect today; align them to `Decisions.md` and complete
    `Coverage.md`'s rows during the port.
- [ ] Re-derive `3 - MVP` by omission (Process step 4)
  - Same spellings as Revolution, fewer capabilities. Includes the focused-writing mode (the
    `@tao/time` forcing feature); excludes automations; settles the authority-cluster scope
    question recorded in `Process.md`.
- [ ] Cut tranches from the Current ↔ MVP gap until Current ≡ MVP (Process step 5)
  - One tranche at a time per the definition of done; then expand to the Tao Future apps
    (Skillet first) and continue toward Revolution the same way. The previously noted gap
    capabilities — InstantDB, remote authorization semantics, richer data test controls, snapshots,
    SplitNav/windows, semantic design recipes, concurrency policy — are now scoped by
    `Coverage.md`'s tier column.
- [ ] Decide the runtime action-transaction contract
  - Deferred by the Developer on 2026-08-31. Settle whether root actions serialize, nested `do` calls join one
    transaction, state/data use private read-your-writes overlays, commits apply deltas to the latest
    snapshot through prepare/publish phases, and publish failures restore already-published resources.
  - Keep external effects explicitly non-rollbackable and do not treat the implemented Studio runtime
    behavior as a settled distributed-atomicity or automatic-retry language contract.
- [ ] Decide the semantic failure capture and replay contract
  - Deferred by the Developer on 2026-08-31. Settle the versioned artifact and domain-registry contract, domain
    compatibility and restore timing, credential and opaque-state exclusions, Studio cell-environment
    participation, and validation of loaded or pasted artifacts.
  - Automatic render-failure containment and guarded recovery are adopted independently. Do not treat the
    implemented `action-history`, `data`, `navigation`, `persisted-state`, or Studio replay behavior as an
    adopted language contract until this decision is resumed.
- [ ] Decide fixture-through-action result and handle semantics
  - Deferred by the Developer on 2026-08-31. Keep `through` setup fail-closed until result multiplicity, fixture-handle
    identity, transaction and rollback behavior, capture/replay, and test-harness seeding are settled.
  - Successful captured-fixture source writing is not evidence that the current runner can execute that
    setup path; do not infer the language contract from Studio's transient capture workflow.

## Toward v1

- [ ] Complete freehand UI sketching in Tao Studio
  - The implemented foundation covers scenarios, the generated root `@` package, and drawing and
    snapping free rectangles. The FS-D1–FS-D20 design and the ordered remaining data, variant,
    Tao-rendering, focus-in, and companion slices live in `Docs/Roadmap/Freehand UI sketching/`.
- [ ] Complete interaction and accessibility defaults
  - The implemented interaction-system foundation derives the outline, attention, names, state,
    commands, focus projection, and generated surfaces shared by keyboard and accessibility. The
    first accessibility extension makes native selectable-row focus enter Tao attention without
    activating selection. The keyboard plan's **Remaining decided implementation** ledger owns the
    rest of KEY-D1–D14; ranked accessibility slices live in
    `Docs/Roadmap/Accessible Tao apps/Plan - Accessible Tao apps.md`.
- [ ] Complete Tao Studio v2
  - The Studio v2 foundations replace Electron with Electrobun, split the browser client, add
    multi-project sessions and grouped scenario matrices, and establish the Tao-client strangler.
    Remaining integration and native-validation gates are tracked in the living ledger:
    `Docs/Roadmap/Tao Studio v2/Plan - Tao Studio v2.md`. The v1 plan is archived at
    `Docs/Archive/Plans/Plan - Tao Studio v1.md`. `packages/studio/README.md` owns how to run,
    inspect, and recover Studio.
  - A native phone as a Studio canvas is feasible for an explicitly instrumented Expo development
    build, limited for internal preview builds, and rejected as an unrestricted production-code path.
    The authenticated gateway, cross-process trust/revocation, Bonjour rediscovery, QR/deep-link
    fallback, LAN/cable selection, and device host are implemented in software. Real-device and
    physical-cable acceptance remain required. Exploration:
    `Docs/Archive/Explorations/Exploration - Native device as Studio canvas.md`.
  - A `./dev studio` session reloads its browser client but not its server, so a page can be rebuilt from
    sources the running server has not loaded and then call an endpoint that does not exist yet. The rebuild
    now says so, but the split remains, and `--native` reloads nothing at all. What a real one has to preserve
    -- the preview runtime, the session, and one revision both halves agree on -- is in
    `Docs/Roadmap/Tao Studio v2/Exploration - Studio server hot reload.md`.
- [x] Make `just verify-full` pass its simulated-user lane
  - Closed by `34132956`: the journey ran ten consecutive green normal-terminal runs and
    `studio-smoke-simulated-user` is an ordinary member of `VERIFY_FULL_GATES` again, with
    `VERIFY_FULL_SKIPPED` now empty. `just studio-smoke
    packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts` still runs it alone.
  - The editor-ownership, source-identity, canvas geometry, pointer-release, drag-one-in, and sketch
    transaction defects it found landed with focused coverage along the way.
  - Standing rule for whoever touches the stub preview next: do not widen `previewOriginPath`. The
    stub builds its identity by fetching `/api/protocol` and `/api/file`, which that six-endpoint
    allowlist deliberately keeps away from a preview origin; a real preview receives `path` and
    `sourceVersion` from Studio's own `postEditorSelection` message and knows its source ranges from
    the bundle it runs.
- [ ] Implement a drag-and-drop example app
  - Drag and drop stress-tests more UI assumptions at once than anything else: gesture ownership
    (loop vs cell vs scroll container), drag previews, declarable drop targets (including
    non-collection targets like a trash zone), cross-container moves against `(ordered)` store
    positions and `on move`, edge auto-scroll, and a drop as an authorized write (`can change`
    interposing). Build it over a Skillet-style grocery list (reorder within an aisle, drag across
    aisles, drag to "bought"), bridging RN Gesture Handler + Reanimated the way the card grid
    bridges FlashList. Deliberately an example app to implement, not a design decision to settle
    up front — findings feed back through the tranche process. Context:
    `Docs/Roadmap/Tao Revolution/Decisions.md` (§9 collections, §8 commands).
- [ ] Harden `tao test`
  - Richer failure reporting and broader runtime coverage. Test Apps already assert behavior in Tao.
  - Filters and watch have landed: path arguments and `--name <pattern>` select journeys, and
    `--watch` reruns the selected set on any change under the selected paths or the selected tests'
    project roots, serialized, until Ctrl-C. A rerun is still the whole one-shot pipeline — a
    cold compile and a Jest child — so it costs what `tao test` costs; making it sub-second is Phase 1
    item 7 and Phase 2 of `Docs/Roadmap/Tao tooling performance.md`, and the loop takes its run body
    as a dependency so a live-workspace or headless run replaces it without touching the loop.
  - The output half landed with the verification-orchestration plan: the Jest child streams live,
    `--output lines|quiet` defaults by terminal, a quiet run keeps the full output in
    `test-output.log` inside the run root, and `TAO_TEST_JOBS` bounds the whole command.
- [ ] Add the Tao design system MVP
  - Deterministic design declarations, tokens, semantic tokens, component recipes, source-level application, runtime lowering, and first diagnostics. Plan: `Docs/Roadmap/Add Tao design system MVP/`.
- [x] Implement `tao ship`
  - The command is a filesystem-only transaction: it may inspect Git for exact provenance but never
    stages, commits, tags, or pushes. It updates source-owned version metadata and the `ship` concern
    in the project's single `.tao-project/lock.jsonc` atomically, preserving the caller's index and
    refs. Local Xcode/App Store Connect and TestFlight (`--beta`) flows are implemented, as are
    compatible Expo-protocol updates and rollback over Tao's update service. Compatibility combines
    native runtime identity with canonical semantic schema identity and is checked against every
    supported binary. Unknown export-compliance status is omitted rather than asserted exempt.
    External App Store/TestFlight success, installed-binary OTA, signed/notarized Studio, and real
    device acceptance remain separately unverified. Plan and research: `Docs/Roadmap/Tao ship/`.
- [ ] Build the Tao Studio companion app
  - Decided 2026-09-02. A Tao-published phone app for an improved development experience, paired
    with Tao Studio, and for pre-release testing and feedback by members a developer invites to
    their project on the Dev Tao servers, each with an account there. A `tao ship` flag of its
    own delivers through it once it exists; plain `tao ship` and `--beta` are the store motions.
    The implementation plan now includes trivial LAN/relay pairing, the everyday native-device
    development loop, spoken and recorded user-story journeys, an iPad pen-and-touch workbench that
    edits real view definitions through typed source actions, invited tester feedback and visual
    proposals, permission-controlled forks, physical-device replay into regression tests, causal
    inspection/performance, multi-device stories, and same-state revision comparison. Design rules:
    project membership as the only remote access model, no public sharing surface, compiled bundles
    only, Studio/source as authority, and rare shell releases. Plan:
    `Docs/Roadmap/Tao Studio companion app/Plan - Tao Studio companion app.md`. Distribution context:
    `Docs/Roadmap/Tao ship/Plan - Beta distribution in one command.md`. Slice 1 implementation prompt
    (archived, landed): `Docs/Archive/Plans/Prompt - Implement Slice 1.md`. Slice 1 (pair and render one
    real device) is implemented: `packages/studio-companion-app`, the `tao-studio-device-v1` gateway and
    trust store in `packages/studio`, `TR.Studio.DeviceHost`, the workbench Device popover, and
    `just studio-companion-install`; contract and proof record in
    `Docs/Roadmap/Tao Studio companion app/Slice 1 - Device protocol and trust.md`. Slice 2 (everyday
    development canvas) is partly implemented: a reconfigure reaches the device, selection works both
    ways, Studio can capture a device's runtime state, the phone's console is mirrored into Studio, and
    a device loads the scenario rather than the canvas frame. Its acceptance is not complete — running
    one journey on the device is a fork rather than a task, and capture/restore has no UI on any
    surface. Status, what was proven live, and the open decisions are in
    `Docs/Roadmap/Tao Studio companion app/Slice 2 - Everyday development canvas.md`. The Developer deferred
    the entire record-and-replay Slice 4 until after the public MVP on 2026-09-22; its design
    details remain open and its acceptance is not an MVP release gate.
- [x] Add `tao create` project scaffold
  - Shipped 2026-09-04: `tao create "<description>"` writes the canonical project layout, id, and
    starters. Contract: `Docs/Spec/Tao Packages.md`. Direction and open follow-ups:
    `Docs/Roadmap/Tao create.md`.
- [ ] Implement secrets
- [ ] Polish the IDE MVP
  - Syntax, diagnostics, formatting, source actions, go-to-definition, and references remain the IDE
    surface. Tao Studio now owns the richer live-preview product rather than duplicating it inside the
    IDE; finish the browser proof and capture workflow in the Studio workstream above.
- [ ] Prove the iCloud datasource on devices
  - The snapshot-family `ICloud` provider landed with its native Expo module and ship
    entitlements; see the "ICloud" section of `Docs/Roadmap/Multiple datasources/Plan - Multiple
    datasources.md` for the boundary, its limits, and the two-device live acceptance still owed.
- [ ] Settle the granular-write family's open questions and prove CloudKit on devices
  - The family's runtime machinery (change-sets, fold, bridge, conformance suite) and a `CloudKit`
    provider over `CKSyncEngine` landed as a stab under three stated assumptions; see the
    "CloudKit" section of `Docs/Roadmap/Multiple datasources/Plan - Multiple datasources.md`. Open
    questions 1, 2, and 5 in `Docs/Roadmap/Multiplayer sync.md` need the Developer's answers before the fold
    is more than a working assumption.
- [ ] Finish the multiple-datasources follow-ups
  - Binding several datasources to one app landed: a datasource names the collections it stores, an
    app binds a set and derives a member where it is bound with `with`, and `reference` links rows across
    stores by unique value. `Docs/Roadmap/Multiple datasources/Plan - Multiple datasources.md` holds
    the decisions and its revision note what remains: a reference's `missing` and `error` readings
    have no forcing journey until datasource fault injection lands, the release override is scoped by
    configuration slot rather than keyed by datasource, and whether `Data` should become an ordinary
    patchable slot is open.
- [ ] Widen the HTTP datasource
  - The query-driven `Http` datasource landed with `Apps/HNReader`; see the "Http" section of
    `Docs/Roadmap/Multiple datasources/Plan - Multiple datasources.md` for the settled design and
    its deferred list — offline persistence across launches, remote writes, a user-triggered
    refresh spelling, cache eviction and retry, and per-feed row provenance. Per-entity datasource
    scoping moved to the multiple-datasources plan above.
- [ ] Bridge React Native and Expo APIs into Tao
  - Design how a native API becomes a Tao binding before building more of them: whether bindings can
    be generated from TypeScript type definitions or published documentation, driven by per-API
    configuration through one bridging engine, or must stay hand-written — optimizing for the least
    work per additional API. Settle whether React Native or Expo is the primary target, or whether
    both stay first-class. Then prove the design on `Vibration` and `Share` (React Native core) and
    `Clipboard`, `Haptics`, and `Location` (Expo), chosen to span fire-and-forget, async-with-result,
    and permission-gated fallible shapes. `Haptics` and `Vibration` overlap deliberately: decide
    whether one capability may ever expose two bindings.
  - Reference: the `reference/rn-expo-bridge-drafts` branch holds 47 unreviewed draft modules
    covering both targets, each using one pattern worth evaluating — a driver type, a test-driver
    escape hatch, and lazy native `require()`. It is reference only and does not merge; its runtime
    entry point conflicts structurally with the current domain-split `TR.ts`.
- [ ] Finish shell completions for the Tao CLI
  - `tao complete <shell>` and `tao completion install` ship for bash, zsh, and fish through
    `@bomb.sh/tab`. Remaining: PowerShell installation, which the library generates but the installer
    does not place, and per-argument completions for app names, paths, and test patterns.
- [ ] Build the enforcement and diagnostics surface
  - A hosted gate that runs `verify` on pushed work. The diagnostics half is done: `tao check`,
    `tao fix`, and `tao fmt` report syntax, linker, and validator diagnostics with file, line,
    column, severity, and the underlined source line, and fail the command on any error. Every
    lexer and parser syntax error is now stated in Tao's own words rather than Chevrotain's, a
    report shows the line above the mistake and at most three errors per file, and an error at end
    of file is positioned at the end of the source instead of `NaN:NaN`. What remains under this
    bullet is the hosted gate itself. Brief:
    `Docs/Roadmap/Enforcement and diagnostics surface/`. Its repository claims were verified against
    a much older commit, so re-check them before planning.
- [ ] Complete canonical app and v1 hardening
  - Build WordFlower end to end, close gaps, tighten diagnostics and docs, remove stale drift, and validate `verify`.

## Post-MVP targets

The Developer-selected [post-MVP target inventory](Docs/Roadmap/Post-MVP%20target%20inventory.md)
records the next server-side, data, integration, operations, cross-app, agent, and host-surface
capabilities. Its item IDs preserve the original selection; the list does not imply priority or
settled language syntax.

- [ ] Turn a photograph of a paper UI sketch into editable Tao Studio views
  - A person draws one or more views on paper and photographs them. An agent using Tao skills and
    Studio tools identifies the drawn view boundaries and elements, then adds matching free rectangles
    to Studio sketch views. The person reviews the result and continues with Studio's ordinary tools:
    snap chosen rectangles into Tao layout, or keep drawing and editing the free sketch. Import does
    not snap or bind elements on the person's behalf. The target and its first acceptance journey are
    in `Docs/Roadmap/Freehand UI sketching/Plan - Freehand UI sketching.md`.

## Backlog

Product and codebase backlog, unordered.

- [x] Move Tao Studio to be an ordinary Tao app (landed 2026-09-22)
  - The browser client, its code editor, and its local-InstantDB dev stack moved to `Apps/Tao Studio/`,
    an app-local editor package, and new `tao-cloud`/`providers/instantdb` packages. No language or
    product decision is needed; it is a location move. Plan:
    `Docs/Archive/Plans/Tao Studio as a Tao app/Plan - Tao Studio as a Tao app.md`.
- [ ] Deferred past MVP from the second simplification pass (2026-09-22)
  - A curated runtime SDK, `@tao/runtime/sdk` for app builders and `@tao/runtime/sdk/providers` for
    provider authors, with a surface snapshot test and a gate that app TypeScript imports only the
    SDK; today app code imports `@tao/runtime` directly, which every `TR` member makes public.
  - A vocabulary pass on the word "host", which names the machine in host lanes and an embedding
    program in product host and device host, across the repository.
  - Recorded with the run in `Docs/Archive/Plans/Repository simplification 2/`.
- [ ] Finish the cleanups the simplification plan deliberately deferred
  - The program itself is complete and recorded in
    `Docs/Archive/Plans/Repository simplification/Plan - Repository simplification.md`. Each item
    below was judged worth doing but not worth widening that plan's diff:
    - **No disabled state on the entry file in Studio's file tree.** The old `protectedPath` option
      went with the legacy DOM tree, where it only ever disabled buttons in a section that was never
      displayed. The rule itself is enforced server-side by the entry-file guards in
      `packages/studio/studio-src/session/StudioFileOperations.ts`, which reject renaming or deleting
      the active app entry file on the only path a client can reach. What is missing is the affordance: the tree offers the
      action and the server refuses it, instead of not offering it.
    - **Raw `Error`s handed to a promise rejection.** `repo-lint` ratchets them through
      `CONVENTION_RULES.rawError` per allowlisted site rather than per count, so the set of files
      cannot grow while the sites inside a listed file remain. Most reach a Tao author exactly as a
      throw would; the test fixtures among them do not. Heaviest in
      `studio-src/client/StudioMatrixView.ts`.
    - **Already-typed `throw new Errors.*` guards in the studio files** that would collapse to a
      one-line `Assert.input` now that `Assert` narrows the expression it is given. Invisible to
      repo-lint because they are already typed; purely a readability win.
- [ ] Finish simulation mode in Tao Studio
  - The versioned cell matrix, viewport/network contract, provider overlay, exact data snapshot codec,
    fixture/scenario metadata, generated-host provider wiring, and captured-fixture save exist.
    The capture review is proven: the server proposal returns the exact diff without writing, the client
    shows it before applying, and cancel or a failed proposal applies nothing.
  - The browser proof of observable delay, offline, declared failure, and cross-cell isolation exists
    as `packages/ides/studio-tooling/studio-smoke/studio-network-simulation.test.ts`, driven through
    the Environment and scenario panel. It found and now guards a defect where a runtime update
    repeating the applied revisions rebuilt a cell's provider overlay without a remount.
  - That journey is the `studio-network-simulation` gate in `verify-full`.
  - Two leads the diagnosis left open: `setMatrixManifest` emits `preview-manifest-changed` without
    checking the revision moved, which is the likely producer of the repeated update; and
    `resetFromRecovery()` reconfigures a datasource without a remount, which would strand live
    queries the same way in a production app if nothing else remounts them. Neither is confirmed.
  - Loading captured state in tests stays deferred with the fixture-through-action result and handle
    semantics (`Docs/Spec/Tao Studio.md`).
- [ ] Improve the imports and exports structure. Decide whether namespaces are used commonly, and whether types and values can be exported together from one default export.
  - Part 1 of the simplification plan removed the dead subpath exports and de-exported the
    internal-only symbols; the export/rename sweep that answers the namespace question is Part 5.1
    of that plan, which also records the answer in `packages/AGENTS.md`.
- [ ] Review all tests: remove unnecessary surfaces and overlaps, favor e2e coverage of the underlying packages, and justify each remaining test.
  - Partly done through the simplification plan: Test Apps went 17 folders to 11 with every
    journey kept, and the jest-e2e migration rule is now in `packages/AGENTS.md`. The TR, studio,
    pipeline, and dev/CLI passes in Parts 2.2 to 2.5 remain.
- [ ] Finish project-root ownership across tooling
  - Studio now selects a folder owning exactly one project definition, scopes its workspace and package
    lookup to that root, and runs multiple projects as separate concurrent sessions. Remaining: have the
    IDE extension manage one workspace per project folder and stop requiring a Git repo at the project root.
  - One Studio feature still needs Git: beta ship finds the `tao` launcher through `Repo.getRoot`
    (`runBetaShip` in `packages/ides/studio/studio-src/StudioServer.ts`), which throws outside a Git
    worktree. Project discovery, scoping, and compile already fall back to a filesystem walk. The IDE
    extension has no project-root finder at all: each VS Code workspace folder becomes one
    language-server root (`ide-extension-src/extension/workspace-server-roots.ts`), so it should reuse
    Studio's `resolveStudioProjectRoot` once that moves somewhere both can import.
- [ ] Implement styling, and then all of `Docs/Spec/Tao Layout and UI.md`.
  - Declaration-level style defaults are decided (R9, 2026-09-22, `Decisions.md` §13): the header
    clause is the declaration's public defaults, a caller's clause replaces them, the root render's
    own clauses are private, and `none` clears a clause:
    ```tao
    view Foo() [pad 12, bg red] {
       render Text("Foo")
    }

    render Foo()                  // red, padded
    render Foo() [pad 0, bg none] // caller clears the declared default
    ```
- [ ] Complete the declared concurrency policy from `Decisions.md` §8
  - Foreign `runs latest` is implemented and adopted: it finishes the running call and retains only the
    newest waiting call. Remaining work includes `runs single`, policy keying, the `.Running` surface, and
    any separately decided cancellation contract.
  - Keep this separate from the AI-in-apps work, which consumes concurrency policy but does not decide it.
    Context: `Docs/Roadmap/AI in Tao apps.md`.
- [ ] Change the argument order of `ValidationContext.error` and its siblings.
  - Part 5.2 of the simplification plan: the few call sites that pass inline template literals
    rather than factory-produced messages need converting first.
    Land it before or with that plan's validator rename slice.
- [ ] Clean up the TR package: inter-dependencies, structure, and a slow pass simplifying each file.
  - The dead-surface pass has landed (Part 1 of the simplification plan): the web-history module,
    `TR.Alert`, `TR.IsEmpty`, the deprecated `TR.Enum` overload, and `setTestStatus` are gone. The
    structural work is Part 3.2 of that plan; The `TR.Errors` disposition is decided and shipped: it is the
    consolidated runtime error surface.
- [ ] Remove magical strings.
  - Part 3.1 of the simplification plan owns the cluster with real breakage potential: Studio's
    route table, session-protocol DTOs, and guards.
- [ ] Improve utility function usage, preferring grouped helpers over many free imports.
  - Partly done through the simplification plan: `@shared/test` gained the deferred, waiter,
    terminal, module-mock, and clock helpers, and the runtime gained memory data helpers. The
    per-package adoption and the grouped-helpers pass in Part 5.7 remain.
- [ ] Apply the named-const export pattern across the repo, then rename modules to match their main export in one coordinated sweep.
  - Part 5.1 of the simplification plan, one commit per package, Note repo-lint's convention checks do **not**
    cover export naming or the module-basename-to-export correspondence, so this sweep needs its own
    check if it is to stay swept.
- [ ] Rename `gen` helper properties to capitalized names, and stop `fmt` from breaking `gen\`…\`` onto the next line.
- [ ] Add generic compiled test declarations.
- [ ] Enable over-the-network dev app running for iOS devices
  - Start with the authenticated Expo-development-build Studio renderer described in the native-device
    exploration; require foreground pairing, local-network permission, revision recovery, revocation,
    and a real-iPhone validation pass. Do not add an unrestricted production remote-code path.
- [ ] Deep links and navigation persistence.
- [ ] Work through the developer-environment upgrade ledger.
  - Agents record and deduplicate material findings as they work; the current backlog, incoming
    branch fixes, evidence, and acceptance criteria live in
    `Docs/Roadmap/Developer environment upgrades.md`; addressed entries move to
    `Docs/Roadmap/Developer environment upgrades archive.md`. The `devenv-upgrades` skill owns how
    the next set is selected and archived.
- [ ] Decide how parallel agents share one machine.
  - What to share, what to serialize, what is duplicated per worktree for no reason, and where a
    single orchestrator does and does not help live in
    `Docs/Roadmap/Parallel agents on one machine.md`.
- [ ] Let Codex drive Tao Studio on its own, for testing and for developing Studio itself.
- [ ] Shorten the TUI tests' main timer from 0.5 s to 0.1 s.

### Smaller follow-ups

- Parser/validator: remove the last capitalized grammar keywords. Parse restoration's `Restore` and
  `Exclude` through identifier seams and validate their exact spellings, preserving public source
  syntax while allowing those names elsewhere. Update restoration fixtures and generated-grammar
  coverage to complete the keyword rule in `packages/AGENTS.md`.
- Formatter: keep standalone comments attached to the following top-level declaration when separating with blank lines.
- Formatter: drop redundant `render` keywords once the language makes `render` optional in view bodies.
- Compiler: add codegen tracing and source maps when needed.

## Records

- `Apps/WordFlower/README.md` — the implementation process and the four app tiers.
- `Docs/Roadmap/AI in Tao apps.md` — AI-in-apps exploration with recorded direction: the `generate` surface, platform-provided models first, the `Sees` prompt boundary, scripted-model testing, and the implementation sequence.
- `Docs/Roadmap/Authority.md` — authority exploration with open dialogue: lowering the decided access/publish/secrets model into the provider's own rule language, remote authorization semantics for `through` grants, the remote-refusal contract, redaction, and the two-account proof app over InstantDB.
- `Docs/Roadmap/Deterministic simulation.md` — deterministic whole-app simulation exploration: the determinism boundary, the scripted-world harness over the Studio cell pipeline, schema-derived property testing, journal-based replay and time-travel, and design rules across cells.
- `Docs/Roadmap/Device capabilities.md` — device-capabilities exploration for the RN/Expo bridge item: the config-through-one-engine recommendation, permission case sets, outcome delivery into `when do`, scripted capability drivers, and the proving sequence.
- `Docs/Roadmap/Tao ship/Plan - Beta distribution in one command.md` — the implementation record for `tao ship [path] --app <App>`, local Xcode/App Store/TestFlight operation, resumable lifecycle, and compatible OTA (its EAS and Android material is retained only as dated research), plus the still-open hosted-runtime, schema-migration, and commercial design folded in from the retired `Tao ship.md` exploration.
- `Docs/Roadmap/Multiplayer sync.md` — multiplayer-sync exploration with open dialogue: the typed change-set ledger, the granular-write provider family and its conformance contract, offline queue and late-refusal semantics, fieldwise-latest convergence, presence, and the slice sequence.
- `Docs/Roadmap/Freehand UI sketching/` — the FS-D1–FS-D20 design record folded into reconciled
  product stories and hand-authored wireframes, and the ordered implementation plan (with the
  Figma-at-home strides and canvas-first design mode work folded in) for Studio-owned free
  rectangles, generated `@/studio` views, snapping to Tao flow, data, variants, focus-in, and the
  PencilKit-backed companion; its approved review-and-refinement follow-on covers interaction
  recording, prompted scenario expansion, collaborative visual review, and design conformity.
- `Docs/Roadmap/Keyboard driven apps/` — the interaction system design (KEY-D1–D14) and
  implementation record. The T1–T5 core ships the outline, attention reducer, `scene`, shell view
  with a rendered nav, configured commands, mounted-node narrowing, and four generated surfaces.
  Its plan owns the complete remaining-decision ledger, including the adapter and surface tail and
  the App Intents/native-menu boundary deferred for lack of a native iOS build path.
- `Docs/Roadmap/Accessible Tao apps/Plan - Accessible Tao apps.md` — the ranked accessibility
  program, mainstream assistive-technology compatibility baseline, research watchlist, and first
  selectable-row focus-intake slice.
- `Docs/Roadmap/Deferred Tao language decisions.md` — the LANG-001..036 deferred-decision inventory.
- `Docs/Roadmap/UI screenshot archive/Plan - UI screenshot archive.md` — the decided product ×
  platform × size matrix, the private submodule store, and the slices for an append-only history of
  UI screenshots.
- `Docs/Roadmap/Add navigation and routing MVP/Follow-ups - …md` — unimplemented navigation work and `DEF-NAV-*` deferrals.
- `Docs/Archive/Plans/Repository foundations/` — the package, automation, and language-service foundation record.
- `Docs/Archive/Plans/Verification orchestration/` — the completed verification-orchestration program: one
  dependency-aware, duration-informed scheduler for every test and verification lane, the live dashboard
  for humans on `check`/`verify`/`verify-full`, the file-backed quiet output contract for agents, and
  `verify-full`'s Studio lanes parallelized on per-worker resources.
- `Docs/Archive/Plans/Repository simplification/` — the completed simplification program: dead-code and API removals with named surviving proofs, the typed error surface and its ratchets, Typir's retirement onto the structural `Type`, the Test App consolidation, and the tooling and gate simplification.
- `Docs/Archive/Plans/Repository simplification 2/` — the completed second simplification pass: instruction and documentation budgets, pattern conformance, and the package restructure into role groups (`shared`, `compiler`, `language`, `apps`, `providers`, `ides`, `ai`, `cli`, `services`, `testing`), landed through a dedicated `./agent` front door. `Docs/Archive/Plans/Tao Studio as a Tao app/Plan - Tao Studio as a Tao app.md` carries forward the one deferred slice its plan did not start, and has since landed.
- `Docs/Archive/Reports/Code cleanup spike/Report.md` — the completed cleanup spike and R1–R13 rulebook.
- `Docs/Archive/Reports/September squash-merge remediation.md` — the September squash-merge audit's 183
  tracked findings (implemented) and the follow-up branch's open items, including a second,
  independent findings list that is cross-checked but not yet triaged.
- `Docs/Archive/` — frozen records of completed work.
