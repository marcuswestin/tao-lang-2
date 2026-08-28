# Plan - Add validator and type system

## Goal

Add Tao semantic validation and a Typir-backed Tao type checker for parsed `.tao` files, then route those diagnostics through source compilation and the first real IDE extension slice.

The implementation should support the current executable Kitchen Sink plus the target syntax already captured in `Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao`: `alias`, `number` parameters, literals is number, and value references used as render arguments.

## Non-goals

- Do not add a separate type-system package.
- Do not implement custom type declarations, boolean/item/list/view/action values, operators, interpolation, state, actions, functions, `when`, imports, formatter behavior, or runtime stdlib behavior.
- Do not copy the old validator, compiler Langium workspace, or IDE extension wholesale.
- Keep expected Tao semantic/source-shape errors in validation. Compiler/codegen should assume validated AST and use assertions only for internal type contractions or invariant checks after validation.

## Assumptions

- The parser remains permissive about broad `Statement` placement so validation owns context-specific rules.
- Parser package services stay parser-oriented. New semantic checks should not make `Parser.parseCode` fail broad placement tests that are intentionally waiting for the validator, and parser package `validation: true` remains parser/linker validation only.
- `Validator.validateCode`, `Validator.validateFile`, and `Validator.validateParsed` return diagnostics as data. Throwing is reserved for unexpected implementation failures.
- `Validator.validateParsed` must not run Typir over a parser-only `ParseResult` document. It should either rebuild the same source/URI in validator-owned Langium services before Typir validation, or the API must be narrowed before implementation. Add tests for `validateParsed(await Parser.parseCode(...))`.
- Typir is the type-checking engine for this slice, but the public Tao model still starts with only `text` and `number`.
- Do not add an `unknown` Tao type, Typir primitive, or Typir sentinel. The previous repo did not need one; Typir inference misses used `undefined` / `InferenceRuleNotApplicable`.
- The first invocation checker can bind render arguments positionally because current syntax is positional. Adopt the old repo's single shared argument-checking concept, but do not adopt its greedy by-type binding algorithm until Tao syntax needs it.
- A local alias or parameter should not silently hide another visible value in the first slice. If implementation shows that Tao should allow shadowing, stop and ask Ro before changing this policy.
- File-level aliases are visible throughout the file. View parameters and aliases inside a `ui` are visible inside that view body.

## Previous repo reference

Adopt these ideas from `~/code/tao-lang`:

- `packages/compiler/compiler-src/validation/ValidationReporter.ts`: short diagnostic calls with explicit node/property locations and related information.
- `packages/compiler/compiler-src/validation/tao-lang-validator.ts`: feature-specific validation functions with message constants near the checks.
- `packages/compiler/compiler-src/langium/tao-services.ts`: a Langium service graph that registers validation checks for language-server diagnostics.
- `packages/ast-utils/ast-utils-src/invocations.ts`: one shared invocation-checking surface used by validation and codegen.
- `packages/compiler/compiler-src/typing/tao-type-system.ts`: Typir-Langium service types, primitive registration, inference rules, validation collector rules, `safeInferType`, and `ensureNodeIsAssignable` call-site diagnostics.
- `packages/ide-extension`: VS Code/Cursor client and language-server split, IPC transport, generated TextMate grammar wiring, package metadata, and smoke-test shape.
- `packages/compiler/compiler-src/langium/langium-lsp.ts`: re-export LSP/node APIs through local package wrappers so downstream packages use one dependency surface.

Simplify or reject these parts:

- Keep Typir integration focused on `text`, `number`, alias inference, parameter references, and render invocation compatibility.
- Keep validator modules small and package-local instead of porting the old compiler-owned validation tree.
- Keep IDE extension packaging minimal and real: syntax highlighting, activation, language server startup, and diagnostics. Leave stdlib bundling, formatter registration, navigation providers, extension install commands, and broad old repo language behavior out until the repo grows those features.

## Typir implementation instructions

The old repo's Typir implementation was reviewed before writing this plan. Use these mechanics, scaled down to the current grammar:

- Before adding dependencies, verify a `typir` / `typir-langium` version pair that supports the repo's current `langium ~4.2.2`. Start from the old repo's `~0.3.3` pair only as a reference. If no compatible pair exists, stop and ask Ro; downgrading Langium is out of scope for this project.
- Add the compatible `typir` and `typir-langium` dependencies to `packages/validator`.
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
- For broken links or paths that cannot resolve to a type, return `undefined` or `InferenceRuleNotApplicable` from Typir-facing code. Use an internal `unresolved` union member only in non-Typir structural helpers when it matches the old repo's `ResolvedTypeKind` / `TypeFingerprint` pattern, and never expose it as a Tao type.
- Add call-site validation through `typir.validation.Collector.addValidationRulesForAstNodes`, not a second hand-written assignability engine.
- Resolve the render target and argument-to-parameter pairings once in `invocations-validator.ts`, then call `typir.validation.Constraints.ensureNodeIsAssignable(argument, expectedType, accept, ...)` for each pair.
- Keep structural invocation diagnostics, such as missing or extra arguments, in the shared invocation checker; keep type compatibility diagnostics in Typir assignability.
- Expose the Typir service graph to validator tests so there is explicit Stage 0 coverage that Typir services are reachable and primitive inference works, mirroring the old repo's type-checking tests.
- Do not copy old support for booleans, actions, views, operators, interpolation, nominal types, local parameter subtypes, structs, functions, query rows, or data rows in this slice.

## Feature-sliced file layout

Follow `packages/AGENTS.md`: each language surface should have one focused file per pipeline stage, named with the same feature so the slice is greppable across packages. Add a stage file only when that stage actually handles the feature.

Use this project split:

- `app`: existing parser `app.langium`; validator `app-validator.ts`; compiler app/module assembly in `app-compiler.ts`.
- `views`: parser `views.langium`; validator `views-validator.ts`; compiler `views-compiler.ts`.
- `aliases`: parser `aliases.langium` imported by the block/entry grammar; validator `aliases-validator.ts`; compiler `aliases-compiler.ts`.
- `expressions`: parser `expressions.langium`; expression-specific validation/helpers in `expressions-validator.ts`; compiler `expressions-compiler.ts`. Typir inference registration still lives in `type-system.ts`.
- `invocations`: parser argument-list rules can stay with expressions unless they grow enough to deserve `invocations.langium`; validator `invocations-validator.ts`; compiler render-prop binding in `invocations-compiler.ts` should call `ASTUtils.resolveRenderInvocation` rather than duplicating matching logic.
- `injections`: parser injection grammar may stay in `views.langium` for this slice unless touched heavily; compiler injection handling belongs in `injections-compiler.ts`.
- `type-system`: Typir service wiring and primitive/type helpers live in `type-system.ts`; do not hide feature-specific validators there when a matching feature file exists.
- Runtime: this project uses the runtime-owned `TR` wrapper in `packages/runtime/TaoRuntime-src/TR.ts`. Generated Tao TS should stay minimal, import default `TR` from `@runtime/TR`, and move reusable runtime behavior into runtime wrappers instead of emitting helper implementations.

If implementation needs a cross-cutting helper, keep it small and name it for the shared mechanism, such as `diagnostics.ts`, `validation.ts`, or `codegen-util.ts`; do not create a catch-all feature file.

## Target Tao code

- `Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao` already expresses this project's target slice with `alias Greeting`, `alias LaunchCount`, `render Text Greeting`, and `render StatTile "Launch count", LaunchCount`.
- `Apps/Kitchen Sink/Kitchen Sink.tao` stays unchanged until compiler/codegen supports the target slice. Copy the implemented target slice into executable Kitchen Sink during Step 4.
- `Apps/Test Apps/Type System Tests/Type System Tests.tao` already demonstrates aliases and text/number invocation behavior. Keep it as the focused app for type-system behavior and compile it once the compiler supports this syntax.
- `Apps/Test Apps/Type System Tests/Purpose.md` already names the app boundary and expected visible output. Update it during implementation only if behavior-test metadata or visible expectations change.

## Implementation steps

### 1. Extend parser syntax for the target type-system slice

Concrete work:

- Extend `packages/parser/parser-grammar/blocks.langium` so `PrimitiveType` includes `number` and alias declarations can appear wherever the broad `Statement` grammar currently permits later validation.
- Extend `packages/parser/parser-grammar/expressions.langium` with an `Expression` union for string literals, literals is number, and value references; rewire `Argument.value` from `StringLiteral` to `Expression`.
- Add `packages/parser/parser-grammar/aliases.langium` with `AliasDeclaration: 'alias' name=ID '=' value=Expression`, and import it through the block/entry grammar so `Statement` can include aliases.
- Add a value-reference cross-reference to a `ValueDeclaration`-style AST union of `AliasDeclaration | ParameterDeclaration`, or an equivalent explicit design that keeps value references distinct from view references.
- Add the smallest custom scoping service needed to keep parameters visible only inside their owning `ui`, view-local aliases visible only in the owning view, and file aliases visible throughout the file. Do not let default global Langium scoping expose one view's parameters or local aliases to another view.
- Regenerate parser artifacts through the existing `just` parser-generation path.
- Add parser tests for number literals, alias declarations, alias references, parameter references, current Kitchen Sink, target Kitchen Sink, and `Apps/Test Apps/Type System Tests/Type System Tests.tao`.
- Keep parser diagnostics tests that prove invalid placement still parses when the grammar can represent it, including alias inside an app block, render outside a `ui`, and number-typed parameters used in syntactically valid but semantically invalid positions.

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
- Expand local parser wrapper exports in `packages/parser/parser-src/langium-exports.ts` before the validator imports Langium validation/service types. Package consumers must not import Langium/LSP types directly when a local parser wrapper export can provide them.
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
- Add `validator-src/type-system.ts` with the Typir service wiring described above for `text`, `number`, and future named/custom type hooks. Do not add an `unknown` Tao type, Typir primitive, or Typir sentinel.
- Add `validator-src/expressions-validator.ts` for expression-specific checks and helper calls into Typir inference:
  - string literal -> `text`
  - number literal -> `number`
  - alias reference -> referenced alias expression type
  - parameter reference -> parameter declared type
- Add `validator-src/aliases-validator.ts` for alias placement, visible-name duplicate checks, and declaration-order reference checks. Aliases may reference only values declared before the alias; this makes alias cycles invalid by construction.
- Add `packages/ast-utils/ast-utils-src/invocations.ts` as the shared render invocation resolver:
  - resolve the target view
  - report structural arity diagnostics
  - return positional argument/parameter pairs for valid positions
  - let Typir validation call `ensureNodeIsAssignable` for each returned pair
  - report duplicate parameter names through the same feature area
- Keep this invocation API general enough for future actions/functions, but do not build those call hosts now.
- Add validator tests for valid alias inference, number/text literal inference, alias references as arguments, parameter references in view-local expressions, duplicate aliases, duplicate parameters, alias declaration-order errors, arity errors, text/number mismatch errors, file-level alias visibility, cross-view non-visibility, duplicate visible names, and rejected local alias/parameter shadowing.

Likely commit unit:

- Typir wiring, type-system helpers, expression validation/inference, alias validation, invocation validation, and focused validator tests.

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
- Split codegen for new surfaces into the feature files named above, with `Compile.ts` as the single `Compile.<ASTNode>` object assembly. Keep shared helpers in `compiler-src/codegen/codegen-util.ts`.
- Replace the temporary generated text-only helper with a minimal runtime-owned Tao value constructor that supports `text` and `number`, exposed as `TR.Value<T>` / `new TR.Value(...)` from `packages/runtime/TaoRuntime-src/TR.ts`. Keep generated Tao TS minimal and keep the injection contract unchanged: `_ViewProps.<Param>.evaluate().jsValue`.
- Compile string literals, literals is number, alias references, and parameter references.
- Compile file-level aliases as generated bindings before views.
- Compile view-local aliases as local bindings before the view return expression.
- Compile render props from validated positional arguments.
- Update compiler tests so validation failures are asserted through compiler diagnostics/errors instead of generated TypeScript structure.
- Keep the compiler source API throw-on-error for this slice: `compileCode` / `compileFile` still return `{ code }` on success and throw the existing structured failure with `details.errors` on parser or validator errors. Do not add diagnostics to `CompileResult` unless Ro changes the API.
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
- Add IDE smoke coverage for generated syntax file presence, extension/server entrypoint build inputs, and one Langium-services-only diagnostics test that proves a `.tao` source receives validator/type diagnostics without launching VS Code.

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

- Update `Docs/Roadmap/Add validator and type system/Research - Add validator and type system.md` only if implementation disproves a research decision or records a Ro decision.
- Keep `Docs/Roadmap/Add validator and type system/Plan - Add validator and type system.md` current if implementation slices shift.
- Update `Apps/Test Apps/Type System Tests/Purpose.md` if implemented behavior or future behavior-test metadata differs from the current notes.
- Remove stale compiler comments/tests that still describe semantic checks as compiler-owned.
- Run `project-6-review-implementation` after implementation; it will use the repo's agent review workflow before merge.

Likely commit unit:

- Final docs cleanup, stale instruction/comment removal, and validation-only fixes.

Validation:

- Run `./agent just prep` as the final repo gate.

Exit criteria:

- The plan's implemented scope is reflected in Roadmap, app Purpose docs, tests, and package wiring.
- The repo passes `prep`.
- Remaining out-of-scope type-system and IDE work is listed as deferrals rather than left as stale active instructions.

## Validation summary

- Parser and validator work should be tested through AST/diagnostic behavior, not generated TypeScript string matching.
- Compiler behavior should be tested through source compilation success/failure and runtime app compilation.
- App behavior should include current Kitchen Sink and Type System Tests once syntax is implemented.
- Final validation is `./agent just prep`.

## Deferrals

- Custom type declarations and nominal assignability.
- Boolean, item, list, view, action, operators, interpolation, state, actions, functions, `when`, imports, formatter behavior, and stdlib runtime behavior.
- By-type argument binding and named arguments beyond the current positional render syntax.
- IDE formatter, go-to-definition, stdlib bundling, package/install commands, and full extension host automation.
- Codegen tracing/source maps.

## Implementation notes

- Implemented on branch `feat/add-validator-type-system` in five code commits: parser value syntax, structural validator package, Typir-backed checks, compiler integration, and minimal IDE/Langium diagnostics.
- The executable Kitchen Sink now matches the planned alias/number target slice, and `Apps/Test Apps/Type System Tests/Type System Tests.tao` compiles as a focused type-system app.
- Tao value and alias wrappers live in runtime-owned `TaoRuntime-src/TR.ts`; generated apps import default `TR` from `@runtime/TR` and use `TR.Value` / `TR.Alias` rather than emitting reusable value logic.
- Parser-dependent semantic helpers shared across validator/compiler live in `packages/ast-utils`; render invocation resolution moved there so compiler does not import validator feature internals.
- Typir integration uses `undefined` / `InferenceRuleNotApplicable` for unresolved inference paths and did not introduce an `unknown` Tao type, Typir primitive, or public sentinel.
- Langium LSP diagnostics use the same structural validator functions through `validator-src/validation.ts` plus Typir-Langium's validation collector. Typir-Langium wraps custom messages with node context in LSP diagnostics, so tests assert the stable message substring.
- The IDE extension build emits ignored `_gen_ide-extension` output, and parser generation emits ignored TextMate syntax under `packages/ide-extension/ide-extension-syntaxes/_gen_syntaxes/`.
- Next step: run `project-6-review-implementation` before review/merge.
