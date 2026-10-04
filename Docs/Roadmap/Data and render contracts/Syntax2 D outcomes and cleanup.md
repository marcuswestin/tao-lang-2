# Syntax2 D — outcomes and cleanup

Own the outcomes/cleanup workstream under [the program](<Implement Syntax2.md>),
[Decisions](../Tao%20Revolution/Decisions.md), and [ownership](<Syntax2 ownership.md>).
Start in your own worktree from main containing the landed render foundation and this brief;
record the exact base. Run ./agent help and read applicable package instructions before implementation.

## First slice D1

Preserve unknown/open failures through named callers, bound results, contained calls and detached
roots. Publish known cases plus openness; union propagates openness and a handler of known cases
does not silently close an unknown remainder. Preserve explicit declared foreign failure cases.
Bodyless/foreign contracts without an explicit closed bound are unknown, not failure-free.
Infer native bodies when their complete effects are known; a recursive contract must not become
closed merely because traversal encountered its cycle. Use existing AST/source forms for this slice.

Current anchors to verify: effect-outcomes.ts returns [] for dynamic invocations and foreign
contracts with no cases. ActionsCompiler has a direct dynamic unknown check that does not retain
the distinction through a named wrapper. Extend this machinery and all completeness consumers.
Keep old syntax and rollback/savepoint behavior working. Preserve current root warnings until the
subsequent app-guard coverage boundary exists; do not reject unrelated applications prematurely.

Exclusive source paths:

- packages/language/ast-utils/ast-utils-src/effect-outcomes.ts
- packages/language/ast-utils/ast-utils-src/ast-utils.ts (D1 failure-contract exports only;
  return ownership after integration)
- packages/language/validator/validator-src/validators/effect-outcomes-validator.ts
- packages/compiler/compiler-src/codegen/react-native/app/ActionsCompiler.ts
- packages/compiler/compiler-src/codegen/react-native/app/action-control-flow.ts
- packages/apps/runtime/TaoRuntime-src/TR-effect-outcomes.ts
- Feature-specific validation messages beside the owned validator, if required.

Exclusive tests:

- packages/language/validator/validator-tests/effect-outcomes.test.ts
- packages/compiler/compiler-tests/effect-outcomes.test.ts
- packages/apps/runtime/TR-tests/TR-effect-outcomes.test.ts
- packages/language/validator/validator-tests/effect-contracts.test.ts
- packages/compiler/compiler-tests/effect-contracts.test.ts

Request other paths before editing. Type.ts/binding belong to A; grammar, FunctionalCore files,
TR facade, transaction implementation, native ABI/publication and app graduation belong to the
coordinator. Do not modify dependencies/lockfiles. You are not alone in the repository; preserve
other edits. Failure inference is distinct from purity and from the action's result value.

## Acceptance and next slices

Prove open propagation through named and bound calls, partial local handling, known closed cases,
detached roots, recursion and current containment/rollback behavior. Dynamic action failures need
actual runtime coverage where relevant, not only generated string assertions. Keep the existing
joined bound-result contract. Run owned tests via ./agent test-file, then ./agent verify-changed.

Return exact paths/APIs, tests and remaining gaps in at most 700 words. Commit reviewed task paths
on your named feature branch; do not land until the coordinator releases the concrete reviewed slice.
After D1, obtain explicit ownership transfers for actions.langium, ActionsValidator/ActionsFormatter,
TR-action-transactions and corresponding tests. Implement then/done for joined outcomes, native
results, lexical defer/LIFO/all exits and primary versus cleanup-only failures, cancellation,
detached ownership and app guard coverage. The coordinator supplies parser/scoping/export/TR-facade
seams. Keep lexical cleanup distinct from existing rollback-only callbacks and after-commit work.
Mandatory basic failure coverage is required later; advanced static proof/refinement remains deferred.
