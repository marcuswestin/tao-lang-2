# Working across packages

A single language feature (views, expressions, etc.) usually spans every stage of the pipeline. Implement it as a vertical slice: one focused file per stage, named after the feature, so a feature can be read and changed in one pass across packages.

## Feature-sliced file naming

Add or edit the feature's file in each relevant package source dir (`<package>/<package>-src/...`):

- `parser/`: `views.langium`, `expressions.langium`, ...
- `validator/`: `views-validator.ts`, `expressions-validator.ts`, ...
- `formatter/`: `views-formatter.ts`, `expressions-formatter.ts`, ...
- `compiler/`: `views-compiler.ts`, `expressions-compiler.ts`, ...
- `runtime/` (`TaoRuntime-src/`): `TR.ts`, `TR-views.tsx`, `TR-expressions.tsx`, ...

## Rules

- Keep the same feature name across stages so the slice is greppable end to end.
- Add a stage only when that stage actually handles the feature; don't create empty placeholder files.
- Prefer extending the matching slice over adding cross-cutting catch-all files.
- Put expected Tao semantic/source-shape diagnostics in `validator`, not compiler codegen. Compiler/codegen must assume it receives validated AST and must not re-check validator-owned rules such as arity, placement, app/root counts, duplicate names, or type compatibility. Use `Assert.is` / `Assert.defined` only for local type contractions needed to compile an already-validated AST, such as narrowing an AST node or resolving a cross-reference.
- Compiler/codegen should traverse and compile the AST it is given in source order. Do not filter, select, reorder, or skip nodes to make invalid input look valid; generating output is the compiler's job, while deciding whether source is valid is the validator's job.
- Use `@ast-utils` for shared Tao AST traversal and node/document helpers; do not call `Langium.AstUtils` or `Langium.isAstNode` directly from package consumers.
- In compiler codegen, keep `compiler-src/codegen/app/Compile.ts` as the single `Compile` object assembly. Feature compiler files export `Compile<ASTNode>` functions and call recursive codegen through `Compile.<ASTNode>`.
- Keep generated Tao TS minimal. Prefer reusable runtime functionality on default `TR` from `@runtime/TR` (`packages/runtime/TaoRuntime-src/TR.ts`) over emitting helper implementations in generated app files.
- Do not special-case empty iterables before `genJoin` or `genList`; those helpers already emit empty output. Branch only when empty input needs different generated syntax or runtime behavior.
