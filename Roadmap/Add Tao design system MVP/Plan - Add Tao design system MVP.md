# Plan - Add Tao design system MVP

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

- Layout and visual design entries share one typed `[ ... ]` application surface. Step 1 settles only the design declaration and recipe shapes, not a second render-site delimiter.
- The first runtime target is the existing Expo/React Native runtime.
- Generated code imports default `TR` from `@runtime/TR` and delegates reusable design semantics to `TR.*` or generated design data consumed by `TR`.
- The first implementation should update `Apps/Kitchen Sink/Kitchen Sink.tao` only after the slice is executable.
- Old repo design code is reference material only; do not port old implementation files wholesale.

## Tao code coverage

Add executable coverage once the parser, validator, compiler, and runtime can support it:

- `Apps/Test Apps/Design System MVP/` demonstrates tokens, semantic tokens, recipes, and one styled screen.
- `Apps/Kitchen Sink/Kitchen Sink.tao` gains a compact design section after the first end-to-end slice compiles and renders.
- `Apps/Test Apps/README.md` records the Design System MVP app's intended scope and behavior-test notes before the app is added.

## Implementation steps

### 1. Settle and parse design declarations and combined entries

Concrete work:

- Decide the first public source shape for design declarations and combined spec application:
  - `design AppTheme { ... }` declarations and app selection;
  - token and semantic-token blocks;
  - recipe definitions or semantic variants;
  - visual entries and named combined specs applied through existing `[ ... ]` clauses.
- Define typed merge and precedence rules between layout entries, visual entries, named specs, recipes, and caller overrides.
- Extend parser grammar and AST for the chosen design declaration subset.
- Add parser tests for positive design declarations, token references, recipe declarations, combined entries, and ambiguous merge cases.
- Add formatter support for the new declarations and clauses in the same slice if the parser accepts source files.

Likely commit unit: parser grammar, generated parser artifacts, AST-facing tests, formatter handling for syntax introduced here.

Validation: parser and formatter package tests.

Exit criteria: the chosen MVP design source parses and formats deterministically, and unresolved syntax alternatives are recorded as deferrals instead of staying implicit.

### 2. Add design model validation and references

Concrete work:

- Add a feature-sliced validator module for design declarations and design references.
- Validate token category names, duplicate tokens, duplicate semantic aliases, unknown token references, recipe names, recipe variant names, and app design selection.
- Keep raw values either disallowed or accepted with clear diagnostics according to the Step 1 decision.
- Define how design declarations participate in visibility/import rules before enabling cross-file design references.
- Add validator diagnostics that are purely source-structural; defer rendered contrast and tap-target checks to later design tooling.

Likely commit unit: validator design module, type/reference helpers where needed, diagnostics tests.

Validation: validator package tests and focused workspace validation fixtures.

Exit criteria: invalid design declarations produce stable diagnostics, and valid app-local design declarations are visible to compiler codegen.

### 3. Lower deterministic tokens and recipes through `TR`

Concrete work:

- Add a compact compiler representation for design data selected by the app.
- Extend generated app code only enough to pass design data or design references to runtime helpers.
- Add or extend `TR` design/runtime helpers for:
  - token lookup;
  - semantic token resolution;
  - recipe/variant/default merging;
  - state style selection where the first slice supports it;
  - React Native style production.
- Keep reusable semantics in `packages/runtime/TaoRuntime-src/`; generated app TypeScript should stay declarative and minimal.
- Add runtime tests for token resolution, recipe merging, fallback behavior, and style precedence.

Likely commit unit: compiler design lowering plus `TR` design helpers and runtime tests.

Validation: compiler tests through compile success/failure, `packages/runtime/TR-tests`, and targeted runtime e2e tests.

Exit criteria: a Tao app can select a design and render at least Text, Button, and a surface/container with deterministic styles produced by the runtime.

### 4. Apply design at UI call sites and defaults

Concrete work:

- Implement the first design-application surface from Step 1 through visual entries in combined specs, recipe variants, semantic component variants, or app default recipes.
- Define precedence among stdlib defaults, app selected design defaults, recipe defaults, call-site variants, raw visual values, and native props from injected views.
- Ensure current layout clauses still merge independently from visual styles.
- Add focused compiler/runtime tests that inspect behavior through rendered output or runtime style resolution, not brittle generated-code substrings.
- Add the implemented slice to `Apps/Test Apps/Design System MVP/` and then Kitchen Sink once the app compiles and renders.

Likely commit unit: call-site design application, test app, Kitchen Sink coverage.

Validation: parser, validator, compiler, formatter, runtime tests; `./agent just compile-app 'Apps/Kitchen Sink/Kitchen Sink.tao'`.

Exit criteria: visible Tao source can request a semantic treatment such as primary button, raised card, muted text, or screen surface, and runtime output reflects it.

### 5. Add deterministic design diagnostics and CLI surface

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

### 6. Close the MVP and plan the next design phase

Concrete work:

- Update `Spec/Tao Design - WIP.md`, `Spec/Tao Layout and UI.md`, and `Spec/Tao Packages.md` for any syntax or capability names that changed during implementation.
- Update `Roadmap.md` status and this plan with completion notes.
- Run a stale-repo check for old design syntax, old theme names, and obsolete plan claims.
- Prepare the next project plan for lockfile/generation or screenshot-loop work only after the deterministic MVP is accepted.

Likely commit unit: docs and stale cleanup only.

Validation: `./agent just verify`.

Exit criteria: docs, examples, test apps, and roadmap agree on the shipped deterministic design surface.

## Validation summary

- Parser and formatter tests prove the syntax.
- Validator tests prove source-level design diagnostics and reference resolution.
- Compiler tests prove successful design lowering without brittle generated-code substring checks.
- `TR` and runtime tests prove token, recipe, state, and precedence behavior.
- Test Apps and Kitchen Sink prove the end-to-end Tao authoring experience.
- Final validation is `./agent just verify`.

## Deferrals

- `tao.design.lock`, accepted design provenance, generated design history, and app fingerprinting.
- AI-generated themes, style-genome tuning, screenshot critique, visual diff, and design iteration loops.
- Figma import/export, DTCG token import/export, external design registry, and Tao MCP server.
- Full platform adaptation across iOS, Android, web, density, motion, high contrast, locale, direction, and accessibility settings.
- Pattern recipes beyond the initial component recipe surface.
- Rendered tap-target, overflow, hierarchy, and screenshot baseline checks.
