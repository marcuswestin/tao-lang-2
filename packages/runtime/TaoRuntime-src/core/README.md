# RuntimeCore

`RuntimeCore.ts` is the public `@tao/runtime/core` entry point. It exports host-neutral namespaces
shared by the shipped runtime and tooling; `@shared/core` and `@shared` re-export the same objects.
Keep platform modules and test runners out of this core.

## Arrays

Use `Arrays.sorted(values, compare?)` and `Arrays.reversed(values)` for ordering. Both accept readonly
arrays and return a fresh shallow array, including for empty and single-element inputs. Element
identity is preserved. Without a comparator, sorting follows JavaScript's default string ordering.
The implementation uses builtins supported by the bundled native engine rather than assuming
`toSorted` or `toReversed` is present.

When mutation is intentional, use the explicitly named in-place operation on an owned mutable array.
Repository lint reserves raw `sort`, `reverse`, `toSorted`, and `toReversed` member access for
`Arrays.ts` within shipped runtime source. This is a syntax convention, not whole-program alias
analysis; dynamically computed member names are outside its coverage.

## Effects

`Effects.createSession` owns deterministic clock/random state with an injected clock. Independent
sessions share no mutable global state. Host adapters and runtime scheduling live outside this core.
