---
name: tao-design
description: Define and apply Tao's implemented color tokens and reusable layout/style clause bundles.
---

# Tao Design

The implemented design surface has hexadecimal color tokens, in a `colors { }` block, and named
clause bundles, in a `styles { }` block. An app selects one design with `Design Name`; render sites
apply its bundle names inside the same `[]` list as direct layout clauses.

```tao SkillDesign.tao
folder
design SkillDesign {
   colors {
      paper #fbfaf7
      ink #1b1b1f
      accent #2f6b4f
      accentPressed #24543e
   }
   styles {
      screen [fill, content top stretch, pad 16, background paper]
      title [size 28, line 34, weight 700, ink ink]
      primaryButton [background accent, background accentPressed when pressed, ink paper, radius 10]
   }
}
```

Colors must use `#RGB`, `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`. Bundle entries may reference earlier or
later tokens and other bundles; cycles and missing names are diagnostics.

Implemented visual heads are:

- `background <token>`: background color.
- `border <token>`: border color with width 1.
- `ink <token>`: foreground/text color.
- `line <number>`: text line height.
- `radius <number>`: corner radius.
- `size <number>`: font size.
- `weight <number>`: font weight.

`bg` and `fg` still parse as legacy spellings of `background` and `ink`; write the canonical names.
Likewise, a color token or bundle declared directly in the design body outside `colors { }`/
`styles { }` still parses; write it inside the typed block instead.

Bundles and direct clauses expand left to right. The last entry for one semantic slot wins, while
unrelated style and layout remain. This makes `[card, gap 20]` a safe layout override of a bundle.

An entry may end in one condition: `when pressed`, `when focused`, `when hovered`, `when selected`
(the element its host marks as the current choice, such as the active navigation tab), or
`when Scheme is Light|Dark`. A conditioned entry applies only while its condition holds.

To restyle without changing layout, edit color token values and visual entries in `Design.tao`.
Keep `fill`, `content`, sizing, spacing, and view structure unchanged. Element defaults such as
`Text`, `TextInput`, `FormButton`, `Checkbox`, and navigation host names are Capitalized entries in
`styles { }` that those standard views apply automatically. A clause list never names one — not at a
render site and not inside another style — so a default that needs another's clauses restates them,
and a state such as the active tab is a condition on the same default:
`NavigationTab [pad 10, ink inkMuted, background accentSoft when selected]`. Colors, sizes, text
styles, and screens are always lowercase; a Capitalized one is an error.

When a view tints something inside itself, which a caller's clauses cannot reach, give it a `color`
parameter: `view StatusBadge(Label text, Tint color default inkMuted)`, whose body writes
`Box() [dot, background Tint]`, called as `StatusBadge("Final", Tint: accent)`. A lowercase word in a
clause list is a design name and a Capitalized word reads a value, so `background Tint` uses the
parameter. A `color` value is only ever a design color name (including a shade such as
`accent.20`) or another `color` parameter — never text, a number, or data — and `color` is only a
view parameter's type, not state.

Semantic tokens, component or pattern recipes, design rules, shadows, opacity, focus rings,
platform blocks, container queries, screenshot comparison, lockfiles, and `tao design` commands are
unavailable. Do not invent their syntax.
