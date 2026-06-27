# Research - Add Tao design system MVP

## Context

`Spec/Tao Design - WIP.md` proposes Tao design as a language, compiler, runtime, and tooling concern rather than an app-local style-library concern. The core direction is to keep layout and visual design separate, give every app polished defaults, and make design systems inspectable through tokens, semantic tokens, recipes, pattern recipes, and deterministic diagnostics.

The current repo already has bracketed layout clauses and runtime layout lowering. `packages/parser/parser-grammar/layout.langium` parses `[ ... ]` layout clauses as compact layout entries. `packages/compiler/compiler-src/codegen/app/tao-props-compiler.ts` lowers those entries into `TR.TaoProps({ layout: ... })`, and `packages/runtime/TaoRuntime-src/layout-engine/LayoutTypes.ts` defines the current runtime layout entry surface. The repo does not yet have Tao-authored design declarations, design tokens, semantic tokens, recipes, style clauses, `tao design` commands, design diagnostics, visual screenshot loops, or a design lockfile.

`Spec/Tao Layout and UI.md` already names styling as separate from layout, but keeps open whether `frame` and `layout` can paint pixels directly. The design MVP should not settle that accidentally; the first implementation should make style ownership explicit and keep any visual treatment routed through design/runtime APIs rather than raw React Native props in generated app code.

The old Tao repo has useful precedent: app-level `design { description "..." }` blocks, semantic `variant` declarations such as `variant PrimaryAction = Button <"...">`, and generated style resolution. That proves the value of semantic design intent, but the old syntax and implementation should be treated as reference material only. The new repo should implement the design stack in feature slices that match its current `view`/`layout` declarations, `TR` runtime facade, formatter, validator, and test-app workflow.

## Settled Decisions

- The first implementation should be deterministic. Do not start with AI generation, screenshot critique, reference-image import, or a design lab.
- Layout stays in `[ ... ]`. Visual treatment belongs to a separate design surface, whether that lands as `< ... >` style clauses, design declarations, recipes, or a combination of those.
- The first design model should include raw tokens, semantic tokens, component recipes, component variants or recipe variants, state styles, and design rules.
- Raw visual values may be useful while prototyping, but the intended checker should prefer semantic tokens and eventually warn on raw color, spacing, and radius values in app code.
- Generated app TypeScript should stay small. Reusable design resolution, token lookup, recipe merging, state style resolution, and diagnostics belong in `TR`/runtime or focused compiler helpers, not repeated emitted helpers.
- The first visible acceptance surface should be a focused Test App and Kitchen Sink coverage once the feature is executable.

## Open Questions

- What is the exact source syntax for visual treatment? The WIP spec proposes `< ... >`, while current repo syntax already uses `{ ... }` render blocks and roadmap notes mention angle render blocks elsewhere. The implementation plan should start by pinning the delimiter and grammar interaction before parser work.
- Does the first slice introduce a `design AppTheme { ... }` declaration in `.tao` source, a separate `tao.design` file, or both?
- Does `app` select a design with `design AppTheme`, `theme AppTheme`, or another capability name? `Spec/Tao Packages.md` currently mentions app capabilities such as themes, strings, assets, and datasources.
- Which visuals can be applied to `layout` and future `frame` declarations, versus only to `view` declarations and view-like primitives?
- How much of "beautiful defaults" should ship before author-controlled tokens and recipes? A deterministic baseline can be useful, but it should not obscure the source-level design system contract.
- Should recipe variants be declared through a standalone `recipe Button { variant ... }` surface, semantic `variant Name = Button <"...">`, or a staged combination?
- Which design diagnostics are validator diagnostics, and which belong to a future `tao design check` command that can use rendered context?

## Planning Conclusion

The next step is an implementation plan for `Add Tao design system MVP`. It should start with a small source and runtime model for deterministic tokens and recipes, then add style-clause or variant application, then add diagnostics and CLI checks, and only later add lockfiles, generation, screenshot loops, AI critique, registry, Figma, and MCP surfaces.
