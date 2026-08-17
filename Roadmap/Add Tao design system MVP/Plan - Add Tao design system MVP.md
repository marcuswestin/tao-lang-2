# Plan - Add Tao design system MVP

This plan predates the WordFlower tranche process. WordFlower Tranche 4 implemented its first slice:
flat tokens, named clause bundles, app `Design` selection, shared `TagOrHexColor` lexing with
contextual validation, deterministic clause composition, compiler lowering, and mounted-app runtime
resolution. Steps 1–4 below describe that landed milestone; continue from Step 5 through a later
WordFlower tranche. Later design surface is expressed in `Apps/WordFlower/3 - MVP/WordFlower.tao-mvp`.

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

### 7. Close the MVP and plan the next design phase

Concrete work:

- Update `Spec/Tao Design - WIP.md`, `Spec/Tao Layout and UI.md`, and `Spec/Tao Packages.md` for any syntax or capability names that changed during implementation.
- Update `Roadmap.md` status and this plan with completion notes.
- Run a stale-repo check for old design syntax, old theme names, and obsolete plan claims.
- Prepare the next project plan for lockfile/generation or screenshot-loop work only after the deterministic MVP is accepted.

Likely commit unit: docs and stale cleanup only.

Validation: `./agent verify`.

Exit criteria: docs, examples, test apps, and roadmap agree on the shipped deterministic design surface.

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
