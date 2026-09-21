---
name: tao-design
description: Define and apply Tao's implemented flat color tokens and reusable layout/style clause bundles.
---

# Tao Design

The implemented design surface has flat hexadecimal color tokens and named clause bundles. An app
selects one design with `Design Name`; render sites apply its bundle names inside the same `[]` list
as direct layout clauses.

```tao SkillDesign.tao
folder
design SkillDesign {
   paper #fbfaf7
   ink #1b1b1f
   accent #2f6b4f
   accentPressed #24543e
   screen [fill, content top stretch, pad 16, bg paper]
   title [size 28, line 34, weight 700, fg ink]
   primaryButton [bg accent, bg accentPressed when pressed, fg paper, radius 10]
}
```

Colors must use `#RGB`, `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`. Bundle entries may reference earlier or
later tokens and other bundles; cycles and missing names are diagnostics.

Implemented visual heads are:

- `bg <token>`: background color.
- `border <token>`: border color with width 1.
- `fg <token>`: foreground/text color.
- `line <number>`: text line height.
- `radius <number>`: corner radius.
- `size <number>`: font size.
- `weight <number>`: font weight.

Bundles and direct clauses expand left to right. The last entry for one semantic slot wins, while
unrelated style and layout remain. This makes `[card, gap 20]` a safe layout override of a bundle.

To restyle without changing layout, edit color token values and visual entries in `Design.tao`.
Keep `fill`, `content`, sizing, spacing, and view structure unchanged. Element defaults such as
`Text`, `TextInput`, `FormButton`, `Checkbox`, and navigation host names are ordinary bundle names
used automatically by those standard views.

Semantic/nested tokens, component or pattern recipes, design rules, shadows, opacity, focus rings,
platform blocks, container queries, screenshot comparison, lockfiles, and `tao design` commands are
unavailable. Do not invent their syntax.
