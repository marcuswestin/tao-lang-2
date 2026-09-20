# Freehand UI sketching — record the decisions, write the plan, implement the first slices

Implement freehand UI sketching in Tao Studio, in the Tao repository.

This is an implementation project with a short documentation phase in front of it. Ro has already
ruled on every open question in the product draft; your first job is to record those rulings as a
design record, reconcile the product document with them, and write the implementation plan. Your
second job is to execute that plan's first slices as tested vertical slices, in the mandated order,
stopping cleanly rather than leaving a slice half done.

This prompt is the project's requirement authority. It is committed at
`Docs/Roadmap/Freehand UI sketching/Prompt - Freehand UI sketching.md` on the branch
`feat/freehand-ui-sketching-7207ce`, beside the product document it completes. Base your work on
that branch. Where this prompt and older repository documents disagree, this prompt reflects the
newer intent; where it and `Docs/Roadmap/Tao Revolution/Decisions.md` disagree, Decisions remains
the decided language until a tranche amends it, and the rulings below are what the tranche writes
into it.

Terminology: this project says **sketch** for what Figma calls a frame. `frame` is the interaction
system's shell nav kind (KEY-D7) and a retired view kind, and is not to be reused.

## What the product is

Read `Docs/Roadmap/Freehand UI sketching/Product - Freehand UI sketching.md` and its wireframes
first. In one paragraph: a designer draws a rectangle on Studio's canvas beside the running app and
gets a sketch; draws boxes inside it where they want them; snaps them into flowing layout when
ready; feeds the sketch with a real entity by dragging it in and binding its fields; duplicates the
cell to see other arguments and states; focuses into a view that appears everywhere and edits the
one definition; and does a good part of this on an iPad with a pencil. Everything that flows is Tao
source. Everything that has not flowed yet is Studio data. The draft's user stories are the
behavior to reach; the draft's proposals are superseded wherever the rulings below say otherwise.

## Settled rulings (Ro, 2026-09-02)

Do not reopen these. Record them verbatim in the design record as FS-D1 to FS-D20 and cite them
from the plan.

1. **FS-D1 — Unsnapped rectangles are Studio data, never Tao code.** They are rows in Studio's own
   catalog (`Sketch` with `Name`, `Project`, `View`, `Width`, `Height`, owned ordered `Rects`;
   `Rect` with `X`, `Y`, `Width`, `Height`, `Kind`, `Content?`, `Binding?`), rendered by Studio's
   own Tao client positioned absolutely on the canvas. A sketched view's render tree is written only
   by snapping and holds only flowed elements. The product draft's `Sketch` container, `at` clause
   in product source, and nested sketches are withdrawn.
2. **FS-D2 — Nothing gates release.** An app contains only views, so no sketch-tier diagnostic
   exists. A snapped but unbound placeholder ships as an empty box of its size, and `tao check`
   warns that a `Placeholder` is shipping.
3. **FS-D3 — The root `@` package holds generated code.** Every Tao project has a committed `@/`
   folder at its root, meant only for generated source, one subfolder per generator. Studio writes
   one file per view at `@/studio/<Name>.tao`, imported as `use <Name> from @/studio`; the view is
   `public`; it reaches the project's declarations through ordinary relative imports
   (`use Playlist from ../../Data`). Studio writes the file with mode `0444`, flips the owner bit
   to write and back, and re-asserts `0444` on every `@/studio/*.tao` when it opens a project,
   because Git does not track the write bit. Never use the macOS immutable flag; Git cannot replace
   an immutable file. The fix lanes (`tao fix`, `dprint fmt`) are check-only under `@/`. A header
   comment says the file is Studio-written and read-only until moved. `tao create` scaffolds an
   empty `@/`. A "Move to package" action moves the file with history, rewrites every
   `use … from @/studio` site, and asks only when the target package already declares the name.
4. **FS-D4 — Sketch data persists in `.tao-project/studio/sketches.jsonc`**, written by the Studio
   server's provider and committed by default. The companion app reads it through the paired session,
   never the file.
5. **FS-D5 — Rendering the rectangles.** The language direction is a positioned container, working
   name `Canvas`, whose direct children carry an offset clause, working name `at x y`, with Studio's
   own Tao client as the forcing feature. It is decided through the tranche process; its spelling is
   settled with Ro in `2 - Next` before that tranche starts. Until it lands, Studio draws rectangles
   as a TypeScript overlay in the matrix view. Tao rendering must land before the companion slice.
6. **FS-D6 — What travels with a view.** Declarations that relate only to the view, its `scenarios`
   group above all, live in the view's file. Shared declarations, the example fixture `Sketches`
   above all, live in `@/studio/Sketches.tao`. Move to package offers to relocate the group into the
   app's `Scenarios.tao`, defaulting to yes.
7. **FS-D7 — States are reached by steps, never forced.** A scenario entry accepts ordered steps
   after its subject, spelled exactly as in a test body, so an entry is a journey prefix that ends
   in a state. The step seam gains phase and pointer steps, proposed as `press down "…"`,
   `press up "…"`, `hover "…"`, and `focus #tag`, each lowering to the testing library's own events;
   a held press with `advance 600.ms` is the long press. There is no `while pressed` world control.
   Studio replays an entry's steps when its cell mounts and the cell stays interactive afterwards.
8. **FS-D8 — A required `action` parameter may be omitted in a scenario `render`.** The harness
   binds a stand-in that records each invocation in the cell's log. No spelling. When
   fixture-through-action semantics are adopted, an explicit real action becomes the upgrade.
9. **FS-D9 — A fixture is optional in a scenario entry.** Absence means an empty store. The
   validator requires one when the entry's arguments or `prepare` block reference handles.
10. **FS-D10 — `Placeholder` is a stdlib element.** `Placeholder("Cover art") [width 52, height 52]`
    renders as a labelled hatched box in development and an empty box of its size in release. It may
    carry a binding hint, act as a drop target for field chips in a running cell, show as unbound in
    the inspector, and count in the design check. A `Spacer` element is the leaning for the spacer
    role; its spelling versus `Box [claim 1]` is settled in `2 - Next`.
11. **FS-D11 — Snap.** Implement basic projection inference first (one clean separating axis is
    the container direction; stacked boxes in one lane nest in the other direction; the median
    neighbour distance is `gap`; the distance to the sketch edge is `pad`; a box touching both
    edges is `fill`; the widest slack puts `claim 1` on its neighbour; drawn sizes stay `width` and
    `height`; text and images hug). When projections overlap, show the proposed tree as an overlay
    through the existing proposal endpoint before applying. Beside inference: dragging one unsnapped
    rectangle over a view shows where it would land using the gap indicators palette drops already
    use, and spacers split a row, with dragging a spacer in edit mode rewriting the neighbours'
    `claim` weights through the existing layout action. Evidence that closes the inference: over a
    corpus of fifteen to twenty real screens flattened to rectangles, at least four in five snap
    without the overlay and no snapped tree needs more than two inspector fixes.
12. **FS-D12 — Unsnap.** A rectangle row keeps its canvas position after snapping and unsnapping
    returns the element there. Rows match view nodes by the manifest's render identity while Studio
    runs; a row whose node was deleted, retyped, or cannot be matched on reopen is dropped, and
    unsnap then falls back to measured layout.
13. **FS-D13 — Naming.** New views are `View1`, `View2`, … numbered project-wide and never reused,
    with the file `@/studio/View1.tao` created the moment the view is created on the canvas. A Tao
    identifier cannot hold a space; spaced names are not adopted. Until the first snap the view's
    render tree is one `Placeholder` the size of the sketch.
14. **FS-D14 — Duplicate is Option-drag** on the Mac and long-press then Duplicate on the
    companion.
15. **FS-D15 — Focus-in takes an instance's arguments from the interaction outline's item
    provenance** (entity plus handle per loop item, KEY-D). Focus-in is sequenced after that
    provenance lands with the keyboard tranches; editing in place inside the app cell covers the
    need meanwhile. A live-store row is captured into the fixture before the entry references it.
16. **FS-D16 — Generated example values are deterministic** from a seed, with a vocabulary keyed by
    field name and type (titles, people, addresses, placeholder images; text in short, long, and
    empty forms; numbers as zero, typical, and large). A generated value reaches source only when the
    cell is kept, and then as an ordinary fixture row. Model-generated suggestions come later and
    promote the same way.
17. **FS-D17 — Editing inside a variant cell is a persistent mode**, shown on the cell as
    "Editing: this state" or "Editing: all states", defaulting to the state when the cell has
    non-default arguments. The written condition is the conjunction of the cell's non-default
    arguments (`when Disabled and Busy`), and the inspector lets the designer drop a term. No
    per-edit prompt.
18. **FS-D18 — The companion canvas.** A device shows one cell at a time, stepping through a group,
    until every runtime store a cell uses is instance-scoped. A native sidecar (PencilKit through an
    Expo module, declared as a foreign view with `accepts content slots`) owns all canvas input at
    first — ink, selection, move, resize — and emits typed events (`Drew action(RectShape)`,
    `Wrote action(text, Rect)`, `Moved action(Rect, RectShape)`); Tao owns the data, the rectangle
    rendering through the positioned container, and every source action to the paired Mac. The
    sidecar shrinks toward ink-only as Tao gesture primitives land from the drag-and-drop example app.
19. **FS-D19 — Rectangle creation is a pencil mode, not recognition.** Hold the pencil's side
    gesture, put the tip down at one corner, drag to the opposite corner, lift or release to commit.
    Apple Pencil Pro's squeeze reports began, changed, and ended phases; Apple Pencil 2's double-tap
    toggles the rectangle tool; the strip carries a rectangle tool for fingers and other styluses.
    Text is Apple Scribble. No free-ink shape recognition.
20. **FS-D20 — Order.** The scenario and stdlib tranche (L1) first, then Studio slices 1 (Draw)
    and 2 (Snap) together, then 3 (Feed), then the executable-dialect tranche (L2) and slice 4
    (Variants), then the positioned container (L3) and slice 5 (Tao-rendered canvas), slice 6
    (Focus-in) when the interaction outline's provenance has landed, slice 7 (Companion) after the
    companion app shell exists. If budget runs out, later slices are dropped, never interleaved
    half done.

Withdrawn by these rulings: the `Sketch` container and `at` in product source; the release rule on
sketch content; `Sketches.tao` at the app root; `while pressed`; a root-absolute import form; spaced
identifiers; free-ink shape recognition. Still missing and out of this project's scope unless a
slice needs it: scenario spellings for text scale, loading, and empty as world controls.

## Repository workflow

1. Read, in this order:
   - `AGENTS.md`, `packages/AGENTS.md`, `Apps/WordFlower/README.md`, `Apps/Test Apps/AGENTS.md`
   - `Docs/Roadmap/Freehand UI sketching/Product - Freehand UI sketching.md` and its `wireframes/`
   - `Docs/Roadmap/Tao Revolution/Decisions.md`, `Process.md`, `Coverage.md`
   - `Docs/Spec/Tao Studio.md` (especially "Scenario groups", "Editing, identity, and trust",
     "Product workbench and design", and "Current boundary"), `Docs/Spec/Tao Testing.md`,
     `Docs/Spec/Tao Layout and UI.md`, `Docs/Spec/Tao Packages.md`
   - `Docs/Roadmap/Keyboard driven apps/Design - Keyboard driven apps.md` (design summary and
     KEY-D7, KEY-D8, KEY-D13) and `Plan - Keyboard driven apps.md` (the plan format to follow)
   - `Docs/Roadmap/Tao Studio v2/Prompt - Complete Tao Studio v2.md` (settled ruling 1: Studio is a
     forcing app) and `Plan - Tao Studio v2.md`
   - `Docs/Archive/Explorations/Exploration - Native device as Studio canvas.md` and the companion
     app section of `Docs/Roadmap/Tao ship/Plan - Beta distribution in one command.md`
   - `packages/source-actions/source-actions-src/studio-actions.ts`,
     `packages/studio/studio-src/StudioInspector.ts`, `packages/studio/README.md`
2. Inspect Git status, `git worktree list`, and the branch. Other agents and Ro work concurrently in
   other worktrees; preserve changes you did not make.
3. Run `./agent verify` before any edit to confirm the green baseline.
4. Use the repository skills: `git-workflow`, `studio-hybrid-client`, `runtime-codegen`,
   `test-quality`, `error-handling`, `dev-automation`, `langium-scoping`, and
   `parallel-implementation` where workstreams genuinely do not share seams.
5. Work on the `feat/freehand-ui-sketching-7207ce` branch or a `feat/<name>` branch cut from it.
   Never commit from detached HEAD. Never touch the index unless asked. No agent identity in any
   work product.
6. Language changes go through the tranche: contract in `Apps/WordFlower/2 - Next`, then grammar,
   scoping, validator, formatter, source actions, compiler, runtime, stdlib, proven by behavior tests
   written in Tao, absorbed into `1 - Current`, with `Decisions.md`, `Docs/Spec/`, and `Coverage.md`
   reconciled in the same change. Studio's own client is a forcing app and forces the positioned
   container; WordFlower still absorbs every new spelling in the same tranche.
7. Anything a tranche's "Open before starting" list names is settled with Ro in `2 - Next` before
   the tranche begins. Do not guess spellings; do not reopen the rulings above.
8. Run `./agent verify` before every commit. Keep a developer-environment ledger and carry every
   subagent's entries.

## Deliverables, in order

### 1. The design record

Write `Docs/Roadmap/Freehand UI sketching/Design - Freehand UI sketching.md` in the shape of
`Design - Keyboard driven apps.md`: a design summary that states FS-D1 to FS-D20 with the
sub-rulings above, what is derived rather than declared, the boundaries, the withdrawn items, and
the deferred items. Rationale may be brief; the product document holds the alternatives that were
weighed. This record is authoritative for the project over every other markdown document, the same
way KEY-D is.

### 2. Reconcile the product document

Update `Product - Freehand UI sketching.md` and the wireframes wherever a ruling overrode the
draft: the sketch tier sections and the `Sketch`/`at` snippets become the Studio data model and
the positioned container; the FS-Q list becomes pointers to FS-D; stories 3 and 4 describe free
rectangles over a snapped view and partial snapping as data plus merge; `Sketches.tao` at the app
root becomes `@/studio`; `Untitled1` becomes `View1`; `Placeholder` replaces sized empty `Box` in
the snapped examples; `while pressed` becomes steps; the companion section states one cell per
device, the sidecar boundary, and squeeze-to-draw; wireframe 6's caption and wireframe 4's code
follow. Keep the wireframes as hand-authored SVGs. Run `dprint fmt` on the markdown.

### 3. The plan

Write `Docs/Roadmap/Freehand UI sketching/Plan - Freehand UI sketching.md` in the shape of
`Plan - Keyboard driven apps.md`: ground rules, a sequence table, and one section per tranche with
its forcing feature, dependencies, size, what it introduces, its tests, its documentation
reconciliation, and its "Open before starting" list. The tranches:

- **L1 — scenario steps, stand-ins, optional fixture, `Placeholder` and `Spacer`** (FS-D7, D8,
  D9, D10). Forcing feature: a WordFlower scenario that holds a pressed button and a `Placeholder`
  in Studio's own client. Open before starting: the step spellings, `Spacer` versus `Box [claim 1]`.
- **Tooling — the `@` package** (FS-D3): resolver support for the bare `@` package and
  `@/<subfolder>`, `tao create` scaffolding, fix lanes check-only under `@/`, Studio's `0444`
  assertion. No language change.
- **Slice 1 — Draw** (FS-D1, D4, D13, D14): the canvas gesture, `Sketch` and `Rect` rows in
  `.tao-project/studio/sketches.jsonc`, rectangles as a TypeScript overlay, `@/studio/View1.tao`
  with its group and cell, retyping a rectangle's kind and typing text into it as data,
  Option-drag duplicate of a rectangle.
- **Slice 2 — Snap** (FS-D11, D12): inference and the proposal overlay, drag-one-in with the
  landing indicator, unsnap, spacers with `claim` dragging, direction toggle, separators, measured
  rectangles reported from the preview for the fallback. Build the inference corpus here.
- **Slice 3 — Feed** (FS-D6, D16): entity drop to parameter and argument, field chips binding
  rectangles and snapped nodes, the four example sources, promotion into `fixture Sketches`,
  `insert-project-view` binding arguments from scope.
- **L2 — the executable dialect catches up**: `yes / no` as a parameter type with `yes` and `no`
  literals; postfix `when` over parameters and interaction states. Already decided in
  `Decisions.md`; forcing feature in WordFlower.
- **Slice 4 — Variants** (FS-D7, D14, D17): Option-drag duplicate of a cell with generated
  arguments, expand all states, the editing mode writing `when` clauses, steps in entries for
  pressed and hovered cells.
- **L3 — the positioned container** (FS-D5), forced by Studio's own client. Open before starting:
  the container and offset spellings, and their relation to KEY-D7's anchored layers.
- **Slice 5 — Tao-rendered canvas** (FS-D5): the overlay replaced by Tao rendering through L3.
- **Slice 6 — Focus-in** (FS-D15), after the interaction outline's provenance has landed.
- **Slice 7 — Companion** (FS-D18, D19), after the companion app shell exists and slice 5 has
  landed: the sidecar ink canvas, squeeze rectangles, Scribble, one cell per device, source actions
  over the paired session.

Every slice carries a Tao behavior test per language construct it introduces, a Studio journey per
gesture in `packages/studio/studio-tests` or the smoke lanes `packages/studio/README.md`
describes, and updates to the documents that own the touched contracts.

Commit deliverables 1 to 3 together, then update `Roadmap.md`'s Records entry for the folder and
add the project under "Toward v1" pointing at the plan.

### 4. Execute

Implement L1, the `@` tooling, slice 1, and slice 2, in that order, each as a tested vertical slice
committed on its own with `./agent verify` green, then continue down FS-D20's order as far as budget
and decision latency allow. A slice whose "Open before starting" list is unsettled waits for Ro; do
not skip ahead past a dependency. Stop cleanly: every commit leaves Current green and absorbed for
what landed, and the tranche status honestly open where a decision is pending.

## Handoff

End with a report that reconciles against this prompt: what landed per deliverable and slice, what
is open and why, the decisions still waiting on Ro with your recommendation for each, the
documents updated, and a `Developer environment` summary that separates issues fixed, remaining
repository improvement suggestions, and external or policy limitations, with exact user steps for
anything you could not complete. Say plainly when nothing was found.
