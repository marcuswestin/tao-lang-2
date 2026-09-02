# Product - Freehand UI sketching

Status: product document draft, first version, 2026-09-02. It describes a Tao Studio capability from
the perspectives that matter for designing and then implementing it: the person arriving from Figma,
the language, Studio's architecture, example data, the companion app, and the developer working
beside the designer. It carries user stories, wireframes, alternative ways to meet each need, and
the questions that must be decided before an implementation plan can be cut. Nothing here is
language law: where it touches grammar it proposes and defers to `../Tao Revolution/Decisions.md`,
and every spelling marked _proposed_ is a draft. Tao snippets use the decided dialect (`Col [card]`),
not the executable tranche's `Col() [card]`.

Wireframes live in `wireframes/` beside this file and are embedded where the stories use them.

This document says _sketch_ for what Figma calls a frame. The word `frame` is taken: it is the
interaction system's shell nav kind (KEY-D7) and a retired view kind, and a document about drawing
should not reuse it.

## The intention

Studio already lets a person drag components from a palette into a running app and edit layout and
style through the inspector. This document is about the other way in: drawing. A person who thinks
in Figma should be able to draw a rectangle on the canvas next to the running app, put boxes inside
it where they want them, decide later how those boxes flow, turn boxes into text and images and
buttons, feed the sketch with real data by dragging an entity into it, and end up not with a picture
of a component but with the component — a Tao `view` that already runs in the app, with its states
laid out as cells beside each other. The same person should be able to focus into a button or a row
that appears in twenty places and edit the one definition as a sketch. And they should be able to do
a good part of this on an iPad with a pencil, or on the phone at true size, with the Mac keeping up.

## Why it can be better here than anywhere else

- **The canvas is source.** Studio keeps no hidden layout, example, or runtime state as project truth
  (`Docs/Spec/Tao Studio.md`). Every gesture below is a versioned, undoable source action, so a sketch
  drawn on Tuesday is a view in Git on Wednesday, and a second client — the companion app — sees the
  same sketch because it renders the same compiled cell from the same source.
- **The vocabulary is already Figma's.** Fill container, hug contents, and fixed are `fill`, `hug`,
  and `width N`. Auto layout is `Row` and `Col` with `gap`, `pad`, and `content`. Figma's "absolute
  position inside auto layout" is the sketch tier this document adds. A designer's muscle memory maps
  onto the layout language almost word for word (`Docs/Spec/Tao Layout and UI.md`).
- **Data is real, and example data is shared.** A sketch is fed with an entity, not with a content
  plugin's strings. Its example rows are `fixture` rows — the same rows the tests and the scenario
  gallery use — so a screenshot, a journey, and the designer's sketch cannot drift apart.
- **Variants are one definition.** Figma's copy-and-edit habit produces divergent copies that a
  human keeps in sync. Here a variant is a `scenarios` entry over one `view`, and a difference between
  cells is a `when` clause on one render tree, never a second tree.
- **The preview is the product.** A cell renders the real React Native app, at true size on a
  paired phone. There is no handoff: the Code preset shows the source the whole time, and a developer
  can keep typing in it while the designer draws.
- **States that only a running app has are one pin away.** Dark, offline, right-to-left, another
  locale: the scenario surface already pins them, so a sketch's cells can show them without a designer
  faking them with grey boxes. Loading, empty, and large text need world controls that have not landed
  and are listed under what is missing.

## Vocabulary: Figma to Tao Studio

| Figma                                    | Tao Studio                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| Frame                                    | a sketch: one `view` plus one `scenarios` entry rendered as a cell        |
| Auto layout                              | `Row`, `Col`, `WrappingRow`, `Grid`                                       |
| Fill container / Hug contents / Fixed    | `fill` / `hug` / `width N`, `height N`                                    |
| Absolute position (inside auto layout)   | `at x y` inside a `Sketch` container — the sketch tier (_proposed_)       |
| Padding, gap, alignment                  | `pad`, `gap`, `content`                                                   |
| Component                                | a `view` declaration                                                      |
| Instance                                 | a render site of that view                                                |
| Text property                            | a `text` parameter                                                        |
| Boolean property                         | a `yes / no` parameter                                                    |
| Variant property                         | a `one of` case parameter                                                 |
| Instance-swap property                   | a named slot `@name`, or caller content `@@content`                       |
| Component set (variants)                 | a `scenarios` group; each variant is an entry with arguments              |
| Interactive states (hover, pressed)      | `hovered`, `pressed`, `focused` conditions in a clause list               |
| Variables and modes (light, dark)        | design tokens and `when Scheme is Dark`                                   |
| Styles                                   | design bundles and element defaults in `design { }`                       |
| Content Reel, Sheets sync, Sketch's Data | fixture rows, generated example values, the live store, a fixture library |
| Option-drag to duplicate                 | duplicate the cell as a new scenario entry with generated arguments       |
| Prototype link                           | `present` / `open` at a call site                                         |
| Dev Mode, handoff                        | none — the sketch is the code                                             |

## Perspective: the designer — user stories

Each story names the intention first, then the steps the person takes in the imagined finished
Studio, then what Tao wrote, then what is different from doing the same thing in Figma. The
designer in these stories is Noor, who has used Figma daily for years and Tao for an hour. The
project is a small music app with `Playlists / Playlist` and `Tracks / Track` entities.

### Story 1 — A playlist row, fed by an entity

**Intention.** Noor wants a row for the playlist list: cover art on the left, title and a tracks
line, duration on the right. They want to draw it first and worry about layout after, and they want
to see it with real playlists, not lorem ipsum.

**Steps.**

1. Noor opens the project in Studio's Design preset. The app runs in a cell, in its `"full"`
   scenario, exactly as it does today (wireframe 1, callout 1).
2. They drag on the empty canvas beside the phone. A 360 by 76 sketch appears with a size badge, a
   tab reading `Untitled1 · sketch`, and a rename field in the inspector. Noor types `PlaylistRow`.
3. Inside the sketch they draw four boxes: a square at the left, two lines beside it, a small box at
   the right. Each lands exactly where drawn; nothing reflows (wireframe 2, left).
4. From the Data panel they drag `Playlists / Playlist` onto the sketch. The tab now reads
   `PlaylistRow(Playlist)`, a column of field chips appears beside the sketch — `Cover`, `Title`,
   `Duration`, `Tracks.Count`, `Owner.Name` — and the sketch's cell is now rendering the fixture row
   `Chill Vibes`, although nothing inside is bound yet (wireframe 3, callouts 1 and 2).
5. They drop `Cover` on the square: it becomes an `Image` showing the cover. `Title` on the first
   line: a `Text` reading "Chill Vibes". `Tracks.Count` on the second line: Studio proposes
   `"{ Playlist.Tracks.Count } tracks"` and Noor accepts. `Duration` on the small box at the right.
6. They press Snap (⇧A, as in Figma). Studio infers a `Row` holding the image, a `Col` with the two
   texts, and the duration, with `gap 14`, `pad 12`, and `claim 1` on the column so the title takes
   the slack (wireframe 2, right). The rendering does not visibly change; the source did.
7. Option-drag on the sketch makes a second cell beside it with the next fixture row, `Morning Run`.
   A third Option-drag, with the "generated" example source selected, renders a playlist with a very
   long title. Noor sees the title wrap, opens the inspector, and sets `Lines: 1`; all three cells
   update.
8. From the Views palette they drag `PlaylistRow` into the phone cell, onto the list. Studio sees the
   drop landed inside `loop Playlists / Playlist`, binds the parameter from scope, and the app's
   list now renders Noor's row.

![Wireframe 1 — drawing a sketch beside the running app](wireframes/01-draw-a-sketch.svg)

![Wireframe 2 — the same boxes free, then in flow](wireframes/02-free-to-flow.svg)

![Wireframe 3 — feeding the sketch with an entity](wireframes/03-feed-an-entity.svg)

**What Tao wrote.**

```tao
// Playlists/PlaylistRow.tao — the feature folder the row was drawn beside
view PlaylistRow(Playlist) {
   render Row [pad 12, gap 14, content left center] {
      Image(Playlist.Cover, Description: Playlist.Title) [width 52, height 52, radius sm]
      Col [gap 10, claim 1] {
         Text(Playlist.Title, Lines: 1) [body]
         Text("{ Playlist.Tracks.Count } tracks") [caption]
      }
      Text(Playlist.Duration.Clock) [caption]
   }
}

// Scenarios.tao
scenarios PlaylistRow "sketches" {
   fixture Sketches
   device phone

   scenario "first" { render (Playlist: ChillVibes) }
   scenario "second" { render (Playlist: MorningRun) }
   scenario "longTitle" {
      prepare { update ChillVibes { Title: "Songs for the drive up the coast and back again" } }
      render (Playlist: ChillVibes)
   }
}
```

and, in the app's list, `loop Playlists / Playlist { PlaylistRow(Playlist) }`.

**What is different.** From step 4 the sketch has a typed parameter, so there was never a moment
where the row was a picture of a row. The long-title variant is a `prepare` delta over a fixture
row, which a test can reuse. Step 8 is the whole handoff.

### Story 2 — A button with states

**Intention.** Noor wants a primary button used everywhere, and they want to see it normal,
disabled, busy, and dark, side by side — the way they would build a component set in Figma — without
maintaining four copies.

**Steps.**

1. A new 240 by 100 sketch. Noor draws a rounded box, double-clicks it, and types `Play`. They press
   B, and the box becomes a `Button` — the stdlib button, rendered by the design's element default.
2. They select the literal `Play` and choose Make parameter. Studio adds `Label text` to the view's
   head and `Label: "Play"` to the cell's scenario entry.
3. In the inspector's Parameters context they add `Disabled`, kind yes / no, default no. Studio
   wires it to the button's own `Disabled` slot.
4. Option-drag on the sketch. The copy's arguments are generated: the only unvisited value is
   `Disabled: yes`, so the new cell is the disabled button, drawn by the stdlib control's own disabled
   look (wireframe 4).
5. In the disabled cell Noor changes the background to `muted` from the Style context. Studio asks
   whether the change applies always, only when Disabled, or as a new view. They choose only when
   Disabled, and the clause lands as `background muted when Disabled`.
6. They add `Busy` the same way and choose Expand all states; two more cells appear, `busy` and
   `disabled + busy`.
7. They pin `appearance dark` on the group's cells; every button re-renders dark through the design's
   `Scheme` conditions, with nothing drawn twice.
8. They pin `pressed` on one cell — a world control that forces the runtime's attention state for
   that cell, the way `network offline` forces the network — to style the press.

![Wireframe 4 — variants as scenario entries, and an edit inside one cell](wireframes/04-variants-and-states.svg)

**What Tao wrote.**

```tao
view PrimaryButton(Label text, Press action?, Disabled yes / no default no, Busy yes / no default no) {
   render Button(Label, Disabled: Disabled)
      [primary, busy when Busy, background muted when Disabled, ink inkMuted when Disabled, background accent.60 when pressed] {
      on press Press
   }
}

scenarios PrimaryButton "states" {
   fixture Sketches
   device phone

   scenario "default" { render (Label: "Play") }
   scenario "disabled" { render (Label: "Play", Disabled: yes) }
   scenario "busy" { render (Label: "Play", Busy: yes) }
   scenario "disabledBusy" { render (Label: "Play", Disabled: yes, Busy: yes) }
}
```

**What is different.** The four cells are four argument sets over one tree. A change made "in" a
cell is a conditional clause, never a divergence, and the prompt in step 5 is how the designer says
which one they meant. `Press` is optional so a cell can render without it; a required action parameter
has no scenario spelling today and needs a stand-in that logs the press (FS-Q9). A view with no entity
still names a fixture under the current contract (FS-Q17).

### Story 3 — Focus into the row that is everywhere

**Intention.** In the running app Noor notices the row should show the owner's name under the
title. The row appears on three screens. They want to edit it once, in place, while seeing the row
the app is actually showing.

**Steps.**

1. In the phone cell they click the second row. The selection outline names it `PlaylistRow`, with
   two choices: edit here, or Edit as a sketch (wireframe 5).
2. Edit as a sketch opens a sketch beside the phone, pinned to that instance's arguments: the row is
   `Morning Run`, exactly as the app showed it. If the row had come from the live store rather than
   a fixture, Studio captures it into the fixture first, through the existing capture flow.
3. Under the title, inside the flowing column, they draw a box. Because the column flows, the box is
   inserted at the nearest gap (an insertion line shows where) and takes its drawn height. Holding ⌃
   while drawing would instead drop it free, inside a nested `Sketch`.
4. They drop `Owner.Name` on it. All three rows in the phone update at once, and so does every other
   screen the row is on.
5. They close the sketch. Its scenario entry remains in source as `"fromPlaylists"` unless they choose
   Discard sketch, which removes the entry and leaves the view.

![Wireframe 5 — focusing into a definition from a running instance](wireframes/05-focus-into-a-definition.svg)

**What is different.** Figma's "go to main component" leaves the instance behind; here the sketch is
the definition rendered with the instance's data, so the designer never loses the context that made
them want the change. "Edit here" is the same edit without opening a sketch: selection inside an
occurrence already edits the owning view's tree.

### Story 4 — A whole screen, sketched loose and snapped

**Intention.** Noor wants a Now Playing screen and has no layout in mind yet: big artwork, title,
artist, a progress line, three round buttons. They want to draw the whole thing loosely, then decide
what stacks and what sits side by side.

**Steps.**

1. They draw a sketch and pick the phone preset from its size badge; the sketch becomes 390 by 844 and
   its scenario is on `device phone`.
2. They draw the artwork box, two text lines, a thin line, and three circles, all free.
3. They drag `Tracks / Track` onto the sketch and bind artwork, title, and artist. The circles they
   retype to `Button`, picking an icon each from the inspector.
4. They select the three circles and press Snap; only those become a `Row [content center center,
   gap lg]`, and the rest stays free. Then they select everything and press Snap; Studio proposes a
   `Col` with the row inside it, shows the proposed tree over the sketch, and Noor accepts
   (wireframe 2 describes the rules; wireframe 7 the gestures that follow).
5. They ⌘-click the button row to try it vertical, dislike it, and press undo.
6. They ⌥-click the gap between the artwork and the title and insert a divider from the palette.
7. From the Views palette they drag `NowPlaying` onto a row in the phone cell's playlist list; Studio
   offers `on select -> { present NowPlaying(Track) as sheet }`, with the mode chosen in the prompt,
   and Noor accepts. The press behavior of the three
   buttons is left for whoever wires actions, with a `Press action` stand-in in the cell meanwhile.

**What is different.** Partial snapping keeps the sketch tier and the flow tier side by side inside
one sketch, and a release build refuses to ship while any `Sketch` still holds content, so a loose
sketch cannot leak into the product by accident.

### Story 5 — Sketching on the iPad with a pencil, the Mac keeping up

**Intention.** Noor is on the couch with an iPad and a pencil; Studio is running on the Mac across
the room. They want to sketch the row at the size it will really be, with their hands, and have the
Mac and the source follow.

**Steps.**

1. They open the Tao Studio companion app on the iPad, scan the QR code Studio shows, confirm the
   pairing code on both screens, and pick the project. The iPad shows one cell at a time at its own
   scale, with room around it to draw; the Mac's grid stays the overview (wireframe 6).
2. With the pencil they draw a rectangle on empty canvas and hold at the end of the stroke; it snaps
   to a clean sketch, and the sketch appears on the Mac as it settles.
3. Inside it they draw a box and write "Chill Vibes" into it with the pencil; the box becomes a
   `Text` with that content. They draw a square and tap it, and pick Image from the strip.
4. They drag `Playlist` from the strip's entity menu onto the sketch with a finger, then drag chips
   into boxes with the pencil, as on the Mac.
5. A two-finger tap undoes the last action. Snap is a button on the strip.
6. They pick up the iPhone, which is paired to the same session and shows one cell at a time. They
   choose the `PlaylistRow` cell and see the row at thumb size; the height is wrong, so they drag the
   sketch's bottom edge with a finger. The Mac's source updates to the new height; the developer at
   the Mac sees the diff in the Code preset and keeps typing.

![Wireframe 6 — the companion app on the same session](wireframes/06-companion-pen-and-touch.svg)

**What is different.** The device never compiles or owns source. Every stroke becomes a typed source
action the Mac validates, applies, and echoes back as a new compiled cell, so the iPad, the iPhone,
and the Mac are three views of one session. The pen is not a novelty: a row drawn at true size on the
phone is a row that fits a thumb.

## Perspective: the language — what the canvas writes

The stories only work if everything the canvas produces is ordinary Tao. This section lists what
that requires, what already exists, and what would be new.

### A sketch is a view and a scenario

A sketch is one `view` declaration plus one entry in a `scenarios` group whose subject is that view.
Both exist today: the focused `render (Parameter: Handle)` subject, group defaults, the device and
appearance pins, and the `(source path, group, entry)` identity Studio already uses for cells. A sketch
therefore needs no new declaration; it needs a place to be written (FS-Q1) and a name (FS-Q2).

### The sketch tier: free placement in source

Free placement must be representable in source, or the sketch would be Studio-only state, which the
Studio contract forbids and which the companion app could not see. The layout specification keeps raw
absolute positioning out of ordinary layout syntax deliberately, so the sketch tier must be a fenced
exception rather than a general positioning mechanism.

_Proposed:_ a stdlib container `Sketch` whose direct children may carry `at x y`. `Sketch` takes
`width` and `height` and lays nothing out; a child's `at` is its offset from the sketch's top-left.
`at` is accepted by no other element, which fits the decided rule that every element kind declares
which clauses it accepts. Development builds render a `Sketch` as drawn; a release build reports a
`Sketch` that still holds content as an error, mirroring the existing policy under which raw inline
design exploration is a warning in development and an error at release. Nested `Sketch` is allowed
so a free region can sit inside flowing content (story 3, step 3). Snapping rewrites a `Sketch` into
`Row`, `Col`, or a nesting of them and drops every `at`; unsnapping does the reverse from measured
layout.

`at` is an offset from the container's top-left, which is the anchor-plus-offset vocabulary the
interaction system already settles for floating surfaces (KEY-D7, spelling deferred as LANG-018): a
`Sketch` child is content anchored to its container with an offset, and whether the two share one
spelling is part of FS-Q3. The release fence has no exact precedent either: the existing release rule
on raw design exploration is a severity policy on values, whereas this is a construct that must be
empty to ship (FS-Q4).

```tao
render Sketch [width 360, height 76] {
   Box [at 12 12, width 52, height 52]
   Box [at 78 16, width 180, height 14]
}
```

Alternatives and the recommendation are in _Ways to meet each need_ below.

### Placeholders

A drawn box is `Box [width N, height N]` — a hugging container with an explicit size. In development
Studio paints a hatched overlay on any `Box` that has a size and no children, as Studio chrome rather
than source, so placeholders look like placeholders without a `Placeholder` element existing in the
language (FS-Q5 records the alternative). Retyping replaces the element while keeping its clauses:
`Box` to `Text`, `Image`, `Button`, `TextInput`, `Switch`, or any project view.

### Parameters from data and from literals

- Dropping an entity on a sketch adds a bare-name parameter to the view head (`view PlaylistRow(Playlist)`)
  and an argument to every entry of the sketch's group, chosen from the selected example source.
- Dropping a field chip binds a placeholder by the field's type: `image` to `Image`, `text` and
  numbers to `Text`, a `yes / no` field to a condition or an icon, a to-one relation to nested chips one
  level deep (`Owner.Name`), a collection to a `loop` with an inner sketch for its row.
- Make parameter extracts a literal into a typed parameter and adds the argument to every entry of
  the group; the reverse, inlining a parameter, is the same action backwards.
- Adding a parameter by hand in the inspector offers the kinds the scenario surface can argue:
  text, number, yes / no, `one of` cases, an entity, and an action (which needs a stand-in, FS-Q9).

### Variants are scenario entries; states are conditions

Duplicating a cell writes a new entry. Generated arguments follow the parameter's type: the other
pole of a `yes / no`, the next unused case of a `one of`, the next of short, long, and empty for
text, `0`, a typical value, and a large one for numbers, the next fixture row for an entity.
Expand all states writes one entry per unvisited case, and a full cross on request. A text variant of
an entity field is a `prepare { update Handle { … } }` delta, never a mutated fixture.

A style change made inside one cell asks where it applies: always, only under this cell's arguments
(`when Disabled`), or as a new view. The middle choice writes the decided postfix `when` form.
Interaction states are decided conditions in the language (`pressed`, `hovered`, `focused`), though the
executable tranche admits only `when Scheme is …` today. Pinning one on a cell is a world control over
runtime-owned attention state (KEY-D8), not a language condition, and its spelling belongs with the
other world controls (FS-Q8).

### What would be new in the language

- The `Sketch` container and the `at` clause, with the release diagnostic (a tranche through
  `Apps/WordFlower/2 - Next`, as every language change is).
- Postfix `when` over a parameter (`background muted when Disabled`) and over interaction states,
  which are decided but not executable: the parser admits only `when Scheme is Light` or `Dark`.
- `yes / no` as a parameter type, with `yes` and `no` literals, in the executable dialect.
- Scenario spellings for an interaction-state world control and for an action-parameter stand-in,
  if they are to be source rather than transient.
- Nothing else. Parameters, scenarios, fixtures, `prepare`, named slots, and `loop` are decided and
  implemented.

## Perspective: Studio — canvas, identity, actions, inference

### The canvas

The existing scenario canvas renders grouped rows of cells. A sketch is a cell whose scenario
belongs to a `"sketches"` group, so it lives on the same canvas, next to the app. Drawing on empty
canvas is the one new gesture at the canvas level; everything else happens inside a cell. Cells keep
their iframe realm each; a sketch's overlays — selection, insertion lines, placeholder hatching,
size badges, field chips — are Studio chrome drawn over the cell, never nodes in the preview.

### Identity and trust

Every gesture becomes a source action carrying the identity the protocol already binds: project,
app, preview instance, source version, revision-bound range, node kind, owning view, and for a cell
the exact cell revisions and scenario. The server resolves ranges in current source and rejects
stale identity with structured conflicts; proposal and apply share one preparation path, and undo is bound to the
latest checkpoint. None of that changes. A sketch opened from a running instance additionally needs the instance's
argument bindings, which the render inspection does not publish yet (FS-Q10).

### Source actions this needs

| Action                         | Status | Notes                                                                                        |
| ------------------------------ | ------ | -------------------------------------------------------------------------------------------- |
| `insert-component` at a gap    | exists | palette drops; wireframe 7 A                                                                 |
| `insert-project-view` at a gap | exists | zero-argument today; needs binding from scope for parameterized views                        |
| `move-render`                  | exists | wireframe 7 C                                                                                |
| `set-layout-entry`             | exists | wireframe 7 D; the sizing handles write `fill`, `hug`, `width N`                             |
| `set-style-entry`              | exists | the conditional variant adds `when <argument>` (see `set-conditional-style`)                 |
| `wrap-render`                  | exists | `Stack` only; snapping needs `Row` and `Col` with clauses                                    |
| `set-scenario-arguments`       | exists | rewrites one existing focused-render entry; creating entries belongs to `duplicate-scenario` |
| `insert-captured-fixture`      | exists | focus-in from a live row; example rows promoted to source                                    |
| `create-sketch-view`           | new    | writes the view, the group, the entry, and picks the file                                    |
| `set-position`                 | new    | `at x y` and size on a `Sketch` child                                                        |
| `snap-to-flow` / `unsnap`      | new    | inference plus rewrite; unsnap reads measured rects from the preview                         |
| `retype-render`                | new    | `Box` to another element or a project view, clauses kept                                     |
| `add-parameter` / `bind-field` | new    | entity and literal parameters; chip drops                                                    |
| `set-conditional-style`        | new    | the always / when / fork prompt's result                                                     |
| `duplicate-scenario`           | new    | generated arguments; expand all states                                                       |
| `set-container-direction`      | new    | wireframe 7 B, remapping `content` terms across axes                                         |
| `insert-separator`             | new    | a divider or spacer at a gap                                                                 |

### Inference for snapping

The first cut is a projection algorithm, the one Figma uses for Add auto layout, with Tao's sizing
words as the output. Boxes whose projections on one axis do not overlap are siblings on that axis;
boxes stacked inside one lane become a nested container in the other direction; the median distance
between neighbours becomes `gap` and the distance to the sketch edge becomes `pad`; a box touching
both edges becomes `fill`; the widest slack on the main axis puts `claim 1` on the neighbour that
should absorb it; a box drawn to a size keeps `width` and `height`; text and images hug. When the
projections are ambiguous Studio shows the proposed tree as an overlay and asks, through the existing
proposal endpoint, before it applies. The rules are a draft (FS-Q6) and should be tuned on real
sketches, not settled in prose.

### Gestures in flow

Wireframe 7 maps the flow-editing gestures — insert at a gap, turn a container, reorder, resize to
fill or hug — to source actions. Modifier keys are the desktop spelling; the companion app maps the
same actions to long-press and two-finger gestures, consistent with the interaction system's rule
that long-press means target plus verbs.

![Wireframe 7 — flow-editing gestures and the source actions behind them](wireframes/07-flow-gestures.svg)

## Perspective: data — where example values come from

A sketch with an entity parameter needs a row to render. Four sources, in the Data panel, selected per
sketch and remembered per cell:

1. **The fixture** — the project's named rows, shared with tests and the scenario gallery. Durable,
   reviewable, and the recommended default. The sketch's entry names the handle.
2. **Generated** — deterministic rows from a seed, derived from field names and types: `Title`
   yields titles, `Email` yields addresses, text takes short, long, and empty forms, numbers take
   zero, typical, and large. Transient until the designer keeps the cell, at which point the rows are
   written into the fixture through the existing capture action, so a saved sketch always names its
   example in source.
3. **The live store** — the rows the running app holds, through the existing runtime capture. Useful
   for focus-in (story 3) and for "what does this look like with my real data"; promoted to a fixture
   the same way when kept.
4. **A library** — a curated fixture of edge cases per entity (`fixture EdgeCases`), which is just a
   fixture file a project or a kit ships.

Two rules keep this honest. A cell's example is always nameable in source once the cell is saved, so
a sketch reloads identically on the Mac and on the companion. And generated values never overwrite a
fixture; a variant of a fixture row is a `prepare` delta on the entry.

## Perspective: the companion app — pen and touch

The Tao Studio companion app is decided (`../Tao ship/Plan - Beta distribution in one command.md`)
and its control plane is designed (`../Tao Studio v1/Exploration - Native device as Studio canvas.md`):
pairing by QR and confirmation code, one authenticated WebSocket carrying manifest revisions, cell
assignment and configuration, selection, and source-action requests with acknowledgements, and one
rendered cell per device. Freehand sketching adds a canvas and an input model on top of that plane;
it does not add a second editing protocol.

- **Two devices, two roles.** An iPad has room to draw beside a cell at the iPad's own scale, but it
  renders one cell at a time — a group stepped through — until every runtime store a cell uses is
  instance-scoped, which the native-canvas exploration makes a precondition for any on-device grid.
  An iPhone shows one cell at true size, which is the reason to sketch there at all: a row drawn on
  the phone is a row that fits a thumb. Both are views of the same session; the Mac's grid stays the
  overview.
- **Pencil draws and writes, finger moves.** The platform's own convention. Draw and hold snaps a
  stroke to a clean rectangle, as Notes and Freeform do; scribbling inside a box turns it into `Text`
  with that content through on-device handwriting recognition; a tap opens the retype strip; a
  two-finger tap undoes; a long-press on anything shows its verbs. Snap, the entity menu, and the
  palette live on a strip at the bottom.
- **The device never owns source.** Ink is drawn locally and optimistically, and on pen-up the
  device sends one typed source action with the full identity tuple. The Mac validates, applies,
  compiles, and echoes the new cell; a stale identity is rejected and the device redraws from the
  echo. Concurrent edits from the Mac and a device resolve the way concurrent Studio edits already
  do, by source version.
- **True scale wins.** When a cell is assigned to a device, the device's measured viewport is the
  cell's viewport, reported through the designed `device.cellApplied` message; the sketch's `device` clause
  remains what the Mac's grid renders.
- **Where the canvas is implemented.** First as a native sidecar — a foreign view over PencilKit
  inside the companion's own Tao app — because Tao has no drawing or gesture primitives yet. The
  drag-and-drop example app on the roadmap will tell us how much of this a later Tao-native canvas
  could own (FS-Q14).

## Perspective: the developer beside the designer

- **Readable output.** Everything the canvas writes is formatted by the ordinary formatter and reads
  like hand-written Tao, because it is the same grammar. The snap inference should prefer the fewest
  clauses that reproduce the drawing, not the most precise.
- **Predictable homes.** New views land where the decided app decomposition puts them — a file in
  the feature folder — and their entries in `Scenarios.tao` (FS-Q1), so a developer knows where
  sketches accumulate and nothing straddles the reviewable layout.
- **Sketches cannot ship.** The release diagnostic on `Sketch` content, and the existing one on raw
  inline design exploration, make "the designer left a placeholder" a build failure rather than a
  surprise in review.
- **Tests fall out.** Every sketch is a scenario entry over a fixture, so the decided `tao review`
  will render it once that command exists, and a journey will mount the same view with the same
  handle once the runner executes fixtures and scenarios, which it does not yet. Coverage of the
  sketching features themselves is a Tao behavior test per language construct under
  `Apps/Test Apps/AGENTS.md`, and a Studio journey per gesture in `packages/studio/studio-tests` and
  the smoke lanes `packages/studio/README.md` describes.

## Ways to meet each need

| Need                               | Options                                                                                                                                                                                         | Recommendation                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Free placement                     | (a) Studio-only overlay state; (b) `Sketch` container with `at`, release-refused; (c) general absolute positioning in the layout language; (d) a separate `.tao-sketch` file compiled to a view | (b). (a) breaks the source-is-truth contract and the companion; (c) is what the layout spec refuses; (d) is a second authority |
| Where a new view is written        | (a) a new file in the feature folder of the screen it was drawn beside, entries in `Scenarios.tao`; (b) one `Sketches.tao` per app holding views, entries, and fixture; (c) ask every time      | (a); it is the decided decomposition, and (b) straddles it                                                                     |
| Placeholder rendering              | (a) a `Placeholder` stdlib element; (b) Studio chrome over an empty sized `Box`; (c) a dev-only design bundle                                                                                   | (b); it leaves nothing in source that must be removed                                                                          |
| Example rows                       | (a) fixture only; (b) fixture, generated, live, library, all promoted to fixture on save; (c) Studio-owned example store                                                                        | (b); (c) is the `example` declaration Studio already rejected                                                                  |
| Variant generation                 | (a) one entry per Option-drag with the next unvisited value; (b) expand all at once; (c) pairwise generation for many parameters                                                                | (a) plus (b); (c) later if sketches grow past three parameters                                                                 |
| A style edit inside a variant cell | (a) always ask; (b) default to conditional when the cell has a non-default argument, with a toggle; (c) always apply globally                                                                   | (a) first, (b) once the prompt's answer distribution is known                                                                  |
| Interaction-state pins             | (a) transient only, like appearance before save; (b) a scenario clause; (c) both, transient promoted on save                                                                                    | (c), mirroring appearance                                                                                                      |
| Focus-in arguments                 | (a) publish a binding graph from the preview; (b) reuse the interaction outline's item provenance (entity plus handle); (c) ask the user                                                        | (b); it is one derived model with many consumers                                                                               |
| Action parameters in a cell        | (a) a runtime stand-in that logs; (b) a scenario spelling naming a fixture action; (c) forbid action parameters on sketched views                                                               | (a) now, (b) when fixture-through-action semantics are adopted                                                                 |
| Direction change                   | (a) rewrite `Row` to `Col` and remap `content` terms; (b) wrap in the other container                                                                                                           | (a)                                                                                                                            |
| Companion canvas                   | (a) native PencilKit sidecar in the companion's Tao app; (b) Tao-native canvas; (c) a web view                                                                                                  | (a); (b) after the drag-and-drop app; (c) never — the device must render real cells                                            |
| Snap ambiguity                     | (a) pick the best guess silently; (b) show the proposed tree and ask; (c) refuse                                                                                                                | (b), through the proposal endpoint                                                                                             |

## What exists today, and what is missing

**Exists.** The scenario canvas with grouped cells and stable identity; focused `render` subjects
with fixture handles; the `prepare` delta; device, appearance, locale, direction, and network pins;
the palette drag with position-aware insertion; layout and style inspection with provenance;
`move-render`, `wrap-render`, `set-layout-entry`, `set-style-entry`, `set-scenario-arguments`,
`insert-captured-fixture`; proposal, apply, checkpoint, and undo on one canonical path; the trusted
preview bridge; runtime data capture; the companion app decision and its protocol design; the
decided conditional-styling grammar, of which the executable tranche implements `when Scheme is …`.

**Missing — language.** `Sketch` and `at`; the release diagnostic; postfix `when` over parameters
and interaction states in the executable dialect; `yes / no` as a parameter type with `yes` and `no`
literals; scenario spellings for a text-scale pin, an interaction-state world control, and an action
stand-in; loading and empty as world controls.

**Missing — compiler and manifest.** Measured layout rectangles reported per render node for
unsnap; argument bindings per rendered instance for focus-in; project-view insertion with argument
binding from scope.

**Missing — Studio.** Drawing on empty canvas; sketch overlays; the new source actions in the table
above; the snap inference; the Data panel's example sources and generation; the Parameters
inspector context; the duplication and expansion commands; the conditional-edit prompt; the
transient interaction pin.

**Missing — companion.** The app itself, then its canvas sidecar, handwriting and shape
recognition, the strip, and the device-side optimistic ink with pen-up commit.

## Key questions and decisions to make

Language questions are Ro's; the others can be resolved by implementation evidence unless Ro wants
to rule on them.

- **FS-Q1 — Where does a sketched view live?** Decisions §1 fixes the app decomposition: screens in
  per-feature folders, scenarios in `Scenarios.tao`. The proposal follows it: the view goes to a new
  file in the feature folder of the screen it was drawn beside (`Playlists/PlaylistRow.tao`), its
  entries to `Scenarios.tao`, its example rows to the fixture there. Open: which folder when nothing
  was drawn beside, and whether one `Sketches.tao` per app is an acceptable stated exception for
  throwaway work.
- **FS-Q2 — Naming.** `Untitled1` until renamed, with rename through the language service so call
  sites follow. Should Studio insist on a name before the first scenario is saved?
- **FS-Q3 — The sketch tier's spelling** (language). `Sketch` with `at x y` as proposed, or `Canvas`,
  or `Free`; whether `at` may take design sizes (`at md lg`) or only bare pixels; whether nested
  `Sketch` is allowed. `at` should be read as the anchor-plus-offset vocabulary KEY-D7 settles for
  floating surfaces (LANG-018); whether the sketch tier and floating layers share one spelling, or the
  tier argues for a coordinate form of its own, is the core of this question.
- **FS-Q4 — The release rule** (language). Error at release and warning in development, as for raw
  design exploration, or an error at every `tao check`? Note the difference in kind: the existing rule
  is a severity policy on values, whereas this is a construct that must be empty to ship, which has no
  precedent.
- **FS-Q5 — Placeholders.** Studio chrome over an empty sized `Box`, or a `Placeholder` element
  that carries a label and a hatched look in development?
- **FS-Q6 — Inference rules.** Which heuristics, and what does the proposal overlay show when they
  disagree? To be tuned on a corpus of real sketches before the plan fixes them.
- **FS-Q7 — Unsnap fidelity.** Recompute `at` from measured layout only, or also remember the last
  free positions in source as a comment? The former is honest; the latter is convenient and dubious.
- **FS-Q8 — Forcing an interaction state on a cell.** Attention state is runtime-owned, never `set`
  and never restored (KEY-D8), so a pinned `pressed` is a world control like `network offline`, not a
  language condition. Transient only, or a scenario spelling routed through the KEY-D13 step seam and
  promoted on save the way `appearance` is?
- **FS-Q9 — Action parameters in cells** (language). A runtime stand-in that logs the invocation,
  or a scenario spelling once fixture-through-action semantics are adopted?
- **FS-Q10 — Focus-in bindings.** Reuse the interaction outline's item provenance (entity plus
  handle) or publish a separate binding graph from the preview? One derived model is the decided
  direction for interaction; this should be its second consumer.
- **FS-Q11 — Generated example values.** Deterministic from a seed and field names, with what
  vocabulary, and are they ever visible in source before promotion? The rule proposed here is never.
- **FS-Q12 — The conditional-edit prompt.** Ask every time, or default to the conditional answer
  when the cell has a non-default argument?
- **FS-Q13 — Option-drag versus Shift-drag.** Figma duplicates with Option; Ro described the habit
  as Shift-drag. Either binding works and the mechanism is the same; pick one and mirror it on the
  companion as a two-finger drag.
- **FS-Q14 — The companion canvas.** Native PencilKit sidecar first, as proposed, and if so which
  gestures the sidecar owns versus the Tao app around it? The iPad shows one cell at a time until
  runtime state is instance-scoped; whether a group can be stepped through on the device, and whether
  multi-cell isolation is worth landing for the iPad, is part of this question.
- **FS-Q15 — Handwriting and shape recognition.** On-device only, and which languages; what happens
  when recognition is wrong (the stroke stays as ink until accepted?).
- **FS-Q16 — Scope of the first slice.** Draw, boxes, retype, snap, entity feed, and duplicate on the
  Mac; or start with the language tier and the entity feed alone? Slice order is the plan's question,
  but the first slice's cut changes what the tranche must carry.
- **FS-Q17 — Sketches without data.** Every scenario entry selects exactly one fixture today, so a
  button sketch with no entity parameter still names one. Allow fixture-less focused renders, or have
  Studio supply an empty project fixture?

## Non-goals for a first version

- Not a vector tool: no pen paths, arbitrary shapes, or shipped ink. A stroke is a request for a
  rectangle, a text, or a gesture.
- No absolute positioning in production layouts; the sketch tier cannot reach a release build.
- No Figma import or export; the design tooling document lists those as a later ecosystem phase.
- No prototype wiring beyond what call-site presentation already expresses.
- No multi-user editing beyond one Mac session and its paired devices.
- No on-device grid; one cell per device, phone or iPad, until instance-scoped runtime state exists.

## Prior art

- **Figma**: auto layout, absolute position inside auto layout, component properties, variants,
  Option-drag duplication, variables and modes. The vocabulary map above is deliberate.
- **Sketch**: symbols with overrides, and its Data feature, which fills text and image layers with
  sample data — the closest ancestor of feeding a sketch with an entity.
- **Framer**: components bound to a CMS collection, edited with real records.
- **Play**: a native iOS design tool that edits real UIKit components on the device, paired with a
  Mac — the companion app's nearest relative.
- **Notes and Freeform**: draw-and-hold shape perfection, pencil versus finger roles, scribble.
- **SwiftUI previews and Storybook**: named preview states with arguments beside the code — the
  scenario group is that idea made source.
- **Penpot**: open-source flex layout in a design tool, useful for its inference behaviour.

## Toward a plan

Slices, unordered until the questions above are answered:

1. The sketch tier in the language: `Sketch`, `at`, the release diagnostic, through the tranche
   process with a WordFlower forcing feature.
2. Drawing on the Mac: sketches, boxes, retype, free move and resize, the new view and entry written
   to source.
3. Snap and unsnap: inference, proposal overlay, measured rectangles from the preview.
4. Feeding: entity parameters, field chips, example sources, generated rows promoted to fixtures.
5. Variants: duplicate with generated arguments, expand all states, the conditional-edit prompt,
   interaction-state pins.
6. Focus-in from a running instance, on the interaction outline's provenance.
7. The companion canvas: PencilKit sidecar, strip, optimistic ink, pen-up commit, iPhone true-scale
   cell.

Each slice proves itself with a Tao behavior test for any language construct and a Studio journey
for each gesture, and each ends with the documents that own the touched contracts updated.
