# Syntax2 A — names and capabilities

Own the names/capabilities workstream under [the program](<Implement Syntax2.md>),
[Decisions](../Tao%20Revolution/Decisions.md), and [ownership](<Syntax2 ownership.md>).
Start in your own worktree from main containing the landed render foundation and this brief;
record the exact base. Run ./agent help and read applicable package instructions before implementation.
Do not infer unavailable source from another chat's working tree.

## First slice A1

Implement upward-only nominal admission and identity-preserving named signature references using
existing AST/source shapes. Keep raw contextual construction distinct from implicit narrowing.
No argument binds by position: preserve named/exact matching, resolve remaining compatible values
only when unambiguous, and report unmatched/extra values after the maximal valid matching.
Repeated parameter identities are permitted when explicit roles make binding unique. Existing
owner labels may demonstrate this first slice; the later bare/dot role syntax remains required.

Current anchors to verify at your base: Type.ts actualSatisfiesExpectedNominal uses intersecting
chains; ofDefinition's ParameterTypeDeclaration branch synthesizes parameter identity. Replace the permissive admission with
the selected direction. Referencing an existing named type in longhand must retain its identity;
an inline primitive role still creates its scoped nominal type. Extend the current binder rather
than creating a second implementation. Preserve existing inferred results and action resolution.

Exclusive allowed source paths:

- packages/language/ast-utils/ast-utils-src/Type.ts
- packages/language/ast-utils/ast-utils-src/argument-bindings.ts
- packages/language/ast-utils/ast-utils-src/type-binding-matches.ts
- packages/language/validator/validator-src/validators/functions-validator.ts
- packages/language/validator/validator-src/validators/types-validator.ts
- New feature-specific validation message modules beside those validators, if required.

Exclusive tests:

- packages/language/validator/validator-tests/nominal-admission.test.ts
- packages/language/validator/validator-tests/callable-binding.test.ts
- packages/compiler/compiler-tests/callable-binding.test.ts

Request additional existing test/source paths before editing. All shared files in the ownership
manifest, app source, grammar, effects, native bridge, dependencies and lockfiles remain outside
your ownership. D is implementing effects concurrently and may read Type's public API; coordinate
an API change before making its consumers incompatible. You are not alone in the repository.

## Acceptance and next slices

Prove exact and upward admission, rejected downward/sibling admission with an explicit construction
alternative, preserved signature identity, reversed argument order, repeated-type directed roles,
raw literal construction, missing/extra argument diagnostics, and parity for existing callers.
Run each owned test through ./agent test-file, then ./agent verify-changed. Do not weaken unrelated
fixtures to hide a compatibility regression; explain any selected-contract migration to the coordinator.

After A1 is coherent, report the exact changed paths/APIs, test evidence and remaining gaps in at most
700 words. Commit only reviewed task paths on a named feature branch. Do not land until the
coordinator releases that reviewed slice. Continue after the next ownership amendment into private
signature projections/import collisions, associated members/structural can/concrete Self/generics,
owner-elided methods/inferred results and converters. Those are required work, not A1 completion claims.
Function purity and capability failure bounds integrate with D's published contracts; automatic
whole-app effect refinement remains deferred.
