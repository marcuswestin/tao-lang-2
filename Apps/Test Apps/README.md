# Test Apps

Test apps are valid, positive functionality examples for implemented Tao behavior.
Parser, compiler, validator, formatter, and diagnostic error cases belong in package unit tests instead.

Each test app lives in its own folder:

```text
Apps/Test Apps/<App Name>/
  <App Name>.tao
  <App Name>.test.tao
```

## Navigation MVP

### Purpose

Exercise an app-owned stack whose destinations inherit typed view parameters, with deterministic presentation, state-preserving covered entries, and automatic back behavior.

### Belongs Here

- `stack`, `initial`, and `destination` declarations.
- A root `stack` selected by an `app`.
- `present Stack.Destination(.Parameter Value)` with mandatory parentheses and named typed arguments.
- A covered destination that remains mounted while hidden and restores its local state when revealed.
- The automatic accessible Back control and the test-only `back` step, including returning to the initial destination through the root-safe reducer.

### Does Not Belong Here

- Tabs, split views, overlays, launch-time restoration, routes, deep links, or animated transition policy.
- Invalid destination or argument diagnostics; package tests own those.
- WordFlower-specific data and product behavior.

### Behavior Test Notes

`Navigation MVP.test.tao` increments state on the initial destination, presents a parameterized detail destination, proves the covered screen is hidden, invokes test `back`, and confirms that the exact initial-screen state was preserved.

## Forms and Interaction MVP

### Purpose

Exercise controlled text input, named view arguments, change and submit events, form-button presses, disabled controls, validation feedback, and submitting feedback through executable Tao behavior tests.

### Belongs Here

- `TextInput` and `FormButton` from `@tao/ui`.
- Structural callback contracts: change is `action(text)`; submit and press are `action()`.
- Named invocation arguments such as `Value:`, `Placeholder:`, and `Disabled:`, including standard-control parameter defaults.
- Automatic two-way updates when `Value:` directly references writable text state and no explicit change handler exists.
- `on press|change|submit` with named actions or inline handlers, including the scoped `on change` text payload and explicit override of automatic binding.
- Direct `label`, `id`, and `placeholder` selectors for input entry/submission; direct label/ID button presses; and `expect placeholder "target"` placeholder checks.
- `expect input <label|id|placeholder> "target" value "value"` for controlled native input values.
- Reactive form state, required-field feedback, disabled submit behavior, visible submission progress, and suppression of duplicate presses while submitting.

### Does Not Belong Here

- Durable collections, relationships, filtering, or ordering.
- Navigation and route restoration.
- Invalid invocation, selector, or event diagnostics; package tests own those.

### Behavior Test Notes

`Forms and Interaction MVP.test.tao` proves automatic and explicit controlled-input changes, named and inline event handlers, scoped change payloads, clearing through an inline press, and both keyboard and button submission. It also covers the disabled initial button, reactive validation/progress output, the authored accessible Save label while visible text changes to `Saving…`, and duplicate-press suppression.

This README is the contract for each test app. When adding functionality to a test app, update this file first if the new behavior changes the app's scope.

## Data MVP

### Purpose

Exercise provider-neutral schema declarations and an app-selected isolated Memory datasource through reactive queries and typed entity-handle writes.

### Belongs Here

- A provider-independent `data` schema plus `datasource DataMVP through Memory` in the app.
- `time`, `indexed`, literal defaults, `default now()`, explicit `relation`, and explicit `on delete cascade` schema metadata.
- Reactive `query` values with filtering, ordering, `Loading`, `Error`, and `Empty`.
- Strict action-owned `create`, live entity-handle `update`, and `delete` writes; relation values are entities rather than text IDs.
- Relationship cleanup, empty/populated transitions, and deterministic loading/provider-error test controls.

### Does Not Belong Here

- Remote providers, credentials, authentication, permissions, sync, pagination, or aggregation.
- Navigation or WordFlower-specific product behavior.
- Invalid schema/query/write diagnostics; package tests own those.

### Behavior Test Notes

`Data MVP.test.tao` proves reactive related CRUD and filtering, deterministic loading/error recovery, and explicit cascade behavior by deleting a workspace and its related task. Each check receives a fresh memory store.

## Functional Core MVP

### Purpose

Exercise the executable functional-language core: booleans and `none`, precedence-aware operators, explicit interpolation, expression-bodied pure functions, total conditionals, list iteration, and reactive composition with existing state/actions.

### Belongs Here

- Boolean, absence, arithmetic, comparison, and boolean expressions.
- Positional parenthesized pure-function calls with explicit `returns` types.
- `interpolate` text construction.
- Required-total `when … otherwise` in value, render, and action contexts, plus `for … in` inside render child blocks.
- Reactive branch changes driven by Tao state/actions.

### Does Not Belong Here

- Invalid expression, function, or control-flow diagnostics; package tests own those.
- Input/form events, data queries/mutations, or navigation.
- Additional collection transforms beyond the shipped list members and iteration.

### Behavior Test Notes

`Functional Core MVP.test.tao` checks function/interpolation/absence/iteration output and verifies that a Tao action lazily takes a matching branch, toggles boolean state, and reactively switches total rendered `when` branches.

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

Exercise positive behavior for local workspace package access, package-indexed imports, bare same-package imports across package folders, workspace-visible imports, and local project metadata.

### Belongs Here

- `project { name "..." remote none license ... }` metadata.
- `use ... from @package/subfolder` where the package folder is nested inside the project.
- Bare `use Foo` for `package` declarations in sibling files, sibling folders, and child folders in the same `@package`.
- `project` declarations imported across indexed local packages.
- Runtime rendering for package-imported views and immutable bindings.

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
  - `Project let works`
  - `Project view works`

## Runtime Stdlib Tests

### Purpose

Exercise positive behavior for runtime-backed `@tao/ui` imports and first stdlib primitives.
This app must stay valid Tao and focus on import/runtime integration rather than parser or validator edge cases.

### Belongs Here

- `use ... from @tao/ui` imports for first stdlib views.
- Runtime rendering for `Text`, `Number`, `Button`, `Box`, `Stack`, `Col`, `Row`, `WrappingRow`, `TextFrame`, and `TextMultiline`.
- A no-op `on press` action binding required by the Button primitive.
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

Exercise positive behavior for view-local state, named and inline actions, action parameters and values, `set`, `do`, compound state updates, state-derived immutable bindings, Button press binding, and reactive rerendering.

### Belongs Here

- `state` declarations inside views.
- Named view-local actions with parameters.
- Inline `on press -> { }` action handlers and named action references configured on views.
- `set`, compound `set`, and `do` behavior that updates rendered output through user interaction.

### Does Not Belong Here

- Invalid placement or type diagnostics, which belong in package validator tests.
- Input, submit, or non-Button event behavior, which belongs in Forms and Interaction MVP.
- `when`, `toggle`, functions, booleans, custom types, item/list behavior, or Tao-native `check` syntax.

### Edit When

- State/action syntax changes.
- `@tao/ui` Button action binding changes.
- Runtime behavior for reactive state or state-derived immutable bindings changes.

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
- Typed constructors and invocation type-fixing with `Type: value`.
- Item member access.
- Immutable `let` bindings whose inferred types are used as view arguments.
- Nested render-block `let` declarations that shadow file-level bindings while captured view-level references keep the outer value.
- Invocation argument compatibility for view calls, including out-of-order type-based binding.
- Inject arguments that expose typed view values inside injected TS.

### Does Not Belong Here

- Parser-only grammar edge cases without type-system meaning.
- Layout, styling, navigation, data, or action behavior unless it directly supports type-system coverage.
- Runtime standard-library coverage that is better exercised by Runtime Stdlib Tests or a dedicated runtime app.
- Invalid or intentionally failing validation cases.

### Edit When

- The Tao type system gains a new value kind that should be demonstrated through view invocation.
- Immutable-binding inference or invocation checking behavior changes.
- Custom type declaration, constructor, or member-access behavior changes.

### Behavior Test Notes

- `Type System Tests.test.tao` asserts the visible type-system output.
- Expected visible output includes `Open: 1`, `Done: 2`, `Ada`, `40`, `Compiler engineer`, `types, items, lists`, `Kai`, `29`, `Runtime engineer`, `runtime, mobile`, `People in the team: 2`, `2 team member(s)`, `Grace`, `Constructed primitive text`, `File scope label`, and `Nested scope label`.
- Future behavior metadata can live in this section without changing the app layout.
