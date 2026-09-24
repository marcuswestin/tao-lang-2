# Tao Design

Status: authoritative for the implemented design language, with the decided remainder of
`Docs/Roadmap/Tao Revolution/Decisions.md` §13 marked as not yet implemented and the deferred parts
marked as deferred. Tooling, artifacts, and rollout live in
`Docs/Roadmap/Add Tao design system MVP/Plan - Add Tao design system MVP.md`.

Current implementation status: Tao-authored `design` declarations hold typed `colors`, `sizes`,
`text`, `screens`, and `styles` blocks in ordinary source (`Decisions.md` §13). An app mounts one
declaration through `Design`; render specs resolve its styles and merge layout plus the implemented
`background`, `border`, `ink`, `line`, `radius`, `size`, and `weight` visual entries into the
existing native root. Static validation owns duplicates, reserved names, references, cycles, colors,
tags, conditions, and uniquely resolvable app design selection. Parameterized entries, environment
values other than `Scheme`, the `when Screen` condition, and the clause-list casing rule are decided
but not implemented. `rules { }` is deferred past MVP, as are `tao design` commands, screenshot
comparison, design lockfiles, and AI-assisted design iteration.

## Implemented First Slice

An app selects a design through its `Design` property:

```tao
workspace design WordFlowerDesign {
   colors {
      paper #f6f7f3
      ink #121826
      accent #2f6b4f
   }
   styles {
      screen [fill, content top stretch, pad 16, background paper]
      title [size 28, weight 700, ink ink]
   }
}

app WordFlower {
   Name "WordFlower"
   Navigator HomeStack
   Design WordFlowerDesign
}
```

A style contains the same clauses a render site may write inline. Styles and direct clauses form
one left-to-right list; the last specification of a given clause wins. After replacement, a
semantically incompatible resolved clause set is invalid regardless of source order.

The implemented visual heads are `background <token>`, `border <token>`, `ink <token>`,
`line <number>`, `radius <number>`, `size <number>`, and `weight <number>`. A border token supplies
its color and the minimal slice supplies width `1`. `bg` and `fg` are accepted legacy spellings of
`background` and `ink` and draw a warning; one style spelling the same property both ways is an
error. Colors and bundles written directly in `design { }`, outside the typed blocks, are the
deprecated flat catalog: still accepted, with one warning per design. Style expansion preserves
source order; later occurrences replace the same semantic clause while unrelated layout and style
clauses remain. Resolution uses the Design selected by the mounted app occurrence — there is no
global design registry — so two mounted apps may resolve the same style name independently.

The lexer uses one `TagOrHexColor: /#[A-Za-z0-9_]+/` terminal. AST context supplies the meaning: the
validator requires tags to match `#[A-Za-z_][A-Za-z0-9_]*`, while design color values must be CSS
hexadecimal `#RGB`, `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`, case-insensitively.

At a render site, names that are not built-in layout or visual heads are style references. When the
enclosing source has one statically selected Design, validation resolves those references and their
cycles there. A renderable app with no Design cannot use design terms. If several app values can
mount the same shared visual with different Designs, validation preserves the reference and each
mounted app resolves it against its own declaration at runtime.

## Goals

- Treat design as a Tao language/compiler/runtime concern, not as a pile of app-authored React
  Native style objects.
- Let authors write semantic UI structure and layout while Tao supplies coherent visual defaults.
- Keep layout and visual design as distinct typed concerns so sizing and flow decisions do not get
  tangled with color, typography, elevation, or state treatment, while applying both through one
  composable spec surface.
- Make visual decisions inspectable through named colors, sizes, text styles, styles, and rules.
- Prefer deterministic design behavior before AI-assisted behavior.
- Make accessibility, contrast, target size, focus, and platform adaptation first-class design
  constraints.
- Give future AI tools constrained design objects to edit, not arbitrary app logic or UI structure.

Non-goals for the first design work:

- No uncontrolled AI code mutation.
- No raw CSS or React Native style prop language as the primary user surface.
- No requirement that Tao apps look identical across iOS, Android, and web.
- No Figma dependency.
- No screenshot loop before deterministic design data, lowering, and diagnostics exist.

## Core Model

Tao combines layout and design in one `[]` spec surface while retaining their distinct types:

```tao
[pad 16, gap 12, width fill, background surface, ink text]
```

- Layout terms answer where content goes and how it sizes.
- Design terms answer what the rendered surface means visually.
- A design declaration defines the app's visual language: its values and its styles.
- Runtime lowering turns resolved design terms into platform styles.

**Raw values stay in the design.** Product code speaks in names; a raw value at a render site
(`Box() [background #ff00aa]`, `pad 16`) is inline design exploration, accepted while prototyping
and reported by `tao check` as a warning to promote it to a design value, style, or element default
before release. The same literal inside `design { }` is fine. `pad 0` and `none` are not
exploration.

**No reference marker.** A bare name in a clause list resolves to a style or design value; clause
heads are a closed, reserved set, so a style may not be named `pad` and the validator says so at
the declaration.

## The design declaration

### Typed value blocks — implemented

The block name types its members, so the checker needs no annotations and there is no generic
`tokens` block:

```tao
design SkilletDesign {
   colors {
      cream #FBF7EF
      ember #D9622B { 20 #F4D7C8, 60 #B34E1F }       // a family: ember, ember.20, ember.60
      night #16130F
      canvas when Scheme is Dark night / not cream    // a derived, conditional color
   }
   sizes {
      sm 8.px, md 12.px, lg md + 4.px                 // folded at build
      display 24.px, readable 1.rem
   }
   text {
      title [size display, weight semibold, line lg]
   }
   screens { narrow below 500.px, medium below 1000.px, wide }
}
```

- A **family** nests shades under a head value, addressed as paths (`ember.20`).
- There is no separate meaning layer: a semantic role is a **derived color**, a named entry whose
  value is conditional on the environment (`canvas` above).
- **Entries fold or react.** An entry derived from other entries or constants folds at build time
  (`lg md + 4.px`); an entry conditioned on the environment resolves at render. `screens { }`
  breakpoints must fold.
- Sizes use the `size` unit family (`Decisions.md` §2). `px` and `rem` are implemented; `%` is
  decided, not implemented. `rem` currently resolves to a fixed 16px; growing with the person's
  text setting waits for `TextScale`.
- A unit literal lives in `sizes { }`; a clause list takes a word, a bare number, a color, or `none`.
  §13's `title [size 24.px]` — a unit literal inside a clause list — is decided, not implemented.
- `screens { }` names the size classes. It parses, validates, and is stored; `when Screen is narrow`
  is not implemented and is rejected as an unknown condition.

**Decided, not implemented:** parameterized entries — a case-keyed palette such as
`aisle(Aisle) when Aisle { Produce -> #7A9D54, otherwise -> #999 }`, used as
`[background aisle(Grocery.Aisle)]`.

### Styles and element defaults — implemented

`styles { }` holds two kinds of entry, told apart by case. A lowercase name is a style a site opts
into (`[card, danger]`); a Capitalized name is an **element default**: every `Text` starts from the
`Text` entry.

```tao
styles {
   card [background canvas, radius md, pad md, gap sm]
   danger [ink #C0392B]
   Text [ink ink]
   FormButton [background accentStrong, background accent when pressed, ink onAccent]
}
```

This replaces a base/variant/state recipe stack: the base is the element default, a variant is a
lowercase style, and a state is an ordinary condition. Element defaults cover the linked `@tao/ui`
elements (`Text`, `TextInput`, `FormButton`, `Checkbox`, `Progress`, …) and the surfaces the
runtime draws itself, which it reads from the mounted design by name — for example `AppSurface`,
`NavigationHost`, `NavigationContent`, `NavigationHeader`, `NavigationTitle`, `NavigationTabs`,
`NavigationTab`, `NavigationTabActive`, `NavigationChromeButton`, `ModalSurface`, `ToastSurface`,
`Hint`, and `Overview`. An app may override any of them without owning the runtime layer.

**Decided, not implemented — the clause-list casing rule** (2026-09-23): a clause list names only
lowercase styles; an element default applies by element and is never named in a clause list; design
names are lowercase; and a Capitalized word in a clause list is a value. Today the validator does
not enforce it, and `NavigationTabActive [NavigationTab, …]` names one default inside another
because the runtime picks one of the two per tab.

`patterns { }` is not carried forward: a named arrangement with slots is an ordinary `view` placing
`@@content`.

### Conditions — partly implemented

Design conditions are ordinary postfix `when` expressions, the same shapes as conditional styling
(§9). Implemented: `when Scheme is Light|Dark`, the interaction states `when pressed`,
`when focused`, and `when hovered`, and `when <Region> is active` for named-region focus. Any other
condition is a validation error that lists these.

**Decided, not implemented:** the remaining environment values — `Contrast`, `Motion`, `TextScale`,
`Screen`, `Platform`, `Pointer`, `Direction`, `Locale` — read-only reactive values that adaptation
consults, the person's settings first; conditions over data (`[ink green when Person.Happy]`); and
case maps (`[ink when Tone { Neutral -> muted, Good -> good }]`). A batch form such as
`dark { canvas night }` or `platform { }` may return later as sugar over these conditions.

**Deferred past MVP:** container conditions, a use-site tool — an element opts in with
`[container]` and only its descendants may test `when Container …`, never the design block.

### Declaration style defaults — implemented

A declaration's header clause is its public style surface, resolved after the design's element
default and before the caller; `Docs/Spec/Tao Layout and UI.md` ("Declaration Style Defaults") owns
the precedence, private root clauses, and `none`.

### Rules — deferred past MVP

`rules { }` makes accessibility executable where it is decidable, in §13's sentence form:

```tao
rules {
   rule contrast at least wcag.aa
   rule tap targets at least 44.px
   rule meaning survives without color or motion
}
```

The MVP ships no rule checks, no runtime validation, and no review automation (2026-09-23). When
rules land, their diagnostics are `tao check` warnings; there is no `tao design check`. The plan's
"Design rules — deferred past MVP" carries which rules are decidable from source, which need
rendering, and the static analysis they need.

## App Selection And Defaults

Every project `tao create` writes has a `Design.tao` with a `colors { }` palette derived from three
colors (canvas, ink, accent), element defaults, and the styles its scenes apply; see
`Apps/Starters/README.md`. The derived muted ink is the lightest blend that still reads at WCAG AA
on canvas and surface. An app selects its design with `Design <Name>`; a general app-capability
bundle remains deferred under `LANG-003`.

Direction, not implemented: starter themes as presets over this one model — for example a clean
platform-adaptive default, an editorial style, a colorful consumer style, a calm style, a dense data
style, and a dark-first style — rather than separate style engines.

## Platform Adaptation

Tao should not force every platform to look identical, and adaptation should preserve app identity
while respecting native expectations, accessibility settings, locale, direction, density, motion,
and input modes. In the decided model this is conditions over the environment values above
(`Platform`, `Pointer`, `Motion`, `Contrast`, …) inside the design, not a separate platform
language. Only `Scheme` is implemented.

## Beyond the design language

The `tao design` CLI surface, the design lockfile, AI and visual iteration policy, scenario-driven
review, the phased implementation path, prior art, and the remaining tooling decisions live in
`Docs/Roadmap/Add Tao design system MVP/Plan - Add Tao design system MVP.md`.

## Open Questions

- ~~What declaration syntax best defines tokens and named specs?~~ **Decided (§13):** typed value
  blocks and `styles { }`; no recipes.
- ~~Does source use `design`, `theme`, or both as public capability names?~~ **Decided: `design`.**
  The declaration is `design <Name> { ... }` and an app selects it with `Design <Name>`.
- ~~Should the first design data live in `.tao` source, a `tao.design` file, or both?~~ **Decided:
  `.tao` source.** Design is an ordinary Tao declaration subject to the same visibility, imports,
  and validation as the rest of the language; no separate design file format.
- ~~Which diagnostics are ordinary validator diagnostics, and which belong to
  `tao design check`?~~ **Decided (§16):** there is no `tao design check`; all are `tao check`
  diagnostics.
- Which visual treatments can apply to content-accepting wrapper views?
- How do combined specs interact with future slot forms beyond the implemented opaque single-fill
  named slot and intrinsic `@@content`?
- How are app defaults selected before the user has authored a design?
- Beyond the implemented unquoted CSS hexadecimal color literal, which raw value forms should remain
  useful for prototypes without becoming the main style language?
- What is the first useful cross-platform adaptation axis after `Scheme`: platform, density, text
  scale, motion, locale, or pointer/hover capability?
