# Capability failure refinement

Status: explicitly post-MVP, selected in the S61 design dialogue on 2026-10-04. This task does not
authorize implementation now. Ordinary native body/callee inference and explicit failure bounds
remain the selected baseline; the complete-proof pre-MVP investigation remains A22/R17.

## Need and scope

A structural capability can declare an upper bound or leave its failures unknown. A concrete
implementation may propagate fewer failures. The compiler may eventually prove that an instance
or call site can reach only those implementations and narrow its inferred failure contract.
This improves diagnostics and handler precision without requiring a large bound on every can.

```tao
can Display { ToText() -> text } // Unknown without a declared or inferred contract.
type Title is text with {
   func Title.ToText() fails never -> text { return Title as text }
}
func Show(Value Display) { return Value.ToText() }
// Future specialization: Show(Title "Hello") can be proven not to fail.
// An open Display value still has unknown effects; never silently infer an empty set.
```

Investigate retained concrete method contracts, effect-polymorphic callable summaries, finite
call-target sets, recursive fixed points, mutation/capture invalidation, package boundaries,
incremental builds and foreign declarations. Multiple possible targets require conservative unions;
open/external targets remain unknown unless trusted contracts bound them. Narrowing must respect
capability substitution and must not erase effects simply because a root guard handles them.

One alternative is explicit capability bounds plus ordinary body/callee inference, with no target
analysis. Another is local generic specialization that retains concrete implementation contracts
without whole-program points-to analysis. Compare cost, predictability and useful precision before
choosing the advanced algorithm.

## Completion evidence

Provide positive/negative examples for concrete values, imported implementations, dynamically
selected values, mutable captures, recursive callbacks and unknown foreign targets. Show sound
failure upper bounds, stable diagnostics and cache invalidation. Do not promise exact runtime
failure enumeration or a proof covering arbitrary foreign code.

Context: [A22](<../MVP Roadmap/Agent MVP Roadmap.md#a22--investigate-static-read-and-failure-handling-proofs>),
[R17](<../MVP Roadmap/Developer MVP Roadmap.md#r17--static-data-safety-guarantees>),
[conversion examples](<Data and render contracts/Conversion examples.md>), and
[language decisions](<Tao Revolution/Decisions.md>).
