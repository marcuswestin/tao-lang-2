# Plan - Tao Studio v1

Living implementation ledger for Tao Studio v1. The prototype on `feat/studio` is reference material,
not an integration branch. Each slice is re-derived against current `main`; the prototype branch is
never merged, rebased, or changed.

The v2 implementation supersedes this plan's Electron architecture, monolithic browser-client shape,
single-project launch assumption, and dotted singular scenario syntax. Current status for those four
workstreams is tracked in
[Plan - Tao Studio v2](../Tao%20Studio%20v2/Plan%20-%20Tao%20Studio%20v2.md); the remaining v1 text is a
historical ledger and should not be read as the current implementation target.

## Status

- Milestone 0 reevaluation: complete on 2026-08-30.
- Implementation branch: `feat/studio-v1`, based on `main` at `a5c5bf38`.
- Slice 1 foundation checkpoint: implemented the protocol v1 boundary, serialized/coalescing compile
  coordinator, current-dialect semantic source-action bus, and stable runtime-toolchain preview root.
- Slice 1 project/identity checkpoint: implemented the contained project session and HTTP/WebSocket
  server boundary, optimistic draft/source-action writes, preview-only compiler render identity, and
  concrete runtime `data-tao-studio` propagation.
- Slice 1 editor/preview checkpoint: implemented the shared Langium WebSocket transport, official
  CodeMirror LSP client, generated TextMate grammar highlighting through the server-side Shiki bridge,
  browser Studio shell, stable revisioned Expo preview publication, trusted iframe bridge,
  bidirectional source/render selection, file watching without duplicate Studio-write compiles, and
  the `./dev studio` / `just studio` web launch surface.
- Slice 1 visual/native checkpoint: implemented the typed palette and inspector, current-layout
  controls, Stack wrapping, preview-originated semantic drag/reorder, edge and cross-container source
  transforms, one-gesture checkpoint/undo, the sandboxed local Electron wrapper and packaging recipe,
  isolated slow-suite resources, and an explicit CDP simulated-user smoke.
- Product gate: closed by Ro on 2026-08-30. Examples and named state use the decided fixture/scenario
  direction, with no `example` declaration or Studio-only authority. Scheme is a versioned, visibly
  inert Studio seam until reactive `Scheme`/appearance resolution exists.
- Scenario-language checkpoint: implemented file-level `fixture` and `scenario`, typed fixture handles,
  exact focused `render View(Parameter: Handle)`, mutually exclusive `run`/`render`, environment
  clauses, formatter/validator coverage, Studio-only compiler metadata, and the matching absorbed
  WordFlower tranche.
- Matrix/state/environment foundation checkpoint: implemented the versioned compiler and Studio
  manifests, one cell per authored scenario, full cell/instance revision identity, concurrent iframe
  grid creation, cell bootstrap/reconfiguration, deterministic state-domain composition, exact provider
  seed/capture, controlled fill latency/offline/failure, typed argument/viewport/network controls, and
  an explicitly disabled Scheme control.
- Focused-host checkpoint: the generated preview root now installs the cell-local provider/environment,
  executes fixture creates and ordered preparation, resolves fixture arguments, and mounts a focused
  view. The generated real WordFlower `WorkspaceRow.novel` Studio host typechecks. Fixture setup through
  an action remains an explicit unsupported boundary.
- Source-promotion checkpoint: per-cell argument controls can promote their current values into the
  existing Tao `scenario` through one versioned, undoable `set-scenario-arguments` source action.
- Capture checkpoint: each matrix cell converts its isolated provider snapshot into a dependency-ordered
  Tao fixture proposal, displays a client rendition for confirmation, and saves the plan through one
  versioned, undoable source action. Exact server-produced diff review and loading accepted captured
  state in tests remain open.
- Review-hardening checkpoint: fixed lossless single-line render moves and Tao string emission,
  reentrant editor opens, abandoned drags, watcher deletions, imported data-catalog binding, stale
  write acknowledgements, Host validation, Electron executable detection/external-URL filtering, and
  compatible matrix override/instance carry-forward. Palette residue was removed from the forcing apps.
- Next executable checkpoint: execute the explicit Chrome and Electron smokes outside the managed
  listener-restricted sandbox and complete the manual interaction pass. The repository-level real-app
  proof already compiles `HNReaderStub`, applies a semantic visual edit, recompiles, undoes, and restores
  the copied HNReader source exactly.
- Validation status: focused parser, validator, formatter, compiler, runtime, runtime-toolchain, and
  Studio gates pass, and the latest complete repository gate passes across 16 suites.
  Listener-dependent browser/Electron execution remains pending because this managed sandbox rejects the
  local Studio listener before browser launch.

## Goal

Ship the smallest solid Tao Studio whose complete loop is useful on an existing Tao app:

1. Edit Tao through CodeMirror and the shared Langium LSP while an Expo web preview updates without
   discarding compatible runtime state.
2. Select and edit the same semantic render from source or preview; drag, insert, and adjust supported
   layout vocabulary through reviewable, versioned source actions.
3. Render multiple saved examples of one `view` across arguments, named state, viewport, network, and
   scheme dimensions.
4. Capture, compose, save, and reload named state as a project artifact usable by Studio, previews,
   and tests.
5. Launch the product on web and in an Electron wrapper, with an explicit slow E2E suite and a local
   packaging recipe.

Tao source and Tao-owned project artifacts are the only durable truth. Studio keeps no hidden pixel or
runtime-only design state.

## Authority and current-main constraints

- `Docs/Roadmap/Tao Revolution/Decisions.md` owns final language spelling; `Docs/Spec/` owns what is
  implemented now. A planned construct is not treated as executable merely because Decisions defines it.
- The current renderable declaration is `view Foo()` and calls always include parentheses. “Scene” is
  Studio product language, not a new Tao keyword.
- Current layout vocabulary is `content`, `claim`, `gap`, `pad`, `margin`, `width`, `height`, `fill`,
  `hug`, `compress`, `rigid`, `aligned`, and `centered`, plus `width max N`. There is no generic `fit`
  clause. Visual wrapping uses a real container such as `WrappingRow()` or `Stack()`; the prototype's
  emitted `Stack [..]` is stale dialect.
- The current tranche implements the first `fixture` and `scenario` surface: accounts, ordered creates,
  `through`/`for`, ordered preparation updates, app or focused-view subject, device/dimensions,
  appearance, locale/pseudolocale, right-to-left direction, and online/offline network. The broader
  Decisions dimensions remain future work. There is no separate `example` declaration.
- Current design runtime implements flat tokens and bundles only. The future reactive `Scheme` and
  `Appearance` behavior is decided but not implemented.
- `tao-runtime` now owns semantic/runtime behavior; Expo generation and testing live in
  `tao-runtime-toolchain`. The prototype predates this split.
- Current compile paths select `appName` for multi-app sources and serialize generation per output root.
  Studio must preserve both.

## Prototype decision verdicts

| Prototype decision                    | Verdict                      | Current-main interpretation                                                                                                                                                                                         |
| ------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tao source is truth                   | Adopt                        | Source actions return inspectable text edits; saved Studio metadata is explicit and versioned.                                                                                                                      |
| One shared Langium LSP                | Adopt                        | Use current `LSPWorkspace`, including project and stdlib loading. Do not recreate HTTP completion, hover, definition, reference, symbol, diagnostics, action, or formatting services.                               |
| Separate Studio protocol              | Adopt and extend             | LSP remains language-only. One typed Studio protocol owns compile/apply revisions, preview identity, examples, state, environment, inspector data, and source-action transactions.                                  |
| CodeMirror 6                          | Adopt                        | Use the official LSP client. Keep server-side TextMate/Shiki highlighting initially; injected-TypeScript semantic intelligence remains deferred.                                                                    |
| Expo web preview in an iframe         | Adopt                        | Keep a stable root module and manual reload escape hatch. Validate origin/source for every `postMessage`; do not retain the prototype's wildcard trust.                                                             |
| Fast Refresh preserves context        | Adopt and harden             | Maintain editing, compiled, and applied revisions. Invalid drafts keep the last good preview. Preserve current output-root serialization and multi-app selection.                                                   |
| Versioned source-action patch bus     | Adopt and revise             | One `/api/source-action` envelope uses source version plus document/range/kind/owner preconditions. Reject stale edits before write. Initial full-document edits are acceptable; range/multi-file edits land later. |
| Absolute path plus offsets as node ID | Replace                      | Treat the range as a version-bound locator, not durable identity. Protocol identity also carries declaration owner, node kind, source version, preview instance, and later example ID.                              |
| Direct DOM drag implementation        | Adopt only as a chassis      | Stabilize semantic drag tests before evaluating `@dnd-kit/dom`; the product model is typed Tao operations, not browser drag events.                                                                                 |
| Electron native wrapper               | Adopt                        | Keep the preview iframe inside the Tao Studio shell. The wrapper owns local process lifecycle; signed/distributable packaging is beyond v1.                                                                         |
| Cases JSON sidecar                    | Defer as authority           | Reuse viewport-frame mechanics only. Saved example/state authority follows Ro's decision below.                                                                                                                     |
| Debugger manifest/source maps         | Preserve seam, defer feature | Keep protocol capabilities optional and avoid blocking future source maps; omit debugger UI, DAP/CDP bindings, breakpoint hooks, and debugger E2E from v1.                                                          |
| VS Code Studio UX                     | Defer                        | The shared LSP remains reusable, but v1 ships native/web Studio rather than a second Studio client.                                                                                                                 |
| Shared in-memory document model       | Defer conditionally          | Disk-synced parsable drafts may ship if revision checks and compile coordination prove reliable.                                                                                                                    |

## Harvest ledger

Harvest means manually porting a behavior or focused module into current structure, never copying a
whole stale package surface.

### Studio server and client

- Recreate `packages/studio` from the focused ideas in prototype `Studio.ts`, `StudioLsp.ts`,
  `StudioHighlight.ts`, `StudioProtocolManifest.ts`, and `native/NativeStudio.ts`.
- Split the prototype's monolithic server into project/session, compile coordinator, protocol,
  source-action routing, LSP transport, highlighting, Expo lifecycle, and native launcher modules.
- Put CodeMirror/editor/parent preview UI in `packages/studio`; keep only preview-runtime bridge and
  render overlay behavior in `packages/runtime`.
- Reuse the CDP browser harness concepts for real interaction tests. Do not carry debugger helpers
  into the v1 core.

### Source actions and identity

- Re-derive `studio-actions.ts` against the unified `view` AST and current source-action helpers:
  component/project-view insertion, same-block reorder, cross-container move, layout entry set/replace,
  and container wrap.
- Keep source-actions responsible for typed transforms and Studio responsible for authorization,
  version checks, disk writes, compile scheduling, and review/checkpoint history.
- Add Studio occurrence identity to current compiler `tao-props` generation without losing design,
  test tag, navigation, response, or caller-context metadata.
- Propagate identity through current `TR-TaoProps`; web attributes and native `dataSet` must not disturb
  styles, `testID`, component-kit props, or injected-view behavior.

### Preview generation and language service

- Move the prototype stable-root generation idea into `packages/runtime-toolchain`, not
  `packages/runtime`. Preserve app selection, sidecars, stale-graph cleanup, generation queueing, and
  concurrent output-root safety.
- Use current `LSPWorkspace` for project plus stdlib language intelligence. Add only demonstrated
  missing readiness/contribution seams; custom symbol/hover metadata is polish after the shared LSP
  connection works.
- Retain the generated TextMate grammar and server-side Shiki bridge until a better client-side path
  proves necessary.

### Automation and tests

- Add current-convention command plumbing through `packages/dev`, `./dev`/`./agent`, and `Justfile`
  after reading the developer-automation boundary. Commands: web launch, native launch, local native
  package, and explicit Studio test suite.
- Reuse user/agent artifact-root and port isolation and slow-suite sharding. Do not put browser or
  Electron E2E into the ordinary fast package-test path.
- Convert prototype assertions to current dialect and current package APIs. Every skipped prototype
  path starts as unproven work, not as a temporary skip to preserve.

## Execution graph

### Slice 1 - Current-main chassis

Critical path:

1. Recreate the Studio package, shared protocol schema, project session, LSP bridge, and highlight
   service.
2. Add a single serialized/coalescing compile coordinator. Studio writes register exact
   `(path, contentVersion, write generation)` acknowledgements; matching watcher notifications do not
   schedule a second compile. A running compile may be followed by only the newest requested revision.
3. Add stable preview generation in `runtime-toolchain`, carrying `appName`, and prove that a successful
   compile advances a monotonic revision while invalid drafts retain the prior preview.
4. Add CodeMirror editor, file navigation, diagnostics/actions/formatting through LSP, the iframe
   preview, compiled/applied status, and manual reload.
5. Add render occurrence metadata, preview bridge, source-to-render highlight, render-to-source
   selection, and inspector identity payload.
6. Add the typed source-action bus, palette insertion, reorder/move, supported semantic layout handles,
   and one-operation checkpoint/undo grouping.
7. Add web/native launch, explicit Studio E2E, resource isolation, and packaging smoke coverage.

Slice 1 validation gates:

- Focused Studio protocol, LSP, source-action, compiler metadata, TR propagation, and
  runtime-toolchain generation tests.
- One editor write produces one logical compile; a stale source action produces no write and no compile.
- Same-module and imported-module add/remove/switch edits keep an iframe sentinel alive; invalid source
  keeps the last good render; compiled and applied revisions converge.
- Click/highlight works both ways; palette insert, same-block reorder, cross-container move, layout
  changes, and wrap produce current-dialect source and a reviewable checkpoint.
- Electron simulated-user smoke opens a project, edits, saves, previews, and performs one visual edit.
- Manual proof against `Apps/HNReader` or `Apps/WordFlower/1 - Current`.
- `./agent verify` before the slice commit.

### Slice 2 - Saved examples and isolated view compilation

Unblocked by Decision 1 on 2026-08-30.

Implemented: the fixture/scenario language tranche, production-no-op/Studio-manifest compiler boundary,
parameter schemas, source ranges, project/app/revision identity, one cell per scenario, isolated iframe
creation, opaque instance bootstrap, fixture/preparation execution, resolved focused-view arguments, and
the generated focused host are present. The real WordFlower host is the generated/typechecked proof.

Remaining: prove multi-cell updates without remounting unaffected state. Fixture `through` execution
remains outside the implemented host subset.

- Implement the chosen durable artifact through the full owning stack. If it is Tao syntax, follow
  parser, scoping, validator, formatter, source-actions, compiler, runtime, IDE, spec, and WordFlower
  tranche rules; do not let Current invent language ahead of the decided source.
- Emit a preview manifest containing view name, parameter schema, saved examples, source ranges, and
  selected `appName`/project identity.
- Compile and mount a chosen `view` with supplied arguments in an isolated preview host.
- Render every example concurrently with isolated provider/state/environment scopes.
- Add args controls as ephemeral edits to the running cell and an explicit promote action that writes
  the chosen durable artifact.

Validation gate: one real parameterized view renders at least three saved examples, and typing or a
visual edit updates every cell without remounting unaffected cell state.

### Slice 3 - State library

Unblocked by Decision 1 on 2026-08-30.

Implemented foundation: versioned JSON-safe domains, deterministic ordered composition, cycle/missing/
codec/override diagnostics, and an exact provider-data seed/capture codec. Capture is intentionally
limited to provider data and identity.

The generated host now receives resolved provider-data seed through its cell-local overlay.

Implemented: a matrix cell turns its current provider snapshot into a proposed named Tao fixture,
shows the proposal before acceptance, and writes only through the validated source-action bus. Relation
dependencies are ordered and emitted as fixture-handle references; unsupported or ambiguous captures
fail explicitly.

Remaining: load accepted captured state in tests. The current generated manifest has no separate named
state entries.

- Implement named, hand-authored state and the agreed relationship among fixture, scenario, and Studio
  example. Separate reusable data/identity graphs from full running-state pins where the decided model
  does.
- Seed through the data-provider/app-state mount seam rather than mutating the store after arbitrary
  rendering. Support explicit state composition with cycle/conflict diagnostics.
- Capture the running preview into a proposed named entry, show the reviewable artifact diff, and write
  only after acceptance.
- Load one named state into an example cell, the main running preview, and the test harness through the
  same semantic mechanism.

Validation gate: hand-authored and captured entries round-trip, compose deterministically, and load
into Studio and tests without hidden runtime state.

### Slice 4 - Environment matrix

Unblocked by Decisions 1 and 2 on 2026-08-30.

Implemented: viewport cells and grid frames, per-cell revisioned environment, runtime provider overlay
for isolated persistence and controlled fill latency/offline/failure, generated-host datasource wiring,
and an inert-only Scheme capability. Studio exposes viewport and network reconfiguration and shows
Scheme as disabled with an inert explanation. Authored scenarios currently map viewport and
online/offline; latency/failure have no Tao spelling in this tranche.

Remaining: complete listener-dependent browser proof of observable network effects and cross-cell
isolation.

- Grow viewport cases into an example grid with phone/tablet/laptop/custom dimensions.
- Wrap the current data-provider seam for latency, offline, and injected failures. Preserve provider
  load/persist/fill semantics; do not fork store behavior or model offline as an unrelated generic error.
- Allow cell-level overrides with explicit global defaults and identity in protocol payloads.
- Bind scheme to the real design `Scheme`/appearance resolution only if that runtime lands. Otherwise
  render a clearly disabled/inert control whose protocol field is still versioned and testable.

Validation gate: cells show observable loading delay, offline, and declared failure behavior without
cross-cell contamination; viewport metadata changes layout; scheme is live or visibly inert exactly as
decided.

### Slice 5 - Solidity and closeout

- Finalize protocol versioning, compatibility errors, example/node/state identity, origin checks,
  inspector payloads, and one drag-session-to-one-checkpoint semantics.
- Consolidate the browser, runtime, HTTP, and future-device message shapes into one dependency-free
  protocol artifact before adding a native-device transport; include explicit capability negotiation
  and typed version-mismatch rejection.
- Replace whole-page matrix resync with manifest-change reconciliation. Preserve compatible cell
  overrides and live opaque instances across recompiles, keep stable name-based cell IDs, and remount
  only cells whose topology or explicit configuration requires it.
- Split the browser client into a typed API/event client, editor lifecycle, matrix-cell view, and thin
  mount before expanding the UI further. Its lifecycle behavior must be directly unit-testable.
- Closed by Tao Studio v2 Slice 1 on 2026-08-31: protocol/source-action v2 enforces the compiler-emitted
  render owner. It also carries the currently single-valued `render` node kind as forward-compatible
  occurrence scaffolding. Cell edits carry scenario identity, and undo retains the committed checkpoint
  identity instead of adopting the active preview.
- Make scenarios declared in imported files mountable by importing their subject bindings into the
  generated host, or reject them before publishing cells; never publish an unmountable blank cell.
- Either execute `run App at Destination(...)` in the generated host or reject that subject until it
  is wired. Widen fixture values for required case-set fields as a separate decided language slice.
- Add a production-bundle assertion for Studio runtime machinery, or invert the runtime integration so
  a Studio host registers the overlay into a production-neutral seam.
- Replace full-document source edits where range or multi-file edits are required for correctness.
- Return the exact server-produced capture insertion or diff for confirmation before any write.
- Stabilize all core browser/native paths without inheriting the prototype's skipped tests.
- Keep the sharded slow suite explicit and deterministic under isolated ports and artifact roots.
- Finish local packaging recipe and lifecycle cleanup.
- Make the packaged macOS app start a usable Studio/project flow without launcher-only environment
  variables; the current packaging check proves layout and hardening, not standalone launch.
- Reconcile `Docs/Spec/` for implemented surface, update this ledger, split `Roadmap.md`'s landed
  simulation foundations from remaining integration, and update the IDE live-preview entry.
- Run the complete real-app demonstration and `./agent verify`.

### Final exploration - Native device as a Studio canvas

Design exploration completed on 2026-08-30 in
`Docs/Archive/Explorations/Exploration - Native device as Studio canvas.md`. It finds an authenticated
Expo development-build
renderer feasible, an internal preview build feasible with signed-update/runtime-version limits, and
unrestricted live compilation in an App Store production build unacceptable. No native transport was
implemented, no physical iPhone was available for validation, and the required real-device spike remains
a separately gated follow-up after the v1 browser loop is complete.

Explore whether any explicitly Studio-enabled Tao app running on an iPhone or other device can pair with
Studio and act like a native counterpart to an iframe in the desktop examples grid:

- From Studio, focus the connected device on one `view`, supplied arguments, named state, and
  environment configuration; optionally render multiple examples on the device at once.
- Keep the app's ordinary native runtime, component kits, layout, navigation, datasource, and device
  capabilities. The device is a preview host, not a browser projection.
- Send compiled/apply revisions, example identity, source/render identity, state seeds, and environment
  controls through the same Studio protocol concepts used by desktop preview cells.
- Allow selection, highlight, semantic drag/drop, palette insertion, and layout handles on the device to
  submit the same versioned source-action envelopes to Studio. The Mac-side project remains the only
  authority that validates and writes Tao source; the device keeps no hidden durable edit state.

The research must distinguish at least these deployment modes:

1. Expo development build connected to Metro and Studio on the LAN.
2. An explicitly instrumented local/ad-hoc/TestFlight preview build paired to Studio.
3. A production/App Store build, where iOS signing, executable-code loading, review policy, and security
   may make arbitrary live code replacement infeasible. Do not add a production backdoor to satisfy the
   general “build mode” wording; identify the strongest safe capability that remains possible.

Evaluate and compare LAN discovery or QR pairing, authenticated WebSocket transport, TLS/tunnel needs,
Metro/Fast Refresh and Expo development-client constraints, background/foreground reconnection,
revision recovery, device trust and revocation, source-action authorization, and latency when the device
is not on the same network. Re-check the then-current Expo, React Native, Hermes, iOS, and App Store
constraints rather than relying on today's versions.

Required proof and output:

- A real-iPhone spike against an existing Tao app: pair, focus one view, show multiple examples, edit on
  the Mac, preserve compatible device state, select both directions, and submit one semantic device-side
  source edit.
- Failure tests for stale revisions, disconnect/reconnect, a revoked or wrong device, an invalid source
  action, and unavailable Studio/Metro hosts.
- A written feasibility report with an adopt/limit/reject verdict for each deployment mode, the proposed
  protocol and runtime boundaries, security model, performance evidence, remaining platform risks, and a
  scoped follow-up implementation plan if the result is viable. The design, boundaries, and staged plan
  are recorded; performance evidence remains part of the real-iPhone spike rather than a paper claim.

## Parallel ownership and integration barriers

- Integration owner: shared manifests, protocol exports, workspace/package dependencies, lockfile,
  generated artifacts, command surface, roadmap/spec docs, branch/index, and commits.
- Studio package owner: `packages/studio/**` only until protocol integration.
- Runtime/compiler owner: Studio metadata and preview bridge in `packages/compiler/**`,
  `packages/runtime/**`, and `packages/runtime-toolchain/**`; no shared manifests or locks.
- Source-actions owner: Studio transforms and focused tests in `packages/source-actions/**` only.
- Current-contract reviewer: language/spec conformance and real-app proof, read-only unless ownership is
  transferred.
- Barriers: protocol schema before client/server split; compiler identity before overlay selection;
  compile coordinator before watch/editor integration; Decision 1 before example/state persistence;
  Decision 2 before scheme behavior; focused green gates before dependency slices and commits.

## Decisions for Ro

### 1. Saved examples and named state

**Closed 2026-08-30: scenario-first.** Use the already-decided `fixture` plus `scenario` mechanism as
the common durable basis for tests, Studio states, and the examples grid; do not add an `example`
keyword or a temporary sidecar authority. Ro approved the focused subject
`render ViewName(Parameter: FixtureHandle)`: named arguments bind the view's parameters, and `run`
and `render` are mutually exclusive scenario subjects. V1 capture covers provider data and identity
only; it does not claim arbitrary React hook or navigation-stack state.

Options:

- **Scenario-first:** implement `fixture`/`scenario` through a WordFlower tranche and approve a focused
  view/arguments scenario form. This gives one durable language mechanism but expands the language slice.
- **Sidecar-first:** ship versioned Tao Studio sidecars for view arguments that reference named
  fixture/scenario state, then migrate the sidecar only when those declarations land. This avoids an
  early grammar tranche but creates a temporary artifact format.
- **Studio-only artifacts:** keep examples and saved state separate from fixtures/tests. This is the
  smallest isolated implementation but conflicts with the decided convergence direction and is not
  recommended.

### 2. Scheme behavior

**Closed 2026-08-30: inert seam.** Ship the protocol and UI seam visibly inert in v1 until the
design-system MVP implements reactive `Scheme`/appearance resolution. Coupling Studio to that separate
language/runtime workstream would expand the critical path.

Alternative: make the design-system MVP a prerequisite and ship the toggle live.

### 3. Architecture amendments

No amendment is recommended. Retain Electron, CodeMirror 6, shared Langium LSP, separate Studio
protocol, Expo web/Fast Refresh, iframe preview, and the versioned source-action patch bus. Any
replacement requires evidence and Ro's approval before implementation.

## Done when

- Web and native Studio open a current Tao project and demonstrate typing plus semantic visual edits
  as reviewable source diffs.
- Multiple examples update live across argument, state, viewport, and network dimensions.
- Hand-authored and captured named state loads in examples, the main preview, and tests.
- Network simulation visibly drives loading/offline/error surfaces without leaking across examples.
- Scheme behavior is live or visibly inert per Decision 2.
- Every adopt/replace/defer verdict and gated decision above is closed in this ledger.
- Implemented language/runtime surface is reconciled in `Docs/Spec/`; `Roadmap.md` separates the landed
  simulation foundations from the remaining preview-host and product work and records Studio's
  IDE-preview ownership.
- The explicit Studio suite and `./agent verify` are green.
- The native-device feasibility report is complete. After v1 is otherwise complete, run the required
  real-iPhone spike before approving any resulting implementation as a separate follow-up.

## V1 boundaries

Debugger product work, design lab, interaction recording, AI assistance, injected-TypeScript semantic
intelligence, VS Code Studio UX, native-device visual editing implementation, collaboration, signed
distribution, and richer multi-select/non-container drag gestures remain out of v1. Native-device visual
editing is explored only by the final feasibility phase above.
