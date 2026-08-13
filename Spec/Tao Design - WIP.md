# Tao Design

Status: intended design draft for the design *language*. Nothing here is implemented. Tooling, artifacts, and rollout live in `Roadmap/Add Tao design system MVP/Design tooling and rollout.md`.

Current implementation status: this repo currently has bracketed layout clauses, runtime layout lowering through `TR.Layout`, a default app shell, and stdlib view/layout primitives that receive Tao-owned props. It does not yet implement Tao-authored design declarations, visual spec entries, design tokens, semantic tokens, recipes, `tao design` commands, design diagnostics, screenshot comparison, design lockfiles, or AI-assisted design iteration.

## Goals

- Treat design as a Tao language/compiler/runtime concern, not as a pile of app-authored React Native style objects.
- Let authors write semantic UI structure and layout while Tao supplies coherent visual defaults.
- Keep layout and visual design as distinct typed concerns so sizing/flow decisions do not get tangled with color, typography, elevation, or state treatment, while applying both through one composable spec surface.
- Make visual decisions inspectable through tokens, semantic tokens, recipes, pattern recipes, and rules.
- Prefer deterministic design behavior before AI-assisted behavior.
- Make accessibility, contrast, target size, focus, and platform adaptation first-class design constraints.
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
[pad 16, gap 12, width fill, bg surface, fg text]
```

The important model is semantic rather than syntactic separation:

- Layout terms answer where content goes and how it sizes.
- Design terms answer what the rendered surface means visually.
- Design declarations define reusable visual language.
- Runtime lowering turns resolved design terms into platform styles.

Named specs may combine both concerns and may contain other named specs. Example intended shape:

```tao
Screen() [fill, bg canvas, fg text] {
   Col() [pad screen, gap xl, width fill] {
      Text("Welcome back") [type display, fg text.strong]

      Card() [surface raised, pad lg, gap md] {
         Text("Your progress") [type title]
         Text("3 tasks completed today") [type body, fg muted]
      }

      FormButton("Continue") [primary, size lg, full]
   }
}
```

Tao should allow raw values for early prototyping only where the language deliberately supports them:

```tao
Box() [bg "#ff00aa"]
```

Raw values should not become the idiomatic surface. `tao design check` should be able to prefer semantic tokens such as:

```tao
Box() [bg accent]
Box() [bg brand.primary]
```

## Design System Layers

Tao design has five layers.

### Raw Tokens

Raw tokens are primitive values owned by the selected design:

```tao
design AppTheme {
   tokens {
      color {
         indigo.500 = oklch(55% 0.18 275)
         gray.950 = oklch(12% 0.02 260)
      }

      space {
         xs = 4
         sm = 8
         md = 12
         lg = 16
         xl = 24
         screen = 20
      }

      radius {
         sm = 6
         md = 10
         lg = 16
         xl = 24
         pill = 999
      }
   }
}
```

Token categories should start small: color, space, radius, typography, shadow/elevation, opacity, and motion. Import/export to external token formats can come later.

### Semantic Tokens

Semantic tokens name intent:

```tao
design AppTheme {
   semantic {
      bg.canvas = color.gray.50
      bg.surface = color.white
      bg.raised = color.white
      fg.text = color.gray.950
      fg.muted = color.gray.600
      border.subtle = color.gray.200

      intent.primary.bg = color.indigo.500
      intent.primary.fg = color.white
      intent.destructive.bg = color.red.600
   }
}
```

App code should normally use meanings such as `surface`, `muted`, `primary`, and `danger`, not raw colors.

### Component Recipes

Recipes define reusable visual treatment for components:

```tao
recipe Button {
   base [centered, pad horizontal md vertical sm, radius md, type label, minTap 44]

   variant size {
      sm [pad horizontal sm vertical xs, type label.sm]
      md [pad horizontal md vertical sm, type label]
      lg [pad horizontal lg vertical md, type label.lg]
   }

   variant intent {
      primary [bg intent.primary.bg, fg intent.primary.fg, border transparent]
      secondary [bg surface, fg text, border subtle]
      destructive [bg intent.destructive.bg, fg white]
   }

   state pressed [brightness -4%, scale .98]
   state disabled [opacity disabled]

   default {
      size = md
      intent = primary
   }
}
```

The compiler should treat recipes as structured data, not text snippets. Runtime helpers should resolve recipes consistently across platforms.

### Pattern Recipes

Pattern recipes describe larger screen grammar:

```tao
pattern EmptyState {
   layout [centered, gap lg, pad screen]

   slots {
      icon [size xl, fg muted]
      title [type title, align center]
      body [type body, fg muted, align center]
      action [primary, size lg]
   }
}
```

Patterns are deferred until component recipes and design application are stable, but the model should leave room for them. A useful Tao design system needs screen-level patterns, not only buttons and text styles.

### Design Rules

Rules are constraints the compiler, validator, runtime, and design tooling can check:

```tao
rules {
   contrast minimum = wcag.aa
   tapTarget minimum = 44
   rawColor allowed = themeOnly
   maxRadiiPerScreen = 3
   maxTypeStylesPerScreen = 5
   requireSemanticRole interactive
   preferTokensForSpacing = true
}
```

Some rules are source-only. Others require rendered context. The first implementation should start with deterministic source-level checks and defer screenshot/browser checks.

## Applying Design

Tao needs both low-level and semantic design application:

```tao
Box() [bg surface, border subtle, radius lg, shadow sm]
Text("Status") [fg muted, type body]
FormButton("Save") [primary]
FormButton("Delete") [destructive]
```

States should be explicit and constrained:

```tao
FormButton("Save") [
   primary,
   hover bg primary.hover,
   press bg primary.press,
   focus ring focus,
   disabled opacity disabled
]
```

Platform-specific adaptation should stay semantic:

```tao
Card() [
   surface raised,
   ios material glass,
   android elevation 2,
   web shadow sm
]
```

Adaptive variants should be container-aware where possible:

```tao
Col() [gap md] {
   Card() [compact when container < sm]
   Card() [spacious when container >= md]
}
```

The exact condition syntax is future work. The important direction is that components should adapt to their context, not only to global breakpoints.

## App Selection And Defaults

Project creation should give every app a coherent design immediately. A first app should not look like unstyled React Native.

Intended created-project shape:

```text
App.tao
design/
   preview.tao
   screenshots/
tao.design
tao.design.lock
```

The first implementation may choose a smaller shape. It can start with app-local Tao declarations before adding separate design files or lockfiles.

Candidate app selection:

```tao
design AppTheme {
   personality = calm
   density = normal
   platform = universal

   tokens { ... }
   semantic { ... }
   recipes { ... }
   patterns { ... }
   rules { ... }
}

app HabitTracker {
   Name "Habit Tracker"
   Design AppTheme
   Navigator StackNav {
      Initial MainView
   }
}
```

Open naming question: `Spec/Tao Packages.md` already describes app capabilities such as `theme`, strings, assets, and datasources. The implementation should decide whether this capability is called `design`, `theme`, or something else before parser work.

Starter themes can be generated from the same underlying token architecture:

- Tao Native: clean platform-adaptive default.
- Tao Studio: polished SaaS/editorial.
- Tao Play: colorful consumer apps.
- Tao Calm: wellness, notes, and coaching apps.
- Tao Ledger: finance and data-heavy apps.
- Tao Field: operational/internal tools.
- Tao Night: dark-first premium apps.

These are presets over one design model, not separate style engines.

## Platform Adaptation

Tao should not force every platform to look identical.

```tao
design AppTheme {
   platform ios {
      nav = native
      material = glass
      radius.bias = +2
   }

   platform android {
      nav = material
      dynamicColor = true
      elevation = tonal
   }

   platform web {
      focusRing = visible
      hover = true
      containerQueries = true
   }
}
```

Platform adaptation should preserve app identity while respecting native expectations, accessibility settings, locale, direction, density, motion, and available input modes.

## Beyond the design language

The `tao design` CLI surface, the design lockfile, AI and visual iteration policy, scenario-driven
review, the phased implementation path, prior art, and the remaining tooling decisions live in
`Roadmap/Add Tao design system MVP/Design tooling and rollout.md`.

## Open Questions

- What declaration syntax best defines tokens, named specs, recipes, and recipe variants?
- ~~Does source use `design`, `theme`, or both as public capability names?~~ **Decided: `design`.** The declaration is `design <Name> { ... }` and an app selects it with `Design <Name>`.
- ~~Should the first design data live in `.tao` source, a `tao.design` file, or both?~~ **Decided: `.tao` source.** Design is an ordinary Tao declaration subject to the same visibility, imports, and validation as the rest of the language; no separate design file format.
- Which visual treatments can apply to `layout` and future `frame` declarations?
- How do combined specs interact with named render slots and caller content?
- Which diagnostics are ordinary validator diagnostics, and which belong to `tao design check`?
- How are app defaults selected before the user has authored a design?
- How should raw values be represented so they remain useful for prototypes without becoming the main style language?
- What is the first useful cross-platform adaptation axis: color scheme, platform, density, text scale, motion, locale, or pointer/hover capability?
