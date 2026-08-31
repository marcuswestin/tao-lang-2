# Tao Roadmap

Open work only. Completed work is recorded under `Docs/Roadmap/Archive/`.

Language features are built in tranches through the WordFlower app family: decisions are settled in
`Apps/WordFlower/2 - Next` and implemented into `1 - Current` slice by slice.
`Apps/WordFlower/README.md` owns the tranche mechanics. The language target and the program that
reaches it — first MVP, then Revolution — are owned by `Docs/Roadmap/Tao Revolution/`: `Decisions.md`
(what Tao becomes), `Process.md` (how the program proceeds, step by step), and `Coverage.md` (which
app feature and Tao test proves each capability).

## Ro STACK

- [x] Rename UI to Scene
- [x] Upgrade all dependencies of e.g expo/react-native/expo-router/etc
- [ ] Think about making Tao apps easily keyboard driven.
- [ ] Deep links and navigation persistence
- [ ] Enable Codex to interact with studio on its own for testing and development of it.
- [ ] Instructions to keep track of all dev env/process issues along the way, and then list them when done implementing with suggested solutions.
  - [ ] Ditto for if there are clear improvement opportunities that you discover while working or implementing. In short, we want to always improve our dev env/process to be the best supportive env for us, tao devs and agents, as we can, and always improving as we go.

## Documentation cleanup

Two scoped passes over the repository's own records. Both are bookkeeping, not language work, and
neither blocks a tranche.

- [ ] Reorganize this roadmap by category and size
  - `Toward v1` and `Ro's stack` are flat lists that mix multi-week workstreams with one-line
    follow-ups, so nothing can be scanned for what to pick up next. Group entries by area and mark
    their rough size, keeping this file the single index of open work.
- [ ] Rework the rest of the markdown set
  - Covers `Docs/Spec/` and the remaining `Docs/Roadmap/` folders: archive the landed declaration-model
    records, de-duplicate the design-system open questions and the project-ID contract into one
    home each, settle the descriptor-identity draft, and write down the draft-suffix convention plus
    an authoritative map of what every document is for. An audit produced concrete per-file
    dispositions, but it predates the tranche 4 documentation edits, so re-verify each finding
    against the current files before acting on it.

## The Tao Revolution program

The language target is decided except for explicitly open or deferred questions recorded below and in
active workstream ledgers (`Docs/Roadmap/Tao Revolution/Decisions.md`); the steps below are
`Process.md`'s sequence as open work, in order. The dialect tranche is absorbed (`1 - Current` and
`2 - Next` are byte-identical, both `Tranche status: absorbed`), so everything written anywhere is
now written once, in the final dialect. Each step lands per the tranche definition of done: behavior
tests written in Tao, green in Current, for every construct introduced.

- [x] Cut and implement the dialect-migration tranche (Process step 1)
  - Closed. `Docs/Roadmap/Archive/Dialect migration tranche/` holds the brief and prompt.
- [x] Implement the focused writing tranche
  - Closed. `Docs/Roadmap/Archive/Focused writing tranche/` holds the brief and prompt.
- [ ] Rewrite `4 - Revolution` in the decided dialect (Process step 2)
  - WordFlower's Revolution tier re-expressed per `Decisions.md`, with the `Apps/Tao Future/` apps
    as sibling references.
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
  - Deferred by Ro on 2026-08-31. Settle whether root actions serialize, nested `do` calls join one
    transaction, state/data use private read-your-writes overlays, commits apply deltas to the latest
    snapshot through prepare/publish phases, and publish failures restore already-published resources.
  - Keep external effects explicitly non-rollbackable and do not treat the implemented Studio runtime
    behavior as a settled distributed-atomicity or automatic-retry language contract.
- [ ] Decide the semantic failure capture and replay contract
  - Deferred by Ro on 2026-08-31. Settle the versioned artifact and domain-registry contract, domain
    compatibility and restore timing, credential and opaque-state exclusions, Studio cell-environment
    participation, and validation of loaded or pasted artifacts.
  - Automatic render-failure containment and guarded recovery are adopted independently. Do not treat the
    implemented `action-history`, `data`, `navigation`, `persisted-state`, or Studio replay behavior as an
    adopted language contract until this decision is resumed.
- [ ] Decide fixture-through-action result and handle semantics
  - Deferred by Ro on 2026-08-31. Keep `through` setup fail-closed until result multiplicity, fixture-handle
    identity, transaction and rollback behavior, capture/replay, and test-harness seeding are settled.
  - Successful captured-fixture source writing is not evidence that the current runner can execute that
    setup path; do not infer the language contract from Studio's transient capture workflow.

## Toward v1

- [ ] Complete Tao Studio v2
  - The Studio v2 foundations replace Electron with Electrobun, split the browser client, add
    multi-project sessions and grouped scenario matrices, and establish the Tao-client strangler.
    Remaining integration and native-validation gates are tracked in the living ledger:
    `Docs/Roadmap/Tao Studio v2/Plan - Tao Studio v2.md`. The v1 plan is retained only as a historical
    ledger. `Docs/Spec/Tao Studio Development.md` owns how to run, inspect, and recover Studio.
  - A native phone as a Studio canvas is feasible for an explicitly instrumented Expo development
    build, limited for internal preview builds, and rejected as an unrestricted production-code path.
    No native transport is implemented and a real-iPhone spike remains required. Exploration:
    `Docs/Roadmap/Tao Studio v1/Exploration - Native device as Studio canvas.md`.
- [ ] Implement a drag-and-drop example app
  - Drag and drop stress-tests more UI assumptions at once than anything else: gesture ownership
    (loop vs cell vs scroll container), drag previews, declarable drop targets (including
    non-collection targets like a trash zone), cross-container moves against `(ordered)` store
    positions and `on move`, edge auto-scroll, and a drop as an authorized write (`can change`
    interposing). Build it over a Skillet-style grocery list (reorder within an aisle, drag across
    aisles, drag to "bought"), bridging RN Gesture Handler + Reanimated the way the card grid
    bridges FlashList. Deliberately an example app to implement, not a design decision to settle
    up front — findings feed back through the tranche process. Context:
    `Docs/Roadmap/Tao Revolution/Decisions.md` (§9 collections, §8 intents).
- [ ] Harden `tao test`
  - Filters, watch and CI output, richer failure reporting, and broader runtime coverage. Test Apps already assert behavior in Tao.
- [ ] Add the Tao design system MVP
  - Deterministic design declarations, tokens, semantic tokens, component recipes, source-level application, runtime lowering, and first diagnostics. Plan: `Docs/Roadmap/Add Tao design system MVP/`.
- [ ] Add `tao create` project scaffold
  - New app folder, minimal Tao app, default package layout, docs, dev and test scripts, and an immediate open-and-run path.
- [ ] Implement secrets
- [ ] Polish the IDE MVP
  - Syntax, diagnostics, formatting, source actions, go-to-definition, and references remain the IDE
    surface. Tao Studio now owns the richer live-preview product rather than duplicating it inside the
    IDE; finish the browser proof and capture workflow in the Studio workstream above.
- [ ] Widen the HTTP datasource
  - The query-driven `Http` datasource landed with `Apps/HNReader`; see
    `Docs/Roadmap/HTTP Datasource/Overview - HTTP datasource.md` for the settled design and its
    deferred list — offline persistence across launches, remote writes, per-entity datasource
    scoping, a user-triggered refresh spelling, cache eviction and retry, and per-feed row
    provenance.
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
  - A hosted gate that runs `verify` on pushed work, and a real diagnostic rendering for `tao check`,
    which today only reports canonicalization. Brief:
    `Docs/Roadmap/Enforcement and diagnostics surface/`. Its repository claims were verified against a
    much older commit, so re-check them before planning.
- [ ] Complete canonical app and v1 hardening
  - Build WordFlower end to end, close gaps, tighten diagnostics and docs, remove stale drift, and validate `verify`.

## Ro's stack

Product and codebase backlog, unordered.

- [ ] Finish simulation mode in Tao Studio
  - The versioned cell matrix, viewport/network contract, provider overlay, exact data snapshot codec,
    fixture/scenario metadata, generated-host provider wiring, and captured-fixture save exist.
    Remaining: review the exact server-produced capture diff, load captured state in tests, and finish browser
    proof of observable delay, offline, failure, and cross-cell isolation. Viewport/network controls and
    reactive per-cell Scheme resolution exist; the remaining proof is the external browser interaction gate.
- [ ] Improve the imports and exports structure. Decide whether namespaces are used commonly, and whether types and values can be exported together from one default export.
- [ ] Review all tests: remove unnecessary surfaces and overlaps, favor e2e coverage of the underlying packages, and justify each remaining test.
- [ ] Finish project-root ownership across tooling
  - Studio now selects a folder owning exactly one project definition, scopes its workspace and package
    lookup to that root, and runs multiple projects as separate concurrent sessions. Remaining: have the
    IDE extension manage one workspace per project folder and stop requiring a Git repo at the project root.
- [ ] Implement styling, and then all of `Docs/Spec/Tao Layout and UI.md`.
  - Consider declaration-level style defaults that a caller may override, and settle how the two
    merge — in particular how a caller clears a default rather than adding to it:
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
- [ ] Clean up the TR package: inter-dependencies, structure, and a slow pass simplifying each file.
- [ ] Remove magical strings.
- [ ] Improve utility function usage, preferring grouped helpers over many free imports.
- [ ] Apply the named-const export pattern across the repo, then rename modules to match their main export in one coordinated sweep.
- [ ] Rename `gen` helper properties to capitalized names, and stop `fmt` from breaking `gen\`…\`` onto the next line.
- [ ] Add generic compiled test declarations.
- [ ] Enable over-the-network dev app running for iOS devices
  - Start with the authenticated Expo-development-build Studio renderer described in the native-device
    exploration; require foreground pairing, local-network permission, revision recovery, revocation,
    and a real-iPhone validation pass. Do not add an unrestricted production remote-code path.

### Smaller follow-ups

- Formatter: keep standalone comments attached to the following top-level declaration when separating with blank lines.
- Formatter: drop redundant `render` keywords once the language makes `render` optional in view bodies.
- Compiler: add codegen tracing and source maps when needed.
- Dev loop: watch resolved relative import roots outside the selected app folder.

## Records

- `Apps/WordFlower/README.md` — the implementation process and the four app tiers.
- `Docs/Roadmap/AI in Tao apps.md` — AI-in-apps exploration with recorded direction: the `generate` surface, platform-provided models first, the `Sees` prompt boundary, scripted-model testing, and the implementation sequence.
- `Docs/Roadmap/Authority.md` — authority exploration with open dialogue: lowering the decided access/publish/secrets model into the provider's own rule language, remote authorization semantics for `through` grants, the remote-refusal contract, redaction, and the two-account proof app over InstantDB.
- `Docs/Roadmap/Deterministic simulation.md` — deterministic whole-app simulation exploration: the determinism boundary, the scripted-world harness over the Studio cell pipeline, schema-derived property testing, journal-based replay and time-travel, and design rules across cells.
- `Docs/Roadmap/Device capabilities.md` — device-capabilities exploration for the RN/Expo bridge item: the config-through-one-engine recommendation, permission case sets, outcome delivery into `when do`, scripted capability drivers, and the proving sequence.
- `Docs/Roadmap/Tao ship.md` — ship exploration with open dialogue: the derived publish pipeline (build/sign/submit/OTA), variants as environments, the derived hosted runtime, the schema-migration option space, deploy configuration, error reports and analytics in production, and the commercial shape.
- `Docs/Roadmap/Multiplayer sync.md` — multiplayer-sync exploration with open dialogue: the typed change-set ledger, the granular-write provider family and its conformance contract, offline queue and late-refusal semantics, fieldwise-latest convergence, presence, and the slice sequence.
- `Docs/Roadmap/Deferred Tao language decisions.md` — the LANG-001..030 deferred-decision inventory.
- `Docs/Roadmap/Add navigation and routing MVP/Follow-ups - …md` — unimplemented navigation work and `DEF-NAV-*` deferrals.
- `Docs/Roadmap/Archive/Repository foundations/` — the package, automation, and language-service foundation record.
- `Docs/Roadmap/Archive/Code cleanup spike/Report.md` — the completed cleanup spike and R1–R13 rulebook.
- `Docs/Roadmap/Archive/` — frozen records of completed work.
