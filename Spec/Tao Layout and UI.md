# Tao Layout And UI

Status: authoritative intended design. This document describes where Tao layout is going, not only what this repo implements today.

Current implementation status: this repo currently has `view` and `layout` declarations, explicit `render` roots, basic stdlib layout views, render child blocks, and the first bracketed layout clauses for `content`, `gap`, `pad`, `margin`, `width`, `height`, `fill`, `hug`, `compress`, `rigid`, `aligned`, and `centered`. The repo does not yet implement `frame`, `@@content`, named render slots, style clauses, or the complete merge/lowering contract described here. The old repo implemented most of this layout contract with the older `ui`, `items`, and `@@children` spellings; this document keeps the behavior that still fits and updates the public names to `view`, `content`, and `@@content`.

Open design question: should `frame` and `layout` be allowed to paint pixels with `<style>`, or should visual styling be restricted to `view` declarations and view-like primitives? Disallowing style on containers may make the model clearer, but it may also make common framed surfaces awkward. This document does not settle that question yet.

## Layout Introduction

In Tao, styling and layout are separated.

Layout describes how to arrange content on the screen - where it appears, and how it gets sized:

`Row [content spread center, pad 2, rigid] { ... }`

And styles describe visual appearance:

`Row <background black, border white, radius 2, shadow gray>`

### UI Kinds

There are three UI kinds in Tao:

- A `frame` container receives arbitrary content, sizes itself to `hug` that content, and resists compressing when space is tight. It is used inside object-like UI such as buttons, chips, icons-with-labels, and similar pieces.
- A `layout` container receives arbitrary content, expands into available space, and can compress when space gets tight. It is used for app regions like headers, lists, panes, and screens.
- A `view` decides its own content instead of receiving arbitrary content, renders content on screen, and handles user interactions. While `frame` and `layout` are about arrangement, `view` is about actually displaying things on the screen.

`frame`, `layout`, and `view` declarations can all take typed value parameters. `frame` and `layout` are additionally specialized by caller content, named render slots, and layout/style clauses.

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

Common complex container UI elements:

- `List`: a list of items, with options like a header and footer, etc.
- `ScrollView`: a scrollable container that allows the user to scroll through its content.

Basic transitional UI elements:

- `Spinner`: a loading indicator.
- `Progress`: a progress bar indicator.
- `Modal`: a modal dialog.

### Rendering Named Parts of the UI

When creating a UI element, you can allow for parts of the UI to be rendered by the caller. This is done using `@<name>` render slots.

```tao
use Icon, Text, Box, Row from @tao/ui

view Label Title is text {
   @icon = empty

   render Box {
      if @icon {
         @icon [centered, pad 2] { }
      }
      Box [content center, gap 2, pad horizontal 4 vertical 2] {
         Text Title
      }
   }
}

render Row {
   Label "Info" {
      @icon Icon "info" // Renders Label with an icon
   }
   Label "..." { }
}
```

### Rendering Arbitrary Content in `frame` and `layout`

When `frame` and `layout` UI render, they get to choose where to render it using `@@content`:

```tao
frame Card {
   @title = empty

   render Stack [content top stretch, gap 8, pad 16] <background white, radius 2, shadow gray> {
      @title [pad 2]
      @@content
   }
}
```

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
- `hug` to avoid expanding on the parent container's main axis
- `compress` to shrink beyond its content size when under pressure
- `rigid` to resist shrinking
- `width <positive number>` and `height <positive number>` to set physical dimensions directly
- `width fill` and `height fill` to fill one physical axis; Tao lowers this at runtime using the actual parent container direction

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

render Row [content right center] {
   Icon "info"
   Icon "hide"
   Icon "settings"
}
```

```tao
Row [content bottom left] {
   Text "Total"
   Text "$42"
}

Row [content spread center] {
   Text "Left"
   Text "Right"
}

Col [content top stretch] {
   Text "fills the column width"
   Button "Continue", Continue
}
```

Or, if we want to:

- Spread out the icons, and align with the bottom:
  - `Row [content spread bottom] { ... }`
- Align just the third icon to the bottom:
  - `Icon "settings" [aligned bottom]`
- Make the row hug the icons vertically (i.e., it shrinks to fit its content):
  - `Row [content spread, hug] { ... }`
- Make the row fill its parent, but also compress (i.e., it shrinks beyond the size of its content when under pressure):
  - `Row [fill, compress] { ... }`
- Make the row rigid (i.e., it never shrinks more than the minimum size of its content):
  - `Row [rigid] { ... }`
- Center icons vertically and horizontally, and add a gap between each one:
  - `Row [content center, gap 2]`
- Set the width and height of the row:
  - `Row [height 20, width 320] { ... }`
- Fill only the horizontal axis:
  - `Text "Name" [width fill]`

### Example: App Shell

```tao
layout AppShell {
   render Col [fill, content top stretch, gap 12, pad 16] {
      Header [hug]
      Row [fill, gap 16] {
         Sidebar [width 280, rigid]
         MainPane [width fill, compress]
      }
   }
}
```

Here, the outer `Col` fills the screen. The header hugs its content. The body row fills the remaining space. The sidebar keeps a fixed width and resists compression. The main pane fills the row's width at runtime.

### Example: Framed Content

`frame` and `layout` receive unnamed caller content through `@@content`.

```tao
frame Card {
   render Stack [content top stretch, gap 8, pad 16] {
      @@content
   }
}

render Col [gap 12] {
   Card {
      Text "Title"
      Text "Body"
   }
}
```

The caller writes the content. The `Card` decides where that content goes.

Caller container layout, such as `gap` and `content`, applies at the explicit container that directly contains `@@content`.

```tao
layout ToolbarArea {
   render Row [content spread center, gap 12] {
      @@content
   }
}

ToolbarArea [gap 8] {
   Button "Cancel", Cancel
   Button "Save", Save
}
```

If the declaration has fixed siblings and caller content, put `@@content` inside an explicit inner host when caller layout should affect only caller content:

```tao
frame LabeledSection text Label {
   render Stack [gap 12, pad 16] {
      Text Label

      Stack [gap 8] {
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
Row [content baseline left, gap 8] {
   TextFrame StatusCode
   Text Order.Title [fill, compress]
}

TextMultiline Article.Summary
TextMultiline Article.Summary, Lines 3
```

This keeps text pressure visible in the view being rendered. A layout clause should not have to say "this text is multiline" or "this label clips instead of ellipsizing." That is part of the text view's job.

### Wrapping Rows

Use `WrappingRow` when wrapping is part of the design.

```tao
WrappingRow [content top left, gap 8] {
   Tag "Design"
   Tag "Compiler"
   Tag "Runtime"
   Tag "Mobile"
}
```

The important part is not "turn flex wrap on." The important part is that the UI is a row of small things that may continue onto another line.

That is why Tao prefers a named container over a raw `[wrap]` flag:

```tao
WrappingRow [gap 8] {
   Tag "Offline"
   Tag "Syncing"
   Tag "Admin"
}
```

Future Tao may need more wrapped-line controls, such as how whole rows of wrapped content pack vertically. Those should be named around the shape Tao authors care about, not copied directly from CSS or React Native props.

### Overflow, Scroll, And Layers

Most normal layout should stay inside its bounds. If content is larger than its container, Tao should generally clip it unless the author chose a container that scrolls or intentionally draws outside its normal box.

Use a real scrolling view when the user should scroll:

```tao
layout FeedPage {
   render Col [fill] {
      Header
      ScrollView [fill] {
         FeedItems
      }
   }
}
```

Use a future layer concept for things that intentionally escape normal flow:

```tao
// Future-ish shape, not settled syntax.
overlay Toast [aligned bottom]
```

This keeps three ideas separate:

- clipping: content stays inside its region
- scrolling: content is larger, and the user moves through it
- layering: content intentionally appears above or outside normal flow

Raw absolute positioning, raw overflow flags, z-index-like layering, popovers, portals, and toasts all need more design. They should not sneak into ordinary layout syntax just because the runtime has a prop for them.

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
Row [content spread center, compress] {
   Text "Name"
   Button "Edit", Edit
}
```

### Things Still Being Designed

This document is not a deterministic implementation spec. It is the intended shape of the language.

Some things are known to belong in or near Tao layout, but still need their own design pass:

- `nudge`: small post-layout movement that does not affect siblings
- `overlay`: positioned content above normal flow
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
- Should `frame` and `layout` be allowed to paint pixels directly?

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
