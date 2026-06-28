# Test Apps

Test apps are valid, positive functionality examples for implemented Tao behavior.
Parser, compiler, validator, formatter, and diagnostic error cases belong in package unit tests instead.

Each test app lives in its own folder:

```text
Apps/Test Apps/<App Name>/
  <App Name>.tao
  <App Name>.test.tao
```

This README is the contract for each test app. When adding functionality to a test app, update this file first if the new behavior changes the app's scope.

## Layout and App Shell

### Purpose

This app verifies bracketed layout clauses and the default app-shell baseline. `Layout and App Shell.tao` is the executable regression app.

### Belongs Here

- Bracketed layout clauses on render sites, including `content`, `claim`, `gap`, `pad`, `margin`, numeric and `fill` `width`/`height`, `fill`, `hug`, `compress`, `rigid`, `aligned`, and `centered`.
- App-root content that should render inside the safe default Tao app shell.
- Rendered text used by behavior-test assertions for the layout/app-shell smoke path.

### Does Not Belong Here

- Visual style clauses such as `<background ...>`.
- `frame`, `@@content`, named render slots, render IDs, or render elision.
- State, actions, forms, data, navigation, or scroll-container behavior beyond app-shell basics.

### Edit When

- The layout clause vocabulary changes in `Spec/Tao Layout and UI.md`.
- The app-shell baseline changes in the runtime.
- The executable app drifts from the layout/app-shell behavior this fixture is meant to cover.

### Behavior Test Notes

`Layout and App Shell.test.tao` asserts rendered text for the layout/app-shell smoke content. Style-specific behavior is covered in runtime tests for `TR.Layout` and `TR.AppShell`.

## Package Access

### Purpose

Exercise positive behavior for local project package access, package-indexed imports, bare same-package imports across package folders, project-visible imports, and local project metadata.

### Belongs Here

- `project { name "..." remote none license ... }` metadata.
- `use ... from @package/subfolder` where the package folder is nested inside the project.
- Bare `use Foo` for `package` declarations in sibling files, sibling folders, and child folders in the same `@package`.
- `project` declarations imported across indexed local packages.
- Runtime rendering for package-imported views and aliases.

### Does Not Belong Here

- Invalid package-resolution, duplicate-package, or visibility diagnostics.
- External projects, `requires`, install/update/publish commands, remotes, or lockfiles.
- Import aliases such as `use Foo as Bar from @package`.

### Edit When

- Local package resolution or project metadata behavior changes.
- Runtime package import behavior changes in ways that affect valid app execution.

### Behavior Test Notes

- `Package Access.test.tao` renders this app and asserts the visible output.
- Expected visible output:
  - `Package access works`
  - `Package sibling file works`
  - `Package sibling folder works`
  - `Package child folder works`
  - `Project alias works`
  - `Project view works`

## Runtime Stdlib Tests

### Purpose

Exercise positive behavior for runtime-backed `@tao/ui` imports and first stdlib primitives.
This app must stay valid Tao and focus on import/runtime integration rather than parser or validator edge cases.

### Belongs Here

- `use ... from @tao/ui` imports for first stdlib views.
- Runtime rendering for `Text`, `Number`, `Button`, `Box`, `Stack`, `Col`, `Row`, `WrappingRow`, `TextFrame`, and `TextMultiline`.
- A no-op `Button` action binding required by the Button primitive.
- Basic nested stdlib layout/container composition that remains valid and executable.

### Does Not Belong Here

- Type-system-only cases that belong in `Type System Tests`.
- Invalid import visibility/import-path errors; unit tests cover diagnostics.
- Layout/design-style behavior planned for later roadmap slices.
- Stateful interaction behavior beyond the no-op Button binding.

### Edit When

- `@tao/ui` adds or removes first-class runtime primitives.
- Import/package resolution behavior changes in ways that affect valid app execution.
- Runtime-backed stdlib behavior changes for these primitives.

### Behavior Test Notes

- `Runtime Stdlib Tests.test.tao` renders this app, presses the no-op button, and asserts the visible output.
- Expected visible output: `Runtime stdlib smoke`, `3`, `Tap me`, `Label`, and `Wrapped`.

## State Action MVP

### Purpose

Exercise positive behavior for view-local state, named and inline actions, parameters is action, `set`, `do`, compound state updates, state-derived aliases, Button action binding, and reactive rerendering.

### Belongs Here

- `state` declarations inside views.
- Named view-local actions with parameters.
- Inline `action { }` and `-> { }` action values passed to views.
- `set`, compound `set`, and `do` behavior that updates rendered output through user interaction.

### Does Not Belong Here

- Invalid placement or type diagnostics, which belong in package validator tests.
- General event syntax beyond Button action binding.
- `if/else`, `toggle`, functions, booleans, custom types, item/list behavior, or Tao-native `check` syntax.

### Edit When

- State/action syntax changes.
- `@tao/ui` Button action binding changes.
- Runtime behavior for reactive state or state-derived aliases changes.

### Behavior Test Notes

- `State Action MVP.test.tao` renders this app, presses buttons, and asserts visible counter updates.

## Type System Tests

### Purpose

Exercise Tao type-system behavior through a small UI that passes typed values into views.
This app must stay valid Tao; invalid type and validation cases belong in validator unit tests.

### Belongs Here

- Text and number literals.
- List literals.
- Custom type declarations for primitive, list, and item shapes.
- Typed primitive, list, and item constructors.
- Type-fixing with `as`.
- Item member access.
- Aliases whose inferred types are used as view arguments.
- Invocation argument compatibility for view calls, including out-of-order type-based binding.
- Inject arguments that expose typed view values inside injected TS.

### Does Not Belong Here

- Parser-only grammar edge cases without type-system meaning.
- Layout, styling, navigation, data, or action behavior unless it directly supports type-system coverage.
- Runtime standard-library coverage that is better exercised by Kitchen Sink or a dedicated runtime app.
- Invalid or intentionally failing validation cases.

### Edit When

- The Tao type system gains a new value kind that should be demonstrated through view invocation.
- Alias inference or invocation checking behavior changes.
- Custom type declaration, constructor, or member-access behavior changes.

### Behavior Test Notes

- `Type System Tests.test.tao` asserts the visible type-system output.
- Expected visible output includes `Open: 1`, `Done: 2`, `Ada`, `40`, `Compiler engineer`, `types, items, lists`, `Kai`, `29`, `Runtime engineer`, `runtime, mobile`, `People in the team: 2`, `2 team member(s)`, `Grace`, and `Constructed primitive text`.
- Future behavior metadata can live in this section without changing the app layout.
