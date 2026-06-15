# Runtime Stdlib Tests

## Purpose

Exercise positive behavior for runtime-backed `@tao/ui` imports and first stdlib primitives.
This app must stay valid Tao and focus on import/runtime integration rather than parser or validator edge cases.

## Belongs Here

- `use ... from @tao/ui` imports for first stdlib views.
- Runtime rendering for `Text`, `Number`, `Button`, `Box`, `Stack`, `Col`, `Row`, `WrappingRow`, `TextFrame`, and `TextMultiline`.
- Basic nested stdlib layout/container composition that remains valid and executable.

## Does Not Belong Here

- Type-system-only cases that belong in `Type System Tests`.
- Invalid import visibility/import-path errors (unit tests cover diagnostics).
- Layout/design-style behavior planned for later roadmap slices.
- State/action/control behavior planned for later roadmap slices.

## Edit When

- `@tao/ui` adds or removes first-class runtime primitives.
- Import/package resolution behavior changes in ways that affect valid app execution.
- Runtime-backed stdlib behavior changes for these primitives.

## Behavior Test Notes

- `packages/runtime/runtime-tests/runtime-e2e.jest-test.tsx` renders this app and asserts the visible output.
- Expected visible output: `Runtime stdlib smoke`, `3`, `Tap me`, `Label`, and `Wrapped`.
