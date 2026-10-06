---
name: tao-layout
description: >-
  Build Tao UI layout. Use when arranging or sizing views, choosing containers, fixing text clipping
  or wrapping, adding scrolling, or adapting panes to available space.
---

# Tao Layout

Use `Col` for flexible vertical content, `Row` for one flexible horizontal line, `WrappingRow` for
wrapping horizontal content, `Stack` for hugging vertical content, and `Box` for hugging horizontal
content. `Layer(InsetTop:, InsetRight:, InsetBottom:, InsetLeft:)` floats its stacked children over
the parent's flow at those optional edge distances; a missing axis sits at top or left, the parent
never grows to hold it, and later layers paint over earlier siblings. `ScrollView` is the
implemented scrolling container. Leaf views include `Text`, `TextFrame`, `TextMultiline`, `Number`,
`Image`, `Checkbox`, `Button`, `FormButton`, `TextInput`, `Spinner`, `Progress`, `Placeholder`, and
`Spacer`.

`Text` is one line with ellipsis, `TextFrame` clips one line, and `TextMultiline` wraps; add
`Lines: N` to cap it. A non-decorative `Image` needs a nonblank `Label`.

```tao SkillLayout.tao
use Col, Panes, Row, Text, TextMultiline from @tao/ui

view SkillLayoutExample() {
   render Col() [fill, content top stretch, gap 12, pad 16] {
      Row() [content spread center, gap 8] {
         Text("Title") [hug]
         Text("Status") [aligned center]
      }
      Panes() [gap 16] {
         TextMultiline("First pane") [claim 2, compress]
         TextMultiline("Second pane") [claim 1, compress]
}  }  }
```

## Implemented clauses

- Content: `content top|bottom|left|right|center|baseline|stretch|spread|spread-inset|spread-balanced`.
  One or two compatible terms set the container's main and cross axes.
- Size: `fill`, `claim N`, `hug`, `compress`, `rigid`, numeric `width`/`height`, `width fill`,
  `height fill`, and `width max N`.
- Item alignment: `aligned top|bottom|left|right|center|baseline`; `centered` means `aligned center`.
- Spacing: `gap N`; `pad` and `margin` accept one number or physical/horizontal/vertical side pairs.
- A later clause for the same semantic slot wins; unrelated clauses remain.

`Panes` puts direct children side by side only when each can have at least 320 logical pixels after
gaps; otherwise it stacks them in source order. Before measurement it uses the stacked shape.

Use a view with `@@content` for an authored wrapper and `@name = empty` for an optional single-fill
slot. Layout merges into the rendered native root; tags and specs do not add wrapper nodes.

Positioning clauses on arbitrary views, overflow flags, z-index, anchored overlays, safe-area
helpers, breakpoints, aspect ratio, logical start/end, and wrapped-line controls are unavailable. Use `ScrollView` for
scrolling and navigation presentation for overlays or toasts.

See [Flexbox mapping](references/flexbox-mapping.md) for the exact React Native resolution.
