# Design tooling and rollout

Moved out of `Docs/Spec/Tao Design - WIP.md` so that spec covers the design language and this file covers
the tooling, artifacts, and rollout around it. None of the tooling in this document is implemented.
The preceding language slice now ships: flat tokens and named clause bundles inside an ordinary
`.tao` design declaration, selected by the app's `Design` property and resolved through the mounted
app. The tooling and richer design layers below remain compatible later work.

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

## Implementation Path

Phase 1 (shipped by WordFlower Tranche 4): deterministic source and runtime design

- Parse the `design Name { ... }` surface in ordinary `.tao` source. **Shipped.**
- Resolve flat tokens and named clause bundles. **Shipped.**
- Compose bundles and direct clauses left to right; the last value for the same clause wins, then
  reject semantically incompatible resolved clause sets. **Shipped.**
- Lex `#...` through `TagOrHexColor` and validate tag and CSS hexadecimal color contexts separately.
  **Shipped.**
- Lower design to React Native styles through runtime helpers. **Shipped.**
- Apply the app's selected `Design` value. **Shipped.**

Phase 2: semantic tokens, recipes, defaults, and design diagnostics

- Add semantic-token resolution and a small recipe/default system.
- Add deterministic app defaults for core views.
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

- ~~What declaration syntax defines the first tokens and named specs?~~ **Decided and implemented:** flat
  `name value` tokens and `name [clauses]` bundles inside `design Name { ... }`. Semantic-token,
  recipe, and recipe-variant syntax remains open.
- ~~Does source use `design`, `theme`, or both as public capability names?~~ **Decided: `design`.** The declaration is `design <Name> { ... }` and an app selects it with `Design <Name>`.
- ~~Should the first design data live in `.tao` source, a `tao.design` file, or both?~~ **Decided: `.tao` source.** Design is an ordinary Tao declaration subject to the same visibility, imports, and validation as the rest of the language; no separate design file format.
- Which visual treatments can apply to `layout` and `frame` declarations?
- How do combined specs interact with future slot forms beyond the implemented opaque single-fill named slot
  and intrinsic `@@content`?
- Which diagnostics are ordinary validator diagnostics, and which belong to `tao design check`?
- How are app defaults selected before the user has authored a design?
- Beyond the implemented unquoted CSS hexadecimal color literal, which raw value forms should remain useful
  for prototypes without becoming the main style language?
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

- Exact declaration syntax for recipe variants and state-specific entries.
- Whether `tao create` writes a first `design` declaration into the scaffolded app.
- Whether `tao design init` is separate from project creation.
- The `tao.design.lock` schema.
- Visual screenshot artifact naming and retention.
- Design registry package format.
- Figma and external design-token import/export semantics.
- Tao MCP resource shape.
- AI prompt, model, and patch-scope policy.
