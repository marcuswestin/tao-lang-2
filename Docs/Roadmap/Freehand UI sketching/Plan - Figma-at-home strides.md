# Plan - Figma-at-home strides

Status: adopted 2026-09-04 with Ro's rulings recorded in the decisions section; implementation in
progress. It builds on the landed foundation of `feat/freehand-ui-sketching-implementation` and does not reopen FS-D1–FS-D20 or
reorder the remaining slices in `Plan - Freehand UI sketching.md`. It names the first strides that
make Studio feel like home to a person fluent in Figma: the reflexes they bring with them (keys,
selection, undo, guides, numeric fields), a Snap they can trust, and a sketch fed with real data.
Strides 1, 2, and 4 are polish of the landed Draw and Snap slices; stride 3 finishes Feed, which is
the next slice in FS-D20's mandated order.

## Where the work stands

The foundation landed on `main` as squash `13d2577c` (2026-09-04 22:20).

Landed: L1 (ordered scenario steps, pointer phases, action stand-ins, optional fixture,
`Placeholder`, `Spacer`), the root `@` package with Move to package, Slice 1 Draw, Slice 2 Snap with
the transactional Unsnap and typed flow actions, the Slice 3 Feed server foundations, and the review
roadmap's first two targets (Record journey, `tao review`).

Browser evidence: the simulated smoke lane, the only real-browser proof of Draw and Snap, is
quarantined from `full-verify` again (`just _full-verify-simulated` reproduces it). The landing
fixed a real product bug it exposed: the board's pointer handler swallowed toolbar clicks, so Snap
could not be pressed with a mouse. After that fix the synthetic CDP drags themselves proved
nondeterministic (one run left the catalog at revision 1 with no rectangle), and the ledger in
`Developer environment upgrades.md` asks for a deterministic browser action boundary and ten
consecutive green runs before the lane rejoins the graph. Native and canary lanes report
`native-host-busy` under an agent host and pass only from an ordinary Terminal.

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

## Figma reflex to Tao Studio

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

## Stride 0 — Real-browser proof for Draw and Snap

**Goal.** Every later stride adds gestures; none of them can claim browser evidence while the only
browser lane for sketching is quarantined. Make that lane deterministic and bring it back.

**Done (2026-09-04).** Hit-test diagnostics in the lane showed the failures were product defects:
the toolbar covered the drawing surface, drag-one-in depended on an HTML5 drag the move gesture
suppressed, and a re-render could replace a board mid-gesture. All three are fixed with pure
helpers and unit tests: the toolbar and proposal live in a frame around the board, drag-one-in is a
pointer gesture released over the sketch's running cell, and renders are held while a gesture is in
flight. The lane now passes Draw, four further draws, Snap, and reload in a normal terminal, runs
the sketch section in the Run preset at a designer-sized viewport, and records board state, the
element under the pointer, host errors, and a screenshot on every sketch timeout.

**Open.** Drag-one-in in the real browser: the release reaches the board and requests a
one-rectangle Snap, which the server refuses because the rectangle sits between two flowed siblings
(`Studio Snap cannot preserve authored source for interleaved rectangle geometry`). Stride 2 owns
inserting into an existing flow or routing it through the proposal. Then ten consecutive green
runs, remove the `FULL_VERIFY_SKIPPED` quarantine, restore the `agent-worktree-profile` expectation,
and close DEVENV-042. Confirm native and canary from the Terminal in the same pass.

**Size.** S–M remaining. **Depends on.** Nothing.

## Stride 1 — Reflexes on the sketch

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
- **i. Inline text.** Double-click a `Text` rectangle to edit its content in place; Enter commits,
  Escape cancels.

**Tests.** A Studio journey per gesture in `studio-sketch-view.test.ts` and `studio-sketch-session.test.ts`;
the simulated smoke lane gains one keyboard pass (draw, nudge, duplicate, delete, undo, marquee) and
one guide pass (a drawing that snaps to guides projects without a proposal). Every journey asserts
that no gesture other than Snap writes the Tao render tree.

**Reconcile.** `Docs/Spec/Tao Studio.md` (gesture and key contract, rename, delete, sketch resize),
`packages/studio/README.md`.

**Size.** L overall: a S, b M, c S, d M, e M, f M, g M, h M, i S. **Depends on.** Stride 0.

## Stride 2 — A Snap you can trust, and Figma gestures on flowed views

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

## Stride 3 — Feed in the client

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

**Tests.** The journeys `Plan - Freehand UI sketching.md` already assigns to Slice 3.

**Size.** L. **Depends on.** Stride 0; benefits from stride 1's selection and undo.

## Stride 4 — The canvas as a place

**Goal.** A phone-sized sketch fits on screen and a person moves around it the way they expect.

- ⌘+wheel and pinch zoom, ⌘0 for 100%, ⇧1 fit, ⇧2 zoom to selection; space-drag and trackpad pan.
- Zoom-aware pointer math for every stride 1 gesture; guides and handles keep screen size.
- Several sketches per group row; optional rulers.

**Size.** M. **Depends on.** Stride 1b (the tool model owns the space key).

## After these strides

FS-D20's order continues unchanged: L2, Slice 4 Variants, L3, Slice 5 Tao-rendered canvas, Slice 6
Focus-in, Slice 7 Companion. Stride 2d's flow gestures serve variant cells later, and stride 1's
undo stack is what Slice 4's cell edits will join.

## Decisions

Settled by Ro on 2026-09-04, taking the recommendations.

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

A decision discovered during implementation joins the next round with Ro; it is not decided silently.

## Sizes and dependencies

| Stride | Size | Depends on | Language change |
| ------ | ---- | ---------- | --------------- |
| 0      | S–M  | none       | none            |
| 1      | L    | 0          | none            |
| 2      | L    | 0          | none            |
| 3      | L    | 0          | none            |
| 4      | M    | 1b         | none            |

## Verification

Each stride lands with a Studio journey per gesture in `packages/studio/studio-tests`, its smoke-lane
steps green on a host with Chrome, `./agent verify` green, and the Studio spec and README reconciled
to what landed. Corpus numbers are reported as measured, never rounded up to the threshold.
