# Tao Layout And UI

Status: authoritative intended design. This document describes where Tao layout is going, not only what this repo implements today.

Current implementation status: this repo currently has `view`, `ui`, and `layout` declarations,
explicit `render` roots, basic stdlib layout views, render child blocks, runtime-backed `TextInput`
and `FormButton` controls with labels, placeholders, disabled and submitting state, private `#tag`
test metadata, control configuration through `on press|change|submit`, direct-state two-way text
input binding, and the first bracketed layout clauses for `content`, `claim`, `gap`, `pad`, `margin`,
`width`, `height`, `fill`, `hug`, `compress`, `rigid`, `aligned`, and `centered`. Render arguments are
always parenthesized, and layout remains a distinct following clause: `render View(args) [layout]
{ children }` or `View(args) [layout] { children }`. Tags merge into an existing concrete native
root and do not add a layout node. The repo does not yet implement `frame`, `@@content`, named render
slots, visual style entries, or the complete merge/lowering contract described here. The old repo
implemented most of this layout contract with older spellings; this document keeps the behavior that
still fits and uses the current public `view`, `ui`, `content`, and `@@content` names.

## Layout Introduction

Styling and layout remain distinct typed concerns, but Tao combines both in one bracketed spec surface. Named specs may contain other named specs and may package layout and visual styling together.

Layout describes how to arrange content on the screen - where it appears, and how it gets sized:

`Row [content spread center, pad 2, rigid] { ... }`

Visual entries describe appearance in the same brackets:

`Row [content spread center, background black, border white, radius 2, shadow gray]`

### UI Kinds

There are three UI kinds in Tao:

- A `frame` container receives arbitrary content, sizes itself to `hug` that content, and resists compressing when space is tight. It is used inside object-like UI such as buttons, chips, icons-with-labels, and similar pieces.
- A `layout` container receives arbitrary content, expands into available space, and can compress when space gets tight. It is used for app regions like headers, lists, panes, and screens.
- A `view` decides its own content instead of receiving arbitrary content, renders content on screen, and handles user interactions. While `frame` and `layout` are about arrangement, `view` is about actually displaying things on the screen.

`frame`, `layout`, and `view` declarations can all take typed value parameters. `frame` and `layout` are additionally specialized by caller content, named render slots, and combined specs. Containers may paint backgrounds, borders, shadows, and other visual styles when their spec requests them.

Presentation adds separate declaration roles without changing these visual roles:

- `ui` is presentable content whose visual body follows the same render rules as a `view`.
- `dialogue` is response-demanding content whose body follows the same render rules.
- `nav` declares a package-configured presentation kind and binds its runtime behavior through
  `implement inject nav`; it is not a render-bearing visual declaration. A configured nav may be
  mounted only as an app navigator, a genuine app auxiliary, or content of another nav. Rendering a
  nav inside a `view` or `ui` is a validation error.

See `Tao Presentation and Navigation.md` for presentation behavior.

#### UI Containers: `frame` and `layout`

Tao provides common core containers:

Flexible `layout` containers:

- `Col`: lays out its content vertically with flexible height
- `Row`: lays out its content horizontally on a single line with flexible width
- `WrappingRow`: lays out its content horizontally and allows it to wrap onto multiple lines, with flexible total width

Rigid `frame` containers:

- `Stack`: hugs its content and lays it out top-to-bottom
- `Box`: hugs its content and lays it out horizontally

UI containers usually do not paint pixels themselves. Instead, they focus on how visible content is arranged and sized.

#### UI Elements: `view`

Tao provides common `view` UI elements and view-like stdlib components. They are automatically styled according to your app's design system.

Basic content UI elements:

- `Text`: displays text and allows you to style its typography, color, etc.
- `Image`: displays an image and allows you to size and transform it, etc.
- `Icon`: a specialized version of `Image` that is used to display icons, including system icons.

Basic interactive UI elements:

- `Pressable`: a pressable surface. Its exact `view`/`frame` classification is still part of the broader UI design.
- `Button`: a button with options like an icon, a label, etc.
- `TextInput`: a text input with options like a placeholder, a label, etc.
- `ImageInput`: a button that allows the user to select an image, with options like where to store it, etc.
- `Checkbox`: a checkbox for a boolean value, with options like a label and disabled state, etc.

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

For a text control with `Value is text, Change is action(text)`, omitting `on change` synthesizes the usual two-way update only when the explicitly labeled `Value:` expression directly references writable text `state`:

```tao
state Draft = ""
TextInput(Value: Draft, Label: "Title")
```

Computed values, aliases, parameters, entity fields, and unlabeled arguments are not writable bindings; they require an explicit `on change`. An explicit change handler replaces the synthesized update. Disabled controls suppress their configured native press/change/submit delivery in the runtime.

Common complex container UI elements:

- `List`: a list of items, with options like a header and footer, etc.
- `ScrollView`: a scrollable container that allows the user to scroll through its content.

Basic transitional UI elements:

- `Spinner`: a loading indicator.
- `Progress`: a progress bar indicator.

Modal presentation is not an ordinary UI primitive. Non-blocking modal surfaces use
`present X() as overlay`, which layers above the nearest nav or an explicit `in` target. Every nav
owns that overlay layer. Response-demanding conversations are dialogues invoked with `ask`; see
`Tao Presentation and Navigation.md`. Raw visual portals and general in-layout layering remain a
separate deferred design question.

### Rendering Named Parts of the UI

When creating a UI element, you can allow for parts of the UI to be rendered by the caller. This is done using `@<name>` render slots.

```tao
use Icon, Text, Box, Row from @tao/ui

view Label Title text {
   @icon = empty

   render Box() {
      if @icon {
         @icon [centered, pad 2] { }
      }
      Box() [content center, gap 2, pad horizontal 4 vertical 2] {
         Text(Title)
      }
   }
}

render Row() {
   Label("Info") {
      @icon Icon("info") // Renders Label with an icon
   }
   Label("...") { }
}
```

### Rendering Arbitrary Content in `frame` and `layout`

When `frame` and `layout` UI render, they get to choose where to render it using `@@content`:

```tao
frame Card {
   @title = empty

   render Stack() [content top stretch, gap 8, pad 16, background white, radius 2, shadow gray] {
      @title [pad 2]
      @@content
   }
}
```

### Declaration Properties, Children, And Slots

Declaration properties use the owner-qualified binding rules in `Tao Type System.md`. Header parameters are shorthand for the same public properties:

```tao
view Profile User {
   render Text(User.Name)
}

view ProfileLonghand {
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
- `@@content` places unnamed children inside a `frame` or `layout` implementation.
- Keyed navigation entries bind the configured nav declaration's direct `@key { ... }` contract;
  they are not visual render slots or an implicit `Items` property.

`@name` consistently introduces or refers to an owner-scoped name. Render slots and keyed entries are different typed roles under that shared naming model: a render slot is declared by the reusable UI surface, while a keyed entry is declared in one configured value and may be targetable when its accepted entry type permits it.

Direct `@name` entries share one namespace within their immediate configured owner. Nested configured
values begin new namespaces. In the implemented surface, a configured nav may declare one `@key`
item contract and each direct key binds it; a declaration without that contract rejects keyed entries.
A render declaration's direct `@name` remains a visual slot. A duplicate direct name in one owner is
invalid.

Only a targetable keyed entry creates an owner-qualified target such as `WordFlower@home`. A render slot never becomes a navigation target merely because it uses `@`.

```tao
frame UserCard {
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
   @actions Button("Edit") // named render slot
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
- Within one layout clause, bare `fill` cannot appear with `width` or `height`; use physical-axis sizing when per-axis control is needed.

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

If we want a row with three icons aligned to its right edge and vertically centered:

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
   Button("Continue", Continue)
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
layout AppShell {
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

### Example: Framed Content

`frame` and `layout` receive unnamed caller content through `@@content`.

```tao
frame Card {
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
layout ToolbarArea {
   render Row() [content spread center, gap 12] {
      @@content
   }
}

ToolbarArea() [gap 8] {
   Button("Cancel", Cancel)
   Button("Save", Save)
}
```

If the declaration has fixed siblings and caller content, put `@@content` inside an explicit inner host when caller layout should affect only caller content:

```tao
frame LabeledSection text Label {
   render Stack() [gap 12, pad 16] {
      Text(Label)

      Stack() [gap 8] {
         @@content
      }
   }
}
```

Render slots are different from `@@content`. Slots are named holes such as `@actions` or `@row Item`. This layout doc only mentions slots where content routing affects layout. Detailed slot invocation and fill rules still need their own spec.

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
TextMultiline(Article.Summary, Lines 3)
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

### Overflow, Scroll, And Layers

Most normal layout should stay inside its bounds. If content is larger than its container, Tao should generally clip it unless the author chose a container that scrolls or intentionally draws outside its normal box.

Use a real scrolling view when the user should scroll:

```tao
layout FeedPage {
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

A caller layout clause overlays the render site's defaults. Terms that target the same layout slot replace that default slot; unrelated defaults remain:

```tao
Row() [content spread center, compress] {
   Text("Name")
   Button("Edit", Edit)
}
```

### Things Still Being Designed

This document is not a deterministic implementation spec. It is the intended shape of the language.

Some things are known to belong in or near Tao layout, but still need their own design pass:

- `nudge`: small post-layout movement that does not affect siblings
- `overlay`: a possible in-layout positioning term, distinct from implemented presentation
  `as overlay`
- scroll containers
- safe-area and keyboard-aware helpers
- design-token spacing and size values
- logical direction, such as `start` and `end`
- aspect ratio
- wrapped-line layout controls
- empty-container behavior
- exact render-slot layout merging
- fixed child-count constraints

The main unresolved ownership questions:

- When does outside spacing belong to the parent, and when does it belong to the child?
- When can a reusable declaration expose layout of its private internals?
- When do slots and caller content merge layout with the callee?

Those are language-design questions, not things this document should settle by accident.

### Historical Notes

The old repo and old design docs explored more syntax than Tao intends to carry forward.

Important history:

- Old settled layout used `items`; this document uses `content`.
- Old unnamed caller content was `@@children`; this document uses `@@content`.
- Old drafts tried bare layout words such as `Row [top left]`; this document keeps the explicit `content` head.
- `centered` is shorthand for `aligned center`.
- Old drafts considered raw `row`, `column`, `wrap`, `nowrap`, `absolute`, offsets, `z`, `basis`, and `shrink`; this document keeps the common surface smaller.
- Old spread names included `spread-hug` and `spread-hug-tight`; this document uses `spread-inset` and `spread-balanced`.

The pattern behind these decisions is simple: Tao layout should read like UI language, not like a thin wrapper around runtime style props.

Where a runtime concept is common and human-facing, Tao should name it clearly. Where a runtime concept is powerful but low-level, Tao should wait for a design that explains why an app author wants it.
