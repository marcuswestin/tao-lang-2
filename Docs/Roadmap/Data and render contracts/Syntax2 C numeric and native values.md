# Syntax2 C — numeric and native values

Own numeric/native quantities under [the program](<Implement Syntax2.md>),
[Decisions](../Tao%20Revolution/Decisions.md), and [ownership](<Syntax2 ownership.md>).
Start in your own worktree from main containing the landed render foundation and this brief;
record the exact base. Run ./agent help and applicable instructions.

## First deliverable C0

Prepare a concrete checked-quantity/native contract prototype and migration evidence. This is
useful parallel preparation; it is not a claim that Tao arithmetic or factories are implemented.
The current runtime exposes evaluate/jsValue and erases number-backed nominal values at foreign
boundaries. A1 nominal admission alone does not supply the checked factory/member contract.

Own packages/apps/runtime/.scratch/syntax2-quantity-contract.ts and task-local artifacts in your
worktree. Use the existing runtime value/failure machinery. Demonstrate canonical finite binary64
backing, signed Duration seconds, selected-unit views, normalization exactly once, canonical equality,
Ratio unity/percent, same-domain arithmetic, scaling in both operand orders and modeled invalid-result
failures. Do not build a competing static type registry, unchecked adapter wrappers, or a helper
that only tests its own invented representation. Show the intended integration with generated
type factories/fromJSValue and getJSValue, including an actual native consumer boundary.

Map legacy lowercase duration explicitly: it currently has nanosecond backing consumed by timers,
Interval, toast/cache/poll windows and tests. New Duration seconds must not silently reinterpret
those values. Demonstrate an explicit adapter conversion and retained legacy result.

Return a reviewable minimal ABI, exact source ownership request, prototype commands/results,
one positive round trip, negative nonfinite/invariant examples, and the legacy migration boundary
in at most 1,000 words. Do not commit scratch or land. End C0 at this evidence/contract handoff and
wait for the coordinator's executable seam/ownership release; no broad new language decisions.

## Required implementation after C0

The proposed quantity runtime owner is packages/apps/runtime/TaoRuntime-src/TR-quantity-values.ts,
with TR-tests/TR-quantity-values.test.ts. Production ownership is released after the ABI review,
not implicitly granted by this proposal. The coordinator wires the TR facade, bridge metadata and
.tao-ts publication; A supplies nominal/member/operator admission; D supplies computational failure
inference. Preserve publication ownership and live-handle contracts from the shared manifest.

C0's runtime/cell/native contract was reviewed on 2026-10-04. C1 may implement and independently
review those two runtime paths, retaining existing wrappers and modeled failure machinery. The
coordinator then supplies accessor/facade and declaration-owned factory publication. C1's final
acceptance includes that integrated bridge evidence; a runtime-only commit is its first prerequisite,
not completion of the generated native contract. Exact parser/stdlib ownership remains unreleased.

Then implement numeric/number/scalar contracts, explicit operators/converters, unit declarations
and postfix constructions, checked factories/accessor, Duration/Ratio and selected Wait/timer APIs.
Request exact parser/validator/formatter/compiler/stdlib paths before each slice. Preserve concrete
Self domains and leftmost/sole quantity view; sibling units/types do not become implicitly comparable.
Bare scalar values, ambiguous unit names, nonfinite results and implicit narrowing must reject.
Broader time/calendar and localized core text remain deferred.

For C1, acceptance includes actual generated native factory round trips, canonical accessor values,
view persistence without renormalization, modeled bad shape/nonfinite/invariant failures, and
unchanged legacy timing behavior. A detached helper with only self-tests cannot complete C1.
Commit reviewed production paths and run focused plus required gates when released. The coordinator
controls landing of each reviewed slice. You are not alone in the repository; preserve other owners.
