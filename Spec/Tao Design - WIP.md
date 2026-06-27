# Tao Design

Status: intended design draft. This document describes the direction for Tao's design system, not only what this repo implements today.

Current implementation status: this repo currently has bracketed layout clauses, runtime layout lowering through `TR.Layout`, a default app shell, and stdlib view/layout primitives that receive Tao-owned props. It does not yet implement Tao-authored design declarations, visual style clauses, design tokens, semantic tokens, recipes, `tao design` commands, design diagnostics, screenshot comparison, design lockfiles, or AI-assisted design iteration.

## Goals

- Treat design as a Tao language/compiler/runtime concern, not as a pile of app-authored React Native style objects.
- Let authors write semantic UI structure and layout while Tao supplies coherent visual defaults.
- Keep layout and visual design separate enough that sizing/flow decisions do not get tangled with color, typography, elevation, or state treatment.
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

Tao separates layout from design:

```tao
[pad 16, gap 12, width fill]  // layout, sizing, flow, containment
<bg surface, fg text>         // design, visual treatment, semantic appearance
```

The exact design-clause delimiter is still a parser decision. The important model is the split:

- Layout terms answer where content goes and how it sizes.
- Design terms answer what the rendered surface means visually.
- Design declarations define reusable visual language.
- Runtime lowering turns resolved design terms into platform styles.

Example intended shape:

```tao
Screen <bg canvas, fg text> [fill] {
   Col [pad screen, gap xl, width fill] {
      Text "Welcome back" <type display, fg text.strong>

      Card <surface raised> [pad lg, gap md] {
         Text "Your progress" <type title>
         Text "3 tasks completed today" <type body, fg muted>
      }

      Button "Continue" <primary, size lg, full>
   }
}
```

Tao should allow raw values for early prototyping only where the language deliberately supports them:

```tao
Box <bg "#ff00aa">
```

Raw values should not become the idiomatic surface. `tao design check` should be able to prefer semantic tokens such as:

```tao
Box <bg accent>
Box <bg brand.primary>
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
   base {
      [centered, pad horizontal md vertical sm]
      <radius md, type label, minTap 44>
   }

   variant size {
      sm { [pad horizontal sm vertical xs] <type label.sm> }
      md { [pad horizontal md vertical sm] <type label> }
      lg { [pad horizontal lg vertical md] <type label.lg> }
   }

   variant intent {
      primary {
         <bg intent.primary.bg, fg intent.primary.fg, border transparent>
      }

      secondary {
         <bg surface, fg text, border subtle>
      }

      destructive {
         <bg intent.destructive.bg, fg white>
      }
   }

   state pressed {
      <brightness -4%, scale .98>
   }

   state disabled {
      <opacity disabled>
   }

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
   layout {
      [centered, gap lg, pad screen]
   }

   slots {
      icon <size xl, fg muted>
      title <type title, align center>
      body <type body, fg muted, align center>
      action <primary, size lg>
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
Box <bg surface, border subtle, radius lg, shadow sm>
Text "Status" <fg muted, type body>
Button "Save" <primary>
Button "Delete" <destructive>
```

States should be explicit and constrained:

```tao
Button "Save" <
   primary,
   hover bg primary.hover,
   press bg primary.press,
   focus ring focus,
   disabled opacity disabled
>
```

Platform-specific adaptation should stay semantic:

```tao
Card <
   surface raised,
   ios material glass,
   android elevation 2,
   web shadow sm
>
```

Adaptive variants should be container-aware where possible:

```tao
Col [gap md] {
   Card <compact when container < sm>
   Card <spacious when container >= md>
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
   design AppTheme
   view MainView
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

## `tao design`

`tao design` should grow from deterministic commands toward richer visual tooling.

Initial deterministic commands:

```sh
tao design init
tao design theme --preset calm
tao design theme --seed "#635bff"
tao design check
tao design fix --safe
```

Possible `tao design check` output:

```text
Design check

pass 42 components use semantic colors
warn 7 raw colors found
warn 11 raw spacing values found
error 2 text/background pairs fail WCAG AA contrast
warn Button "Delete" has destructive intent but uses primary style
warn Settings screen uses 6 radius values; theme defines 4
```

Safe fixes should be reviewable and small:

```text
- Replace raw spacing 16 with space.lg
- Replace "#ffffff" with bg.surface
- Add minTap 44 to icon-only buttons
- Convert repeated card styles into recipe Card.raised
```

Rendered checks, screenshot baselines, AI critique, design diff, and visual iteration should wait until the deterministic source/runtime model exists.

## Design Lockfile

A design lockfile can prevent design churn, especially once generation or AI iteration exists.

Conceptual lockfile shape:

```yaml
version: 1

theme:
   id: app-theme-ledger-calm
   generatedBy: tao-design-template@0.1
   tokenHash: 9fb3e2
   acceptedAt: 2026-06-24T10:12:00-07:00

appFingerprint:
   routesHash: 32a991
   componentsHash: f89d20
   copyHash: a91b40

generated:
   tokens:
      color.brand.primary:
         source: seed
         locked: true

   recipes:
      Button:
         source: tao-default
         modifiedByUser: false

screens:
   /dashboard:
      lastRenderedHash: 902aa1
      baselines:
         iphone.light: design/screenshots/dashboard.iphone.light.png
      score:
         contrast: pass
         tapTargets: pass
         overflow: pass
         visualHierarchy: 0.82

ai:
   lastModel: ...
   lastPromptHash: ...
   maxEditScope:
      - tao.design
      - design/generated/*
```

Lockfile rules:

- Never rewrite user-locked tokens.
- Never change raw UI structure unless layout editing is explicitly requested.
- Never touch business logic.
- Prefer token and recipe edits over per-component edits.
- Keep generated changes explainable.
- Store before/after screenshot hashes when screenshots are involved.

The lockfile is not part of the first deterministic MVP unless implementation discoveries make a small provenance record necessary.

## AI And Visual Iteration

AI should edit constrained design objects:

```text
AI can edit:
   - design genome
   - tokens
   - semantic tokens
   - recipes
   - pattern choices
   - explicit generated design blocks

AI cannot edit by default:
   - app logic
   - data queries
   - navigation
   - event handlers
   - arbitrary component structure
```

For layout iteration, require explicit scope:

```sh
tao design iterate --layout
```

Even then, Tao should produce structured patches:

```text
Change 1
Route: /dashboard
Reason: primary CTA below fold on 390x844 viewport
Patch: move Button slot:primaryAction into HeaderActions pattern

Change 2
Route: /dashboard
Reason: stat cards too cramped
Patch: change Grid minCell 140 -> 164
```

This keeps the design agent from becoming a vague source mutator.

## Visual Tooling

Long-term design tooling can include:

- `tao design generate`: app-specific theme generation from app structure, copy, routes, data names, current styles, and screenshots.
- `tao design diff`: visual and token-level report of changed design decisions.
- `tao design iterate`: Expo web plus Playwright screenshot loop across route, device, state, and theme matrices.
- `tao design lab`: local workbench for tokens, recipes, component gallery, screen gallery, states, density, platform, screenshots, and critique.
- `tao design export tokens --format dtcg`.
- `tao design import tokens --format dtcg`.
- `tao design export figma`.
- `tao design import figma <file-or-node>`.
- `tao mcp`: structured context for external AI tools.

These are ecosystem phases, not the first implementation slice.

## Scenario-Driven Design

Design should be tested against realistic app states:

```text
Dashboard
   - empty
   - loading
   - normal
   - long names
   - many items
   - error
   - offline
   - large text
   - dark mode
   - compact width
```

Potential future syntax:

```tao
scenario Dashboard.empty {
   user = null
   tasks = []
}

scenario Dashboard.longText {
   user.name = "Alexandria Cassandra Montgomery-Smith"
}
```

Then:

```sh
tao design check --scenarios all
tao design screenshots --scenarios all
```

This should build on Tao-native testing and app-state modeling rather than inventing a separate scenario system too early.

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

## First Implementation Path

Phase 1: deterministic source and runtime design

- Choose and parse the MVP design source surface.
- Add design declarations or an equivalent app-local design file.
- Add token and semantic-token resolution.
- Add a small recipe/default system.
- Lower design to React Native styles through runtime helpers.
- Add deterministic app defaults for core views.

Phase 2: recipes and design diagnostics

- Add recipe variants and state styles.
- Add source-level design diagnostics.
- Warn on raw values where semantic tokens are preferred.
- Add contrast checks where foreground/background pairs are statically known.
- Add duplicate-style and token-drift checks where source data supports them.

Phase 3: provenance and app-specific generation

- Add `tao.design.lock`.
- Add app fingerprinting.
- Add generated-theme provenance.
- Add reviewable design reports.
- Add `tao design generate`, `tao design diff`, and `tao design accept`.

Phase 4: screenshot loop

- Use Expo web preview.
- Add Playwright screenshots.
- Add route/device/theme/state matrices.
- Add visual diff reports.
- Add constrained AI critique over design objects.

Phase 5: ecosystem

- Add design lab.
- Add Tao MCP server.
- Add Figma import/export.
- Add external token import/export.
- Add block/theme registry.

## Open Questions

- What exact source syntax applies visual design at a render site?
- Does source use `design`, `theme`, or both as public capability names?
- Should the first design data live in `.tao` source, a `tao.design` file, or both?
- Which visual treatments can apply to `layout` and future `frame` declarations?
- How do design clauses interact with named render slots and caller content?
- Which diagnostics are ordinary validator diagnostics, and which belong to `tao design check`?
- How are app defaults selected before the user has authored a design?
- How should raw values be represented so they remain useful for prototypes without becoming the main style language?
- What is the first useful cross-platform adaptation axis: color scheme, platform, density, text scale, motion, locale, or pointer/hover capability?

## Prior Art

Stable ideas from current design systems and tooling:

- Design tokens as a portable source of truth for colors, typography, spacing, elevation, themes, and aliases.
- Semantic tokens and color roles from systems such as Fluent and Material.
- Component recipe and variant systems from tools such as Panda CSS.
- Static, typed, predictable styling from systems such as StyleX and vanilla-extract.
- Source-owned component registries and beautiful defaults from shadcn/ui.
- AI constrained by tokens, components, registries, and codebase rules instead of arbitrary visual guessing.
- Expo web plus Playwright screenshots as a practical future feedback loop.
- WCAG contrast and target-size rules as compile-time or design-check constraints.
- React Native accessibility APIs as the runtime lowering target for semantic accessibility.

Old Tao repo lessons:

- App-level design descriptions and semantic component variants are valuable.
- Plain-language variant intent can give deterministic tooling and future AI enough context to generate coherent styles.
- Generated style resolution can work, but the reimplementation should fit the current repo's `TR` runtime and feature-sliced package layout instead of porting old compiler code directly.

## Deferred Decisions

- Exact syntax for visual clauses and recipe variants.
- Whether `tao create` writes a first `tao.design` file.
- Whether `tao design init` is separate from project creation.
- The `tao.design.lock` schema.
- Visual screenshot artifact naming and retention.
- Design registry package format.
- Figma and external design-token import/export semantics.
- Tao MCP resource shape.
- AI prompt, model, and patch-scope policy.
