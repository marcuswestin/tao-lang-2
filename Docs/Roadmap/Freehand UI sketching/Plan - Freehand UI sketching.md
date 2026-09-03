# Plan - Freehand UI sketching

The implementation plan for freehand UI sketching decided in
`Design - Freehand UI sketching.md` (FS-D1–FS-D20). Read that design summary first; this plan cites
the decisions rather than reopening their alternatives.

## Ground rules

- Follow the exact FS-D20 order. Finish, test, document, verify, and commit each slice before
  beginning its dependent. When a dependency or an **Open before starting** item is unsettled, stop;
  never skip forward or interleave a half slice.
- Every language tranche follows `Docs/Roadmap/Tao Revolution/Process.md`: settle the working code
  in `Apps/WordFlower/2 - Next`, implement the vertical through grammar, scoping, validator,
  formatter, source actions, compiler, runtime, and stdlib as applicable, prove each construct with
  Tao behavior tests, migrate `1 - Current`, reconcile Decisions/specs/Coverage and later tiers, then
  absorb byte-identically.
- Tao Studio is a forcing app. Its own Tao client may force a capability, but WordFlower absorbs
  every new spelling in the same tranche. Current never leads Next.
- `Docs/Spec/` describes only landed executable behavior. The design record and this plan own future
  work until its slice lands. `Docs/Roadmap/Archive/` remains frozen.
- Unsnapped rectangles are Studio catalog rows, never Tao source. Only snapping writes flowed render
  nodes. Until L3 and Slice 5 land, the matrix draws them through a TypeScript overlay (FS-D1, D5).
- The Studio server is the sole project-file and sketch-catalog writer. All client changes pass
  through typed, versioned, server-canonical proposal/apply/checkpoint actions.
- Generated source under `@/` is committed and read-only to people by default. Formatting and fix
  lanes check it without rewriting it (FS-D3).
- Use `.test.tao` journeys for observable language behavior. Use package tests only for grammar,
  validation, source-action mechanics, native/module boundaries, generated IR, and the harness.
  Every Studio gesture receives a journey in `packages/studio/studio-tests` or the smoke lane that
  `packages/studio/README.md` assigns it.
- Run focused tests during each slice and `./agent verify` before every commit. Preserve the task's
  developer-environment ledger and distinguish implementation, contract, browser, native, and
  physical-device evidence.

## Sequence

| #  | Tranche / slice                    | Forcing feature                                              | Depends on                                  | Size |
| -- | ---------------------------------- | ------------------------------------------------------------ | ------------------------------------------- | ---- |
| 1  | L1 — scenarios and sketch elements | Held press and `Placeholder` in a WordFlower Studio scenario | Settled step and spacer spellings           | XL   |
| 2  | Tooling — root `@` package         | Studio-generated `@/studio/View1.tao`                        | L1                                          | M    |
| 3  | Slice 1 — Draw                     | Draw and edit free rectangles beside a running cell          | L1, Tooling                                 | XL   |
| 4  | Slice 2 — Snap                     | Project rectangles into Tao flow and reverse the operation   | Slice 1                                     | XL   |
| 5  | Slice 3 — Feed                     | Bind a sketch to real, generated, live, or library data      | Slice 2                                     | XL   |
| 6  | L2 — executable dialect            | WordFlower yes/no parameters and postfix conditions          | Slice 3                                     | XL   |
| 7  | Slice 4 — Variants                 | Duplicate scenario cells and edit one argument state         | L2                                          | L    |
| 8  | L3 — positioned container          | Studio's Tao client renders free rectangle rows              | Slice 4; settled container/offset spellings | XL   |
| 9  | Slice 5 — Tao-rendered canvas      | Replace the matrix overlay with the L3 container             | L3                                          | M    |
| 10 | Slice 6 — Focus-in                 | Open an occurrence's owning view with provenance arguments   | Interaction-outline provenance              | L    |
| 11 | Slice 7 — Companion                | Pencil-mode sketching in one paired native cell              | Slice 5; companion app shell                | XL   |

The mandated delivery groups Studio Slices 1 and 2 together after L1, but each remains its own green
commit and Slice 2 begins only after Slice 1 is complete. L2 and L3 remain distinct language
tranches because they settle different contracts and force different application behavior.

---

## L1 — scenario steps, stand-ins, optional fixture, `Placeholder` and `Spacer`

**Decisions.** FS-D7, FS-D8, FS-D9, FS-D10.

**Goal.** A focused scenario can reach interaction states through ordered journey steps, including
activation, input, selection, and pointer phases; omit an unused fixture; omit required action
arguments through logging stand-ins; and render the two sketch-support elements without
Studio-specific runtime exceptions.

**Dependencies.** None after the two language spellings below are settled. **Size.** XL.

**Forcing feature.** A WordFlower scenario renders a view with a required action, delivers a held
button sequence with phase steps and `advance 600.ms`, and includes a labelled `Placeholder` in
Studio's own client. L1 proves ordered phase delivery in the shared adapter; Tao-visible `pressed`
styling waits for L2. The cell log proves the stand-in invocation.

**Introduces.** Scenario entries accept ordered steps after their `run` or `render` subject. Plain
press, enter, submit, and tagged-row select retain their test-step spellings; the shared IR and
runtime add pointer-down, pointer-up, hover, and focus delivery through Testing Library events. The
scenario host replays the prefix once before leaving the cell interactive. A
focused render may omit required action parameters, which receive per-cell invocation-recording
stand-ins. Fixture clauses become optional and validation requires one only for handle-bearing
arguments or `prepare`. `@tao/ui` publishes `Placeholder` with development/release rendering and
design-check participation, plus the settled spacer representation.

**Tests.** Parser/formatter/validator tests for step placement, source order, selector rules,
fixture dependency diagnostics, and omitted action versus non-action parameters. Compiler/runtime
tests prove the shared test/scenario step IR, activation/input/selection and exact phase events,
replay-before-interaction, stand-in log isolation, and release `Placeholder` output. Tao journeys
prove held press, hover/focus where observable, optional fixture, and both elements in WordFlower
Current. Studio journey proves a cell replays its prefix and remains interactive.

**Reconcile.** `Decisions.md` §9 and §16, `Docs/Spec/Tao Studio.md`, `Tao Testing.md`, `Tao Layout and
UI.md`, the stdlib/package catalog, `Coverage.md`, and all WordFlower tiers at absorption.

**Open before starting.** None. Ro settled both items on 2026-09-03: phase steps are
`press down <selector>`, `press up <selector>`, and `hover <selector>` over the existing
text/label/placeholder/`#tag` selector family; focus is tag-only as `focus #tag`. `Spacer()` is the
semantic leaf with implicit `claim 1`, overridable by `[claim N]`.

---

## Tooling — the root `@` package

**Decision.** FS-D3.

**Goal.** Reserve a project's root `@/` as a generated-code package whose subfolders resolve through
the ordinary package importer and whose generated ownership is enforced without immutable files.

**Dependencies.** L1. **Size.** M.

**Forcing feature.** Studio creates a read-only public view in `@/studio` and ordinary app source
imports it with `use View1 from @/studio`.

**Introduces.** Workspace discovery and package resolution accept the bare `@` package and its
subpaths while keeping `@name` package semantics unchanged. The reserved package may import its own
project's root declarations by ordinary relative paths without weakening other package boundaries.
`tao create` scaffolds `@/` with a marker so Git can retain the otherwise empty directory. Fix and
format commands exclude `@/` from writes and run an explicit check over it. Studio project-open reasserts mode `0444` on
`@/studio/*.tao`; a writer temporarily grants only the owner write bit and restores it even on
failure. Generated files carry the required header. Move to package performs a same-repository move,
rewrites `use … from @/studio` sites through language-aware source edits, and prompts only on a
target-package declaration-name conflict.

This is resolver, workspace, CLI, and Studio tooling. It introduces no language change.

**Tests.** Workspace/parser linking tests for `@/studio`, nested subpaths, relative imports from a
generated file, visibility, duplicate names, and continued `@tao/*` resolution. CLI tests assert the
empty scaffold and check-only formatter/fixer behavior. Studio filesystem/source-action tests assert
fresh create, reopen permission repair, temporary write restoration on success/failure, import
rewrites, move history, and conflict prompting. A fixture repository proves Git can replace files.

**Reconcile.** `Docs/Spec/Tao Packages.md`, CLI create/fix docs, Studio's file/trust boundary, the
project scaffold documentation, and `Coverage.md` if the package form gains a dedicated row.

**Open before starting.** None. This is tooling and resolver behavior, not a new Tao spelling.

---

## Slice 1 — Draw

**Decisions.** FS-D1, FS-D4, FS-D13, FS-D14.

**Goal.** Draw, select, move, resize, retype, edit text, and Option-drag duplicate free rectangles
beside the scenario matrix while keeping all free geometry in Studio's committed catalog.

**Dependencies.** L1 and Tooling. **Size.** XL.

**Forcing feature.** Drawing an empty 360×76 sketch creates `View1`, its scenario cell, and four
editable free rectangles beside the running app.

**Introduces.** A Studio-server sketch provider validates and atomically writes versioned JSONC at
`.tao-project/studio/sketches.jsonc`. It owns `Sketch` and ordered `Rect` rows with the exact FS-D1
fields, a project-wide monotonic view counter, render-identity associations for snapped rows, and
conflict-safe source/catalog checkpoints. Creating a sketch immediately writes read-only
`@/studio/ViewN.tao` with a public view, co-located scenarios group, fixture import where needed, and
one sketch-sized `Placeholder`. Matrix chrome renders absolute rectangle overlays and handles
pointer capture, selection, move/resize, kind/content edits, and Option-drag duplication.

**Tests.** Provider tests cover malformed/stale JSONC, ordering, atomic writes, monotonic names across
delete/reopen, and concurrency. Source-action tests cover the exact generated file, scenario,
read-only lifecycle, and rollback when one side fails. Studio journeys cover every gesture and prove
that no move/resize/retype writes the Tao render tree. Browser smoke covers real canvas pointer
capture and file/catalog reload.

**Reconcile.** `Docs/Spec/Tao Studio.md` gains the implemented sketch catalog, generated view, trust,
and current-boundary contract; `packages/studio/README.md` gains artifact/recovery and smoke steps.

**Open before starting.** None. Gesture mechanics must preserve platform selection and canvas
scrolling, but their product meaning is settled.

---

## Slice 2 — Snap

**Implementation status (2026-09-03).** The transactional Snap/Unsnap, typed flow edits, proposal
parity, render-identity refresh, and preservation contracts are implemented. The committed 16-case
component-layout corpus is regression evidence only: 12 cases project directly and four require
confirmation. The required 15–20 real-screen corpus and operational inspector-fix measurement remain
open, so FS-D11 acceptance is not yet closed.

**Decisions.** FS-D11, FS-D12.

**Goal.** Convert chosen free rectangles to minimal flowing Tao source, edit flow directly, and
return a node to its remembered free position without losing identity.

**Dependencies.** Slice 1. **Size.** XL.

**Forcing feature.** Snap the playlist-row corpus example into a `Row` containing an image, nested
`Col`, and duration; then drag one remaining free rectangle into a gap and unsnap it back.

**Introduces.** A pure deterministic projection engine implements the FS-D11 direction, nesting,
median-gap, edge-pad, fill, claim, fixed-size, and hug rules. Clean separation applies directly;
overlap or two clean separating axes produce a canonical proposed tree and diff through the existing
proposal endpoint before apply. Partial snap deletes only projected catalog rows after source
success; remaining rows overlay the flowed preview. Drag-one-in reuses palette gap indicators.
Direction toggle, separators, and spacer claim dragging lower to typed layout actions. The preview
reports measured rectangles by manifest render identity. Unsnap uses the retained row position,
drops stale associations on delete/retype/reopen, and otherwise falls back to measurement.

**Tests.** Unit/property tests pin projection invariants and deterministic output. A committed corpus
of 15–20 real screens records expected trees, overlay requirement, and inspector-fix count; acceptance
requires at least 80% without overlay and at most two fixes for every accepted tree. Source-action
tests cover propose/apply parity, stale identity, atomic source/catalog rollback, partial selection,
and measurement fallback. Studio journeys cover Snap, overlap confirmation, drag-one-in, unsnap,
direction toggle, divider/spacer insertion, claim dragging, undo, and reopen.

**Reconcile.** Studio spec and README document inference, proposal, identity, measurement, and the
honest corpus result. Layout specs change only for existing actions exercised here.

**Open before starting.** None. Select and record the corpus before tuning as an implementation
step; do not change the settled heuristic to fit individual screens invisibly.

---

## Slice 3 — Feed

**Implementation status (2026-09-03).** Foundations are green and committed: shared fixture imports,
entity-aware preview manifests, deterministic four-source inventory, canonical shared-fixture source,
typed entity/field source actions, durable free/snapped field bindings, and scope-derived arguments for
parameterized project-view insertion. The slice remains open until Studio exposes the row/chip browser
and lands entity/field drop, atomic Keep, Move-to-package scenario relocation, and their browser journey.

**Decisions.** FS-D6, FS-D16.

**Goal.** Give a sketch a real entity argument, bind fields to free or snapped targets, and persist
only kept examples as fixture source.

**Dependencies.** Slice 2. **Size.** XL.

**Forcing feature.** Feed `PlaylistRow` from fixture, deterministic generated, live-store, and
library rows, then insert it inside a loop with its parameter bound from scope.

**Introduces.** Entity drop adds a view parameter and scenario arguments. Field chips type-check and
bind rectangle hints or flowed nodes. The generator uses a stable seed and field-name/type vocabulary;
generated and live rows remain transient until Keep promotes an ordinary row to
`@/studio/Sketches.tao`. View-only declarations remain co-located; shared fixture data lives in that
file. Move to package defaults to moving the scenario group to `Scenarios.tao`. `insert-project-view`
derives compatible arguments from lexical/loop scope and asks only for unresolved required values.

**Tests.** Generator snapshots and mutation tests cover deterministic seeds and every value class.
Validator/source-action tests cover field types, relations, promotion, fixture imports, and scope
binding. Studio journeys cover all four sources, free and snapped binding, Keep, move to package,
and loop insertion.

**Reconcile.** Studio/data/testing specs, package examples, capture boundary, and Coverage.

**Open before starting.** None; model suggestions remain deferred.

---

## L2 — the executable dialect catches up

**Decision.** Tao Revolution `Decisions.md` §2 and §9; sequenced by FS-D20.

**Goal.** Execute already-decided yes/no parameter types and postfix conditions over parameters and
interaction states.

**Dependencies.** Slice 3. **Size.** XL.

**Forcing feature.** WordFlower renders a parameterized control whose style responds to yes/no
arguments and ordinary `pressed`, `hovered`, and `focused` conditions.

**Introduces.** `yes / no` in parameter type position, `yes` and `no` literals, boolean expression
composition needed by `when Disabled and Busy`, and postfix `when` on complete layout/style entries
for parameter and runtime interaction-state conditions.

**Tests.** Tao behavior tests prove both poles, defaults, conjunction, independent conditions, and
real press/hover/focus styling. Parser/validator/formatter/compiler/runtime tests cover invalid types,
condition types, precedence, and native/basic host parity.

**Reconcile.** WordFlower tiers, `Decisions.md`, Type System, Layout/UI, Testing, and Coverage.

**Open before starting.** None. FS-D17 already settles the conjunction as
`when Disabled and Busy`.

---

## Slice 4 — Variants

**Decisions.** FS-D7, FS-D14, FS-D17.

**Goal.** Generate scenario entries from arguments and edit one or every state without divergent
render trees.

**Dependencies.** L1 and L2. **Size.** L.

**Forcing feature.** Option-drag a button cell through default, disabled, busy, and combined states;
replay pressed and hovered prefixes; edit the combined state.

**Introduces.** Duplicate and Expand all states use deterministic next-unvisited values. Each cell
shows persistent `Editing: this state` or `Editing: all states`; a non-default cell begins in the
former. Conditional source actions write the conjunction of non-default arguments and allow terms to
be removed in the inspector. No edit-time prompt exists.

**Tests.** Studio journeys cover Option-drag, expansion, duplicate avoidance, persistent mode,
condition-term removal, all-state edits, and pointer-prefix replay. Source-action tests pin canonical
scenario naming and `when` output.

**Reconcile.** Studio and scenario specs, design-system condition documentation, and Coverage.

**Open before starting.** None after L1 and L2.

---

## L3 — the positioned container

**Decision.** FS-D5, constrained by KEY-D7.

**Goal.** Let Studio's own Tao client render Studio-owned rectangle rows without making absolute
positioning a product-layout escape hatch.

**Dependencies.** Slice 4 and the spellings below. **Size.** XL.

**Forcing feature.** The Studio canvas renders its catalog through a positioned container and direct
child offsets.

**Introduces.** One positioned stdlib container and one direct-child offset clause, with validation
restricting offsets to that parent. The runtime accepts reactive Studio data and preserves ordinary
selection, accessibility, and event semantics. WordFlower contains the smallest honest forcing
example needed to absorb the spelling.

**Tests.** Tao behavior tests prove offsets, sizing, ordering, invalid parents/nesting, events, and
web/native behavior. Studio journey compares Tao rendering against the Slice 1 overlay geometry.

**Reconcile.** `Decisions.md` §9 and KEY-D7's floating anchored-layer relationship, Layout/UI,
stdlib catalog, WordFlower tiers, and Coverage.

**Open before starting.** Settle in `2 - Next` the container name (`Canvas` recommended), the offset
spelling (`at x y` recommended), accepted value types, whether nesting is legal, and the explicit
relationship to KEY-D7's floating anchored layers. This container renders Studio data; it does not
reinstate product-source sketches withdrawn by FS-D1.

---

## Slice 5 — Tao-rendered canvas

**Decision.** FS-D5.

**Goal.** Replace the TypeScript rectangle overlay with the L3 container in Studio's own Tao client.

**Dependencies.** L3. **Size.** M.

**Forcing feature.** Every Slice 1 and 2 rectangle gesture operates against Tao-rendered rectangles
with identical source/catalog results.

**Introduces.** Typed catalog rows cross the ProductHost boundary into the Tao client; Tao owns
rectangle rendering and accessibility while the existing controller retains pointer orchestration,
selection identity, and trusted mutations. Remove the overlay only after parity tests pass.

**Tests.** Run the complete Draw/Snap journey suite against the Tao client, add render parity and
portal-ownership regression tests, and exercise the browser smoke lane.

**Reconcile.** Studio strangler/current-boundary docs and README evidence status.

**Open before starting.** None after L3.

---

## Slice 6 — Focus-in

**Decision.** FS-D15.

**Goal.** Open one view definition beside the running occurrence using the exact entity/handle that
produced the selected loop item.

**Dependencies.** The keyboard tranche that publishes interaction-outline item provenance.
**Size.** L.

**Forcing feature.** Open `PlaylistRow` from `Morning Run`, capture it first when it came from a live
store, edit once, and observe every occurrence update.

**Introduces.** The interaction outline publishes internal item provenance to the trusted Studio
selection bridge. Focus-in creates or selects a co-located scenario entry, captures a live row before
referencing its handle, and keeps Edit here as the immediate alternative.

**Tests.** Outline/runtime tests prove provenance identity across reorder and remount. Studio journeys
cover fixture and live rows, repeated occurrences, stale provenance rejection, edit propagation,
close, and discard.

**Reconcile.** Interaction and Studio specs/Coverage.

**Open before starting.** Blocked until the keyboard tranche has landed entity-plus-handle item
provenance. Do not publish a parallel binding graph.

---

## Slice 7 — Companion

**Decisions.** FS-D18, FS-D19.

**Goal.** Draw and edit one paired scenario cell on a physical device while the Mac validates,
writes, compiles, and acknowledges every change.

**Dependencies.** Slice 5 and the companion app shell. **Size.** XL.

**Forcing feature.** On iPad, select rectangle mode with Pencil Pro squeeze or Pencil 2 double-tap,
drag corner to corner, write text with Scribble, move/resize the rectangle, snap it, and observe the
same cell and source on the Mac.

**Introduces.** An Expo-module PencilKit sidecar declared as a foreign view with `accepts content
slots` owns initial ink, selection, move, and resize input and emits `Drew`, `Wrote`, and `Moved`
actions. The Tao companion owns catalog data, L3 rendering, the strip, one-cell group stepping, and
paired source-action requests. Rectangle mode is explicit: squeeze phases for Pencil Pro,
double-tap toggle for Pencil 2, strip tool for other pointers. Scribble handles text; no recognition
turns free ink into shapes.

**Tests.** Sidecar unit/module tests cover phase handling and event payloads. Contract tests cover
pairing, capabilities, stale identity, acknowledgement/retry, and one-cell isolation. Simulator tests
cover ordinary touch and strip flows. The required acceptance is a physical iPad/iPhone pass for
squeeze/double-tap, Scribble, background/reconnect, latency, and rejection without source mutation.

**Reconcile.** Studio companion exploration, Tao ship companion plan, foreign-view/native bridge,
Studio spec, physical-proof ledger, and Coverage.

**Open before starting.** None after the dependencies exist. Confirm the exact Expo PencilKit module
API against the supported iOS/Pencil versions as adapter implementation evidence, not a new product
decision.
