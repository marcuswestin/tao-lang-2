# Type System Tests

## Purpose

Exercise Tao type-system behavior through a small UI that passes typed values into views.
This app must stay valid Tao; invalid type and validation cases belong in validator unit tests.
`Item List Custom Type MVP.tao-next` is the non-executable acceptance sketch for this slice and should mirror the implemented examples in `Type System Tests.tao`.

## Belongs Here

- Text and number literals.
- List literals.
- Custom type declarations for primitive, list, and item shapes.
- Typed primitive, list, and item constructors.
- Type-fixing with `as`.
- Item member access.
- Aliases whose inferred types are used as view arguments.
- Invocation argument compatibility for view calls, including out-of-order type-based binding.
- Inject arguments that expose typed view values inside injected TS.

## Does Not Belong Here

- Parser-only grammar edge cases without type-system meaning.
- Layout, styling, navigation, data, or action behavior unless it directly supports type-system coverage.
- Runtime standard-library coverage that is better exercised by Kitchen Sink or a dedicated runtime app.
- Invalid or intentionally failing validation cases.

## Edit When

- The Tao type system gains a new value kind that should be demonstrated through view invocation.
- Alias inference or invocation checking behavior changes.
- Custom type declaration, constructor, or member-access behavior changes.

## Behavior Test Notes

- Behavior automation is not wired yet.
- Expected visible output includes `Open: 1`, `Done: 2`, `Ada`, `40`, `Compiler engineer`, `types, items, lists`, `People in the team: 2`, `2 team member(s)`, `Grace`, and `Constructed primitive text`.
- Future behavior metadata can live in this section without changing the app layout.
