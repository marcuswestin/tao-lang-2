# Tao Layout And UI

Status: authoritative intended design. This document describes where Tao layout is going, not only what this repo implements today.

Current implementation status: this repo has `view`, `ui`, `layout`, and `frame` declarations,
explicit `render` roots, unnamed `@@content`, optional single-fill named frame slots, runtime-backed
controls and containers, private `#tag` test metadata, and bracketed clauses for `content`, `claim`,
`gap`, `pad`, `margin`, `width`, `height`, `fill`, `hug`, `compress`, `rigid`, `aligned`, and
`centered`. It also implements `width max`, adaptive `Panes`, and the first flat-token design terms
and named clause bundles. Render arguments are always parenthesized, and a spec remains a distinct
following clause: `render View(args) [spec] { children }`. Tags, layout, and design style merge into
an existing concrete native root and add no wrapper node. Compatible material beyond that first
contract remains future direction in this document. The old repo
implemented most of this layout contract with older spellings; this document keeps the behavior that
still fits and uses the current public `view`, `ui`, `content`, and `@@content` names.

## Layout Introduction

Styling and layout remain distinct typed concerns, but Tao combines both in one bracketed spec surface. Named specs may contain other named specs and may package layout and visual styling together.

Layout describes how to arrange content on the screen - where it appears, and how it gets sized:

`Row [content spread center, pad 2, rigid] { ... }`

Visual entries describe appearance in the same brackets:

`Row [content spread center, background black, border white, radius 2, shadow gray]`

### UI Kinds

The implemented core hierarchy separates rendering from presentation. `visual` is the common
rendering root; `presentable` refines `visual`; `ui` and `nav` refine `presentable`; and `view`,
`layout`, and `frame` refine `visual` without thereby becoming presentable. A `nav` is consequently
visual in the type hierarchy but is not a render-bearing declaration and cannot be embedded as an
ordinary child.

There are three render-bearing visual declaration kinds in Tao:

- A `frame` container receives arbitrary content, sizes itself to `hug` that content, and resists compressing when space is tight. It is used inside object-like UI such as buttons, chips, icons-with-labels, and similar pieces.
- A `layout` container receives arbitrary content, expands into available space, and can compress when space gets tight. It is used for app regions like headers, lists, panes, and screens.
- A `view` decides its own content instead of receiving arbitrary content, renders content on screen, and handles user interactions. While `frame` and `layout` are about arrangement, `view` is about actually displaying things on the screen.

`frame`, `layout`, and `view` declarations can all take typed value parameters. `frame` and `layout` are additionally specialized by caller content, named render slots, and combined specs. Containers may paint backgrounds, borders, shadows, and other visual styles when their spec requests them.

Presentation adds separate declaration roles without changing these visual roles:

- `ui` is presentable content whose visual body follows the same render rules as a `view`.
- `dialogue` is response-demanding content whose body follows the same render rules.
- `nav` is a package-configured presentation kind and binds its runtime behavior through
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

Hugging containers:

- `Stack`: hugs its content and lays it out top-to-bottom
- `Box`: hugs its content and lays it out horizontally

All five ship today as `layout` declarations. The separate `frame` role is implemented for
intrinsically hugging, rigid containers that place caller content with `@@content`.

UI containers usually do not paint pixels themselves. Instead, they focus on how visible content is arranged and sized.

#### UI Elements: `view`

Tao provides common `view` UI elements and view-like stdlib components. They are automatically styled according to your app's design system.

Basic content UI elements:

Shipped today, alongside the containers above: `Text`, `TextFrame`, `TextMultiline`, `Number`,
`Button`, `TextInput`, and `FormButton`. `TextInput` and `FormButton` carry the label, placeholder,
disabled, and submitting properties that forms rely on.

Also shipped:

- `Image`: displays an image and allows you to size and transform it.
- `Checkbox`: a checkbox for a two-state value, with a label and disabled state.

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

For a text control with `Value is text, Change is action(text)`, omitting `on change` synthesizes the usual two-way update only when the explicitly labeled `Value:` expression directly references writable text `state`:

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
owns that overlay layer. Response-demanding conversations are dialogues invoked with `ask`; see
`Tao Presentation and Navigation.md`. Raw visual portals and general in-layout layering remain a
separate deferred design question.

### Rendering Named Parts of the UI

The first named-slot contract is implemented. A `frame` declares an
optional named content slot with `@name = empty`. A caller may fill it at most once with
`@name <visual>`. The filled value is opaque visual content and renders exactly where the frame body
places `@name`; `empty` contributes no node. Parameterized, repeatable, and required slots remain
future work.

```tao
use Col, FormButton, Row, Text from @tao/ui

frame Card(Title is text) {
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

### Rendering Arbitrary Content in `frame` and `layout`

When `frame` and `layout` UI render, they get to choose where to render it using `@@content`:

```tao
frame Card() {
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
- `@@content` places unnamed children inside a `frame` or `layout` implementation.
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
frame UserCard() {
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
- Within one layout clause, bare `fill` cannot appear with `width` or `height`; use physical-axis sizing when per-axis control is needed.
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
layout AppShell() {
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
frame Card() {
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
layout ToolbarArea() {
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
frame LabeledSection(Label is text) {
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
layout FeedPage() {
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

A caller layout clause overlays the render site's defaults. Named clause bundles and direct clauses
form one left-to-right list. The last specification of a given clause replaces the earlier value;
unrelated clauses remain. After replacement, the validator rejects a resolved set containing
semantically incompatible clauses—source order cannot make incompatible categories valid:

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
- safe-area and keyboard-aware helpers
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

Important history:

- Old settled layout used `items`; this document uses `content`.
- Old unnamed caller content was `@@children`; this document uses `@@content`.
- Old drafts tried bare layout words such as `Row [top left]`; this document keeps the explicit `content` head.
- `centered` is shorthand for `aligned center`.
- Old drafts considered raw `row`, `column`, `wrap`, `nowrap`, `absolute`, offsets, `z`, `basis`, and `shrink`; this document keeps the common surface smaller.
- Old spread names included `spread-hug` and `spread-hug-tight`; this document uses `spread-inset` and `spread-balanced`.

The pattern behind these decisions is simple: Tao layout should read like UI language, not like a thin wrapper around runtime style props.

Where a runtime concept is common and human-facing, Tao should name it clearly. Where a runtime concept is powerful but low-level, Tao should wait for a design that explains why an app author wants it.
