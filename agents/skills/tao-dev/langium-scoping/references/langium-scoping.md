# Langium Scoping Reference

Langium scoping has two relevant phases:

1. `ScopeComputation` indexes exported and local symbols after parsing.
2. `ScopeProvider` resolves references during linking.

Do not resolve references inside scope computation. Reading `.ref` triggers linking and can create cycles.

## Current Tao Locations

- Value reference scoping lives in `packages/parser/parser-src/value-scope.ts`.
- Parser-owned services install the scope provider in `packages/parser/parser-src/parser.ts`.
- Validator-owned services install the same provider in `packages/validator/validator-src/langium-services.ts`.
- Parser wrapper exports for Langium APIs live in `packages/parser/parser-src/langium-exports.ts`.

## Scope Precedence

Prefer explicit nested scope chains:

1. Closest block-local aliases.
2. Outer block-local aliases.
3. Current view parameters.
4. File-level aliases.

Closer scopes should shadow outer scopes by passing the outer scope into `createScopeForNodes`.

## Test Guidance

- Use parser or validator helpers that build documents so linking runs.
- Parser-only grammar checks are not enough for scoping changes.
- Cover shadowing and out-of-scope diagnostics at the smallest package that owns the behavior.
