# Freehand UI sketching — design

The design record for freehand UI sketching in Tao Studio. The **design summary** and FS-D1–FS-D20
below are the authoritative statement of this project's product and language direction. They
supersede older proposals in `Product - Freehand UI sketching.md`; `Docs/Spec/` changes only as
implementation lands. Where a language change is involved, the tranche first writes the settled
spelling into `Apps/WordFlower/2 - Next`, then reconciles Tao Revolution decisions and executable
specifications as that vertical slice lands.

Status: **product discovery closed** (FS-D1–FS-D20, Ro, 2026-09-02). The two L1 spellings called out
as open by FS-D7 and FS-D10 were settled by Ro on 2026-09-03 and are recorded below. Later tranche
spellings remain tranche decisions rather than implementation choices.

Terminology: a **sketch** is what Figma calls a frame. `frame` remains the interaction system's
shell nav kind (KEY-D7) and a retired view kind; freehand work never reuses it.

---

## Design summary

A designer draws a sketch beside the running app, lays out free rectangles as Studio-owned data,
then snaps some or all of them into the Tao view's flowed render tree. Studio creates the public,
read-only generated view immediately under `@/studio`, persists free geometry in the project's
committed Studio catalog, and uses typed source actions for every transition into or edit of Tao
source. Scenarios render real entities, deterministic generated fixtures, and journey-reached
states as variant cells. The Mac remains the source-owning compiler; a later companion renders one
cell and delegates initial Pencil input to a native sidecar.

### Authority and data boundary

- Unsnapped geometry, content hints, and bindings are Studio data in
  `.tao-project/studio/sketches.jsonc`; they are not Tao render nodes.
- Snapping is the only operation that writes those rectangles into a view's flowed Tao render tree.
  A partially snapped sketch is therefore a flowed source subtree plus remaining Studio rows, merged
  by Studio for editing. Later Snap and Unsnap operations patch only their selected Studio-owned
  leaves so manual edits and flow actions survive.
- Generated project source lives under the reserved root package `@/`, one generator per subfolder.
  Studio owns `@/studio/*.tao`; developers take ownership through Move to package.
- A snapped `Placeholder` is valid product source. Development makes it visibly labelled and
  hatched; release renders its empty dimensions and `tao check` warns.
- The Studio server owns file and catalog persistence. Browser and companion clients use the paired,
  versioned session and never write project files directly.

### Scenario and variant boundary

- Scenario entries may omit a fixture when no fixture handle is referenced. Required action
  parameters omitted by a focused render receive logging stand-ins.
- A scenario entry may contain ordered test-shaped steps after its subject. Pointer phase, hover,
  and focus steps extend the existing step seam; states are reached by replay, never forced.
- Duplicate cells are scenario entries over one definition. Generated values are deterministic and
  become durable only when promoted to ordinary fixture rows.
- Editing a variant cell is an explicit persistent mode. Conditional changes default to the cell's
  non-default arguments and write their conjunction as a postfix `when` condition.

### Layout and device boundary

- Snap begins with deterministic projection inference and asks through the existing proposal
  endpoint when projection is ambiguous, including overlap or two clean separating axes. Unsnap
  prefers the remembered rectangle position, dropping stale render matches and falling back to
  measured layout.
- Free rectangle rendering begins as a TypeScript matrix overlay. A later positioned-container
  tranche moves it into Studio's own Tao client after the `Canvas` and offset spellings are settled.
- The companion waits for Tao rendering and an app shell. One device renders one cell. PencilKit
  initially owns canvas input and emits typed events; Tao owns data, rendering, and source actions.

### What is derived, never declared

- `View1`, `View2`, … comes from a project-wide monotonic allocator; deleted numbers are not reused.
- Snap direction, nesting, gap, pad, fill, claim, fixed dimensions, and hug behavior are inferred
  from geometry by the FS-D11 projection rules.
- Generated snapped leaves carry a private source marker so a catalog rectangle can recover the
  compiler manifest identity after recompilation. Only Studio-owned `@/studio` source publishes that
  identity, and Move to package removes the marker.
- A focused instance's entity and handle come from the interaction outline's item provenance. No
  second binding graph is declared.
- Generated example values come from a stable seed plus field name and type vocabulary.
- A variant edit's initial `when` condition is the conjunction of its non-default arguments.

### Boundaries

- Tao source owns declarations and every flowed element; Studio's catalog owns only free geometry.
- `@/` is committed generated source, not a scratch cache. Fixers check it but do not rewrite it.
- Source actions keep the existing project, app, preview, source-version, revision-bound range,
  render-owner, node-kind, and cell/scenario trust boundary.
- The positioned container is a language capability forced by Studio, but still follows the normal
  WordFlower tranche and absorption process.
- Runtime interaction states remain runtime-owned, modality-neutral, unsettable, and unrestored per
  KEY-D8. Scenario steps produce them through ordinary events.
- The native sidecar never owns Tao source or durable sketch state.

### Deferred

- Scenario world controls for text scale, loading, and empty.
- Model-generated example suggestions; they later use the same fixture-promotion path.
- Fixture-through-action semantics for explicit real action parameters.
- Focus-in until interaction-outline item provenance lands.
- The companion until its app shell exists, Tao rectangle rendering has landed, and the required
  physical-device proof can run.
- Shrinking the native sidecar toward ink-only as Tao gesture primitives land.

### L1 tranche decisions

- Scenario pointer phases are `press down <selector>` and `press up <selector>`; hover is
  `hover <selector>`. All three accept the existing text, label, placeholder, and `#tag` selector
  family. Focus is tag-only as `focus #tag`. Plain `press` remains a complete activation.
- `Spacer()` is the semantic flexible-space leaf. It has implicit `claim 1`, and an explicit
  `[claim N]` overrides that weight.

---

## Decisions

The following rulings are recorded verbatim from the project requirement authority.

> **FS-D1 — Unsnapped rectangles are Studio data, never Tao code.** They are rows in Studio's own
> catalog (`Sketch` with `Name`, `Project`, `View`, `Width`, `Height`, owned ordered `Rects`;
> `Rect` with `X`, `Y`, `Width`, `Height`, `Kind`, `Content?`, `Binding?`), rendered by Studio's
> own Tao client positioned absolutely on the canvas. A sketched view's render tree is written only
> by snapping and holds only flowed elements. The product draft's `Sketch` container, `at` clause
> in product source, and nested sketches are withdrawn.

> **FS-D2 — Nothing gates release.** An app contains only views, so no sketch-tier diagnostic
> exists. A snapped but unbound placeholder ships as an empty box of its size, and `tao check`
> warns that a `Placeholder` is shipping.

> **FS-D3 — The root `@` package holds generated code.** Every Tao project has a committed `@/`
> folder at its root, meant only for generated source, one subfolder per generator. Studio writes
> one file per view at `@/studio/<Name>.tao`, imported as `use <Name> from @/studio`; the view is
> `public`; it reaches the project's declarations through ordinary relative imports
> (`use Playlist from ../../Data`). Studio writes the file with mode `0444`, flips the owner bit
> to write and back, and re-asserts `0444` on every `@/studio/*.tao` when it opens a project,
> because Git does not track the write bit. Never use the macOS immutable flag; Git cannot replace
> an immutable file. The fix lanes (`tao fix`, `dprint fmt`) are check-only under `@/`. A header
> comment says the file is Studio-written and read-only until moved. `tao create` scaffolds an
> empty `@/`. A "Move to package" action moves the file with history, rewrites every
> `use … from @/studio` site, and asks only when the target package already declares the name.

> **FS-D4 — Sketch data persists in `.tao-project/studio/sketches.jsonc`**, written by the Studio
> server's provider and committed by default. The companion app reads it through the paired session,
> never the file.

> **FS-D5 — Rendering the rectangles.** The language direction is a positioned container, working
> name `Canvas`, whose direct children carry an offset clause, working name `at x y`, with Studio's
> own Tao client as the forcing feature. It is decided through the tranche process; its spelling is
> settled with Ro in `2 - Next` before that tranche starts. Until it lands, Studio draws rectangles
> as a TypeScript overlay in the matrix view. Tao rendering must land before the companion slice.

> **FS-D6 — What travels with a view.** Declarations that relate only to the view, its `scenarios`
> group above all, live in the view's file. Shared declarations, the example fixture `Sketches`
> above all, live in `@/studio/Sketches.tao`. Move to package offers to relocate the group into the
> app's `Scenarios.tao`, defaulting to yes.

> **FS-D7 — States are reached by steps, never forced.** A scenario entry accepts ordered steps
> after its subject, spelled exactly as in a test body, so an entry is a journey prefix that ends
> in a state. The step seam gains phase and pointer steps, proposed as `press down "…"`,
> `press up "…"`, `hover "…"`, and `focus #tag`, each lowering to the testing library's own events;
> a held press with `advance 600.ms` is the long press. There is no `while pressed` world control.
> Studio replays an entry's steps when its cell mounts and the cell stays interactive afterwards.

> **FS-D8 — A required `action` parameter may be omitted in a scenario `render`.** The harness
> binds a stand-in that records each invocation in the cell's log. No spelling. When
> fixture-through-action semantics are adopted, an explicit real action becomes the upgrade.

> **FS-D9 — A fixture is optional in a scenario entry.** Absence means an empty store. The
> validator requires one when the entry's arguments or `prepare` block reference handles.

> **FS-D10 — `Placeholder` is a stdlib element.** `Placeholder("Cover art") [width 52, height 52]`
> renders as a labelled hatched box in development and an empty box of its size in release. It may
> carry a binding hint, act as a drop target for field chips in a running cell, show as unbound in
> the inspector, and count in the design check. A `Spacer` element is the leaning for the spacer
> role; its spelling versus `Box [claim 1]` is settled in `2 - Next`.

> **FS-D11 — Snap.** Implement basic projection inference first (one clean separating axis is
> the container direction; stacked boxes in one lane nest in the other direction; the median
> neighbour distance is `gap`; the distance to the sketch edge is `pad`; a box touching both
> edges is `fill`; the widest slack puts `claim 1` on its neighbour; drawn sizes stay `width` and
> `height`; text and images hug). When projections overlap, show the proposed tree as an overlay
> through the existing proposal endpoint before applying. Beside inference: dragging one unsnapped
> rectangle over a view shows where it would land using the gap indicators palette drops already
> use, and spacers split a row, with dragging a spacer in edit mode rewriting the neighbours'
> `claim` weights through the existing layout action. Evidence that closes the inference: over a
> corpus of fifteen to twenty real screens flattened to rectangles, at least four in five snap
> without the overlay and no snapped tree needs more than two inspector fixes.

> **FS-D12 — Unsnap.** A rectangle row keeps its canvas position after snapping and unsnapping
> returns the element there. Rows match view nodes by the manifest's render identity while Studio
> runs; a row whose node was deleted, retyped, or cannot be matched on reopen is dropped, and
> unsnap then falls back to measured layout.

> **FS-D13 — Naming.** New views are `View1`, `View2`, … numbered project-wide and never reused,
> with the file `@/studio/View1.tao` created the moment the view is created on the canvas. A Tao
> identifier cannot hold a space; spaced names are not adopted. Until the first snap the view's
> render tree is one `Placeholder` the size of the sketch.

> **FS-D14 — Duplicate is Option-drag** on the Mac and long-press then Duplicate on the
> companion.

> **FS-D15 — Focus-in takes an instance's arguments from the interaction outline's item
> provenance** (entity plus handle per loop item, KEY-D). Focus-in is sequenced after that
> provenance lands with the keyboard tranches; editing in place inside the app cell covers the
> need meanwhile. A live-store row is captured into the fixture before the entry references it.

> **FS-D16 — Generated example values are deterministic** from a seed, with a vocabulary keyed by
> field name and type (titles, people, addresses, placeholder images; text in short, long, and
> empty forms; numbers as zero, typical, and large). A generated value reaches source only when the
> cell is kept, and then as an ordinary fixture row. Model-generated suggestions come later and
> promote the same way.

> **FS-D17 — Editing inside a variant cell is a persistent mode**, shown on the cell as
> "Editing: this state" or "Editing: all states", defaulting to the state when the cell has
> non-default arguments. The written condition is the conjunction of the cell's non-default
> arguments (`when Disabled and Busy`), and the inspector lets the designer drop a term. No
> per-edit prompt.

> **FS-D18 — The companion canvas.** A device shows one cell at a time, stepping through a group,
> until every runtime store a cell uses is instance-scoped. A native sidecar (PencilKit through an
> Expo module, declared as a foreign view with `accepts content slots`) owns all canvas input at
> first — ink, selection, move, resize — and emits typed events (`Drew action(RectShape)`,
> `Wrote action(text, Rect)`, `Moved action(Rect, RectShape)`); Tao owns the data, the rectangle
> rendering through the positioned container, and every source action to the paired Mac. The
> sidecar shrinks toward ink-only as Tao gesture primitives land from the drag-and-drop example app.

> **FS-D19 — Rectangle creation is a pencil mode, not recognition.** Hold the pencil's side
> gesture, put the tip down at one corner, drag to the opposite corner, lift or release to commit.
> Apple Pencil Pro's squeeze reports began, changed, and ended phases; Apple Pencil 2's double-tap
> toggles the rectangle tool; the strip carries a rectangle tool for fingers and other styluses.
> Text is Apple Scribble. No free-ink shape recognition.

> **FS-D20 — Order.** The scenario and stdlib tranche (L1) first, then Studio slices 1 (Draw)
> and 2 (Snap) together, then 3 (Feed), then the executable-dialect tranche (L2) and slice 4
> (Variants), then the positioned container (L3) and slice 5 (Tao-rendered canvas), slice 6
> (Focus-in) when the interaction outline's provenance has landed, slice 7 (Companion) after the
> companion app shell exists. If budget runs out, later slices are dropped, never interleaved
> half done.

## Withdrawn

- The `Sketch` container and `at` in product source.
- A release rule on sketch content or any other sketch-tier diagnostic.
- `Sketches.tao` at the app root.
- `while pressed` and all forced interaction-state world controls.
- A root-absolute import form distinct from the root `@` package.
- Spaced Tao identifiers.
- Free-ink shape recognition.

The product document preserves alternatives as history but labels these choices withdrawn and points
to the corresponding FS-D decision.
