# Plan - Inject typed TS values

## Goal

Let Tao source bring actual TypeScript values into Tao's value space with declared Tao types, as injection expressions:

````tao
alias PlatformName = inject text ```ts
    return RN.Platform.OS
````

alias DoubleLaunchCount = inject number Count LaunchCount ```ts
return Count * 2

```
```

An `InjectionExpression` is a normal Tao `Expression`: it declares its Tao type (`text` or `number` for now), optionally takes the existing injection argument list to bind Tao values as TS locals, and evaluates the fenced TS function body at runtime.

Type soundness is split across the two type systems:

- Tao/Typir treats the injected value as its declared type, with no TS analysis.
- The generated TS annotates the injected function body with the declared return type, so `tsc` over `_gen_tao-app` (already part of `check`) verifies the claim. A fence whose body does not return the declared type fails repo validation and the dev loop's compile typecheck surface.

## Non-goals

- No TS type _inference_ into Tao. The validator does not parse or type-check TS; the fence stays opaque to Tao. Inference can be added later without changing this syntax.
- No injected function/action/view values. Those wait for function/action types in the Tao type system (state/actions/control slice).
- No re-introduction of `inject file`; fences stay inline.
- No new runtime evaluation semantics: injected values evaluate like other alias values do today (eager module evaluation through `TR.Value`); reactivity is out of scope.

## Assumptions

- Syntax is `inject <PrimitiveType> <InjectionArgumentList?> <TS_CODE_BLOCK>` in expression position, approved by Ro in chat (26-06-11). The fence is a function body and must `return` a value, consistent with render injections.
- Injection expressions are allowed anywhere an `Expression` is allowed (alias values, render arguments, injection argument values). If implementation shows a position should be restricted, the restriction is a validator rule and a Ro decision.
- The render-injection statement grammar (`render inject ...`) is unchanged; only expressions gain the typed form. The parser distinguishes the two by context (statement vs expression position).
- Parser and compiler tests pin the intended syntax directly, so the injection examples land in focused fixtures and test apps before executable Kitchen Sink coverage.
- The old repo has no comparable typed-value-injection feature to port; render-injection mechanics in this repo are the reference.

## Tao code coverage

Add to focused parser/compiler fixtures in step 1, and add to `Apps/Kitchen Sink/Kitchen Sink.tao` in step 3 once it compiles and renders:

- `alias PlatformName = inject text ...` returning `RN.Platform.OS`.
- `alias DoubleLaunchCount = inject number Count LaunchCount ...` returning `Count * 2`.
- `MainView` renders `Text PlatformName` and `CountText DoubleLaunchCount`.

`Apps/Test Apps/Type System Tests/Type System Tests.tao` gains a focused positive slice (injected `text` and `number` aliases used as arguments), with `Purpose.md` updated to name typed injection expressions as in-scope behavior.

## Implementation steps

### 1. Parser: injection expressions

Concrete work:

- Extend `packages/parser/parser-grammar/injections.langium` with an `InjectionExpression` rule: `'inject' type=PrimitiveType argumentList=InjectionArgumentList? tsCodeBlock=TS_CODE_BLOCK`. Reuse `InjectionArgumentList`; do not fork it.
- Add `InjectionExpression` to the `Expression` union in `expressions.langium` and regenerate parser artifacts.
- Parser tests: injected text/number alias values, injected expression with arguments, and injected expression as a render argument. Diagnostics test for a missing type keyword (``alias X = inject ```ts...`` must be a parser error).

Likely commit unit: grammar, generated artifacts, parser tests, and focused fixture updates.

Validation: parser package tests.

Exit criteria: injection examples parse; render-injection statement tests unchanged and green; expression form rejects a missing declared type.

### 2. Validator and type system

Concrete work:

- Typir inference rule in `validator-src/type-system.ts`: `InjectionExpression` infers to its declared primitive type.
- `injections-validator.ts`: duplicate-argument checks apply to injection expressions too (shared with render injections).
- Aliases/invocations need no new rules: declared-type inference makes existing assignability checks work (e.g. passing an injected `text` to a `number` parameter errors).
- Validator tests: injected alias type flows into invocation checking (positive and mismatch cases), duplicate arguments inside an injection expression, and injection expressions inside imported module files validate (workspace-wide validation).

Likely commit unit: typir rule, validator wiring, validator tests.

Validation: validator package tests.

Exit criteria: declared types participate in type checking with stable diagnostics; no TS analysis added to the validator.

### 3. Compiler, runtime behavior, and Kitchen Sink

Concrete work:

- `injections-compiler.ts` gains the expression form, reusing the existing parameter/value compilation: emit the fence as a `Reflect.apply`-invoked function with the declared TS return type annotation (`text` -> `string`, `number` -> `number`), wrapped as a Tao value, e.g. `TR.Value<number>(Reflect.apply(function __injection__(Count: number): number { ... }, undefined, [...]))`. Reuse `CompilePrimitiveJsType`; keep generated code minimal and add a `TR` helper only if the emitted shape repeats beyond this wrapping.
- Compiler tests through compilation success and validation failures, not generated-string assertions; the existing inject-arguments tests extend to expression form.
- Add the implemented injected-value slice to `Apps/Kitchen Sink/Kitchen Sink.tao`; extend `Apps/Test Apps/Type System Tests/Type System Tests.tao` and its `Purpose.md`.
- Runtime e2e: Kitchen Sink renders the injected platform text and doubled launch count (extend the existing Kitchen Sink runtime test expectations).
- Confirm `check`'s `tsc` over `_gen_tao-app` fails when a fence returns the wrong type (manual verification during implementation; keep a compiler test only if it can assert through compile/typecheck behavior rather than string matching).

Likely commit unit: compiler expression support, Kitchen Sink + Type System Tests updates, compiler/runtime tests.

Validation: compiler and runtime tests; `./agent just compile-app 'Apps/Kitchen Sink/Kitchen Sink.tao'`; `./agent just prep`.

Exit criteria: executable Kitchen Sink contains and renders the injected-value slice; mistyped fence bodies fail repo typecheck; generated code stays `TR`-minimal.

### 4. Docs, stale checks, review

Concrete work:

- Update `Roadmap.md` task status; keep this plan current if slices shift.
- Stale-repo check for any instruction or spec text still describing injections as render-only.
- Run `project-6-review-implementation` before merge.

Likely commit unit: docs and cleanup only.

Validation: `./agent just prep`.

Exit criteria: roadmap, Purpose docs, and spec text match implemented behavior; repo passes `prep`.

## Validation summary

- Parser/validator behavior tested through AST and diagnostics; compiler through compile success/failure; app behavior through Kitchen Sink runtime tests.
- The TS side of the type contract is enforced by `tsc --build` over `packages/runtime` (includes `_gen_tao-app`) in `check`/`prep`.

## Deferrals

- TS type inference into Tao (requires TS compiler API in the validation path and a TS->Tao type mapping; revisit when Tao's type universe grows).
- Injected function/action values (waits for function/action types).
- Reactive or lazily re-evaluated injected values.
- Richer declared types (lists, optionals, records) as Tao gains them; the `inject <type>` syntax extends naturally.
