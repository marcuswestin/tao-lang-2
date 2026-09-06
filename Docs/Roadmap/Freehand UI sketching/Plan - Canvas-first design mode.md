# Plan — Canvas-first design mode

Status: proposal, 2026-09-06. No code changed. Written after a visual inspection of Studio on
`Apps/HNReader` (HNReaderStub, 1440×900 browser pane) and a reading of the canvas-mode proof of
concept, the freehand decisions FS-D1–FS-D20, and `Plan - Figma-at-home strides.md`. Where this plan
and the strides plan overlap, this one is the design intent and the strides plan keeps the order.

## What the inspection showed

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

## Principles

- **One next action per state.** Each state of the canvas has one obvious thing to do, shown once,
  where the eye already is. Everything else waits behind a selection or a menu.
- **The canvas is where design happens.** In Design mode the canvas takes half the window and shows
  the whole app as frames side by side. Source and inspector share the other half.
- **Figma's vocabulary, Tao's model.** Frame, select, focus, hand, zoom, and the bottom tool strip
  mean what a Figma person expects. Underneath, every edit is still a source action on one view
  definition (FS-D3, FS-D12), and free rectangles live in the catalog until they snap (FS-D4).
- **Show, do not list.** Discoverability comes from a short tool strip, hover outlines, and empty
  states that name the one next step, not from more chips.

## Stride A — Canvas takes half the window

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

## Stride B — A focused view gets a frame the size it had

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
- Landed so far (branch `feat/canvas-first-design-mode`, 2026-09-06): `inspectRender` reports
  `owner { view, renderId }`, the server joins it with the selecting cell's measurement when the
  request carries the selection identity, and Focus view applies `owner.rect` as a custom viewport
  and restores it on Back to app. Live check on HNReader: the inspect response carries `owner` but
  no `rect` while the preview does post `preview-layout-measurements`, so the join misses. First
  suspects: the selection identity's `manifestRevision`, `compileRevision`, or `cellRevision` are
  absent or differ from the cell that measured (the measurement key is project, app, manifest
  revision, cell, and instance), or the root `Row` of `StoryRow` is not among the measured renders.
  Until that is fixed the focused frame keeps the device size.
- Narrowed since: a session test now records a measurement for the owning view's root render and
  asserts `inspectRender` returns `owner.rect` for the measuring cell and nothing for another preview
  instance. It passes, so the server join and the identity guard are right and the live miss is on
  the measurement side. The remaining suspects are that no measurement exists for the root render's
  id at all, or that the id the runtime emits for a container render spans differently from the
  source-side `renderIdFor` (offset and end of the `Render` CST node, block included). The next
  live check should read the posted `preview-layout-measurements` payload and compare its ids with
  `owner.renderId` for the same cell; `standardDesignElementName` is not the filter, since it does
  return `Row` for a `@tao/ui` view.

## Stride C — Zoom and pan the way Figma does

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
- Persistence: viewport per project in the catalog (`viewport: {x, y, z}`), restored on open.
- Work: transform layer and gesture handling in `StudioMatrixView`, coordinate helpers, zoom pill,
  keyboard bindings in `StudioApp`. Two days. Lands before Stride A's frames-on-a-surface so the
  surface is pannable from the start.

## Stride D — Focus-selection mode with a red outline on view frames

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

## Stride E — Draw a new view on the canvas

- Tool strip button **Frame** (R). Dragging on empty canvas draws a rectangle that becomes a view
  definition at once: a sketch is created (existing outer draw), snapped immediately into
  `@/studio/<Name>.tao` with a `Placeholder` of that size (FS-D2 warns until it ships something
  real), and a `draft` scenario group so it shows as a focused frame. An inline name field appears
  on the frame; Enter confirms, Escape keeps the generated name.
- The frame's size while editing is Stride B's frame size. The person then adds content with Stride
  F. Deleting the frame while it still holds only the Placeholder removes the view and its group
  (the "server rejects sketch deletion" gap in the strides plan closes here).
- Work: new tool, immediate snap path through existing catalog and Snap actions, naming UI. One day
  after Strides B and C.

## Stride F — Adding UI into a focused view

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
  one ⌘Z stack the strides plan already decided.
- Work: dwell-to-enter in `StudioSketchDragOneIn` and the matrix drop target, nested outline,
  modifier overrides, palette drop onto frames. Two days after Stride B.

## Stride G — Discoverability and calm

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

## Order

C (zoom and pan) → A (half-window canvas on the pannable surface) → B (frame at occurrence size,
draft groups) → D (Focus tool, red outline) → G (tool strip, lens merge, inspector policy) → E (Frame
tool) → F (dwell-to-enter insertion). About twelve working days in total; A, B, and G can proceed in
parallel once C has landed.

## Decisions for Ro

1. Frame size as catalog state with an explicit "Save as scenario size", rather than writing the
   scenario's `Size` on every resize.
2. Dwell-to-enter as the primary "into a container" gesture, with ⌥ (into) and ⌘ (beside) as
   overrides, instead of a modifier as the only way.
3. Red for the Focus tool's outline (`--studio-focus-pick`), blue kept for element selection.
4. Frame tool snaps immediately into a generated view with a `draft` group, rather than leaving a
   free sketch first.
5. Beta ship leaves the top bar for the project menu.

## Verification

Each stride adds a browser-lane scenario under `just studio-smoke` (zoom hit-testing, focus frame
size equals the occurrence size within 1 px, Focus tool outlines the owner not the leaf,
dwell-to-enter lands as a child, empty states present) and a screenshot pair in
`.artifacts/studio-smoke/` reviewed by eye before landing. The quarantined simulated lane stays
quarantined until the strides plan's ten-green-runs condition is met.
