# Runtime Stdlib Tests

## Purpose

Exercise positive behavior for runtime-backed `@tao/ui` imports and first stdlib primitives.
This app must stay valid Tao and focus on import/runtime integration rather than parser or validator edge cases.

## Belongs Here

- `use ... from @tao/ui` imports for first stdlib views.
- Runtime rendering for `Text`, `Number`, `Button`, `Box`, `Stack`, `Col`, `Row`, `WrappingRow`, `TextFrame`, and `TextMultiline`.
- A no-op `Button` action binding required by the Button primitive.
- Basic nested stdlib layout/container composition that remains valid and executable.

## Does Not Belong Here

- Type-system-only cases that belong in `Type System Tests`.
- Invalid import visibility/import-path errors (unit tests cover diagnostics).
- Layout/design-style behavior planned for later roadmap slices.
- Stateful interaction behavior beyond the no-op Button binding.

## Edit When

- `@tao/ui` adds or removes first-class runtime primitives.
- Import/package resolution behavior changes in ways that affect valid app execution.
- Runtime-backed stdlib behavior changes for these primitives.

## Behavior Test Notes

- `Runtime Stdlib Tests.test.tao` renders this app, presses the no-op button, and asserts the visible output.
- Expected visible output: `Runtime stdlib smoke`, `3`, `Tap me`, `Label`, and `Wrapped`.
