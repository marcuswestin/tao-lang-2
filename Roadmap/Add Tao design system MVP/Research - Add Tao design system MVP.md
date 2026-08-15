# Research - Add Tao design system MVP

## Context

`Spec/Tao Design - WIP.md` proposes Tao design as a language, compiler, runtime, and tooling concern rather than an app-local style-library concern. Layout and visual design remain distinct typed concerns but share one composable `[]` spec surface. Every app should receive polished defaults, and design systems should be inspectable through tokens, semantic tokens, recipes, pattern recipes, and deterministic diagnostics.

The current repo already has bracketed layout clauses and runtime layout lowering. `packages/parser/parser-grammar/layout.langium` parses `[ ... ]` layout clauses as compact layout entries. `packages/compiler/compiler-src/codegen/app/tao-props-compiler.ts` lowers those entries into `TR.TaoProps({ layout: ... })`, and `packages/runtime/TaoRuntime-src/layout-engine/LayoutTypes.ts` defines the current runtime layout entry surface. The repo does not yet have Tao-authored design declarations, design tokens, semantic tokens, recipes, visual spec entries, `tao design` commands, design diagnostics, visual screenshot loops, or a design lockfile.

`Apps/WordFlower/2 - Next` now settles the first implementation slice: ordinary `.tao`
`design Name { ... }` declarations containing flat tokens and named clause bundles, selected by an
app's `Design` property. It deliberately does not generalize into semantic tokens, recipes, rules,
or tooling yet. Those compatible layers remain the broader MVP direction below.

`Spec/Tao Layout and UI.md` permits containers to receive visual entries through combined specs. The design MVP must still make style ownership explicit and keep visual treatment routed through design/runtime APIs rather than raw React Native props in generated app code.

The old Tao repo has useful precedent in app-level design blocks, semantic variants, and generated style resolution. That proves the value of semantic design intent, but its split syntax and implementation are superseded reference material. The new repo should implement the design stack in feature slices that match its current `view`/`layout` declarations, combined specs, `TR` runtime facade, formatter, validator, and test-app workflow.

## Settled Decisions

- The first implementation should be deterministic. Do not start with AI generation, screenshot critique, reference-image import, or a design lab.
- Layout and visual treatment use one `[ ... ]` application surface. Their entries remain typed, and named specs may compose both concerns.
- The first Next slice includes flat raw tokens and named clause bundles only. The broader design MVP
  should subsequently add semantic tokens, component recipes, variants, state styles, and rules.
- Raw visual values may be useful while prototyping, but the intended checker should prefer semantic tokens and eventually warn on raw color, spacing, and radius values in app code.
- Generated app TypeScript should stay small. Reusable design resolution, token lookup, recipe merging, state style resolution, and diagnostics belong in `TR`/runtime or focused compiler helpers, not repeated emitted helpers.
- The first visible acceptance surface should be a focused Test App and WordFlower coverage once the feature is executable.

## Open Questions

- ~~Does the first slice introduce a `design AppTheme { ... }` declaration in `.tao` source, a separate `tao.design` file, or both?~~ **Decided: a `design` declaration in `.tao` source.**
- ~~Does `app` select a design with `design AppTheme`, `theme AppTheme`, or another capability name?~~ **Decided: `design` is the capability name**, selected by the app as `Design <Name>`. See `Apps/WordFlower/3 - MVP/WordFlower.tao-mvp` and `Apps/WordFlower/4 - Revolution/WordFlower.tao-revolution` for the intended usage.
- ~~How are the first tokens and named specs declared?~~ **Decided for Next:** flat `name value`
  tokens and `name [clauses]` bundles inside `design Name { ... }`. Recipe and variant spelling
  remains open.
- Which visuals can be applied to `layout` and `frame` declarations, versus only to `view`
  declarations and view-like primitives?
- How much of "beautiful defaults" should ship before author-controlled tokens and recipes? A deterministic baseline can be useful, but it should not obscure the source-level design system contract.
- Should recipe variants be declared through a standalone `recipe Button { variant ... }` surface, named combined specs, generated semantic components, or a staged combination?
- Which design diagnostics are validator diagnostics, and which belong to a future `tao design check` command that can use rendered context?

## Planning Conclusion

The first step is now the deterministic flat-token and named-bundle slice specified by Next. Later
MVP tranches can add semantic tokens and recipes, then diagnostics and CLI checks, and only later
lockfiles, generation, screenshot loops, AI critique, registry, Figma, and MCP surfaces.
