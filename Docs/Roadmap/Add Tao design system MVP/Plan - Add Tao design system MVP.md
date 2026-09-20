# Plan - Add Tao design system MVP

This plan predates the WordFlower tranche process. WordFlower Tranche 4 implemented its first slice:
flat tokens, named clause bundles, app `Design` selection, shared `TagOrHexColor` lexing with
contextual validation, deterministic clause composition, compiler lowering, and mounted-app runtime
resolution. Steps 1–4 below describe that landed milestone; continue from Step 5 through a later
WordFlower tranche. Later design surface is expressed in `Apps/WordFlower/3 - MVP/WordFlower.tao-mvp`.

`Docs/Spec/Tao Design - WIP.md` is authoritative for the implemented first design-language slice.
This document carries the plan toward the rest of the MVP and, from "Tooling and rollout beyond the
MVP" onward, the tooling, artifacts, and later-phase direction around it.

## Goal

Make Tao apps visually coherent through a deterministic, language-owned design system: design declarations, tokens, semantic tokens, component recipes, recipe application from UI call sites, runtime lowering to React Native styles, and initial design diagnostics.

The first MVP should prove that ordinary Tao UI can get polished, consistent visual treatment without app authors hand-writing React Native styles or generated TypeScript duplicating style logic.

## Non-goals

- No AI design generation in the first MVP.
- No screenshot critique loop, reference-image import, visual diff workflow, or design lab.
- No Figma import/export, MCP server, external registry, or DTCG import/export implementation.
- No production `tao.design.lock` workflow.
- No broad raw React Native style escape hatch.
- No final answer for every platform-adaptive design axis.

## Assumptions

- Layout and visual design entries share one typed `[ ... ]` application surface. The first design
  declaration and named-bundle shape are implemented; recipe shapes remain later work, not a second
  render-site delimiter.
- The first runtime target is the existing Expo/React Native runtime.
- Generated code imports default `TR` from `@runtime/TR` and delegates reusable design semantics to `TR.*` or generated design data consumed by `TR`.
- The first implementation updated the complete `Apps/WordFlower/1 - Current/` directory only after the slice was executable.
- Old repo design code is reference material only; do not port old implementation files wholesale.
- Raw visual values are useful while prototyping; a checker should eventually prefer semantic tokens
  and warn on raw color, spacing, and radius values in app code rather than forbidding them outright.

## Tao code coverage

Tranche 4 proved the first slice through the owning package suites and WordFlower. The broader design
MVP should add a dedicated Test App only when a later tranche settles semantic tokens and recipes:

- Parser, validator, formatter, compiler, runtime, and runtime-toolchain tests cover flat tokens,
  named bundles, diagnostics, lowering, mounted-app lookup, and precedence.
- `Apps/WordFlower/1 - Current/Design.tao` and the WordFlower journeys prove the end-to-end first
  slice in a product app.
- A later focused Test App should demonstrate the accepted semantic-token and recipe surface, with
  its purpose recorded in `Apps/Test Apps/README.md` before that app is created.

## Implementation steps

### 1. Parse the settled Next design declarations and combined entries

Concrete work:

- Implement `design AppTheme { ... }` in ordinary `.tao` source, with flat `name value` tokens,
  `name [clauses]` bundles, and app `Design AppTheme` selection.
- Replace `TAG` with `TagOrHexColor: /#[A-Za-z0-9_]+/`; leave tag-versus-color meaning to AST
  context and validation.
- Compose named bundles and direct clauses left to right. The last value for the same clause wins;
  validation rejects semantically incompatible resolved clause sets regardless of source order.
- Extend parser grammar and AST only for that chosen subset.
- Add parser tests for both digit- and letter-leading hexadecimal colors, token references, named
  bundles, combined entries, and precedence cases.
- Add formatter support for the new declarations and clauses in the same slice if the parser accepts source files.

Likely commit unit: parser grammar, generated parser artifacts, AST-facing tests, formatter handling for syntax introduced here.

Validation: parser and formatter package tests.

Exit criteria: the exact absorbed design source parses and formats deterministically; recipes, semantic
tokens, and other richer alternatives remain explicit later work.

### 2. Add design model validation and references

Concrete work:

- Add a feature-sliced validator module for design declarations and design references.
- Validate duplicate flat token and bundle names, unknown token and bundle references, recursive
  bundles, contextual tag/color spelling, incompatible resolved clauses, and app design selection.
- Accept the implemented CSS hexadecimal color forms; other raw-value policy remains later work.
- Define how design declarations participate in visibility/import rules before enabling cross-file design references.
- Add validator diagnostics that are purely source-structural; defer rendered contrast and tap-target checks to later design tooling.

Likely commit unit: validator design module, type/reference helpers where needed, diagnostics tests.

Validation: validator package tests and focused workspace validation fixtures.

Exit criteria: invalid design declarations produce stable diagnostics, and valid app-local design declarations are visible to compiler codegen.

### 3. Lower deterministic flat tokens and bundles through `TR`

Concrete work:

- Add a compact compiler representation for design data selected by the app.
- Extend generated app code only enough to pass design data or design references to runtime helpers.
- Add or extend `TR` design/runtime helpers for:
  - token lookup;
  - named clause-bundle resolution;
  - deterministic same-clause replacement and style production;
  - React Native style production.
- Keep reusable semantics in `packages/runtime/TaoRuntime-src/`; generated app TypeScript should stay declarative and minimal.
- Add runtime tests for token and bundle resolution, fallback behavior, and style precedence.

Likely commit unit: compiler design lowering plus `TR` design helpers and runtime tests.

Validation: compiler tests through compile success/failure, `packages/runtime/TR-tests`, and targeted runtime e2e tests.

Exit criteria: a Tao app can select a design and render at least Text, Button, and a surface/container with deterministic styles produced by the runtime.

### 4. Apply the first design slice at UI call sites

Concrete work:

- Apply named bundles and direct visual entries through the combined spec list settled in Step 1.
- Define precedence among stdlib defaults, the selected app design, named bundles, direct clauses,
  and native props from injected views without inventing recipe or semantic-variant behavior.
- Ensure current layout clauses still merge independently from visual styles.
- Add focused compiler/runtime tests that inspect behavior through rendered output or runtime style resolution, not brittle generated-code substrings.
- Prove the implemented slice through owning package/runtime behavior coverage and WordFlower once
  the app compiles and renders. Reserve a dedicated design Test App for the later semantic-token and
  recipe slice described in Step 5.

Likely commit unit: call-site design application, WordFlower coverage, and package/runtime behavior
tests.

Validation: parser, validator, compiler, formatter, runtime tests; `just compile-app 'Apps/WordFlower/1 - Current/WordFlower.tao'`.

Exit criteria: visible Tao source can apply the exact WordFlower bundles such as `screen`, `title`,
`body`, and `panel`, and runtime output reflects their resolved clauses.

### 5. Extend the settled foundation with semantic tokens and recipes

After the first slice, use a later WordFlower tranche to settle the still-open source
shape for semantic tokens, component recipes, variants, state styles, rules, and deterministic app
defaults. Extend validation, lowering, and runtime tests only for the forms that tranche represents.
This preserves the broader MVP goal without expanding the already-solidified Next contract.

Exit criteria: ordinary Tao source can request the accepted semantic treatments and the runtime
resolves their tokens, defaults, variants, and states deterministically.

### 6. Add deterministic design diagnostics and CLI surface

Concrete work:

- Add the initial `tao design check` or equivalent CLI surface after the source and runtime model exists.
- Start with diagnostics that do not require screenshot analysis:
  - unknown or unused tokens;
  - raw values where tokenized values are preferred;
  - duplicate or unreachable recipe variants;
  - missing app design selection when a project uses design declarations;
  - source-level contrast checks only when foreground/background pairs are statically knowable.
- Decide whether safe fixes live in `tao fix`, `tao design fix --safe`, or both.
- Keep rendered checks such as tap target, overflow, hierarchy, and visual rhythm as deferrals unless they can be computed from existing runtime metadata without a browser loop.

Likely commit unit: CLI command, diagnostics/fix plumbing, tests.

Validation: CLI tests, fixture diagnostics tests, and repo `verify`.

Exit criteria: design diagnostics can run deterministically in CI and editor workflows without launching Expo or invoking AI.

The fuller `tao design` command surface, its output shape, and safe-fix examples are carried in
"Tooling and rollout beyond the MVP" below.

### 7. Close the MVP and plan the next design phase

Concrete work:

- Update `Docs/Spec/Tao Design - WIP.md`, `Docs/Spec/Tao Layout and UI.md`, and `Docs/Spec/Tao Packages.md` for any syntax or capability names that changed during implementation.
- Update `Roadmap.md` status and this plan with completion notes.
- Run a stale-repo check for old design syntax, old theme names, and obsolete plan claims.
- Prepare the next project plan for lockfile/generation or screenshot-loop work only after the deterministic MVP is accepted.

Likely commit unit: docs and stale cleanup only.

Validation: `./agent verify`.

Exit criteria: docs, examples, test apps, and roadmap agree on the shipped deterministic design surface.

The phased tooling and rollout work this step prepares is laid out in full below.

## Validation summary

- Parser and formatter tests prove the syntax.
- Validator tests prove source-level design diagnostics and reference resolution.
- Compiler tests prove the exact generated-code lowering boundary; runtime tests independently prove
  its behavior.
- `TR` and runtime tests prove token, recipe, state, and precedence behavior.
- Package/runtime behavior tests and WordFlower prove the end-to-end first-slice Tao authoring
  experience; a later Test App will prove the richer semantic-token and recipe surface.
- Final validation is `./agent verify`.

## Deferrals

- `tao.design.lock`, accepted design provenance, generated design history, and app fingerprinting.
- AI-generated themes, style-genome tuning, screenshot critique, visual diff, and design iteration loops.
- Figma import/export, DTCG token import/export, external design registry, and Tao MCP server.
- Full platform adaptation across iOS, Android, web, density, motion, high contrast, locale, direction, and accessibility settings.
- Pattern recipes beyond the initial component recipe surface.
- Rendered tap-target, overflow, hierarchy, and screenshot baseline checks.
- Exact declaration syntax for recipe variants and state-specific entries (see the open questions
  below).
- The `tao.design.lock` schema, and visual screenshot artifact naming and retention.
- Design registry package format, Figma and external design-token import/export semantics, and the
  Tao MCP resource shape.
- AI prompt, model, and patch-scope policy for constrained design edits.

Decided 2026-09-04: `tao create` does write a first `design` declaration into a scaffolded project.
Every created project has a `Design.tao` with a palette, element defaults, and the bundles its scenes
apply; see `Apps/Starters/README.md`.

## Open questions

- Which visual treatments can apply to content-accepting wrapper views, versus only to leaf views and
  view-like primitives?
- Which design diagnostics are ordinary validator diagnostics, and which belong to a future
  `tao design check` command that can use rendered context?
- Should recipe variants be declared through a standalone `recipe Button { variant ... }` surface,
  named combined specs, generated semantic components, or a staged combination?
- How much of "beautiful defaults" should ship before author-controlled tokens and recipes? A
  deterministic baseline can be useful, but it should not obscure the source-level design system
  contract.
- How do combined specs interact with future slot forms beyond the implemented opaque single-fill
  named slot and intrinsic `@@content`?
- How are app defaults selected before the user has authored a design?
- Beyond the implemented unquoted CSS hexadecimal color literal, which raw value forms should remain
  useful for prototypes without becoming the main style language?
- What is the first useful cross-platform adaptation axis: color scheme, platform, density, text
  scale, motion, locale, or pointer/hover capability?
- Whether `tao design init` is a separate command from project creation.

## Tooling and rollout beyond the MVP

None of the tooling in this section is implemented. The preceding language slice ships: flat tokens
and named clause bundles inside an ordinary `.tao` design declaration, selected by the app's `Design`
property and resolved through the mounted app. The tooling and richer design layers below are
compatible later work, sequenced as phases after the MVP steps above.

### `tao design`

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

### Design lockfile

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

Decided 2026-09-02 for ship: the project has one Tao-written lock, `.tao-project/lock.jsonc`, sectioned per concern, and `tao ship` writes its `ship` section under the contract the old repository's `tao.design.lock` defined — identity, input hash, accepted or suggested status, provenance. When this workstream needs a lockfile it takes a `design` section of that file and reuses the entry shape (`Docs/Roadmap/Tao ship/Plan - Beta distribution in one command.md`, _Precedent: accepted project metadata_).

### AI and visual iteration

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

### Visual tooling

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

### Scenario-driven design

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

### Implementation path

Phase 1 (shipped by WordFlower Tranche 4): deterministic source and runtime design

- Parse the `design Name { ... }` surface in ordinary `.tao` source. **Shipped.**
- Resolve flat tokens and named clause bundles. **Shipped.**
- Compose bundles and direct clauses left to right; the last value for the same clause wins, then
  reject semantically incompatible resolved clause sets. **Shipped.**
- Lex `#...` through `TagOrHexColor` and validate tag and CSS hexadecimal color contexts separately.
  **Shipped.**
- Lower design to React Native styles through runtime helpers. **Shipped.**
- Apply the app's selected `Design` value. **Shipped.**

Phase 2: semantic tokens, recipes, defaults, and design diagnostics (this plan's Steps 5–6)

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

### Prior art

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
