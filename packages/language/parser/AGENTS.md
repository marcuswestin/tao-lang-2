# Parser and Langium Scoping

Langium lives only inside this package; `packages/AGENTS.md` owns how the rest of the workspace
consumes what it exports.

## Scoping

- `ScopeComputation` indexes symbols after parsing; `ScopeProvider` resolves references during
  linking. Never resolve `.ref` while computing scopes — that belongs in `ScopeProvider.getScope`,
  and reading it earlier can trigger cyclic linking.
- Cross-referenced grammar rules must expose their key as `name`; ignore incomplete recovery nodes
  without real names. Build scope chains nearest-to-farthest: pass the outer scope into
  `createScopeForNodes` so closer declarations shadow it.
- Owners: value scopes (`parser-src/value-scope.ts`), parser service install (`parser-src/parser.ts`), workspace-aware scopes (`packages/compiler/compiler-src/workspace/langium-services.ts`), consumer exports (`parser-src/langium-exports.ts`).
- Test through the parser or validator helpers that build documents, not grammar-only parsing, so
  linking and diagnostics actually run; cover shadowing and out-of-scope behavior.

## Keywords

A grammar keyword never starts with a capital letter: Tao's member, slot, field, and property names
are capitalized, so a capitalized keyword silently forecloses that word as a name everywhere in the
language, including in the Prelude. Parse such a word as `ID` and validate its spelling instead
(`ToastPresentationOptions` in `navigation.langium`, `ForeignViewImplementation`'s `content=ID` in
`views.langium`). The same applies to a lowercase word a design, layout, or test vocabulary already
uses — `primary` and `title` are both parsed as validated words rather than keywords for this reason.
Before adding any keyword, `rg` it across `Apps/`, `packages/apps/stdlib/`, and `Docs/Spec/`.
