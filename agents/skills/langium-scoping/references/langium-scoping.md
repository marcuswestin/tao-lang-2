# Langium Scoping Reference

`ScopeComputation` indexes symbols after parsing. `ScopeProvider` resolves references during linking. Reading `.ref` during computation can trigger cyclic linking.

## Owners

- Local value scopes: `packages/parser/parser-src/value-scope.ts`
- Parser service installation: `packages/parser/parser-src/parser.ts`
- Workspace/package-aware scopes: `packages/workspace/workspace-src/langium-services.ts`
- Consumer-facing Langium exports: `packages/parser/parser-src/langium-exports.ts`

## Precedence

Build nested scopes from closest block aliases through outer blocks, view parameters, and file aliases. Pass the outer scope into `createScopeForNodes` so closer declarations shadow it.

Use parser or validator helpers that build documents. Grammar-only parsing does not exercise reference resolution.
