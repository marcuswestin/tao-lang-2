# State Action MVP

## Purpose

Exercise positive behavior for view-local state, named and inline actions, parameters is action, `set`, `do`, compound state updates, state-derived aliases, Button action binding, and reactive rerendering.

## Belongs Here

- `state` declarations inside views.
- Named view-local actions with parameters.
- Inline `action { }` and `-> { }` action values passed to views.
- `set`, compound `set`, and `do` behavior that updates rendered output through user interaction.

## Does Not Belong Here

- Invalid placement or type diagnostics, which belong in package validator tests.
- General event syntax beyond Button action binding.
- `if/else`, `toggle`, functions, booleans, custom types, item/list behavior, or Tao-native `check` syntax.

## Edit When

- State/action syntax changes.
- `@tao/ui` Button action binding changes.
- Runtime behavior for reactive state or state-derived aliases changes.

## Behavior Test Notes

- `State Action MVP.test.tao` renders this app, presses buttons, and asserts visible counter updates.
