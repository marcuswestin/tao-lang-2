# Implementation - Port over scope functionality

## Outcome

- Value references now resolve aliases from innermost render block outward, then view parameters, then file-level aliases.
- Render child blocks now allow aliases.
- Generated aliases and value references use the old repo's `_Scope`/`TR.BlockScope` pattern so nested declarations can shadow outer declarations without JavaScript name collisions.
- Generated render statements now emit JSX fragments and component elements instead of `TR.Render(...)` runtime calls.
- Generated render statements now emit direct JSX children and attributes instead of `TR.RenderChildren(...)` and `TR.RenderProps(...)`.
- Generated block bodies now put setup declarations before a final JSX `return` statement instead of accumulating `_ViewElements`.
- Generated view and render child block bodies now compile their source statements through `Compile.Statement`; render statements compile to block `return` statements.
- Generated ui bodies now execute directly through `TR.BlockScope(...)`; `TR.ViewBlock` was removed.
- Generated ui declarations now assign scoped function components (`_Scope.Name = function Name(...) { ... }`); `TR.UiDeclaration` was removed.
- `layout` declarations now share the view declaration pipeline with `ui` declarations and can receive/render caller children through `_ViewProps.children`.
- Render child blocks now support bare child view invocations such as `Text Value` in addition to explicit `render Text Value`.
- Langium grammar now declares `RenderStatement`, `RenderInvocation`, and `NamedDeclaration`; compiler, validator, and AST helpers consume those generated AST types instead of hand-written TypeScript AST unions.
- Generated JSX tags and value arguments both use the current `_Scope`; `_Views` was removed so generated code has one declaration namespace.
- Validation now requires the single view-body `render` to be the last statement, letting view codegen preserve source-order setup statements.
- Duplicate alias validation is scoped per block. Local aliases can shadow file-level value aliases, while same-block aliases, view-parameter aliases, and visible view declarations still conflict.
- Declaration-order diagnostics continue to run in the validator after parser linking.
- Kitchen Sink demonstrates `layout Stack`, nested value-alias shadowing, bare child view invocations, and literal text arguments.

## Validation

- Added validator coverage for block-local aliases in render child blocks.
- Added validator coverage for duplicate aliases in the same render child block.
- Added validator coverage for same-name aliases in separate render child blocks.
- Added runtime coverage for generated `TR.BlockScope` shadowing.
- Added parser, ast-utils, validator, compiler, and runtime coverage for `layout` and bare child view invocations.
- `./agent just check` passed.
- `./agent just prep-commit` passed.
