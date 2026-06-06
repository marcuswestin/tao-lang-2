# Type System Tests

## Purpose

Exercise Tao type-system behavior through a small tile UI that passes typed values into views.
This app must stay valid Tao; invalid type and validation cases belong in validator unit tests.

## Belongs Here

- Text and number literals.
- Aliases whose inferred types are used as view arguments.
- Invocation argument compatibility for view calls.
- Inject arguments that expose typed view values inside injected TS.
- Future custom type declaration examples when they are used to distinguish otherwise similar tile arguments.

## Does Not Belong Here

- Parser-only grammar edge cases without type-system meaning.
- Layout, styling, navigation, data, or action behavior unless it directly supports type-system coverage.
- Runtime standard-library coverage that is better exercised by Kitchen Sink or a dedicated runtime app.
- Invalid or intentionally failing validation cases.

## Edit When

- The Tao type system gains a new value kind that should be demonstrated through view invocation.
- Alias inference or invocation checking behavior changes.
- Custom type declarations become available and should be shown in a small UI scenario.

## Behavior Test Notes

- Behavior automation is not wired yet.
- Expected visible output: `Open: 1` and `Done: 2`.
- Future behavior metadata can live in this section without changing the app layout.
