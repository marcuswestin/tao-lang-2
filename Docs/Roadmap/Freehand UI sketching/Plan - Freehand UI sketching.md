# Plan - Freehand UI sketching

The implementation plan for freehand UI sketching decided in
`Product - Freehand UI sketching.md`'s "Design record" section (FS-D1–FS-D20). Read that design
record first; this plan cites the decisions rather than reopening their alternatives. L1, the `@`
tooling, Slice 1 (Draw), and Slice 2 (Snap) have landed; Slice 3 (Feed) is implemented on
`feat/studio-feed-client` and awaits visual acceptance and landing. "Figma-at-home strides" and "Canvas-first design mode" below are two additional, currently
active bodies of work that polish the landed slices and the Studio canvas UI without reopening
FS-D1–FS-D20 or reordering the FS-D20 sequence.

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
  work until its slice lands. `Docs/Archive/` remains frozen.
- Unsnapped rectangles are Studio catalog rows, never Tao source. Only snapping writes flowed render
  nodes. Until L3 and Slice 5 land, the matrix draws them through a TypeScript overlay (FS-D1, D5).
- The Studio server is the sole project-file and sketch-catalog writer. All client changes pass
  through typed, versioned, server-canonical proposal/apply/checkpoint actions.
- Generated source under `@/` is committed and read-only to people by default. Formatting and fix
  lanes check it without rewriting it (FS-D3).
- Use `.test.tao` journeys for observable language behavior. Use package tests only for grammar,
  validation, source-action mechanics, native/module boundaries, generated IR, and the harness.
  Every Studio gesture receives a journey in `packages/ides/studio/studio-tests` or the smoke lane that
  `packages/ides/studio/README.md` assigns it.
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

**Landed.** Ordered scenario steps, pointer phases, action stand-ins, optional fixture, `Placeholder`,
and `Spacer` are implemented and absorbed. Details of what landed with it, and the hardening that
followed, are under "Figma-at-home strides" below.

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

**Open before starting.** None. The Developer settled both items on 2026-09-03: phase steps are
`press down <selector>`, `press up <selector>`, and `hover <selector>` over the existing
text/label/placeholder/`#tag` selector family; focus is tag-only as `focus #tag`. `Spacer()` is the
semantic leaf with implicit `claim 1`, overridable by `[claim N]`.

---

## Tooling — the root `@` package

**Landed.** The `@` package, Studio's `@/studio` writer, and Move to package are implemented.

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

**Landed**, then hardened through "Figma-at-home strides" Stride 0 and Stride 1 below (real-browser
proof, keyboard/tool-model reflexes, undo, numeric fields, rename, delete, smart guides, inline text).

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
and current-boundary contract; `packages/ides/studio/README.md` gains artifact/recovery and smoke steps.

**Open before starting.** None. Gesture mechanics must preserve platform selection and canvas
scrolling, but their product meaning is settled.

---

## Slice 2 — Snap

**Implementation status (2026-09-20).** The transactional Snap/Unsnap, typed flow edits, proposal
parity, render-identity refresh, and preservation contracts are implemented and hardened into
cross-process transactions with version checks (see "Figma-at-home strides" below). The committed
16-case component-layout corpus remains regression evidence only: 12 cases project directly and four
require confirmation. The simulated-browser smoke lane — the only real-browser proof of Draw and
Snap — rejoined `verify-full`, ran ten consecutive green times in a normal Terminal, and closed
DEVENV-042. The required 15–20 real-screen corpus and its operational inspector-fix measurement
remain open (Figma-at-home strides, Stride 2a), so FS-D11 acceptance is not yet closed. Native and
canary acceptance remain a separate normal-Terminal gate.

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

**Implementation status (2026-09-26).** The Feed branch adds the Tao-owned four-source row/chip browser,
entity and typed field drops, collection loop proposals, transient source-overlay compilation, a
multi-file Keep with rollback and Undo Keep, and default-on Move-to-package scenario relocation.
Server lifecycle tests exercise partial writes, failed compilation/catalog persistence, stale source
and catalog state, and concurrent external edits. The browser journey exercises the panel and drag
adapters, free and snapped binding, Keep/Discard/Undo, collection loops, and default scenario relocation.
Imported-view insertion uses canonical source actions with loop-scope arguments and project containment.
Native gesture feel still requires visual acceptance; landing this slice requires separate authorization.
HNReader review exposed a misleading fixture-handle error for folder-only entities. Feed now checks
entity visibility before fixture promotion and explains the import restriction; coverage includes
folder-only and file-only models as well as importable public models.

**Representability limits.** Existing fixture syntax represents primitive literals, `now`, and fixture
references. Exact captured/generated timestamps, unresolved live relation IDs, cyclic fixture creation
dependencies, and unsupported scenario argument expressions are rejected explicitly. Optional field
binding needs a source fallback. Moving into an authored package keeps its existing import boundaries;
app-private dependencies must be made package-compatible before moving the view. No language semantics
are weakened for the visual workflow.

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

---

## Figma-at-home strides

Adopted 2026-09-04, with the Developer's rulings recorded in this section's "Decisions" below; implementation in
progress. It builds on the landed foundation of `feat/freehand-ui-sketching-implementation` and does
not reopen FS-D1–FS-D20 or reorder the FS-D20 sequence above. It names the first strides that make
Studio feel like home to a person fluent in Figma: the reflexes they bring with them (keys, selection,
undo, guides, numeric fields), a Snap they can trust, and a sketch fed with real data. Strides 1, 2,
and 4 are polish of the landed Draw and Snap slices; stride 3 finishes Feed, the next slice in
FS-D20's mandated order.

### Where the work stands

The foundation landed on `main` as squash `13d2577c` (2026-09-04 22:20).

A review of everything that landed on 2026-09-04 and 2026-09-05 followed. For this plan's surface it
fixed: the inspector's Layout, Style, and Text drafts follow the inspected element instead of the first
one seeded, and Set text refuses to swap a binding for `Text("")`; a sketch board recovers from a lost
pointer capture instead of holding the render gate closed; the matrix reconciler removes departed cells
before placing survivors, so a removal no longer detaches the sketch host mid-gesture; canvas mode keeps
the app visible when the focused view is no longer rendered; `remove-render` refuses a `#studio_rect_`
marker (Unsnap first) and a container's only child; `tao check` warns about a shipping `Placeholder`
under `@/studio` too (FS-D2) while Snap's measured `width` and `height` no longer count as explorations
there; projection order is code-point order. The later hardening made Snap/Unsnap, restore, sketch
revision, and rename operations cross-process transactions with version checks. The shared marker
decoder remains a cleanup. `hover`, `down`, and `up` are ordinary spelling-validated test words,
not global grammar keywords.

Landed: L1 (ordered scenario steps, pointer phases, action stand-ins, optional fixture,
`Placeholder`, `Spacer`), the root `@` package with Move to package, Slice 1 Draw, Slice 2 Snap with
the transactional Unsnap and typed flow actions, the Slice 3 Feed server foundations, and the review
roadmap's first two targets (Record journey, `tao review`).

Browser evidence: the simulated smoke lane, the only real-browser proof of Draw and Snap, has
rejoined `verify-full` (`just studio-smoke packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts` runs it alone). The landing
and later diagnostics exposed real toolbar, gesture, rerender, interleaved-Snap, editor-ownership,
source-identity, geometry, and transaction defects. Those product fixes now have focused coverage,
including a real pointer-release drag-one-in target; no remaining failure has been attributed to the
browser automation itself. The last one found, on 2026-09-19, was the lane's own: it pressed Unsnap
on a selection an authoritative render had already discarded, and Unsnap with nothing selected
unsnaps the whole flow. The evidence gate is met: the complete journey ran ten consecutive green
times in a normal Terminal on 2026-09-20, which closed DEVENV-042. Native and canary acceptance
remains a separate normal-Terminal gate.

What the client offers today: drag on empty canvas creates a sketch; drag inside a sketch draws a
rectangle; click selects and Shift-click extends; eight handles resize; Option-drag duplicates; the
sketch inspector has a kind select and a content field; a toolbar carries Snap, Undo Snap, a
snapped-node select, Unsnap, Toggle direction, Insert separator, and a spacer ratio field; a gap
indicator handles drag-one-in; overlap opens an Apply/Cancel proposal.

What a Figma person reaches for and does not find: any keyboard handling (no Delete, arrows,
Escape, ⌘D, ⌘A, ⇧A), marquee selection, deleting a rectangle (the catalog action exists and is not
wired), undo of a move or resize (only Snap has undo), numeric X/Y/W/H, renaming the view, deleting a
sketch (the server rejects it), smart guides, Shift and Option constraints, zoom and pan, the Data
panel with entity drop and field chips, the FS-D11 real-screen corpus, and alignment or nested-pad
inference.

### Figma reflex to Tao Studio

| Figma reflex                                         | Today                                | Stride |
| ---------------------------------------------------- | ------------------------------------ | ------ |
| Delete, arrows, Shift+arrows, Escape, ⌘D, ⌘A, Tab    | none                                 | 1a     |
| V select with marquee, R rectangle, T text           | always drawing                       | 1b     |
| Shift constrains, Option resizes from the centre     | none                                 | 1c     |
| ⌘Z after every move                                  | Snap only                            | 1d     |
| X, Y, W, H fields with arithmetic; frame presets     | kind and content only                | 1e     |
| Rename the frame                                     | display name only                    | 1f     |
| Delete the frame                                     | rejected by the server               | 1g     |
| Red alignment guides, pink spacing hints             | none                                 | 1h     |
| Double-click text to edit in place                   | inspector field                      | 1i     |
| ⇧A adds auto layout and it just works                | Snap, 75% direct on component corpus | 2a–2c  |
| Drag an edge to fill or hug, flip direction, reorder | toolbar buttons and inspector        | 2d     |
| Content Reel, Sheets sync, real records              | server side only                     | 3      |
| ⌘+wheel zoom, space-drag pan, ⇧1 fit                 | none                                 | 4      |
| Option-drag a frame to make a variant                | after L2, Slice 4 as decided         | later  |

### Stride 0 — Real-browser proof for Draw and Snap

**Goal.** Every later stride adds gestures; none of them can claim browser evidence while the only
browser lane for sketching is unreliable. Make that lane deterministic and keep it in the graph.

**Done (2026-09-04).** Hit-test diagnostics in the lane showed the failures were product defects:
the toolbar covered the drawing surface, drag-one-in depended on an HTML5 drag the move gesture
suppressed, and a re-render could replace a board mid-gesture. All three are fixed with pure
helpers and unit tests: the toolbar and proposal live in a frame around the board, drag-one-in is a
pointer gesture released over the sketch's running cell, and renders are held while a gesture is in
flight. The lane now passes Draw, four further draws, Snap, and reload in a normal terminal, runs
the sketch section in the Run preset at a designer-sized viewport, and records board state, the
element under the pointer, host errors, and a screenshot on every sketch timeout.

**Done (2026-09-20).** The product path has a real pointer-release drag-one-in target and preserves
authored source through the proposal/transaction path. The simulated-user lane has been removed from
`VERIFY_FULL_SKIPPED`, runs in both full lanes, and recorded ten consecutive reliable normal-terminal
runs, which closed DEVENV-042. Native and canary evidence remains separate and must be confirmed from
the Terminal in the same acceptance pass.

**Size.** S–M remaining. **Depends on.** Nothing.

### Stride 1 — Reflexes on the sketch

**Goal.** Every gesture a Figma person performs without thinking works on free rectangles, and all
of it stays catalog-only, so no language change and no compile per keystroke.

- **a. Keys.** Delete and Backspace remove the selection (`delete-rect`). Arrows nudge by one,
  Shift+arrows by ten, coalesced into one `update-rect` per burst. Escape cancels a gesture in
  progress, otherwise clears selection. ⌘D duplicates in place with a small offset
  (`duplicate-rect`). ⌘A selects every free rectangle in the sketch. ⇧A snaps the selection, or every
  free rectangle when nothing is selected. Enter edits the selected rectangle's content. T, B, and I
  retype the selection to `Text`, `Button`, and `Image`. Tab and Shift+Tab walk `rectOrder`.
- **b. Tool model.** V is select: dragging empty sketch space draws a marquee, Shift adds to it. R
  is draw: dragging creates a rectangle as today. T draws a `Text` rectangle. Dragging empty canvas
  outside any sketch still creates a sketch. A three-button strip above the sketch shows the active
  tool. Ruled by decision B.
- **c. Constraints.** Shift keeps a square while drawing or corner-resizing and locks the axis while
  moving; Option resizes from the centre.
- **d. Undo.** ⌘Z and ⇧⌘Z walk one client-held, time-ordered stack over catalog gestures and source
  checkpoints. A catalog entry stores its inverse action and replays it through the versioned
  endpoint with the expected revision; a source entry reuses the existing checkpoint undo. Ruled by
  decision C.
- **e. Numbers.** X, Y, W, and H fields that accept arithmetic (`100+20`), a sketch size badge with
  the `phone`, `tablet`, and `laptop` presets, and edge handles on the sketch itself. Resizing the
  sketch is one transaction: the catalog size plus the generated `Placeholder` size and `device`
  clause while the view is unsnapped.
- **f. Rename.** A `rename-sketch-view` transaction renames the declaration, moves
  `@/studio/<Old>.tao` to `<New>.tao` with history, rewrites `use … from @/studio` sites through the
  Move to package machinery, and updates the catalog's `view` and `name` and every snapped
  association. A collision is refused before mutation. FS-D13 still allocates `ViewN` at creation.
- **g. Delete a sketch.** Lift the server rejection by putting generated-file removal inside the same
  rollback contract as creation. Refuse when the app references the view; offer Discard sketch on a
  sketch that has a scenario entry only.
- **h. Smart guides.** While moving or resizing, snap to sibling edges and centres, to the sketch
  edges and its inferred pad, and to equal spacing between neighbours, with a four-pixel screen
  threshold and Figma's red line and pink spacing rendering. This matters more here than in Figma:
  FS-D11 infers `gap` from the median neighbour distance and `pad` from the edge distance, so a
  drawing snapped to guides projects cleanly by construction.
- **i. Inline text — implemented 2026-09-26.** Double-click a free `Text` rectangle to edit its content
  in place; Enter commits a changed value, Escape or blur cancels. Multiline content is preserved,
  and concurrent changes to the edited rectangle invalidate the local edit.

**Tests.** A Studio journey per gesture in `studio-sketch-view.test.ts` and `studio-sketch-session.test.ts`;
the simulated smoke lane gains one keyboard pass (draw, nudge, duplicate, delete, undo, marquee) and
one guide pass (a drawing that snaps to guides projects without a proposal). Every journey asserts
that no gesture other than Snap writes the Tao render tree.

**Reconcile.** `Docs/Spec/Tao Studio.md` (gesture and key contract, rename, delete, sketch resize),
`packages/ides/studio/README.md`.

**Size.** L overall: a S, b M, c S, d M, e M, f M, g M, h M, i S. **Depends on.** Stride 0.

### Stride 2 — A Snap you can trust, and Figma gestures on flowed views

**Goal.** Close FS-D11's acceptance evidence and let a person edit an existing screen's flow with
the gestures wireframe 7 draws, not toolbar buttons.

- **a. Real-screen corpus.** Build the 15–20 screen corpus FS-D11 demands from running apps rather
  than hand-drawn cases: the preview already reports measured rectangles per render identity, so
  flatten WordFlower, HNReader, and the Layout and App Shell test apps to leaf rectangles, record
  the authored tree normalized to the projection vocabulary as the expected result, and count
  inspector fixes as the clause diff. Report the direct-projection rate and fix count honestly in
  the README. Tune rules only with the corpus in view, and document every rule change.
- **b. Inference extensions.** Cross-axis alignment (`content` start, centre, or end from leaf
  positions within a lane), nested container pad (a lane's inset relative to its siblings), and
  equal-size runs to `claim` weights. Proposal-on-ambiguity stays. Ruled by decision D.
- **c. Snap preview.** Hovering Snap, or holding ⇧A, shows the inferred tree as a translucent overlay
  before anything is written. The proposal endpoint already returns the canonical tree; render it
  for clean cases too. This is the cheapest trust a Figma person can be given.
- **d. Flow gestures on the preview.** Select a flowed node in any cell, sketch or app: dragging its
  edge to the container edge writes `fill`, back to content writes `hug`, anywhere else `width N`
  or `height N` (`set-layout-entry`); ⌘-click a container flips direction
  (`set-container-direction`); ⌥-click a gap opens the palette insert at that gap
  (`insert-component`, `insert-project-view`); dragging a node reorders it (`move-render`); dragging
  a spacer edge rewrites neighbour `claim` weights. The toolbar buttons move into the inspector for
  discoverability. This is the first stride where a Figma person edits an existing screen the way
  they would in Figma, and it works on every view, not only sketches.

**Tests.** The corpus is a committed fixture with a property test over projection invariants; a
journey per flow gesture with exact source diffs; the smoke lane's Snap path gains the edge-drag
and ⌘-click cases.

**Reconcile.** Studio spec and README for inference, corpus result, and gesture contract; layout spec
only where an existing action's behaviour is exercised.

**Size.** a M, b M, c S, d L. **Depends on.** Stride 0; d is independent of a–c.

### Stride 3 — Feed in the client

**Goal.** Finish Slice 3 so a sketch is never a picture of a row.

- A Data panel listing entities and rows from the four sources: fixture, generated with a visible
  seed, live store, and library.
- Drag an entity onto a sketch (`add-sketch-entity-parameter`); field chips appear beside it.
- Drop a chip on a free rectangle (`bind-rect`) or a snapped leaf (`bind-sketch-field`); a
  collection field proposes a `loop` with a row view.
- Keep as one multi-file transaction into `@/studio/Sketches.tao` and the scenario arguments; an
  example-source selector per cell.
- Move to package offers scenario relocation to `Scenarios.tao`, defaulting to yes.
- Insert a parameterized sketch view into a loop with its argument bound from scope.

**Tests.** The journeys this plan already assigns to Slice 3.

**Size.** L. **Depends on.** Stride 0; benefits from stride 1's selection and undo.

### Stride 4 — The canvas as a place

**Goal.** A phone-sized sketch fits on screen and a person moves around it the way they expect.

- ⌘+wheel and pinch zoom, ⌘0 for 100%, ⇧1 fit, ⇧2 zoom to selection; space-drag and trackpad pan.
- Zoom-aware pointer math for every stride 1 gesture; guides and handles keep screen size.
- Several sketches per group row; optional rulers.

**Size.** M. **Depends on.** Stride 1b (the tool model owns the space key).

### Canvas mode proof of concept

**Landed 2026-09-04**, ahead of strides 1 and 2, as the first end-to-end taste of editing an existing
view the way a Figma user edits a component: select an element in the running app, press **Focus
view**, and the owning view stands alone with its scenario cells while the app's other groups hide.
Every edit lands in that one definition and shows in every occurrence.

- Entry reuses the view's existing focused `scenarios` group (decision A, first branch); a view
  without one is not focusable yet. Creating a `draft` entry on demand and taking the instance's
  arguments from item provenance (FS-D15) remain open.
- Content edits are flow edits (decision B): the palette inserts `Row`, `Col`, and `Text` at the
  selected gap; the inspector wraps in `Row`, `Col`, or `Stack` and removes a child. Free rectangles
  inside authored views stay out, per FS-D12.
- Binding is the inspector's Text section (decision C, inspector half): edit the literal or bind the
  leaf to a parameter, loop item, local value, or one-level entity field the source makes visible.
  Chips dragged onto the preview wait for stride 2d's on-preview gestures.
- New source actions (decision D): `remove-render`, `set-text-content`, `bind-text`, and `wrap-render`
  for `Row` and `Col`; `inspectRender` publishes the text leaf's expression, literal, and candidates.
- Forcing app (decision E): HNReader's `StoryRow`, which already has the `rows` scenario group.

`Docs/Spec/Tao Studio.md` carries the executable contract under "Canvas mode".

### After these strides

FS-D20's order continues unchanged: L2, Slice 4 Variants, L3, Slice 5 Tao-rendered canvas, Slice 6
Focus-in, Slice 7 Companion. Stride 2d's flow gestures serve variant cells later, and stride 1's
undo stack is what Slice 4's cell edits will join.

### Decisions

Settled by the Developer on 2026-09-04, taking the recommendations.

- **A. When to land the branch.** Moot: the foundation landed on `main` as `13d2577c` before this
  plan was adopted.
- **B. Tool model on the sketch.** Figma's: V selects with marquee by default, R and T draw. The
  alternative, draw-by-default with Shift-drag as marquee, was declined.
- **C. Undo model.** One ⌘Z stack in the client over catalog gestures and source checkpoints in time
  order. Source-only undo was declined.
- **D. Snap inference extensions.** Add cross-axis alignment, nested pad, and equal-size runs, judged
  on the real-screen corpus. Keeping FS-D11's rule set unchanged was declined.
- **E. Stride order.** 0, 1, 2, 3, 4. Taking Feed first was declined; every later gesture reuses
  selection, keys, and undo.

A decision discovered during implementation joins the next round with the Developer; it is not decided silently.

### Sizes and dependencies

| Stride | Size | Depends on | Language change |
| ------ | ---- | ---------- | --------------- |
| 0      | S–M  | none       | none            |
| 1      | L    | 0          | none            |
| 2      | L    | 0          | none            |
| 3      | L    | 0          | none            |
| 4      | M    | 1b         | none            |

### Verification

Each stride lands with a Studio journey per gesture in `packages/ides/studio/studio-tests`, its smoke-lane
steps green on a host with Chrome, `./agent verify` green, and the Studio spec and README reconciled
to what landed. Corpus numbers are reported as measured, never rounded up to the threshold.

---

## Canvas-first design mode

Status: implementation record, reconciled 2026-09-16. Written as a proposal after a 2026-09-06
visual inspection of Studio on `Apps/HNReader`; the inspection and proposed work below remain dated
history, while each **Landed** paragraph records the current boundary. The responsive Design split,
viewport reveal, preview-only transforms, iframe-safe gestures, canonical occurrence identity, real
`owner.rect`, serialized Focus enter/leave restoration, and listener disposal have landed. The lane
runs in `verify-full` again and met its ten-green-runs condition on 2026-09-20; what remains of
acceptance is the visual inspection below and the separate native and canary pass.

### What the inspection showed

1. **The canvas is not the hero.** At 1440 px wide the preview column is the rightmost sixth of the
   window; Files, Scenario, and the editor take the rest. In Design mode a person sees one phone
   frame cut off at the right edge and nothing else of the app.
2. **Everything is open at once.** The Scenario pane shows View arguments, Environment (device, size,
   network, latency, scheme), Selection, Layout, Style, and later Data, Text, and Actions, all
   expanded, most of them saying "Select a rendered element in the preview." Two rows of lens chips
   sit above the editor (All, Compose, Style, Trace, Data, Outline; Structure, Layout, Behavior,
   Data, Wiring, Tests), with `Data` appearing in both rows.
3. **No visible way in.** Nothing on screen says how to draw, how to focus a view, or what Design mode
   is for. Focus view appears only after a selection; drawing needs a drag on empty canvas that
   nothing announces.
4. **Focus fills the device.** Focusing a list row shows it inside the phone frame's full 390×844,
   because the focused group's cells keep the scenario's device size. A row occupying 390×64 in the
   app becomes a full-screen cell with the row at the top.
5. **Small things.** Beta ship is the loudest button on screen. Mode: Edit, Device, and the search
   field share the top bar with the three primary tabs. The inspector repeats section headers with
   disabled placeholders instead of one hint.

### Principles

- **One next action per state.** Each state of the canvas has one obvious thing to do, shown once,
  where the eye already is. Everything else waits behind a selection or a menu.
- **The canvas is where design happens.** In Design mode the canvas takes half the window and shows
  the whole app as frames side by side. Source and inspector share the other half.
- **Figma's vocabulary, Tao's model.** Frame, select, focus, hand, zoom, and the bottom tool strip
  mean what a Figma person expects. Underneath, every edit is still a source action on one view
  definition (FS-D3, FS-D12), and free rectangles live in the catalog until they snap (FS-D4).
- **Show, do not list.** Discoverability comes from a short tool strip, hover outlines, and empty
  states that name the one next step, not from more chips.

### Stride A — Canvas takes half the window

Design mode becomes a 50/50 split: canvas left, source and inspector right, with a draggable
divider that remembers its position per project. Files and Scenario collapse into the left icon
rail, opening as popovers; the scenario strip (group name, device, scheme) moves to a single line
above the canvas.

- The canvas becomes one pannable surface (`.studio-preview-grid` gains a transform layer, see
  Stride C) on which every scenario group is a labelled frame. Groups sit in a row per group with a
  fixed gap, so several screens and views are visible around each other at once; the layout is the
  existing `reconcileMatrix` output positioned absolutely instead of flowed.
- Code mode keeps today's layout. Run mode keeps the device preview alone. The Design/Code/Run tabs
  are the only way the layout changes; no other control moves panels.
- The inspector on the right shows one section at a time chosen by the selection: nothing selected
  shows a single line ("Select an element, or press F to focus a view"); a container shows Layout
  first; a Text leaf shows Text first; Style and Actions are collapsed headers until opened.
- Work: `StudioShell.ts` layout and CSS, `StudioApp.ts` mode wiring, panel collapse into the rail,
  inspector section policy in `TaoStudioClient.tao`. Two to three days.
- **Landed 2026-09-07.** Entering Design collapses the file tree into the rail, which still reopens
  it, and sizes the canvas to half the workbench, clamped so the inspector, a usable editor and the
  dividers keep their room; leaving Design restores what was there, and the divider still overrides
  either way. Group rows no longer scroll horizontally on their own, so every cell of every group
  lies on the one surface and zoom-to-fit shows them together. Fixed along the way: the body panes
  now name their grid columns, because a collapsed pane is `hidden`, which removes it as a grid item
  and shifted every later pane one column left. Still open from this stride: the scenario strip above
  the canvas, Files and Scenario as rail popovers, and the inspector's one-section-per-selection policy.

### Stride B — A focused view gets a frame the size it had

Focusing a view wraps it in a frame whose size is the occurrence's measured size, not the device.

- Where the size comes from (checked 2026-09-06): the runtime already posts every mounted render's
  rectangle after each layout (`preview-layout-measurements` from `TR-studio-preview.tsx`,
  `collectStudioPreviewLayoutMeasurements`, keyed by `renderId`), the client forwards it untouched
  (`StudioMatrixView` → `StudioApiClient.previewLayoutMeasurements`), and the server keeps a
  per-cell `measurements` map in `StudioProjectSession` for Snap. The client holds no rectangles and
  the selection (`inspected.identity`) carries an owner name, not a rectangle. So `inspectRender`
  gains an `occurrence` field: the server maps the owner view to its root `render` occurrence in
  that cell instance (it has the render occurrences) and returns that render's measured rectangle.
  On Focus view the client reconfigures the focused group's cells with `Device custom` and that
  width and height through the existing `reconfigureEnvironment` (`viewport` without a `presetId`).
  The cell _is_ the frame; nothing new renders inside the iframe.
- The frame draws eight handles. Dragging a handle resizes the cell live (debounced
  `reconfigureEnvironment`); the size shows in the canvas bar and in the inspector's Frame fields.
  Height may be "hug" (grow to content, reported back by the runtime) or fixed.
- The frame size is editing state, kept in the sketch catalog next to the group
  (`.tao-project/studio/sketches.jsonc`, a `frames` map keyed by view name), never in `.tao` source.
  A "Save as scenario size" command writes it into the scenario's `Size` when the person wants it.
- Views without a focused `scenarios` group become focusable by creating a `draft` group on demand
  (decision A, second branch, from the strides plan), whose arguments come from the occurrence's
  provenance where the runtime has it and from the inspector's argument drafts otherwise.
- Work: `StudioMatrixView.focusView` gains a frame; `StudioApp` passes the rectangle; catalog gains
  `frames`; canvas bar and inspector Frame fields. Two days. Depends on nothing in Stride A.
- **Landed.** Inspection and layout measurements share canonical structural occurrence identity.
  `inspectRender` returns the owning view's real measured `owner.rect` only for the selecting cell
  instance; Focus uses it as the custom viewport and serialized enter/leave restoration returns to
  the prior app state. The missing-rectangle investigation above is closed rather than a current
  product defect.

### Stride C — Zoom and pan the way Figma does

- One CSS transform on the canvas layer: `translate(x, y) scale(z)`. Iframes scale with it; their
  pointer events keep working in Chromium. Text goes soft above 1×, which is acceptable for the
  first cut; a later "true zoom" re-renders cells with the CSS `zoom` property at integer factors.
- Gestures: pinch and ⌘+wheel zoom around the cursor; two-finger scroll and Space+drag pan; ⌘0 fit
  all, ⌘1 100 %, ⇧1 zoom to selection, ⇧2 zoom to the focused frame, ⌘+ and ⌘−. A zoom pill at the
  bottom right shows the percentage and opens these as a menu.
- Geometry: every client hit test that turns a pointer into canvas coordinates (`relativePoint` in
  `StudioSketchView.ts`, `StudioSketchGeometry`, the matrix focus outline) divides deltas by `z`;
  `getBoundingClientRect` already reflects the transform for positions. Sketch boards, frames, and
  handles keep constant on-screen stroke widths by scaling the inverse on their border layer.
- Persistence: viewport per project in Studio user state (`{x, y, z}`), restored on open. User navigation
  does not change the shared sketch catalog or project source.
- Work: transform layer and gesture handling in `StudioMatrixView`, coordinate helpers, zoom pill,
  keyboard bindings in `StudioApp`. Two days. Lands before Stride A's frames-on-a-surface so the
  surface is pannable from the start.
- **Landed 2026-09-07.** `StudioCanvasViewport.ts` owns the pan and zoom state per preview host and
  writes one transform onto the grid, which the matrix re-applies after each reconcile. Wheel and
  two-finger scroll pan; the same with ⌘ or ctrl, and a trackpad pinch, zoom around the pointer;
  space-drag and the middle button pan; ⌘0 fits, ⌘1 returns to 100 %, ⌘+ and ⌘− step the ladder. The
  pill at the bottom right shows the percentage and toggles fit against 100 %. Sketch pointer
  coordinates divide by the scale, so drawing stays accurate while zoomed. Still open from this
  stride: zoom to selection and to the focused frame, the pill's menu, persistence of the viewport
  across sessions, and counter-scaled stroke widths on sketch handles.
- **Hardened 2026-09-16.** Only preview cells receive the viewport transform, hit testing and pointer
  release remain correct over iframes, reveal scrolls through the viewport coordinate space, and all
  gesture/listener registrations are disposed with their host. Zoom-menu and persistence enhancements
  listed above remain product follow-ups rather than correctness blockers.
- **Corrected 2026-09-26.** Space is captured before child keyboard handlers can stop propagation.
  Focused app previews forward Space to the canvas and immediately suppress app mouse handlers.
  A transparent shield keeps previews neutral to hover, clicks, and wheel input for the entire
  held-Space interval, including between drags. Focus loss and leaving Design clear the gesture.
  Text entry retains Space.
  Pan sensitivity is 0.75 for both drag and scroll; pinch/modifier-wheel zoom uses a 0.006 exponential
  gain per delta unit, retaining the per-event cap and total zoom limits.

- **Extended 2026-09-26.** Focused previews forward the fit/reset/zoom shortcuts. The zoom pill opens
  Fit all, 100%, Zoom to selection, and Zoom to focused frame; absent targets are disabled. Viewport
  state persists per canonical project path beneath the existing Studio user-state root, surviving
  server-port changes without project mutations. Saved writes are ordered, coalesced during motion,
  and flushed on gesture end or page hide. Ordinary scroll stays with the app; canvas pan now requires
  held Space for both scroll and left/middle drag. Pinch and modifier-wheel zoom remain unconditional
  in Design. Selection geometry refreshes after app scrolling and before selection. Remaining from
  this stride: ⇧1/⇧2 framing shortcuts and counter-scaled sketch-handle strokes.

### Stride D — Focus-selection mode with a red outline on view frames

A tool that answers "which view is this?" before entering it.

- Tool strip button **Focus** (shortcut F). While it is on, hovering the preview outlines not the
  hovered leaf but the boundary of the _view definition occurrence_ that renders it, in a distinct
  red (`--studio-focus-pick`), with the view's name as a label. Click enters canvas mode for that
  view (Stride B frame). Escape leaves the tool.
- Only focusable occurrences light up: views with their own definition in the project (not `Text`,
  `Row`, or other `@tao/ui` primitives) and, once Stride B lands, any view. Package views are skipped.
- The runtime already tags each render with its identity (`occurrence.renderOwner`); the hit test
  walks up from the hovered node to the nearest node whose `renderOwner` differs from the leaf's
  owner and reports that node's rectangle. A row rendered by `StoryRow` in a loop inside `FrontPage`
  outlines the whole row and says "StoryRow". The walk can run inside the preview (the DOM nodes
  carry `studioRenderSelector` attributes and `renderTargetFromElement` decodes them), so the tool
  needs one new preview message, `preview-focus-candidate`, carrying the owner name, its root
  render id, and its rectangle, sent on hover while the tool is on.
- Today's `focusableView()` in `StudioApp.ts` only accepts an owner that already has a
  `data-tao-studio-group-view` row; Stride B's `draft` groups lift that limit, and until then the
  outline is grey with a "no scenario yet" label rather than red.
- The ordinary Select tool (V) keeps the blue outline on the leaf, and its inspector keeps offering
  Focus view for the leaf's owning view, so both paths exist.
- Work: runtime hit-test message (`TR-studio-preview.tsx`), client tool state and outline colour,
  tool strip. One and a half days.

### Stride E — Draw a new view on the canvas

- Tool strip button **Frame** (R). Dragging on empty canvas draws a rectangle that becomes a view
  definition at once: a sketch is created (existing outer draw), snapped immediately into
  `@/studio/<Name>.tao` with a `Placeholder` of that size (FS-D2 warns until it ships something
  real), and a `draft` scenario group so it shows as a focused frame. An inline name field appears
  on the frame; Enter confirms, Escape keeps the generated name.
- The frame's size while editing is Stride B's frame size. The person then adds content with Stride
  F. Deleting the frame while it still holds only the Placeholder removes the view and its group
  (the "server rejects sketch deletion" gap in "Figma-at-home strides" above closes here).
- Work: new tool, immediate snap path through existing catalog and Snap actions, naming UI. One day
  after Strides B and C.

### Stride F — Adding UI into a focused view

Two ways to add, one rule for where it lands.

- **Draw** (R inside a focused frame, or the palette's Text, Image, Row, Col dragged onto the
  frame): the rectangle or component is placed over the frame; on release it snaps into the flow
  (FS-D4, existing drag-one-in), and a drawn rectangle's kind select decides what it becomes.
- **Where it lands.** The default target is the nearest slot among the siblings under the pointer,
  shown by the existing gap indicator. Instead of a modifier deciding "sibling or child", the pointer
  decides by depth with a dwell, as Figma does when dragging into frames: hovering over a container's
  interior for about 400 ms enters it, its outline nests one level, and the gap indicator now shows
  slots among its children; moving out backs up a level. ⌥ forces "into" and ⌘ forces "beside" for
  people who want the override, but nobody has to learn them.
- Reason for not making the modifier primary: a hidden modifier is exactly the kind of invisible
  option this plan is trying to remove, and Figma users already trust the dwell-to-enter gesture.
  The question you raised out loud resolves the same way for both of us: the pointer should say
  where, and the modifier is an escape hatch.
- Every landing is a source action on the focused view (`insert-render` at a slot, `wrap-render`
  where a leaf must become a container, `set-text-content` and `bind-text` for Text), so undo is the
  one ⌘Z stack "Figma-at-home strides" already decided.
- Work: dwell-to-enter in `StudioSketchDragOneIn` and the matrix drop target, nested outline,
  modifier overrides, palette drop onto frames. Two days after Stride B.

### Stride G — Discoverability and calm

- **Tool strip at the bottom centre of the canvas**: Select (V), Focus (F), Frame (R), Text (T),
  Hand (H), and the zoom pill. Six things, with tooltips that carry the shortcut. This replaces the
  hidden drag-on-empty-canvas as the way to start drawing.
- **One lens row.** Merge the two chip rows into one: Compose, Style, Data, Outline, plus a More
  menu holding Trace, Wiring, Tests, Behavior. Drop the duplicate Data. The row lives above the
  editor only in Code mode; in Design mode the inspector's selected section is the lens.
- **Inspector shows one hint until there is a selection**, then the section the selection needs,
  with the others as collapsed headers. Disabled placeholder text disappears.
- **Top bar**: project name, Design/Code/Run, device, and search. Beta ship moves into the project
  menu; Mode: Edit becomes part of the Run tab (Run shows the app interactive, Design does not).
- **Empty states name the next step**: an empty canvas says "Press R to draw your first view";
  a focused frame with only a Placeholder says "Draw or drop something into this frame"; a group
  with no selection says "Click an element to edit it, or press F to focus its view".
- **First-run coach**: three cards over the canvas on the first open of a project — Select, Focus,
  Draw — dismissed once and never again (stored in the catalog).
- Work: half a day each for the tool strip, lens merge, and inspector policy; one day for the top
  bar and empty states; half a day for the coach.

### Order

C (zoom and pan) → A (half-window canvas on the pannable surface) → B (frame at occurrence size,
draft groups) → D (Focus tool, red outline) → G (tool strip, lens merge, inspector policy) → E (Frame
tool) → F (dwell-to-enter insertion). About twelve working days in total; A, B, and G can proceed in
parallel once C has landed.

### Decisions for the Developer

1. Frame size as catalog state with an explicit "Save as scenario size", rather than writing the
   scenario's `Size` on every resize.
2. Dwell-to-enter as the primary "into a container" gesture, with ⌥ (into) and ⌘ (beside) as
   overrides, instead of a modifier as the only way.
3. Red for the Focus tool's outline (`--studio-focus-pick`), blue kept for element selection.
4. Frame tool snaps immediately into a generated view with a `draft` group, rather than leaving a
   free sketch first.
5. Beta ship leaves the top bar for the project menu.

### Verification

Each stride adds a browser-lane scenario under `just studio-smoke` (zoom hit-testing, focus frame
size equals the occurrence size within 1 px, Focus tool outlines the owner not the leaf,
dwell-to-enter lands as a child, empty states present) and a screenshot pair in
`.artifacts/studio-smoke/` reviewed by eye before landing. The simulated lane runs in `verify-full`
and met "Figma-at-home strides"'s ten-green-runs condition on 2026-09-20.

## Post-MVP target — paper sketch to editable Studio views

**Goal.** A person draws one or more UI views on paper, takes a photo, and gives it to an agent
equipped with Tao skills and Studio tools. The agent interprets the drawing and adds free rectangles
matching its view boundaries and elements to Studio sketch views. Those rectangles use the existing
Studio catalog and typed, versioned Studio actions; the photograph does not become Tao source.

**Continuation.** The person can correct, move, resize, retype, or add rectangles with the ordinary
freehand tools. They can snap any chosen rectangles into flowing Tao layout when ready, or leave the
sketch free and continue drawing. The import does not silently snap rectangles, invent data bindings,
or require the person to accept the agent's interpretation as final.

**First acceptance journey.** Photograph a paper drawing containing two distinct views and several
labelled boxes. Import it into Studio, inspect the proposed rectangles, correct one, draw one more,
then snap part of one view while the remaining rectangles stay free and editable. Reopen the project
and confirm both the snapped source and free rectangles persist.

**Open before implementation.** Decide where capture and import enter Studio, how a photo selects a
new or existing view, what the agent may infer from ambiguous strokes or handwriting, and how the
person reviews or undoes the import. This is a post-MVP extension, outside the FS-D20 sequence.
