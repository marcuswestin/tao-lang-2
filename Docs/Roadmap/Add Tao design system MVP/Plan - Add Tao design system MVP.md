# Plan - Add Tao design system MVP

This plan predates the WordFlower tranche process. WordFlower Tranche 4 implemented its first slice:
flat tokens, named clause bundles, app `Design` selection, shared `TagOrHexColor` lexing with
contextual validation, deterministic clause composition, compiler lowering, and mounted-app runtime
resolution. Steps 1–4 below describe that landed milestone; continue from Step 5 through a later
WordFlower tranche. Later design surface is expressed in `Apps/WordFlower/3 - MVP/WordFlower.tao-mvp`.

`Docs/Spec/Tao Design.md` is authoritative for the implemented first design-language slice.
This document carries the plan toward the rest of the MVP and, from "Tooling and rollout beyond the
MVP" onward, the tooling, artifacts, and later-phase direction around it.

## Goal

Make Tao apps visually coherent through a deterministic, language-owned design system: design
declarations with typed value blocks, styles and element defaults (`Decisions.md` §13), application
from UI call sites, runtime lowering to React Native styles, and deterministic design diagnostics.

The first MVP should prove that ordinary Tao UI can get polished, consistent visual treatment without app authors hand-writing React Native styles or generated TypeScript duplicating style logic.

## Non-goals

- No AI design generation in the first MVP.
- No screenshot critique loop, reference-image import, visual diff workflow, or design lab.
- No Figma import/export, MCP server, external registry, or DTCG import/export implementation.
- No production `tao.design.lock` workflow.
- No broad raw React Native style escape hatch.
- No final answer for every platform-adaptive design axis.

## Assumptions

- Layout and visual design entries share one typed `[ ... ]` application surface. §13 replaced
  recipes with lowercase styles, element defaults, and conditions, so there is no second render-site
  delimiter.
- The first runtime target is the existing Expo/React Native runtime.
- Generated code imports default `TR` from `@runtime/TR` and delegates reusable design semantics to `TR.*` or generated design data consumed by `TR`.
- The first implementation updated the complete `Apps/WordFlower/1 - Current/` directory only after the slice was executable.
- Old repo design code is reference material only; do not port old implementation files wholesale.
- Raw visual values are useful while prototyping; a checker should eventually prefer semantic tokens
  and warn on raw color, spacing, and radius values in app code rather than forbidding them outright.

## Tao code coverage

Tranche 4 proved the first slice through the owning package suites and WordFlower. A dedicated Test
App is warranted only for §13 surface WordFlower does not itself force:

- Parser, validator, formatter, compiler, runtime, and expo-host tests cover flat tokens,
  named bundles, diagnostics, lowering, mounted-app lookup, and precedence.
- `Apps/WordFlower/1 - Current/Design.tao` and the WordFlower journeys prove the end-to-end first
  slice in a product app.
- A later focused Test App, if one is needed, records its purpose in `Apps/Test Apps/README.md`
  before it is created.

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
- Keep reusable semantics in `packages/apps/runtime/TaoRuntime-src/`; generated app TypeScript should stay declarative and minimal.
- Add runtime tests for token and bundle resolution, fallback behavior, and style precedence.

Likely commit unit: compiler design lowering plus `TR` design helpers and runtime tests.

Validation: compiler tests through compile success/failure, `packages/apps/runtime/TR-tests`, and targeted runtime e2e tests.

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

### 5. Finish the decided surface (reframed 2026-09-22)

`Decisions.md` §13 superseded the semantic-token, recipe, and variant framing this step used to
carry: typed blocks replace tokens and a meaning layer, the `styles { }` case convention replaces
recipes and variants, and a state is an ordinary `when` condition. The structured subset (`colors`,
`sizes`, `text`, `screens`, `styles`) landed with Studio Slice 6.

- **Landed 2026-09-22** (`merged/design-system-mvp-5-7-44b3e6`): `bg`/`fg` warn in favour of
  `background`/`ink`; a design keeping colors or bundles outside the typed blocks draws one warning;
  `tao create` and the starters write only the typed form.
- **Absorbed 2026-09-25: the design values tranche**, below — the casing rule, `selected`, `color`
  parameters, and the `tao fix` migration.

Exit criteria: every §13 construct the MVP keeps is implemented, and every one it drops is recorded
as deferred.

### 6. Diagnostics and CLI surface

Decided: there is no `tao design check` (§16). Design diagnostics are ordinary `tao check`
diagnostics, and rule diagnostics are warnings (2026-09-23). The `rules { }` checks themselves are
deferred past MVP — see "Design rules — deferred past MVP". `tao fix` migrates `bg`/`fg` and the
flat catalog automatically; `tao check` reports unmigrated source as noncanonical.

### 7. Close the MVP and plan the next design phase

Concrete work:

- Update `Docs/Spec/Tao Design.md`, `Docs/Spec/Tao Layout and UI.md`, and `Docs/Spec/Tao Packages.md` for any syntax or capability names that changed during implementation.
- Update `Roadmap.md` status and this plan with completion notes.
- Run a stale-repo check for old design syntax, old theme names, and obsolete plan claims.
- Prepare the next project plan for lockfile/generation or screenshot-loop work only after the deterministic MVP is accepted.

Likely commit unit: docs and stale cleanup only.

Validation: `./agent verify`.

Exit criteria: docs, examples, test apps, and roadmap agree on the shipped deterministic design surface.

The phased tooling and rollout work this step prepares is laid out in full below.

`tao create` writes an authored `Design.tao`, so its first app already has a palette, element
defaults, and named styles. A manually written app that omits `Design` can still render stdlib views
with their built-in layout: primitive containers and text use React Native's unthemed appearance,
published native controls use the platform's own chrome (or a portable fallback), and controls such
as `TextInput` and `Progress` retain their fixed runtime styling. It cannot use named colors or
styles, and the runtime invents no replacement palette. The result works, but looks sparse and
platform-native until the author mounts a design.

## Design values tranche (absorbed, 2026-09-25)

WordFlower `2 - Next` held the contract (`WordFlower.tao-next` header, "DESIGN VALUES"); `1 - Current`
now matches it and both read absorbed. It finishes the MVP design surface in four decision groups,
recorded in `Decisions.md` §13. The Developer confirmed the implementation's remaining choices on
2026-09-25:
`color` is rejected everywhere except a view parameter; a design name counts as a `color` only
directly as an argument or a default (not inside a `when` passed as one); a name and its shade must
exist in every design the project's apps mount, refinements included (after review found the check
depended on app order); `color` is now a keyword, and Studio refuses it and Capitalized names for new
colors, sizes, and forks. Studio's suggested fork name lowercases an element name (`Card` becomes
`cardVariant`). Editor references now cover go-to-definition from `background Tint` to its
parameter, shade rename across `Tint: accent.20` arguments, and relinking a shared view's color
arguments when an app's `Design` changes. Style references now require every mounted design,
including refinements, to declare the style. Journeys stay at observable functionality rather than
asserting a rendered color; compiler and runtime tests cover the color itself.

1. **The clause-list casing rule is a compile error.** A reserved lowercase word is a clause head,
   any other lowercase word is a design name (a style in entry position, a color or size in value
   position), and a Capitalized word is a value. Naming an element default in a clause list, or
   giving a design value a Capitalized name, is an error. The only violations were
   `NavigationTabActive [NavigationTab, …]` in WordFlower and both starters.
2. **`selected` is an interaction condition.** The navigation host supplies it for the active tab,
   so `NavigationTab` carries the active look and `NavigationTabActive` is retired. Selection is
   otherwise not a tracked state today: a loop row's `on select` presents a detail and keeps no
   selected state, so rows do not get `selected` in this tranche.
3. **A `color` parameter carries a design color as a value**, forced by the documents list:

   ```tao
   view StatusBadge(Label text, Tint color default inkMuted) {
      render Row() [gapSmall] {
         Box() [statusDot, background Tint]
         Text(Label) [caption]
   }  }

   loop Documents / Document {
      Col() [card, gapSmall] {
         Text(Document.Title) [sectionTitle]
         if Document.Final is Final {
            StatusBadge("Final", Tint: accent)
         }
         if Document.Final is Draft {
            StatusBadge("Draft")
      }  }
      on select -> { present DocumentScreen(Document) }
   }
   ```

   The dot sits inside the badge, where a caller's clauses cannot reach (R9 keeps a root's inner
   renders private), so its color has to travel as a value. A value is a reference to a design
   name, resolved against the mounted design at render, so it follows light and dark. Every value
   starts as a design name — no `color(Input)` conversion and no entity field reaches a clause — so
   the set of colors a clause can receive stays listed in source, the property the deferred rule
   analysis needs. `size` parameters (the §2 `size` family, `Decisions.md:145`), `color` state,
   `set`, and aliases are not forced by any MVP feature and wait for one; a `style` type is not
   planned.
4. **`tao fix` migrates legacy design source**: `bg`/`fg` become `background`/`ink`, and flat design
   entries move into `colors { }` and `styles { }`. Because `tao check` reports anything `tao fix`
   would change as noncanonical, WordFlower is migrated in the same change.

Earlier finding, kept for the record: before this tranche no WordFlower tier needed a color passed
as a value (2026-09-24 scan); the documents list's status badge is the product feature added to
force it. Skillet's per-aisle color (`Apps/Tao Future/Skillet/Shared.tao-revolution:100`) forces
§13's parameterized entries, a separate post-MVP capability.

## Design rules — deferred past MVP (notes, 2026-09-22/23)

Decided: the MVP uses deterministic static analysis only, no runtime validation, and no review
automation, so `rules { }` waits. When it lands, its diagnostics are warnings (§16, amended
2026-09-23) and its source form is §13's sentences (`rule contrast at least wcag.aa`). These notes
carry the analysis so it does not have to be redone.

**What each rule needs.** A: decidable from source, a build diagnostic. B: needs rendering, measured
on the `tao review` gallery. C: needs a person.

| Class | Rules                                                                                                                                                                                                                                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | raw values only in the design (implemented as a warning); text contrast (WCAG 1.4.3); border and focus-ring contrast (1.4.11); declared tap minimums; names on controls and informative images (4.1.2); heading order (needs heading semantics); text sized in `rem`; focus visible; reduced-motion cases; design budgets |
| B     | clipping at 200% text (1.4.4); overflow and reflow (1.4.10); actual target size and spacing where none is declared (2.5.8); contrast over backgrounds source cannot see; focus obscured (2.4.11); text-spacing overrides (1.4.12)                                                                                         |
| C     | meaning without colour (1.4.1); descriptive names and headings (2.4.6); visual versus reading order (1.3.2)                                                                                                                                                                                                               |

**Why A is so large in Tao.** A clause value is only a word, a number, a color, or `none`
(`layout.langium:21-22`), and a word names a design value that folds at build or a `when` with a
finite set of cases. `pad Indent` with `Indent` a view parameter is `Design 'Theme' has no size
'Indent'.` today.

**The contrast analysis.** Walk the render graph (every call site is in source): for each text, the
set of nearest backgrounds across every context it renders in — its own view, then each call site,
recursively — unioned over branches, interaction states, schemes, and mounted designs, with R9
precedence per site; a recursive view reaches a fixpoint over a finite set. The property is local,
so whole trees are never enumerated. WCAG relative luminance, 4.5:1 (3:1 for text at least 24px,
or 18.66px bold).

- Cost: a single run is roughly linear. The editor is the concern — the analysis is
  whole-program, so it needs per-view summaries invalidated along the call graph and must stay
  inside `./agent bench`'s steady-state budgets.
- Assumption breakers besides authored `render inject` views: runtime colors (`color(Input)`),
  platform-drawn surfaces (translucent sheets, header materials), translucent colors over an unknown
  background, floating layers without their own background, OS color transforms, and the contract
  that stdlib elements — themselves injected — paint only their resolved design clauses.
- Why it waits: a rule with no declarations checks nothing silently; unknown backgrounds are skipped
  silently; the stdlib dims disabled controls to 55% (`TR-views.tsx:275`, `:563`) invisibly;
  conditions that never co-occur produce false warnings Tao has no way to suppress; a warning can
  appear far from the edit that caused it; and a warning may hold under only one mounted design.

**Contrast findings.** The generated starter palettes fail AA for muted text: Notebook `inkMuted` on
`canvas` 3.53:1 and on `surface` 3.88:1, Pantry 3.52:1 and 3.90:1 — so the fault was
`deriveDesignColors` (`packages/cli/tao-cli/cli-src/create/creation-colors.ts`), not one palette.
Fixed 2026-09-24: muted ink is now the lightest blend that reaches 4.5:1 on canvas and surface.
WordFlower passes (4.63:1 light, 8.51:1 dark).

**`tap min`.** The decided spelling (`Decisions.md` §2 and its spelling table: `tap min 48`); its
runtime meaning is not. Downsides: Tao says `press` elsewhere and "tap" is wrong for a pointer; as a
layout minimum it is `width min`/`height min` under another name, and neither exists yet (`width
max` is the only min/max clause, `LayoutTypes.ts:40`); it means nothing on a non-pressable element;
only declared elements get checked; and a minimum beats an explicit `height` in Yoga. No `tap max`:
no guideline caps a target. Preferred direction: the rule applies the minimum itself to every
pressable stdlib element, so there is nothing to check and nothing silently unchecked; `tap min` only
raises it. The cost is layout that grows on its own, and inline targets that cannot.

**React Native `hitSlop`** extends where a press registers without changing layout, but the touch
area never extends past the parent's bounds and overlapping siblings win by z-order (every
platform); React Native for Web's `Pressable` does not document it. A layout minimum is visible,
measurable, and uniform, which is why it is preferred.

**Measuring B.** Deterministic without a language model: Studio renders scenarios in Chrome, and
`tao review` can evaluate script in the page — compare text content size with its box at 200%,
page width with the viewport, pressable boxes for size and spacing, and sample screenshot pixels
under text. It is only as complete as the scenarios: the render graph lists every view and branch,
but reaching each branch needs a pinned state. Unreliable even so: clipping depends on fixture
string length and localisation, fonts differ between the web renderer and native, only the widths
and text scales rendered are covered, transient UI needs timing, and pixel sampling is noisy near a
threshold. C has deterministic stand-ins — a condition whose only effect is a color change,
generic or duplicate labels, rendered position versus tree order — and a vision model could only
assist review, never gate.

**`tao review` today** screenshots every review-ready web scenario into a static report and
`review.json` of hashes, and `--against` marks each scenario added, removed, changed, unchanged, or
failed (`StudioReview.ts`). It measures nothing and checks no rule; deferring review automation
leaves it as it is.

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
- `rules { }` and every rule check, static or rendered (2026-09-23; see "Design rules — deferred
  past MVP").
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
- ~~Which design diagnostics are ordinary validator diagnostics, and which belong to a future
  `tao design check` command?~~ **Decided (§16):** there is no `tao design check`; every design
  diagnostic is a `tao check` diagnostic, and rules warn.
- ~~Should recipe variants be declared through a standalone `recipe Button { variant ... }`
  surface?~~ **Decided (§13):** no recipes — a variant is a lowercase style and a state is a
  condition.
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
- Replace raw spacing 16 with a named size
- Replace "#ffffff" with `background surface`
- Apply a declared `tap min 48` to icon-only buttons
- Convert repeated card clauses into the `cardRaised` style
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

Decided 2026-09-02 for ship: the project has one Tao-written lock, `.tao/lock.jsonc`, sectioned per concern, and `tao ship` writes its `ship` section under the contract the old repository's `tao.design.lock` defined — identity, input hash, accepted or suggested status, provenance. When this workstream needs a lockfile it takes a `design` section of that file and reuses the entry shape (`Docs/Roadmap/Tao ship/Plan - Beta distribution in one command.md`, _Precedent: accepted project metadata_).

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
