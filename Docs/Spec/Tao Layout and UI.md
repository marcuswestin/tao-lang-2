# Tao Layout And UI

Status: authoritative intended design. This document describes where Tao layout is going, not only what this repo implements today.

Current implementation status: this repo has one renderable view family, with `scene is view` and
`nav is scene is view`, explicit `render` roots, unnamed `@@content`, optional single-fill named render slots, runtime-backed controls and
containers, private `#tag` test metadata, and bracketed clauses for `content`, `claim`, `gap`,
`pad`, `margin`, `width`, `height`, `fill`, `hug`, `compress`, `rigid`, `aligned`, and `centered`.
It also implements `width max`, adaptive `Panes`, and the first flat-token design terms and named
clause bundles. Render arguments are always parenthesized, and a spec remains a distinct following
clause: `render View(args) [spec] { children }`. Tags, layout, and design style merge into an
existing concrete native root and add no wrapper node. Compatible material beyond that first
contract remains future direction in this document. The old repo implemented most of this layout
contract with older spellings and a multi-kind declaration surface (`ui`, `frame`, `layout`,
`dialogue`); the unified view tranche collapsed those into `view`, and this document uses the
current public `view`, `content`, and `@@content` names.

## Layout Introduction

Styling and layout remain distinct typed concerns, but Tao combines both in one bracketed spec surface. Named specs may contain other named specs and may package layout and visual styling together.

Layout describes how to arrange content on the screen - where it appears, and how it gets sized:

`Row() [content spread center, pad 2, rigid] { ... }`

Visual entries describe appearance in the same brackets:

`Row() [content spread center, background black, border white, radius 2, shadow gray]`

### The View Family

Tao has one renderable family rooted at `view`. A reusable leaf, a content-accepting wrapper, and a
modal that answers with a typed value are plain `view` declarations. A directly presented surface
that supplies host-facing description is a `scene`; `scene is view`, so it shares the same body
grammar while carrying the one composition restriction described below:

- A view accepts unnamed caller content iff its body places `@@content` — in its render tree, or by
  naming the `@@content` channel in its `render inject` list. Passing child content to a view that
  places no `@@content` is a validation error.
- A view offers named render slots iff its body declares them with `@name = empty`.
- A view answers `ask` iff its head declares `responds <Type>`.
- A `scene` describes itself to a host by filling a supplied host-facing slot such as `Title` or
  `Toolbar`. `scene is view`: it uses the same body grammar, but is presented rather than composed.
  Those slots are declared on primitive `scene` in the prelude, and their values are ordinary
  reactive expressions over the occurrence's parameters, reads, and state. Which host reads or
  requires them is inferred from the placement, never declared on the scene.
- How a view appears — composed inline, presented as an overlay, sheet, or toast, presented into a
  nav, or asked for a response — is a property of each call site, never of the declaration. See
  `Tao Presentation and Navigation.md`.

One body grammar covers every view: supplied-slot fills, state, entity queries, actions, commands,
aliases, tags, render-slot declarations, and one trailing `render` are legal in any view body, so a stateful
content-accepting wrapper (a collapsible section) is an ordinary view.

Host-facing slots are distinct from render slots. On a scene, `Title Book.Title` supplies a value
for the host that directly presents it; `Toolbar { Save }` supplies focused commands for host-owned chrome.
Neither inserts a render node, and neither bubbles from a descendant. By contrast, `@actions =
empty` declares caller-provided content and places it inside the view's own render tree. See
`Tao Presentation and Navigation.md` for the fixed host read/require matrix and toolbar behavior.

In the type system, `view` is the one renderable primitive, `scene is view`, and
`nav is scene is view`. A `nav` is a package-configured presentation kind that binds its runtime
behavior through `nav <Export> from <path>` rather than a render-bearing product declaration. A
configured nav may be the app root, content of another nav, or ordinary rendered content in a shell
view. A rendered nav is held by the nearest host and obeys the at-most-once, never-in-a-loop, and
never-conditional invariants that protect its mounted history.

There is deliberately no arrangement-only category: a wrapper that only positions caller content
and one that owns content around it are indistinguishable to the language. A view occurrence takes
only the layout clauses written at its call site — no declaration kind implies a sizing default.

#### Stdlib Containers

Tao provides common core containers:

Flexible containers:

- `Col`: lays out its content vertically with flexible height
- `Row`: lays out its content horizontally on a single line with flexible width
- `WrappingRow`: lays out its content horizontally and allows it to wrap onto multiple lines, with flexible total width

Hugging containers:

- `Stack`: hugs its content and lays it out top-to-bottom
- `Box`: hugs its content and lays it out horizontally

All five ship today as content-accepting `view` declarations whose injected implementations carry
the sizing defaults named above.

UI containers usually do not paint pixels themselves. Instead, they focus on how visible content is arranged and sized.

#### Stdlib Elements

Tao provides common leaf UI elements as stdlib views. They are automatically styled according to your app's design system.

Basic content UI elements:

Shipped today, alongside the containers above: `Text`, `TextFrame`, `TextMultiline`, `Number`,
`Button`, `TextInput`, and `FormButton`. `TextInput` and `FormButton` carry the label, placeholder,
disabled, and submitting properties that forms rely on.

Also shipped:

- `Image`: displays an image and allows you to size and transform it.
- `Checkbox`: a checkbox for a two-state value, with a label and disabled state.
- `Placeholder(Label)`: an explicit unfinished-content leaf. Development renders a labelled hatch;
  release renders no content while preserving the occurrence's declared layout. `tao check` warns
  when ordinary application source still renders one.
- `Spacer()`: a semantic flexible-space leaf with implicit `claim 1`. An occurrence-level
  `[claim N]` replaces that default weight.

`Image(Source, Decorative: false, Label: "")` treats a non-decorative image as informative and
requires a nonblank accessibility label at runtime; a decorative image may omit it and is hidden
from accessibility. `Checkbox(Value, Change, Label, Disabled: false)` exposes controlled boolean
state and suppresses native changes while disabled. `FormButton` accepts an optional system-icon
name for forward-compatible product configuration; the current primitive deliberately remains a
label-only button until Tao has an implemented `Icon` surface.

Compatible future surfaces beyond the implemented tranche include:

- `Icon`: a specialized `Image` for icons, including system icons.
- `Pressable`: a pressable surface. Its exact role classification is part of the broader UI design.
- `ImageInput`: a button that lets the user select an image, with options such as where to store it.
- `List`: a higher-level collection component if a later forcing app demonstrates behavior beyond
  language-owned `loop`.

#### Control events and two-way inputs

Controls expose standard action-valued slots named `Press`, `Change`, and `Submit`. Callers configure those slots canonically in the control's block:

```tao
TextInput(Value: Draft, Label: "Title") {
   on change -> Entered { set Draft = Entered }
   on submit Save
}

FormButton("Save") {
   on press Save
}
```

`on press` and `on submit` satisfy `action()` slots. `on change` satisfies `action(text)` and an inline handler may name that text payload after `->`. A named action reference must have the same callback contract. Configuring the same event twice, combining an event with an ordinary argument for the same slot, or using an event on a view without the standard slot is an error.

For a text control with `Value is text, Change action(text)`, omitting `on change` synthesizes the usual two-way update only when the explicitly labeled `Value:` expression directly references writable text `state`:

```tao
state Draft = ""
TextInput(Value: Draft, Label: "Title")
```

Computed values, aliases, parameters, entity fields, and unlabeled arguments are not writable bindings; they require an explicit `on change`. An explicit change handler replaces the synthesized update. Disabled controls suppress their configured native press/change/submit delivery in the runtime.

`ScrollView` is a scrollable container, `Spinner` is a loading indicator, and `Progress` is a
progress indicator. Rendering a collection remains language-owned through `loop`; Tao deliberately
introduces no stdlib `List` or function-typed row slot.

Modal presentation is not an ordinary UI primitive. Non-blocking modal surfaces use
`present X() as overlay`, which layers above the nearest nav or an explicit `in` target. Every nav
owns that overlay layer. Response-demanding conversations are views declaring `responds`, invoked
with `ask`; see `Tao Presentation and Navigation.md`. Raw visual portals and general in-layout
layering remain a separate deferred design question.

### Rendering Named Parts of the UI

The first named-slot contract is implemented. Any view may declare an optional named content slot
with `@name = empty`. A caller may fill it at most once with `@name <view>`. The filled value is
opaque visual content and renders exactly where the declaring body places `@name`; `empty`
contributes no node. Parameterized, repeatable, and required slots remain future work.

```tao
use Col, FormButton, Row, Text from @tao/ui

view Card(Title text) {
   @actions = empty

   render Col() [gap 8, pad 12] {
      Row() [content spread center] {
         Text(Title)
         @actions
      }
      Col() [gap 6] {
         @@content
      }
   }
}

Card("Draft") {
   Text("Unsaved changes")
   @actions FormButton("Save") {
      on press Save
   }
}
```

### Rendering Arbitrary Content

A view that accepts caller content chooses where to render it using `@@content`. Placing
`@@content` is what makes the view content-accepting; it may appear at most once, and the
placement may sit under a `when` or `if` branch, so a wrapper can withhold its caller's content
while collapsed:

```tao
view Card() {
   @title = empty

   render Stack() [content top stretch, gap 8, pad 16, background white, radius 2, shadow gray] {
      @title [pad 2]
      @@content
   }
}
```

### Declaration Properties, Children, And Slots

Declaration properties use the owner-qualified binding rules in `Tao Type System.md`. Header
parameters are shorthand for the same public properties. Header parameters require parentheses,
including `()`. The longhand property block remains future work. Named render slots and
`@@content` are implemented:

```tao
view Profile(User) {
   render Text(User.Name)
}

view ProfileLonghand() {
   User User
   render Text(User.Name)
}

render Profile(User)
render ProfileLonghand() { User User }
```

Properties, unnamed render children, and named render slots are distinct channels:

- An explicit property constructor such as `User CurrentUser` binds a public declaration property.
- Ordinary render expressions in a caller content block remain children. They are never consumed as properties solely because their types match.
- `@name` fills a named render slot.
- `@@content` places unnamed children inside a content-accepting view implementation.
- Keyed navigation entries bind the configured nav declaration's direct `@key { ... }` contract;
  they are not visual render slots or an implicit `Items` property.

`@name` consistently introduces or refers to an owner-scoped name. Render slots and keyed entries are different typed roles under that shared naming model: a render slot is declared by the reusable UI surface, while a keyed entry is declared in one configured value and may be targetable when its accepted entry type permits it.

Direct `@name` entries share one namespace within their immediate configured owner. Nested configured
values begin new namespaces. In the implemented surface, a configured nav may declare one `@key`
item contract and each direct key binds it; a `with` patch may add another direct key under that
contract. A declaration without the contract rejects keyed entries. A render declaration's direct
`@name` remains a visual slot. A duplicate direct name in one owner is invalid.

Only a targetable keyed entry creates an owner-qualified target such as `WordFlower@home`. A render slot never becomes a navigation target merely because it uses `@`.

```tao
view UserCard() {
   User User
   @actions = empty

   render Stack() {
      Text(User.Name)
      @@content
      @actions
   }
}

render UserCard() {
   User CurrentUser       // property
   Text("Recent activity") // unnamed child
   @actions Button("Edit") // named render slot, filled once
}
```

The compiler classifies each entry from syntax and the receiving declaration surface before type matching. A child cannot disappear into a same-typed property when a declaration evolves.

## Layout Properties

Below are Tao's current layout properties:

### Content Alignment And Distribution

To describe how to arrange content inside a container, use:

- `content <alignment/distribution>` to describe how content is arranged inside the container:
  - Alignments: `top`, `bottom`, `left`, `right`, `center`, `baseline`
  - Fill: `stretch`
  - Distributions: `spread`, `spread-inset`, `spread-balanced`

### UI Element Sizing

To describe how a UI element resizes when necessary, use:

- `fill` to expand on the parent container's main axis and fill the cross axis
- `claim N` to claim weighted parent main-axis space with `flexGrow: N`
- `hug` to avoid expanding on the parent container's main axis
- `compress` to shrink beyond its content size when under pressure
- `rigid` to resist shrinking
- `width <positive number>` and `height <positive number>` to set physical dimensions directly
- `width fill` and `height fill` to fill one physical axis; Tao lowers this at runtime using the actual parent container direction
- Bare `fill` contributes two semantic effects: parent-main-axis growth and parent-cross-axis stretch.
  A later `claim` or `hug` replaces its growth effect, a later `aligned` or `centered` replaces its
  stretch effect, and a later numeric physical dimension replaces only the effect on that physical
  axis once the parent direction is known. A later bare `fill` replaces both earlier physical-axis
  dimensions. `width max N` is a cap rather than a replacement and composes with `fill` in either
  order.
- `width max N` caps a readable region without forcing it wider than available space.

To specify how to align a single item in a container, use:

- `aligned <direction>` to align the item along the cross axis
- `centered` as shorthand for `aligned center`

### UI Element Spacing

To describe spacing, use:

- `gap` for positive space between each UI element in a container.
- `pad` for space between a UI element's content and its edges:
  - `[pad N]` for all sides, where `N` is positive
  - `[pad horizontal N vertical N]`
  - `[pad top N bottom N]`
  - `[pad left N right N]`
  - `[pad top N bottom N left N right N]`
- `margin` for space outside a UI element's edges:
  - `margin` shares the same parameters as `pad`

## Examples

### Example: Row of Icons

`Icon` remains a compatible future stdlib surface. If it is introduced, a row with three
icons aligned to its right edge and vertically centered would read:

```tao
use Row, Icon from @tao/ui

render Row() [content right center] {
   Icon("info")
   Icon("hide")
   Icon("settings")
}
```

```tao
Row() [content bottom left] {
   Text("Total")
   Text("$42")
}

Row() [content spread center] {
   Text("Left")
   Text("Right")
}

Col() [content top stretch] {
   Text("fills the column width")
   FormButton("Continue") {
      on press Continue
   }
}
```

Or, if we want to:

- Spread out the icons, and align with the bottom:
  - `Row() [content spread bottom] { ... }`
- Align just the third icon to the bottom:
  - `Icon("settings") [aligned bottom]`
- Make the row hug the icons vertically (i.e., it shrinks to fit its content):
  - `Row() [content spread, hug] { ... }`
- Make the row fill its parent, but also compress (i.e., it shrinks beyond the size of its content when under pressure):
  - `Row() [fill, compress] { ... }`
- Make the row rigid (i.e., it never shrinks more than the minimum size of its content):
  - `Row() [rigid] { ... }`
- Center icons vertically and horizontally, and add a gap between each one:
  - `Row() [content center, gap 2]`
- Set the width and height of the row:
  - `Row() [height 20, width 320] { ... }`
- Fill only the horizontal axis:
  - `Text("Name") [width fill]`

### Example: App Shell

```tao
view AppShell() {
   render Col() [fill, content top stretch, gap 12, pad 16] {
      Header() [hug]
      Row() [fill, gap 16] {
         Sidebar() [width 280, rigid]
         MainPane() [width fill, compress]
      }
   }
}
```

Here, the outer `Col` fills the screen. The header hugs its content. The body row fills the remaining space. The sidebar keeps a fixed width and resists compression. The main pane fills the row's width at runtime.

### Example: Wrapped Content

A content-accepting view receives unnamed caller content through `@@content`.

```tao
view Card() {
   render Stack() [content top stretch, gap 8, pad 16] {
      @@content
   }
}

render Col() [gap 12] {
   Card() {
      Text("Title")
      Text("Body")
   }
}
```

The caller writes the content. The `Card` decides where that content goes.

Caller container layout, such as `gap` and `content`, applies at the explicit container that directly contains `@@content`.

```tao
view ToolbarArea() {
   render Row() [content spread center, gap 12] {
      @@content
   }
}

ToolbarArea() [gap 8] {
   FormButton("Cancel") {
      on press Cancel
   }
   FormButton("Save") {
      on press Save
   }
}
```

If the declaration has fixed siblings and caller content, put `@@content` inside an explicit inner host when caller layout should affect only caller content:

```tao
view LabeledSection(Label text) {
   render Stack() [gap 12, pad 16] {
      Text(Label)

      Stack() [gap 8] {
         @@content
      }
   }
}
```

Render slots are different from `@@content`. Tao implements optional single-fill holes such as
`@actions`; parameterized forms such as `@row Item` still need their own design.

## Advanced Layout

### Text Layout

Text is layout-sensitive because text has a natural size, but app UI often gives it less space than it wants.

Tao uses named text views to describe the common pressure behaviors:

- `Text`: one-line text that truncates with an ellipsis.
- `TextFrame`: one-line text that clips hard.
- `TextMultiline`: text that can wrap to multiple lines.
- `TextMultiline ..., Lines N`: multiline text with a line limit.

```tao
Row() [content baseline left, gap 8] {
   TextFrame(StatusCode)
   Text(Order.Title) [fill, compress]
}

TextMultiline(Article.Summary)
TextMultiline(Article.Summary, Lines: 3)
```

This keeps text pressure visible in the view being rendered. A layout clause should not have to say "this text is multiline" or "this label clips instead of ellipsizing." That is part of the text view's job.

### Wrapping Rows

Use `WrappingRow` when wrapping is part of the design.

```tao
WrappingRow() [content top left, gap 8] {
   Tag("Design")
   Tag("Compiler")
   Tag("Runtime")
   Tag("Mobile")
}
```

The important part is not "turn flex wrap on." The important part is that the UI is a row of small things that may continue onto another line.

That is why Tao prefers a named container over a raw `[wrap]` flag:

```tao
WrappingRow() [gap 8] {
   Tag("Offline")
   Tag("Syncing")
   Tag("Admin")
}
```

Future Tao may need more wrapped-line controls, such as how whole rows of wrapped content pack vertically. Those should be named around the shape Tao authors care about, not copied directly from CSS or React Native props.

### Adaptive Panes

`Panes()` is fixed stdlib behavior rather than general breakpoint syntax. It lays out its
direct child horizontally when the measured width after gaps gives every direct child at least 320
logical pixels; otherwise it stacks them in source order. Before its first measurement it uses the
safe stacked form. In horizontal mode, `claim N` distributes the remaining width proportionally;
the container does not synthesize competing `flexBasis` values.

### Overflow, Scroll, And Layers

Most normal layout should stay inside its bounds. If content is larger than its container, Tao should generally clip it unless the author chose a container that scrolls or intentionally draws outside its normal box.

Use a real scrolling view when the user should scroll:

```tao
view FeedPage() {
   render Col() [fill] {
      Header()
      ScrollView() [fill] {
         FeedItems()
      }
   }
}
```

Use a future layout-layer concept for render children that intentionally escape normal flow:

```tao
// Future-ish shape, not settled syntax.
overlay Toast [aligned bottom]
```

This keeps three ideas separate:

- clipping: content stays inside its region
- scrolling: content is larger, and the user moves through it
- layering: content intentionally appears above or outside normal flow

This future layout term is distinct from settled presentation modes. `as overlay` already produces a
nav-owned absolute layer, and `as toast (Key:, Duration:)` already produces app-level transient
content. Raw absolute positioning, overflow flags, z-index-like layout, popovers, and portals still
need design and should not sneak into ordinary layout syntax merely because the runtime has a prop.

### Safe Area And Keyboard Insets

Every compiled app root — and the Studio subject root — renders inside the runtime's universal app
shell with no source-level opt-in or opt-out. The `app-shell-*` suites in
`packages/apps/expo-host/expo-host-tests/` prove it for:

- The generated app root itself, and every full-screen navigator surface that does not own its
  native window (`SlotNav`, a JS-drawn `SelectionNav` bar in `"tabs"` or `"drawer"` display, and an
  app auxiliary such as `@window`): each is padded exactly once — a fixed 12 logical pixels plus the
  live safe-area inset on every edge — inside a scroll frame that dismisses the keyboard on drag (iOS)
  or tap (Android) and never traps a tap on its own content.
- A navigator that owns its native window (`StackNav`, a native-tab or `"toggle"` `SelectionNav`)
  frames each of its own screens the same way. Nesting one inside another — a stack held as another
  stack's or a `SlotNav`'s `Initial` value — insets exactly once, never twice, and an app auxiliary
  insets independently of whatever the main navigator does with its own window.
- `ask` renders through the nearest window layer — the app host's for the root window, a native
  sheet's own for the window it presents — rather than in its navigator's overlay lane, so its
  scrim dims the whole window whatever navigator asked, and it keeps its centred card off the notch
  and the home indicator by adding the live safe-area inset itself. The app host's layer sits above
  the content and the auxiliaries and beneath the toast layer, so a toast stays readable over a
  dimmed screen. The ask keeps what its presenter's place in the tree gave it: its outline region
  stays under the presenter's, so attention treats it as the presenter's, and whatever level hides
  the presenter — a covered stack entry, an inactive selection item — hides the ask too. An ask asked
  from a navigator no window layer encloses — one mounted outside an app host — draws in that
  navigator's overlay lane instead, under the lane's own inset rule below.
- The inline shape of `as sheet` (a runtime without a native modal host) and `as toast` are
  edge-safe without double-padding: the overlay lane detects whether its enclosing navigator already
  sits inside an `AppSurfaceFrame` (a navigator that does not own its window) and adds no further
  inset there — the frame's own padding already reaches the edge — but adds the live safe-area inset
  itself when the enclosing navigator owns its window, where the overlay lane is a sibling of the
  per-entry frames and fills the true window directly. A toast is always the second case: it renders
  as a sibling of the app host's own frame regardless of what the main navigator does, so it always
  adds the live inset.
- A `SplitNav` one of whose panes holds a window-owning navigator takes true window bounds itself,
  a verdict read once at mount from the panes' declared content: that pane's navigator frames its
  own screens, and the split frames each other pane — including a pane whose `SlotNav` is showing a
  plain view — itself. Every frame inside a pane, the split's own or a nested navigator's, insets
  only the window edges the pane meets: top and bottom always, left in the first pane, right in the
  last. A split whose panes are all plain content stays inside the app host's one frame, scrolling
  as one. Inside a native tab's screen, the frames a window-owning entry draws take the platform's
  insets, as the frame the tab would otherwise draw around it does.
- A frame inside a frame adds no live inset: a window-owning navigator a scene renders inline keeps
  the fixed 12-pixel gutter around each of its screens, and the safe-area inset comes from the
  scene's own frame, once.
- A sheet presented through the platform's native modal host is a separate native window — on iOS a
  `pageSheet`'s card starts below the status bar, so its own top inset differs from the app's root
  window — so that presentation nests its own `SafeAreaProvider`, with no `initialMetrics`, and reads
  insets from that provider rather than the app's. Without `initialMetrics`,
  `react-native-safe-area-context` seeds a nested provider from its parent provider's insets, so the
  sheet renders with the root window's insets until the modal's own native measurement lands — not a
  blank frame. On web, where there is no per-window native measurement, a nested provider measures
  the document instead, so a web sheet keeps reading the document's insets (normally zero). The
  presentation also carries its own `KeyboardAvoidingView`, since the root one cannot reach a separate
  native window either, and resets the "already inset" signal below for its own content, since React
  context still crosses this window boundary (a `Modal` is a portal, not a separate React tree) even
  though the modal's window itself was never padded by whatever frame encloses the presenter.

A plain `present … as overlay` (no `ask`, no `as sheet`, no `as toast`) is full-bleed by decision:
it is the escape hatch for a scrim, a spinner layer, or a custom layer that must reach the window
edges, so the runtime adds no inset and its content is the author's to inset (`Decisions.md` §10).
It draws in its navigator's overlay lane, which fills that navigator's own surface: the true window
under a navigator that owns its window, and the padded content box under one that does not, where
the lane sits inside the enclosing `AppSurfaceFrame` and so stops short of the window edges by at
least the frame's own padding.

Seen on an iPhone 17 simulator on 2026-09-21: a plain `as overlay` presented from inside a native
sheet. The sheet hides while a later entry tops the overlay stack, so the overlay's content renders
full-bleed over the root screen, under the status bar — the decided full-bleed behavior applied
literally, with the sheet's own content gone. Whether an overlay presented from a sheet should stay
inside the sheet's window is an open presentation question, not an inset one.

Not yet covered, and not decided by what exists today:

- Whether a plain `as overlay` under a navigator that does not own its window should reach the
  window edges through the window layer the way `ask` does, or keep covering only the navigator
  that presented it.
- Android's keyboard resize behavior (`softwareKeyboardLayoutMode` and equivalents) is unset; only
  the iOS `KeyboardAvoidingView` `behavior` is chosen explicitly.

## Misc

### UI Defaults

These are the layout values of Tao's stdlib containers, and the React Native styles they resolve to:

- `Col`: `[content top stretch, fill]`
  - `{ flexDirection: column, justifyContent: flex-start, alignItems: stretch, alignSelf: stretch, flexGrow: 1 }`
- `Row`: `[content baseline left, fill]`
  - `{ flexDirection: row, justifyContent: flex-start, alignItems: baseline, alignSelf: stretch, flexGrow: 1 }`
- `Stack`: `[content top center, hug]`
  - `{ flexDirection: column, justifyContent: flex-start, alignItems: center, flexGrow: 0 }`
- `Box`: `[content left center, hug]`
  - `{ flexDirection: row, justifyContent: flex-start, alignItems: center, flexGrow: 0 }`
- `WrappingRow`: `[content baseline left, compress, hug]`
  - `{ flexDirection: row, justifyContent: flex-start, alignItems: baseline, flexGrow: 0, flexShrink: 1, flexWrap: wrap }`

A caller layout clause overlays the render site's defaults. Named clause bundles and direct clauses
form one left-to-right list. The last specification of a given clause replaces the earlier value;
unrelated clauses remain. Bare `fill` is lowered as the two growth and stretch effects described
above, so a later specialized clause can replace one effect without erasing the other. After
replacement, the validator rejects a resolved set containing semantically incompatible
clauses—source order cannot make incompatible categories valid:

```tao
Row() [content spread center, compress] {
   Text("Name")
   Button("Edit", Edit)
}
```

### Accessible Names And The Interaction Outline

The runtime keeps a derived, read-only model of the running app — the interaction outline — for
accessibility projection, generated interaction surfaces, and tests. Nothing declares an outline
node; every one is derived from the ordinary structure of the app:

- a `loop` is a **collection**, and each of its rows an **item** whose identity is the row's stable
  key;
- a render whose block binds `Press` or `Submit`, or a loop row with `on select`, is an **action
  control**; a render that binds `Value:` with an explicit or automatic `Change` is an **input
  control**;
- a presented occurrence (a pushed scene or view, an overlay, a sheet, an asked view), a selection
  item, and a split pane are **regions**. The non-nav sibling subtree of a view that renders a nav
  is one further region: the compiler describes it and the runtime coalesces its mounted roots
  without adding a wrapper or layout node.

A row's label is derived by one static ranking, shared by the outline, selectable-row accessibility
projection, and every later reader: the first unconditional `Text`, `TextFrame`, or
`TextMultiline` in the row subtree whose `Value` is a member path on the row binder, preferring the
entity's `(title)` field when the row renders it. Descent follows a bound parameter one level into a
rendered row view (`WorkspaceRow(Workspace)`). A `when`, `if`, or `guard` branch, a nested loop, a
function-wrapped value (`Text(DocumentLabel(Document.Title))`), and an interpolation
(`Text("{ Story.Rank }.")`) are opaque and pass to the next candidate. When nothing ranks, the label
is the `(title)` field read at runtime, then the row's own text, then the entity and its handle, then
the binder and position.

The derived label is always interaction-outline metadata. A selectable row also carries it as the
accessible name of the press surface the runtime wraps around the row. A non-selectable row with one
unconditional root does not project the row label onto that structural root: doing so would not make
the root a real accessibility element, while making it one would hide interactive descendants.
Visible text and controls remain platform-readable in their ordinary traversal. A row with several
roots likewise has no root-level label projection. Regions carry their name — a presented
occurrence's live `Title`, a selection item's `Label`, a pane's key — as a named group. A journey's
`expect label "…"` asserts the derived outline label; for a selectable row, that same value is the
press surface's platform accessible name. When the platform focuses that surface, Tao targets the
same outline item and its containing region without running `on select`; pressing it still performs
selection once through the shared activation path. Directly invokable commands applicable to a
selectable row are also exposed through the platform's custom accessibility-action menu. This
focus-intake contract applies to host focus events React Native exposes; it does not claim to observe
a screen-reader virtual cursor movement the host does not report.

Existence is always registered, and the primary label is always evaluated so the outline has stable
item metadata and selectable rows can expose it synchronously. Everything else — the row's full text
corpus and change notifications — is evaluated only while a reader is attached:
`TR.Interaction.Outline` is read on demand and subscribed to with the same snapshot-and-subscribe
shape as every other runtime channel, publishing a new revision only when what a reader would see
has changed. Provenance rides two
tiers, the entity and handle per item and the loop and entity per collection, and is never a test
selector. The outline joins the check and launch boundaries beside the navigation reset and is
captured as plain JSON under the `interaction` domain. The compiler emits each module's static
descriptors as one table beside its bridge module; the runtime registers them at mount, and the
Studio-only source identity that lowers a DOM marker stays exactly as gated as before.

### Attention, narrowing, and generated surfaces

The attention reducer is the only owner of interaction state: focused region, remembered target,
narrowing text, engagement, and modal focus restoration. Targeting is eager but free — a sole
candidate becomes the target without activating it. Input engagement gives platform text editing
precedence; Escape disengages while retaining the target. Implemented pointer press and focus paths
dispatch the same semantic activation and attention operations rather than mutating outline mounts.

Narrowing is locale-aware, case-insensitive word-prefix subsequence matching across the mounted
region's items and controls. It does not unmount or currently restyle nonmatches. A collection item
owns its inner controls as a descended scope instead of flattening them into the surrounding order.

Hints, overview, the target's verb layer, and the command palette are generated renderings of the
outline, attention, command bindings, and catalog. One app-host layer renders them above content as
a sibling after toasts, outside navigation history and Back. Hidden layers set
`accessibilityElementsHidden`; visible affordances use cached app-relative bounds and never measure
synchronously when opened. `Hint` and `Overview` are ordinary design element defaults. Keyboard
affordances remain absent until the first hardware-key dispatch.

### Things Still Being Designed

This document is not a deterministic implementation spec. It is the intended shape of the language.

Some things are known to belong in or near Tao layout, but still need their own design pass:

- `nudge`: small post-layout movement that does not affect siblings
- `overlay`: a possible in-layout positioning term, distinct from implemented presentation
  `as overlay`
- `SplitNav` pane insets when a pane holds a nested window-owning navigator — see "Safe Area And
  Keyboard Insets" above for what safe-area and keyboard avoidance is already implemented and proven
- design-token spacing and size values
- logical direction, such as `start` and `end`
- aspect ratio
- wrapped-line layout controls
- empty-container behavior
- layout merging for future slot forms beyond the implemented opaque single-fill slots
- fixed child-count constraints

The main unresolved ownership questions:

- When does outside spacing belong to the parent, and when does it belong to the child?
- When can a reusable declaration expose layout of its private internals?
- When do slots and caller content merge layout with the callee?

Those are language-design questions, not things this document should settle by accident.

### Historical Notes

The old repo and old design docs explored more syntax than Tao intends to carry forward.

## Conditions on entries

A layout or style entry may end in a condition, and several conditioned entries may sit in one clause
independently. The executable conditions are the scheme, `when Scheme is Light` or `when Scheme is
Dark`; the control's own interaction state, `when pressed`, `when focused`, and `when hovered`; and
named region focus, `when <Region> is active`. `<Region>` resolves by ordinary declaration identity
and visibility to a named view that the compiler emits as a member of a generated, app-reachable
interaction region. Merely declaring or rendering a same-named view elsewhere does not make it a
region member; private sibling declarations and orphan views cannot match. Private `#tag` values
remain test selectors and never name an interaction region. A condition whose resolved view is not
in that generated membership is a validation error, because it can never become true at runtime.

Important history:

- Old settled layout used `items`; this document uses `content`.
- Old unnamed caller content was `@@children`; this document uses `@@content`.
- Old drafts tried bare layout words such as `Row [top left]`; this document keeps the explicit `content` head.
- `centered` is shorthand for `aligned center`.
- Old drafts considered raw `row`, `column`, `wrap`, `nowrap`, `absolute`, offsets, `z`, `basis`, and `shrink`; this document keeps the common surface smaller.
- Old spread names included `spread-hug` and `spread-hug-tight`; this document uses `spread-inset` and `spread-balanced`.

The pattern behind these decisions is simple: Tao layout should read like UI language, not like a thin wrapper around runtime style props.

Where a runtime concept is common and human-facing, Tao should name it clearly. Where a runtime concept is powerful but low-level, Tao should wait for a design that explains why an app author wants it.
