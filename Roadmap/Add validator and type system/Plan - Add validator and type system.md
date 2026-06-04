# Plan - Add validator and type system

## Goal

Add Tao semantic validation and a Typir-backed Tao type checker for parsed `.tao` files, then route those diagnostics through source compilation and the first real IDE extension slice.

The implementation should support the current executable Kitchen Sink plus the target syntax already captured in `Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao`: `alias`, `number` parameters, number literals, and value references used as render arguments.

## Non-goals

- Do not add a separate type-system package.
- Do not implement custom type declarations, boolean/item/list/view/action values, operators, interpolation, state, actions, functions, `when`, imports, formatter behavior, or runtime stdlib behavior.
- Do not copy the old validator, compiler Langium workspace, or IDE extension wholesale.
- Do not replace defensive compiler assertions for parsed AST entrypoints; validation should prevent normal source compiles from reaching those assertions, but they remain useful implementation guards.

## Assumptions

- The parser remains permissive about broad `Statement` placement so validation owns context-specific rules.
- Parser package services stay parser-oriented. New semantic checks should not make `Parser.parseCode` fail broad placement tests that are intentionally waiting for the validator.
- `Validator.validateCode`, `Validator.validateFile`, and `Validator.validateParsed` return diagnostics as data. Throwing is reserved for unexpected implementation failures.
- Typir is the type-checking engine for this slice, but the public Tao model still starts with only `text` and `number`.
- The first invocation checker can bind render arguments positionally because current syntax is positional. Adopt the old repo's single shared argument-checking concept, but do not adopt its greedy by-type binding algorithm until Tao syntax needs it.
- A local alias or parameter should not silently hide another visible value in the first slice. If implementation shows that Tao should allow shadowing, stop and ask Ro before changing this policy.
- File-level aliases are visible throughout the file. View parameters and aliases inside a `ui` are visible inside that view body.

## Previous repo reference

Adopt these ideas from `~/code/tao-lang`:

- `ValidationReporter.ts`: short diagnostic calls with explicit node/property locations and related information.
- `tao-lang-validator.ts`: feature-specific validation functions with message constants near the checks.
- `tao-services.ts`: a Langium service graph that registers validation checks for language-server diagnostics.
- `tao-argument-bindings.ts`: one shared invocation-checking surface used by validation and codegen.
- `tao-type-system.ts`: Typir-Langium service types, primitive registration, inference rules, validation collector rules, `safeInferType`, and `ensureNodeIsAssignable` call-site diagnostics.
- `packages/ide-extension`: VS Code/Cursor client and language-server split, IPC transport, generated TextMate grammar wiring, package metadata, and smoke-test shape.
- `compiler-src/langium/langium-lsp.ts`: re-export LSP/node APIs through local package wrappers so downstream packages use one dependency surface.

Simplify or reject these parts:

- Keep Typir integration focused on `text`, `number`, alias inference, parameter references, and render invocation compatibility.
- Keep validator modules small and package-local instead of porting the old compiler-owned validation tree.
- Keep IDE extension packaging minimal and real: syntax highlighting, activation, language server startup, and diagnostics. Leave stdlib bundling, formatter registration, navigation providers, extension install commands, and broad old repo language behavior out until the repo grows those features.

## Typir implementation instructions

The old repo's Typir implementation was reviewed before writing this plan. Use these mechanics, scaled down to the current grammar:

- Add `typir` and `typir-langium` to `packages/validator`; use versions compatible with the repo's current Langium version, starting from the old repo's `~0.3.3` dependency pair if still compatible.
- Define Tao-specific Typir service types in `validator-src/type-system.ts`, equivalent in shape to the old `TaoSpecifics extends TypirLangiumSpecifics` and `TaoTypirServices = TypirLangiumServices<TaoSpecifics>`.
- Create Typir services with `createTypirLangiumServices(shared, AST.reflection, new TaoTypeSystem(), {})` in the Langium service factory used by validator and IDE diagnostics.
- Register the language module with the shared `ServiceRegistry`, then call `initializeLangiumTypirServices(languageModule, languageModule.typir)`. Keep this order; the old repo depended on it.
- Implement `TaoTypeSystem implements LangiumTypeSystemDefinition<TaoSpecifics>`.
- In `onInitialize`, register only the primitives needed now: `text` and `number`.
- Add Typir inference rules for:
  - `StringLiteral` -> `text`
  - `NumberLiteral` -> `number`
  - alias reference -> inferred type of the referenced alias value
  - parameter reference -> Typir type for the parameter's declared primitive
- Add a `safeInferType` helper that checks the AST node is attached to a Langium document before calling `typir.Inference.inferType(...)`, catches only Typir-Langium's "AST node has no document" cache error, and rethrows all other errors.
- Add call-site validation through `typir.validation.Collector.addValidationRulesForAstNodes`, not a second hand-written assignability engine.
- Resolve the render target and argument-to-parameter pairings once in `invocations-validator.ts`, then call `typir.validation.Constraints.ensureNodeIsAssignable(argument, expectedType, accept, ...)` for each pair.
- Keep structural invocation diagnostics, such as missing or extra arguments, in the shared invocation checker; keep type compatibility diagnostics in Typir assignability.
- Expose the Typir service graph to validator tests so there is explicit Stage 0 coverage that Typir services are reachable and primitive inference works, mirroring the old repo's type-checking tests.
- Do not copy old support for booleans, actions, views, operators, interpolation, nominal types, local parameter subtypes, structs, functions, query rows, or data rows in this slice.

## Target Tao code

- `Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao` already expresses this project's target slice with `alias Greeting`, `alias LaunchCount`, `render Text Greeting`, and `render StatTile "Launch count", LaunchCount`.
- `Apps/Kitchen Sink/Kitchen Sink.tao` stays unchanged until compiler/codegen supports the target slice. Copy the implemented target slice into executable Kitchen Sink during Step 4.
- `Apps/Test Apps/Type System Tests/Type System Tests.tao` already demonstrates aliases and text/number invocation behavior. Keep it as the focused app for type-system behavior and compile it once the compiler supports this syntax.
- `Apps/Test Apps/Type System Tests/Purpose.md` already names the app boundary and expected visible output. Update it during implementation only if behavior-test metadata or visible expectations change.

## Implementation steps

### 1. Extend parser syntax for the target type-system slice

Concrete work:

- Extend `packages/parser/parser-grammar/blocks.langium` so `PrimitiveType` includes `number` and alias declarations can appear wherever the broad `Statement` grammar currently permits later validation.
- Extend `packages/parser/parser-grammar/expressions.langium` with an `Expression` union for string literals, number literals, and value references.
- Add `AliasDeclaration: 'alias' name=ID '=' value=Expression`.
- Add a value-reference cross-reference that can resolve to aliases and view parameters. Keep custom scoping minimal; if Langium default scoping is too broad for parameters, add the smallest parser/validator service needed instead of broad compiler workspace machinery.
- Regenerate parser artifacts through the existing `just` parser-generation path.
- Add parser tests for number literals, alias declarations, alias references, parameter references, current Kitchen Sink, target Kitchen Sink, and `Apps/Test Apps/Type System Tests/Type System Tests.tao`.
- Keep parser diagnostics tests that prove invalid placement still parses when the grammar can represent it.

Likely commit unit:

- Parser grammar, generated parser artifacts, parser tests, and any required parser wrapper exports.

Validation:

- Run focused parser tests with `./agent just test` once parser generation is in place, or the narrow Bun parser test command while iterating.
- Confirm executable Kitchen Sink still parses.

Exit criteria:

- Current Kitchen Sink, target Kitchen Sink, and Type System Tests all parse without parser errors.
- Parser-only invalid placement fixtures still parse cleanly when they are syntactically valid Tao.
- No semantic diagnostic expectations have moved into parser tests.

### 2. Add the validator package and structural diagnostics

Concrete work:

- Add `packages/validator` with package name `tao-validator`, internal alias `@validator`, `validator-src/validator.ts`, package exports, tsconfig, and validator tests.
- Add path mappings in `packages/tsconfig.base.json` for `@validator` and `@validator/*`.
- Define the public `Validator` object with `validateCode`, `validateFile`, and `validateParsed`.
- Define a small diagnostic model in `validator-src/diagnostics.ts` with message, severity, source, optional node/location data, parser/validator diagnostic merging, and helpers for error filtering.
- Define `validator-src/validation.ts` as the adapter layer for feature checks. It should support a collecting context for package tests/compiler use and a Langium acceptor context for IDE use.
- Implement structural validators:
  - `app-validator.ts`: top-level declaration placement, exactly one app declaration, exactly one app root `ui`, and app block placement.
  - `views-validator.ts`: `ui` body placement, duplicate parameter names, render injection placement, and render target shape.
- Move the compiler-owned structural source checks into validator tests before changing compiler behavior.

Likely commit unit:

- New validator package, public API, structural checks, test helpers, and structural validator tests.

Validation:

- Add `packages/validator/validator-tests/test-validate.ts` with clean-path and expected-error helpers.
- Add tests for current Kitchen Sink as valid Tao.
- Add tests for every structural rule currently thrown from `packages/compiler/compiler-src/codegen/app/runtime-gen.ts`.
- Run validator tests and package typecheck through the repo's normal `./agent just check` or `./agent just test` path while iterating.

Exit criteria:

- Structural problems are reported as validator diagnostics, not thrown exceptions.
- Existing parser tests stay parser-focused.
- Compiler tests can still pass before compiler integration because the compiler's defensive assertions have not been removed yet.

### 3. Add Typir-backed type checking, aliases, and invocation validation

Concrete work:

- Add `typir-langium` and any direct Typir dependency needed by the validator package.
- Add `validator-src/type-system.ts` with the Typir service wiring described above for `text`, `number`, and future named/custom type hooks. Do not add `unknown` to the public Tao type model; if Typir needs an internal unresolved sentinel for unreliable parser/linking nodes, keep it internal.
- Add `validator-src/expressions-type.ts` for expression inference:
  - string literal -> `text`
  - number literal -> `number`
  - alias reference -> referenced alias expression type
  - parameter reference -> parameter declared type
- Add `validator-src/aliases-validator.ts` for alias placement, visible-name duplicate checks, and simple alias cycle detection.
- Add `validator-src/invocations-validator.ts` as the shared render invocation checker:
  - resolve the target view
  - compare argument count to parameter count
  - compare each positional argument type to the matching parameter type
  - report duplicate parameter names through the same feature area
- Keep this invocation API general enough for future actions/functions, but do not build those call hosts now.
- Add validator tests for valid alias inference, number/text literal inference, alias references as arguments, parameter references in view-local expressions, duplicate aliases, duplicate parameters, alias cycles, arity errors, and text/number mismatch errors.

Likely commit unit:

- Typir wiring, type-system helpers, expression inference, alias validation, invocation validation, and focused validator tests.

Validation:

- Run validator tests.
- Parse and validate `Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao`.
- Parse and validate `Apps/Test Apps/Type System Tests/Type System Tests.tao`.

Exit criteria:

- Target Kitchen Sink validates cleanly.
- Type System Tests validates cleanly.
- Invalid type/alias/invocation fixtures produce stable diagnostics with behavior-oriented assertions.

### 4. Integrate validation into compiler and compile the target slice

Concrete work:

- Add `tao-validator` as a compiler dependency and route `Compiler.compileCode` and `Compiler.compileFile` through `Validator`.
- Convert validator errors into the compiler's existing structured compile failure path, de-duplicating parser errors the way the current compiler already does.
- Keep codegen defensive assertions in place but stop relying on them for normal source-level semantic failures.
- Split codegen toward the research shape only as much as needed for this slice:
  - keep shared helpers in `compiler-src/codegen/codegen-util.ts`
  - keep app/module assembly in the current app compiler file or rename only if it reduces complexity now
  - add focused helpers for aliases and expressions if that keeps `runtime-gen.ts` readable
- Replace the temporary text-only runtime helper with a minimal Tao value helper that supports `text` and `number`, for example `TaoValue<T>`, `TaoTextValue`, `TaoNumberValue`, and `taoValue`.
- Compile string literals, number literals, alias references, and parameter references.
- Compile file-level aliases as generated bindings before views.
- Compile view-local aliases as local bindings before the view return expression.
- Compile render props from validated positional arguments.
- Update compiler tests so validation failures are asserted through compiler diagnostics/errors instead of generated TypeScript structure.
- Copy the implemented alias/number slice from `Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao` into `Apps/Kitchen Sink/Kitchen Sink.tao` only after the compiler can compile it.
- Compile `Apps/Test Apps/Type System Tests/Type System Tests.tao` as a focused app validation path.

Likely commit unit:

- Compiler validation integration, codegen support for aliases/numbers/references, Kitchen Sink current update, compiler tests, and app compile coverage.

Validation:

- Run compiler tests.
- Run `./agent just compile-app 'Apps/Kitchen Sink/Kitchen Sink.tao'`.
- Run `./agent just compile-app 'Apps/Test Apps/Type System Tests/Type System Tests.tao'`.
- Run runtime tests once Kitchen Sink current changes.

Exit criteria:

- Compiler rejects validator failures before codegen.
- Current Kitchen Sink contains and compiles the implemented alias/number target slice.
- Type System Tests compiles into the runtime package when requested.
- Runtime test coverage still verifies visible Kitchen Sink behavior, updated for the new text/stat output if the runtime test is expanded.

### 5. Add the minimal IDE extension and Langium validation service wiring

Concrete work:

- Add `packages/ide-extension` with package name `tao-ide-extension`, tsconfig, package metadata, `language-configuration.json`, `ide-extension-src/extension/main.ts`, `ide-extension-src/language/main.ts`, `esbuild.config.ts`, and focused smoke tests.
- Update `packages/parser/langium-config.json` so Langium generation emits TextMate syntax into the IDE extension package while keeping parser generated AST output unchanged.
- Add local parser wrapper exports for Langium LSP/node APIs instead of importing directly from `langium`, `langium/lsp`, `langium/node`, or `vscode-languageserver` in package consumers.
- Add a validator service factory that registers the same feature checks used by `Validator.validate*` with Langium's `ValidationRegistry`.
- Start the language server from the IDE extension with those services so `.tao` files receive parser, linker, validator, and type diagnostics.
- Add minimal build automation through existing `just` conventions if bundling cannot be covered by package tests and `tsc --build packages/*/tsconfig.json`.
- Add IDE smoke coverage for generated syntax file presence, extension/server entrypoint build inputs, and at least one diagnostics-through-services path if practical without launching VS Code.

Likely commit unit:

- IDE extension package, parser TextMate generation wiring, local LSP wrapper exports, language-server service registration, build/test automation, and smoke tests.

Validation:

- Run parser generation and confirm the generated TextMate grammar exists in the IDE extension package.
- Run the IDE extension smoke tests.
- Run package typecheck.

Exit criteria:

- A `.tao` file opened by the extension can receive the same validator/type diagnostics as compiler/test entrypoints.
- Extension package metadata references files that are generated or present in the repo.
- No package imports Langium/LSP APIs directly when a local parser wrapper export is available.

### 6. Final documentation, validation, and review preparation

Concrete work:

- Update `Roadmap/Add validator and type system/Research - Add validator and type system.md` only if implementation disproves a research decision or records a Ro decision.
- Keep `Roadmap/Add validator and type system/Plan - Add validator and type system.md` current if implementation slices shift.
- Update `Apps/Test Apps/Type System Tests/Purpose.md` if implemented behavior or future behavior-test metadata differs from the current notes.
- Remove stale compiler comments/tests that still describe semantic checks as compiler-owned.
- Run agent reviews during the implementation-review phase, not during plan writing.

Likely commit unit:

- Final docs cleanup, stale instruction/comment removal, and validation-only fixes.

Validation:

- Run `./agent just prep-commit` as the final repo gate.

Exit criteria:

- The plan's implemented scope is reflected in Roadmap, app Purpose docs, tests, and package wiring.
- The repo passes `prep-commit`.
- Remaining out-of-scope type-system and IDE work is listed as deferrals rather than left as stale active instructions.

## Validation summary

- Parser and validator work should be tested through AST/diagnostic behavior, not generated TypeScript string matching.
- Compiler behavior should be tested through source compilation success/failure and runtime app compilation.
- App behavior should include current Kitchen Sink and Type System Tests once syntax is implemented.
- Final validation is `./agent just prep-commit`.

## Deferrals

- Custom type declarations and nominal assignability.
- Boolean, item, list, view, action, operators, interpolation, state, actions, functions, `when`, imports, formatter behavior, and stdlib runtime behavior.
- By-type argument binding and named arguments beyond the current positional render syntax.
- IDE formatter, go-to-definition, stdlib bundling, package/install commands, and full extension host automation.
- Codegen tracing/source maps.
