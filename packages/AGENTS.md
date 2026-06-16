# Working Across Packages

A single language feature usually spans several pipeline stages. Implement it as a vertical slice: one focused file per stage, named after the feature, so the feature can be read and changed in one pass across packages.

## Feature-Sliced File Naming

Add or edit the feature's file in each relevant package source dir (`<package>/<package>-src/...`):

- `parser/`: `views.langium`, `expressions.langium`, ...
- `validator/`: `views-validator.ts`, `expressions-validator.ts`, ...
- `formatter/`: `views-formatter.ts`, `expressions-formatter.ts`, ...
- `source-actions/`: `views-actions.ts`, `use-actions.ts`, ...
- `compiler/`: `views-compiler.ts`, `expressions-compiler.ts`, ...
- `runtime/` (`TaoRuntime-src/`): `TR.ts`, `TR-views.tsx`, `TR-expressions.tsx`, ...

## Pipeline Rules

- Keep the same feature name across stages so the slice is greppable end to end.
- Add a stage only when that stage actually handles the feature; do not create empty placeholder files.
- Prefer extending the matching slice over adding cross-cutting catch-all files.
- Put expected Tao semantic/source-shape diagnostics in `validator`, not compiler codegen. Compiler/codegen must assume it receives validated AST and must not re-check validator-owned rules such as arity, placement, app/root counts, duplicate names, or type compatibility. Use `Assert.is` / `Assert.defined` only for local type contractions needed to compile an already-validated AST, such as narrowing an AST node or resolving a cross-reference.
- Compiler/codegen should traverse and compile the AST it is given in source order. Do not filter, select, reorder, or skip nodes to make invalid input look valid.
- Use `@ast-utils` for shared Tao AST traversal and node/document helpers; do not call `Langium.AstUtils` or `Langium.isAstNode` directly from package consumers.
- Use `Switch.type` for behavior that branches by AST node kind. Reserve `AST.is*` checks for tests, filters, and local assertions where no union dispatch is needed.
- When a reusable AST union can be described in grammar, declare a Langium `type` alias and use the generated `AST.is<Type>` guard instead of writing a manual type guard function.
- In compiler codegen, keep `compiler-src/codegen/app/Compile.ts` as the single `Compile` object assembly. Feature compiler files expose AST-node-named handlers through a main named const export and call recursive codegen through `Compile.<ASTNode>`.
- Keep generated Tao TS minimal. Prefer reusable runtime functionality on default `TR` from `@runtime/TR` (`packages/runtime/TaoRuntime-src/TR.ts`) over emitting helper implementations in generated app files. Use the `runtime-codegen` skill for generated/runtime API work.
- Do not special-case empty iterables before `genJoin` or `genList`; those helpers already emit empty output. Branch only when empty input needs different generated syntax or runtime behavior.

## TypeScript And Shared APIs

- Use shared wrappers for platform invocations (`@shared` `CLI`, `FS`, `HCI`, `Platform`, etc.) instead of direct Bun or Node platform APIs.
- Use `Context` types for invocation state and `Options` types for configurable behavior. Keep `Context` types narrow and mostly required: a context defines what the invocation is, so many optional or conditional context properties usually mean the API needs more specific context types. `Options` types may use optional properties for defaults, toggles, and overrides.
- Use `Assert` helpers for invariant checks and type contractions that would otherwise be `if (<check>) throw new Error(...)`. Keep explicit throws for expected domain errors such as user input, command failure, or test-runtime setup errors.
- Use `HCI` for all user-intended terminal I/O, including messages, prompts, help text, replayed command output, and errors. Reserve `Platform.runtimeProcess` and `Platform.runtimeConsole` for low-level process plumbing and shared wrappers.
- Use `CLI.run`/`CLI.mustRun` for completed child processes and `CLI.start` for long-running child processes. Use `prefixedOutput` when output should be captured while streaming colored `[process]:` lines. Use `HCI.logProcessInfo`, `HCI.logProcessWarn`, and `HCI.logProcessError` for standalone process-prefixed messages.
- Plain JS/CJS config and bootstrap files that cannot safely load `@shared` are the exception. Keep direct `node:*` imports narrow, prefer slash-separated path strings where possible, and explain the loader constraint locally.
- Prefer `FS.resolvePath('foo/bar', { cwd })` for concrete filesystem locations. Use one slash-separated string with interpolation; omit `{ cwd }` when the intended base is the current process cwd. Use `FS.joinPath('foo/bar')` only for ungrounded relative path fragments.
- Never export raw `Platform.node*` APIs. Import `node:*` modules only inside the shared wrapper file that owns that capability, and use `FS` for filesystem access instead of `Platform`.
- Use multiline template strings for multiline text; do not build static multiline strings with arrays joined by `\n`. Use `Text.stripIndent` from `@shared` when indentation should be removed.
- Pass an existing one-argument predicate or helper directly to array methods, such as `.filter(isVisible)` or `.flatMap(declarationsInFile)`, instead of wrapping it as `item => isVisible(item)`. Keep a lambda when it captures other values, needs extra logic, or direct passing would make callback arity or `this` binding ambiguous.

## Exports, Comments, And Tests

- Prefer a module's public surface to be one main named const export that groups the exported values, such as `export const Android = { ensureEmulator, startExpo }`. Prefer named const exports over default exports for repo-owned modules.
- For newly created grouped modules, usually name the file and main export in UpperCamelCase, such as `Android.ts` exporting `Android`. When converting an existing module, keep its existing filename until the repo-wide filename sweep lands. Types may be exported separately when TypeScript needs them as types.
- Prefer self-documenting names and small functions over comments. Add comments only for intent, invariants, edge cases, or surprising constraints.
- Document exported functions and types with short, contract-focused JSDoc in the `<decl> <verb>s <description>` style.
- When touching existing exported code, add or update missing export docs as part of the same change.
- Export only real cross-file or package-boundary APIs; do not export helpers for convenience or tests.
- Remove or update stale comments, unused code, and stale exports whenever code changes.
- In TypeScript tests and test helpers, import test runner APIs from `@shared/test` (`Describe`, `Test`, `Expect`, `AfterEach`, `Jest`) instead of importing `bun:test` or `@jest/globals` directly. Runner-specific imports belong in shared test wrappers or test-runner config.
