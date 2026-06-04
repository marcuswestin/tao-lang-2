# Research - Add validator and type system

## Goal

Add Tao validation and type checking for parsed `.tao` files.

This is not about TypeScript type checking or `just check`; package `tsconfig` files already include package tests. This project is about Tao semantic diagnostics and Tao value/type compatibility.

## Current repo context

- The parser intentionally accepts general `Statement` nodes in broad positions so context-specific placement can move to a validator.
- The current supported Tao language surface is:
  - `app Name { ui RootView }`
  - `ui Name { ... }`
  - `ui Name Param text { ... }`
  - `render View "text" { }`
  - `render inject ```ts ... ````
- This project expands the Tao surface to include:
  - `number` parameters
  - number literals
  - `alias Name = Expression`
  - value references to aliases and parameters in render arguments
- The compiler currently owns semantic checks that should move into validation:
  - only declarations at file level
  - exactly one app declaration
  - exactly one app root `ui`
  - only root `ui` statements in app blocks
  - only view renders in multi-statement view blocks
  - no render injection mixed into multi-statement view blocks
  - parameters and render arguments are currently `text` only
- Compiler codegen should keep defensive assertions for direct AST entrypoints, but normal source compilation should fail through validation diagnostics before codegen.

## Previous repo reference

Useful prior patterns from `~/code/tao-lang`:

- `packages/compiler/compiler-src/validation/tao-lang-validator.ts` grouped validation message constants with node-specific checks.
- `packages/compiler/compiler-src/validation/ValidationReporter.ts` wrapped Langium's acceptor into a small reporting helper with optional node/property locations and related information.
- `packages/compiler/compiler-src/langium/tao-services.ts` registered validation checks in the Langium service graph.
- `packages/compiler/compiler-src/typing/tao-argument-bindings.ts` kept argument matching logic shared between validation and codegen.
- `packages/compiler/compiler-src/typing/tao-type-system.ts` used Typir for broader primitives, nominal types, operators, call-site checks, and interpolation checks.
- `packages/compiler/compiler-src/typing/tao-type-system.ts` also showed the important Typir mechanics for this repo: define Tao-specific `TypirLangiumServices`, create primitives and inference rules in `LangiumTypeSystemDefinition.onInitialize`, register validation rules through `typir.validation.Collector.addValidationRulesForAstNodes`, use `ensureNodeIsAssignable` for argument compatibility, and guard inference with a `safeInferType` helper because Typir-Langium caches require AST nodes to be linked into a document.
- `packages/compiler/compiler-src/langium/tao-services.ts` created Typir services with `createTypirLangiumServices(...)`, registered the Tao language module, then called `initializeLangiumTypirServices(...)`.
- `packages/ide-extension` wired VS Code/Cursor through a `vscode-languageclient` IPC client and a bundled Langium language-server entry.
- `compiler-src/langium/langium-lsp.ts` re-exported Langium LSP/node APIs through local package wrappers so downstream packages used one dependency surface.
- `packages/parser/langium-config.json` generated TextMate syntax output into the IDE extension package.
- The IDE extension package included generated bundle files, generated syntaxes, language configuration, package metadata, packaging, and install commands.

What not to carry over yet:

- Do not port the old validator wholesale. It is tied to the old compiler package, broader grammar, navigation, data, layout, actions, functions, and old service wiring.
- Use Typir in the first slice. Keep the Typir integration small and focused on `text`, `number`, aliases, parameter references, and invocation argument compatibility.
- Do not copy the old IDE extension wholesale. Keep its architecture and edge-case lessons, but adapt package names, workspace aliases, stdlib absence, build commands, generated paths, and this repo's leaner package layout.

## Type system input

`Spec/Tao Type System.md` is useful design input, not gospel for this slice.

Relevant now:

- Tao values have Tao types.
- String literals are `text`.
- Number literals are `number`.
- Aliases have the type of their expression.
- View parameters declare expected Tao types.
- Invocations must provide arguments compatible with their target parameters. This should be implemented as a general invocation checker so future actions and functions can use the same path.
- The initial type representation should already be shaped for named/custom type declarations, even though custom type declaration syntax is not part of this project.

Deferred from the spec:

- `boolean`, `item`, `list`, `view`, `action`
- type declarations and nominal aliases
- operators
- interpolation
- state, actions, functions, and `when`
- structural item/list typing
- numeric grouping separators and unary negative numbers, unless they fall out naturally from the parser work

## Research decisions

- Add a new `packages/validator` package named `tao-validator`, imported internally through `@validator`.
- Add a new `packages/ide-extension` package named `tao-ide-extension`.
- Export a single default `Validator` object, matching the current public package API pattern.
- Keep Tao type checking inside the validator package for now; do not create a separate type-system package.
- Wire Typir through the validator package with an initially minimal type model:
  - `text`
  - `number`
- Use the old repo's Typir service mechanics, but shrink the rules to this slice. Register only the primitives and inference/validation checks needed for string literals, number literals, aliases, parameters, and render arguments.
- Do not add an `unknown` Tao type, Typir primitive, or Typir sentinel. The previous repo did not need one; Typir inference misses used `undefined` / `InferenceRuleNotApplicable`. Internal `unresolved` helper variants are acceptable only where the previous repo needed that shape for non-Typir structural helpers, such as broken type-shape or argument-fingerprint resolution, and must never surface as a Tao type.
- Implement expression inference for current expressions:
  - `StringLiteral` -> `text`
  - `NumberLiteral` -> `number`
  - alias reference -> referenced alias expression type
  - parameter reference -> parameter type
- Implement `alias Name = Expression`:
  - allow aliases at file level and inside `ui` blocks
  - reject duplicate names in the same scope
  - detect simple alias reference cycles
  - compile aliases to local/generated bindings only after validation proves their expressions are type-safe
- Implement invocation checking against resolved target parameters:
  - argument count
  - argument type compatibility
  - duplicate parameter names in a view
  - one shared invocation API for render now, action/function calls later
- Implement structural validation currently embedded in compiler codegen:
  - file-level placement
  - app count
  - app root count and app block placement
  - view body placement
  - injection placement
- Keep diagnostics as data, not thrown errors:
  - source-level entrypoints return diagnostics
  - compiler turns validator errors into its existing structured compile failure
- Change Kitchen Sink target syntax during research to show the intended alias and number behavior. Keep executable Kitchen Sink unchanged until implementation.

## IDE extension implementation scope

Include the IDE extension in this project so validator/type diagnostics are available in editor workflows, not only compiler/test entrypoints.

Rely heavily on `~/code/tao-lang/packages/ide-extension`, `~/code/tao-lang/packages/compiler/compiler-src/langium`, and parser LSP wrapper files for architecture and edge cases. The implementation should use those files as the main reference for:

- VS Code/Cursor extension package shape and contribution metadata.
- Language client activation/deactivation and IPC transport.
- Language server entrypoint that starts Langium services with the same validator pipeline used by compiler/source validation.
- Development-mode output channel/log routing, if still useful in this repo.
- Debug server options for extension host runs.
- TextMate grammar generation and package inclusion.
- LSP dependency placement and local wrapper exports so parser/compiler/validator/extension do not import incompatible Langium/LSP instances.
- Build/package/install tasks adapted to this repo's `./agent` and `just` conventions.
- Edge cases around generated bundle paths, extension development paths, language ids, `.tao` file activation, diagnostics refresh, formatter registration, and future stdlib bundling.

First IDE extension slice should be minimal but real:

- extension package manifests and TypeScript config
- extension client entrypoint
- language server entrypoint
- generated syntax/package wiring
- validation diagnostics visible for `.tao` files
- focused smoke test or package check for extension bundle inputs

## Compiler and validator file separation proposal

Use feature/surface files rather than one large compiler or validator module. The shape should grow toward the fuller language while staying small now.

Validator:

- `validator-src/validator.ts`: public `Validator` object and result types.
- `validator-src/diagnostics.ts`: diagnostic type, severity helpers, and parser/validator diagnostic merging.
- `validator-src/validation.ts`: small validation helper API.
- `validator-src/app-validator.ts`: app declarations, app root rules, and file-level app count.
- `validator-src/views-validator.ts`: `ui` declarations, view body placement, parameter declarations, render injection placement.
- `validator-src/aliases-validator.ts`: alias placement, duplicate alias names, alias cycles.
- `validator-src/invocations-validator.ts`: generic invocation argument checking for render now and actions/functions later.
- `validator-src/type-system.ts`: Tao type representation, type equality/assignability, and future custom type declaration hooks.
- `validator-src/expressions-validator.ts`: expression-specific checks and helper calls into Typir inference.

Compiler:

- `compiler-src/compiler.ts`: public `Compiler` object and parse/validate/compile orchestration.
- `compiler-src/codegen/app/app-compiler.ts`: file/app module assembly.
- `compiler-src/codegen/views-compiler.ts`: `ui` declarations, view bodies, render calls.
- `compiler-src/codegen/aliases-compiler.ts`: alias bindings.
- `compiler-src/codegen/expressions-compiler.ts`: string, number, alias/parameter references.
- `compiler-src/codegen/injections-compiler.ts`: `inject` handling.
- Keep shared generator helpers in `compiler-src/codegen/codegen-util.ts`.

IDE extension:

- `ide-extension/ide-extension-src/extension/main.ts`: VS Code extension client and output channel wiring.
- `ide-extension/ide-extension-src/language/main.ts`: Langium language server startup using parser/validator services.
- `ide-extension/ide-extension-syntaxes/`: generated and hand-maintained TextMate syntax files.
- `ide-extension/language-configuration.json`: Tao editor language configuration.
- `ide-extension/esbuild.config.ts`: extension/language bundle.
- `ide-extension/ide-extension-tests/`: bundle and activation smoke tests.

## Validation helper proposal

Do not copy the old `ValidationReporter` wholesale. Keep the useful idea: short calls with explicit locations and related info.

Proposed API shape:

```ts
check((node, ctx) => {
  ctx.error(Msg.duplicateName(name), at.prop(node, 'name'), [
    related(first, 'First declaration is here.'),
  ])
})
```

- `check(fn)` adapts a small callback to the validator runner.
- `ctx.error`, `ctx.warning`, and `ctx.info` accept a message, location, and optional related info.
- `at.node(node)`, `at.prop(node, 'name')`, and `at.index(node, 'arguments', index)` keep location code short.
- `related(node, message, location?)` keeps duplicate/cross-node diagnostics readable.
- `Msg` constants/functions live next to each feature validator so long diagnostic text does not stretch check logic.

## Expected package surface

- `Validator.validateCode(code)` parses and validates Tao source.
- `Validator.validateFile(path)` parses and validates a Tao file.
- `Validator.validateParsed(parsed)` validates an existing parser result.
- Results include the parser result and validator diagnostics.
- Errors are diagnostics; throwing is reserved for unexpected implementation failures.
- `packages/ide-extension` exposes Tao `.tao` syntax highlighting and LSP diagnostics using the same validator package as compiler entrypoints.

## Test direction

- Add validator tests for valid current Kitchen Sink code.
- Add validator tests for each semantic rule moved out of compiler.
- Add validator tests for scope rules: file-level alias visibility, view-local alias and parameter visibility inside the owning view, cross-view non-visibility, duplicate visible names, and rejected local alias/parameter shadowing.
- Add type-checking tests for generic invocation argument count and text/number compatibility.
- Add alias tests for inferred text/number alias types, alias references as invocation arguments, duplicate aliases, and alias cycles.
- Add `Apps/Test Apps/Type System Tests/Type System Tests.tao` as a valid Tao app that demonstrates alias-based text and number values passed into tile views.
- Add IDE extension smoke coverage for bundled syntax/server entrypoints and editor diagnostics wiring where practical.
- Update compiler tests to assert compiler rejects validation failures without testing generated TypeScript structure.
- Keep tests functional and diagnostic-oriented; avoid trivial package export tests.

## Settled scope

- Expand the first implementation beyond the current parser surface to include `number` and `alias`.
- Include a minimal IDE extension implementation in the project.
- Keep custom type declarations out of this slice, but shape the type model so nominal/custom types can be added soon without rewriting invocation checking.
