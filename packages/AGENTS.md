# Working Across Packages

Implement language features as vertical slices. Use the same focused feature name in each participating parser, validator, formatter, source-actions, compiler, and runtime file; do not add empty stages or catch-all modules.

## Ownership

- Put expected Tao semantic and source-shape diagnostics in the validator. Compiler codegen assumes validated input and uses assertions only for local type contraction.
- Compile nodes in source order. Reorder only for validated semantic lowering into a runtime-defined order.
- Use `AST.*` from `@parser` for parser-owned structure and traversal. Put shared semantic helpers in `@ast-utils`; package consumers must not call Langium AST utilities directly.
- Use shared `Switch` helpers for union dispatch instead of native `switch`. Prefer generated `AST.is<Type>` guards for grammar-declared unions.
- Keep `compiler-src/codegen/app/Compile.ts` as the `Compile` assembly. Feature files expose node-named handlers and recurse through `Compile.<Node>`.
- Keep generated TypeScript minimal and move reusable semantics into default `TR` from `@runtime/TR`. The `runtime-codegen` skill owns details.

## TypeScript And Tests

- Use shared wrappers such as `CLI`, `FS`, `HCI`, `Platform`, and `@shared/test` instead of direct platform or test-runner APIs. Loader-constrained config files are the narrow exception.
- Keep each module's public surface focused on one main concept. Export helpers only for real cross-file or package boundaries.
- Prefer behavior tests. Test generated-code changes through Tao AST, validator diagnostics, compilation, or runtime behavior rather than generated TypeScript substring or regex assertions.
- Remove stale comments, code, exports, and instructions encountered within the change scope.
