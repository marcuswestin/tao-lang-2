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

## Collections and Text

### Purpose

Exercise list iteration, string interpolation, and builtin list/text members, including recomputation after state changes.

### Belongs Here

- `for <Name> in <List> { ... }` iteration inside render blocks, including iteration nested in a `when` branch.
- String interpolation of value names and member paths, in view bodies and in view parameters.
- Builtin members: `.Count` and `.Empty` on lists, `.Length` and `.Empty` on text.
- List literals bound with `let`, including an empty list.

### Does Not Belong Here

- Unknown-name or non-scalar interpolation diagnostics, and non-list iteration diagnostics; those belong in validator tests.
- Expressions inside interpolation braces, which the MVP does not support.
- Data-backed collections; those arrive with the data slices.

### Edit When

- Interpolation or iteration syntax changes.
- The builtin member set changes.

### Behavior Test Notes

`Collections and Text.test.tao` asserts interpolated summaries, each iterated row, the empty-list branch, and interpolation inside a parameterized view, then presses `Advance` to confirm interpolated text recomputes.

## Control Flow

### Purpose

Exercise statement-level `when` conditionals: choosing which content renders and which statements run, and reselecting branches as state changes.

### Belongs Here

- `when` render statements inside render blocks, including multi-child branches and a `otherwise -> { }` fallback that renders nothing.
- `when` action statements inside action bodies, including branches that run several statements.
- Conditions built from comparisons, boolean operators, and `let` bindings.

### Does Not Belong Here

- The `when` expression form selecting values; that belongs in the Expressions app.
- Non-boolean condition diagnostics; those belong in validator tests.
- Iteration, forms, data, or navigation.

### Edit When

- `when` statement semantics or totality rules change.

### Behavior Test Notes

`Control Flow.test.tao` asserts which branch content is present and missing at each state, then presses buttons to move between branches and to run conditional action logic.

## Data MVP

### Purpose

Exercise the Tao data layer end to end: schema declarations, entity types, reactive queries, and create/update/delete mutations against the Memory provider.

### Belongs Here

- `data` declarations with `Collection/Entity` pairs, typed fields, `indexed`, `default` values including `now()`, and a bare entity-reference field.
- An app `datasource ... through Memory` binding.
- `query` declarations with `where` and `order`, and query members `.Count` and `.Empty`.
- `create`, `update`, and `delete` mutations, including updates driven by an event clause.
- Entity-typed view parameters and iteration over query results.

- Provider loading and failure surfaces through `run ... with { data loading }` and `{ data failing }`, and the query members `.Loading` and `.Failed`.

### Does Not Belong Here

- Durable storage behavior; `LocalProvider` serialization is covered by runtime tests against an injected key-value store.
- Schema, query, and mutation diagnostics; those belong in validator tests.

### Edit When

- The data schema, query, or mutation syntax changes.
- The provider boundary or store semantics change.

### Behavior Test Notes

`Data MVP.test.tao` starts from an empty collection, creates entries through the form, and asserts that query counts, list rows, and the empty branch update reactively after create, update, and delete.

## Expressions

### Purpose

Exercise the Tao expression language: boolean values, arithmetic, comparison and boolean operators, grouping, and the `when` conditional expression, including recomputation after state changes.

### Belongs Here

- `boolean` state and `true`/`false` literals.
- Arithmetic (`+`, `-`, `*`, `/`), unary minus, decimal literals, and parenthesized grouping.
- Text joining with `+`.
- Comparison (`==`, `!=`, `<`, `<=`, `>`, `>=`) and boolean (`and`, `or`, `not`) operators.
- `when` expressions selecting derived text, including conditions built from other operators.
- `toggle` on boolean state, and derived values recomputing after `set`/`toggle`.

### Does Not Belong Here

- Operand-type and branch-type diagnostics; those belong in validator tests.
- Conditional rendering statements, iteration, interpolation, forms, data, or navigation.

### Edit When

- The operator set or precedence changes in `Spec/Tao Type System.md`.
- `when` expression semantics change.

### Behavior Test Notes

`Expressions.test.tao` asserts rendered values for each operator family, then presses `Advance` and `Flip` to confirm derived aliases and `when` branches recompute from updated state.

## Forms and Events

### Purpose

Exercise interaction events and the form surface: `on` clauses, text input, validation, disabled controls, and the input-oriented test steps.

### Belongs Here

- `on press`, `on change`, and `on submit` clauses on render invocations, including a typed event payload parameter.
- `on press` bound to a container so a whole region is pressable.
- The stdlib `TextInput` view with `Label` and `Placeholder`, and `Button` with `Disabled`.
- Parameters with `default` values, and named arguments through the `Label: "..."` form.
- Validation state derived from input contents, gating both the button and the submit action.

### Does Not Belong Here

- Selector and event diagnostics; those belong in validator tests.
- Data-backed forms; those arrive with the data slices.

### Edit When

- The event vocabulary or event payload types change.
- The stdlib input surface changes.

### Behavior Test Notes

`Forms and Events.test.tao` presses by `label` and `placeholder`, uses `write` and `submit`, and asserts control contents with `expect input ... value ...`, covering the empty/invalid state, typing, submitting, saving through a disabled-guarded button, and pressing a container.

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

## Navigation

### Purpose

Exercise stack navigation: presenting screens with arguments, dismissing them, the automatic back affordance, and state preservation across screens.

### Belongs Here

- `present View(args)` and `dismiss` inside event clauses.
- Screens stacked more than one level deep, unwound one at a time.
- The runtime back affordance, and the `back` test step.
- App-root state that must survive being covered by a presented screen.

### Does Not Belong Here

- Navigation targets, overlays, tabs, split views, and restoration; those remain with the navigation roadmap project.
- Data-backed screens; those belong with the data apps.

### Edit When

- The presentation model or back behavior changes.

### Behavior Test Notes

`Navigation.test.tao` asserts which screen is visible at each step, that covered screens leave the accessibility tree, that a root counter survives a round trip, and that `back`, the back affordance, and an in-app dismiss button all pop one screen.

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
