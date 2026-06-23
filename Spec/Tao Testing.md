# Tao Testing

Status: design draft with an initial v0 implementation in progress. The current repo has package tests, an Expo runtime render harness, and a minimal Tao-native app smoke-test slice: `test`, `check`, `run <AppName>`, `expect text`, `expect missing text`, test-plan IR, and `tao test [path]`. It does not have `render` test subjects, state/action test steps, datasource test seeding, provider test adapters, or the richer CLI options described below yet.

This design starts with app and UI behavior tests. Tests can live in regular `.tao` files or sidecar `.test.tao` files. Package testing is deferred until Tao package semantics and app/UI testing are stable.

## Goals

- Tao users write automated tests in Tao.
- Tests can sit inline in regular app/source files for focused checks, or in sidecar `.test.tao` files for larger suites.
- A `test` declaration groups related checks and shared test-only declarations.
- A `check` declaration is the runnable unit. It launches an app with `run` or mounts focused UI with `render`, then performs assertions and user actions.
- Checks exercise the app or rendered UI the way a user does: by reading rendered text, focusing inputs, writing text, pressing controls, navigating, and observing rendered results.
- Checks may declare the starting world through app variants, `run ... with { ... }`, or `render ... with StateName Value`, but they do not inspect internal state, inspect provider rows, or call app actions directly.
- The default runtime reuses this repo's Expo runtime test harness, so tests exercise the same app host used by runtime integration tests.
- The same compiled test plan can later run in web, iOS, Android, headless, or device/simulator modes through runtime adapters.
- Test flows use Tao-like syntax, not JSON.

Non-goals for the first testing design:

- No package unit-test syntax.
- No value-level assertions over Tao functions, aliases, state, or provider internals.
- No direct action invocation as a test step.
- No generated TypeScript or React component inspection.
- No default connection to real production datasources.
- No Tao-owned in-memory datasource provider or automatic datasource row seeding in the first testing design.
- No clock or time-control syntax in the first testing design.

## Roadmap Alignment

The roadmap asks for datasource injection, initial data, actions, and checks. This spec answers that through app/capability selection, inline app overlays, focused render setup, user-driven UI actions, and rendered-behavior checks.

That is an intentional v1 choice, not an accidental omission. A check can select a staging or test datasource because it needs a starting world, but it verifies behavior through the rendered app surface. Direct action invocation, direct state assertions, datasource row seeding, and value-level Tao tests may become separate lower-level testing surfaces later, especially for packages or pure declarations. App and UI e2e tests should stay user-observable.

## Writing Tests

Tests are `test` declarations containing one or more `check` declarations. The `test` is a suite-like lexical scope; the `check` is the independent runnable case.

```tao
test "optional description" {
   alias Foo "ASD"

   check "optional description" {
      render ViewName Foo, Cats 1 with UserName "Henry" { }

      expect text "Henry has 1 cat"
      press text "Add cat"
      expect text "Henry has 2 cats"
      press text "Henry"
      write " Andersson"
      press text "Add cat"
      expect text "Henry Andersson has 2 cats"
   }

   app AppNameStage = AppName with {
      datasource {
         appId "r112d22-stage"
      }
   }

   check "ABC XYZ" {
      run AppName with {
         datasource.appId "r112d22"
         theme DarkTheme
      }

      expect text "..."
   }

   check "QWEQWE" {
      run AppNameStage

      expect text "..."
   }
}
```

Some things to notice:

- `alias Foo "ASD"` and `app AppNameStage = ...` are test-local helper declarations visible to checks in the same `test`.
- Each `check` starts its own app or focused render subject. Checks do not share runtime state.
- `render ViewName Foo, Cats 1 with UserName "Henry" { }` mounts `ViewName` with normal view parameters and a state override. `ViewName` must declare `UserName` as state; the override does not create new state.
- `run AppName with { ... }` launches a one-off app expression without requiring a named staging app.
- `run AppNameStage` launches a named app variant declared by applying `with { ... }` to an app object.
- `expect text "..."`, `press text "..."`, `write "..."`, and later focused selectors operate through rendered UI and accessibility-visible behavior.

The test runner should report each check with enough context to identify the suite, check, launch subject, and result. A focused render check can be displayed in a shape like:

```text
test "optional description" check "optional description" render ViewName Foo, Cats 1 with UserName "Henry" { } passed
```

Inline tests share the file's normal scope and are stripped from app builds and publishes:

```tao
app RuntimeStdlibTests {
   view MainView
}

view MainView {
   render Text "Runtime stdlib smoke"
}

test "Runtime stdlib" {
   check "renders smoke text" {
      run RuntimeStdlibTests
      expect text "Runtime stdlib smoke"
   }
}
```

Larger suites can live in sidecar `<Name>.test.tao` files:

```text
Apps/Test Apps/TODOs/
  TODOs.tao
  TODOs.test.tao
  Purpose.md
```

```tao
use TODOs from ./

app TODOsTest = TODOs with {
   datasource {
      appId "local-empty-todos"
   }
}

test "TODOs" {
   check "adds a task" {
      run TODOsTest

      expect text "TODOs"
      press label "New task title"
      write "Buy oat milk"
      press text "Add next task"
      expect text "Buy oat milk"
      expect input label "New task title" value ""
   }
}
```

Rules:

- `test` declarations in regular `.tao` files are removed from app builds and publishing.
- `.test.tao` files are excluded from app builds and publishing entirely.
- Regular app/source files cannot import declarations from `.test.tao` files.
- Sidecar test files see what their location sees through normal Tao visibility rules.
- Sidecar imports reference folders, not `.tao` filenames, just like package imports.
- Declarations inside a `test` are test-only and are not exported to app code.
- A `check` must start exactly one subject with `run` or `render` before it performs actions or assertions.
- Each check launches a fresh app/subject instance and fresh runtime capabilities.

## App And Expression Overrides

Datasource-backed tests need a cheap way to make a test app variant without copying the whole app declaration. The broader Tao language should support structural extension for item declarations and item expressions with `with`:

```tao
app TodoStaging = TodoApp with {
   datasource {
      appId "staging-app-id"
   }
}
```

This creates a new app from `TodoApp`, then applies the overlay. Only `datasource.appId` changes; every other app, datasource, theme, nav, permission, and UI property inherited from `TodoApp` is preserved.

This should not be app-specific. The same `Base with { ... }` expression should work anywhere Tao accepts an item expression:

```tao
theme StagingTheme = AppTheme with {
   colors {
      danger "#cc0033"
   }
}

datasource TodoLocalDatasource = TodoDatasource with {
   appId "local-test-app-id"
}

app TodoLocal = TodoApp with {
   datasource TodoLocalDatasource
}

app TodoLocalInline = TodoApp with {
   datasource TodoDatasource with {
      appId "local-test-app-id"
   }
}
```

Draft overlay rules:

- `kind Name = Base with { ... }` declares a new item of the same kind as `Base`.
- `Base with { ... }` produces an expression value of the same type as `Base`.
- Scalar properties named in the overlay replace the inherited scalar value.
- Nested item/object blocks merge recursively with the inherited nested value.
- Dot-path assignments can update nested scalar properties in inline overlays, such as `datasource.appId "r112d22"`.
- A nested property can still be replaced wholesale by naming a different item expression, such as `datasource TodoLocalDatasource`.
- Overlay fields are typechecked against the target item type; unknown fields are diagnostics.
- List and collection merge semantics are deferred. Until explicit append/remove syntax exists, list-like properties should replace as a whole.
- Overlays do not mutate the base item.

Testing should rely on this general language feature rather than inventing test-only app patching.

## Running And Rendering

A `check` launches its subject with either `run` or `render`.

`run` starts a full app from its normal root:

```tao
test "full app behavior" {
   check "starts on todo dashboard" {
      run TODOsTest

      expect text "TODOs"
   }

   check "uses a one-off datasource override" {
      run TODOs with {
         datasource.appId "local-empty-todos"
      }

      expect text "TODOs"
   }
}
```

The `run ... with { ... }` block is an app expression overlay. It is useful when a check needs a one-off datasource, theme, locale, permission, or runtime capability override. For repeated setup, declare a named app variant and `run` that name.

`render` mounts a focused Tao subject directly. This matters because many useful UI states are awkward to reach through a full app, such as uncommon error banners, empty-state cards, disabled controls, or narrow layout variants.

```tao
test "focused UI behavior" {
   check "renders validation message" {
      render ViewX ParamA "abc", ParamB "asd" { }

      expect text "asd"
   }

   check "disabled save button ignores presses" {
      render SaveControls ItemId "task-1" with CanSave.false { }

      expect text "Save"
      press text "Save"
      expect missing text "Saved"
   }

   check "task row renders staging data" {
      render TaskRow TaskId "task-1" using app TodoStaging { }

      expect text "Book dentist"
   }

   check "field row layout renders supplied controls" {
      render FieldRow {
         Text "Email"
         TextInput Email
      }

      expect text "Email"
   }
}
```

Render rules:

- `render` uses the same Tao invocation shape as normal render code. The test language should not invent a separate parameter grammar.
- If Tao accepts commas in render call sites, `render` checks should accept the same comma style.
- `render <ViewName> <params> with <StateOverride>, ... { }` sets initial state for the mounted subject.
- State overrides must name existing state declarations on the rendered subject or its focused runtime context. They do not create new state.
- The render block supplies child UI or named slot fills when the subject accepts them. An empty block is valid when there are no children or slots.
- A focused render gets a minimal app shell and can optionally name an app capability context with `using app <AppName>`.
- If no app context is named, the test runner supplies the default test shell, theme, strings, and empty/no-op capabilities that the subject can legally render without.
- Focused render checks are still black-box UI tests: assertions target rendered output and accessibility-visible state, not internal values.

This gives package-like confidence without introducing package unit tests. A package can test exported `view`, `layout`, `screen`, or `nav` declarations through a focused render subject. If a full harness app is needed, it should live at a project root, because package folders cannot declare apps.

## Data And Datasource Setup

Testing should keep Tao's schema model separate from provider configuration:

```tao
data TodoData {
   Task, Tasks {
      Title text
      Done text
      Ordering number
   }
}

datasource TodoDatasource {
   data TodoData
   provider InstantDB

   appId "prod-app-id"
}

app TodoApp {
   datasource TodoDatasource
   view TodoMain
}

app TodoStaging = TodoApp with {
   datasource {
      appId "staging-app-id"
   }
}

test "Todo datasource behavior" {
   check "runs against staging" {
      run TodoStaging

      expect text "TODOs"
   }

   check "runs against a local app id" {
      run TodoApp with {
         datasource.appId "local-test-app-id"
      }

      expect text "TODOs"
   }
}
```

Draft meanings:

- `data` declares items, properties is item, and item relationships.
- `datasource` selects the data schema and says how that schema is fetched, written, watched, authenticated, and configured.
- `app` selects the datasource capability it should run with.
- A check targets the app or app variant whose datasource configuration is appropriate for the test.

For now, `tao test` should not implement a Tao-owned in-memory provider. This keeps the first testing implementation closer to the current Expo runtime and avoids designing a fake provider before Tao's real datasource contract exists.

Consequences:

- Datasource checks are integration-style checks against an explicitly configured datasource, such as a local provider, staging app id, or test account.
- A datasource-backed check should target a named test, staging, or local app variant, or use an explicit `run App with { datasource... }` override. Running tests against production configuration should require explicit opt-in.
- CI must provide the named datasource configuration or skip those checks.
- Isolation, cleanup, setup row creation, and provider reset are provider/test-environment responsibilities for now.
- Future Tao-owned datasource seeding can still be added later, but it should build on the real `data` and `datasource` declarations instead of a separate test-only row DSL.

## Acting

Test steps simulate user behavior. They run in source order. After each action, the runner waits for Tao state, rendering, datasource updates, and known runtime work to settle before continuing.

V1 action steps:

```tao
press text "Add next task"
press label "New task title"
press placeholder "Search"
press id AddTaskButton

write "Buy oat milk"
clear
submit

back
scroll until text "Archived tasks"
```

Rules:

- `press` targets a rendered interactive element through an explicit selector. It does not call a Tao action by name.
- `press text "..."` targets a user-visible interactive element by exact rendered or accessible text.
- `press <input selector>` focuses an input.
- `write "..."` writes into the currently focused editable control.
- `clear` clears the currently focused editable control.
- `submit` submits the currently focused editable control or form when the runtime supports it.
- `back` uses the runtime's normal back/navigation behavior.
- `scroll until <selector>` scrolls through the rendered surface until a selector is rendered or the assertion timeout expires.
- Tests do not use sleeps. Waiting is modeled through auto-waiting assertions and runtime settling.

The older `type "..." into ...` shape is understandable, but `press <input selector>` followed by `write "..."` is more consistent with how users interact with apps: focus a control, then type. It also composes better with keyboard behavior, selection, replacement, and multi-step editing later.

## Selectors

Selectors should prefer what users perceive, but a real UI also needs stable ways to target repeated controls, icon-only controls, and translated copy.

V1 selector priority:

- Text for simple smoke tests and copy-sensitive behavior.
- Label for inputs and form controls.
- Placeholder when there is no label.
- Stable render ID as a last resort.

Examples:

```tao
expect text "TODOs"
expect missing text "Loading tasks..."

press text "Add next task"
press label "New task title"
press placeholder "Search"
press id NameInput
```

Text selectors are explicit in v1. There is no bare `press "..."` or bare `expect "..."` shorthand in this design, because bare strings become ambiguous once label, placeholder, role/name, id, and i18n selectors exist.

Future selector capacity should include role/name and accessibility-state queries once Tao owns that mapping:

```tao
press role button name "Save"
expect checkbox label "Complete" checked
expect button "Save" disabled
```

Those selectors require the Tao stdlib and runtime components to emit platform accessibility metadata such as React Native roles, accessible names, labels, and states. The compiler should pass through declared labels and render IDs; it should not guess arbitrary accessibility roles from syntax. The validator should report role/state selectors that the selected runtime or component cannot support.

### Render IDs

Unique strings are a good start, and they are straightforward to map to React Native Testing Library test-id queries. They are not enough when the same string appears several times, when text is translated, or when an element has no text.

The spec should add a render-id syntax that compiles to React Native `testID` and any equivalent runtime selector metadata.

Candidate syntaxes:

```tao
NameInput: TextInput Name
@NameInput TextInput Name
TextInput Name @NameInput
TextInput Name: NameInput
TextInput Name {
   id NameInput
}
TextInput Name [id NameInput]
```

Recommended direction: use a render ID prefix for authored Tao UI, and compile it to runtime test/accessibility identifiers:

```tao
NameInput: TextInput Name
SaveButton: Button "Save", Save
```

Then tests target it explicitly:

```tao
press id NameInput
write "Ro"
expect input id NameInput value "Ro"
press id SaveButton
```

Why this shape:

- It gives a rendered node an ID without adding a child block solely for metadata.
- It keeps render IDs outside layout/style brackets.
- It avoids overloading `@icon` / `@row` named slot syntax.
- It is easy to lower to React Native `testID`.
- It reads well for repeated rows and icon-only controls.

The `@NameInput:` family is worth revisiting if Tao settles on `@` for all named render-surface concepts. Old render-slot work uses `@icon` and `@row` for supplied UI holes, so using plain `NameInput:` for element IDs keeps a useful distinction: `@name` means a slot, `Name:` means this rendered node has a stable ID.

### Selectors, I18n, And Specificity

Text selectors are best for smoke tests and user-facing copy tests. They are weaker for translated UI and repeated strings.

For i18n-heavy apps, tests should prefer:

- Role/name when the accessible name comes from localized copy and the test runs in a fixed locale.
- Label selectors for form controls.
- Render IDs for behavior tests that should not fail when copy changes.
- Future string-key selectors if Tao strings become first-class app capabilities, such as `expect text string .tasks.EmptyTitle`.

Action targets and value/state assertions must match exactly one rendered node. `expect text` passes when at least one node matches, and `expect missing text` passes when no node matches. Tests that need to distinguish repeated copy should narrow by label, containing region, row identity, or render ID. Later, explicit count or uniqueness assertions can be added without changing the default selector model.

### Matching Semantics

Text selectors should be exact, case-sensitive, and normalized by default:

- Leading and trailing whitespace are ignored.
- Internal whitespace is collapsed to a single space.
- Matching is not substring matching unless a future `contains` or pattern form says so.
- Text matches a rendered text node or a runtime-owned accessible name, not arbitrary concatenation across unrelated nodes.
- Composite stdlib controls such as buttons may expose an accessible name derived from their rendered label.

This gives predictable matching for early Test Apps. Regex, substring, locale string-key, and count assertions can be added later as explicit syntax.

## Render Slots And Render IDs

Named render slots still need their own spec. This testing spec only owns the boundary between render slots and render IDs.

Render slot direction from old repo work:

```tao
view Button Label is text, Press is action {
   Row {
      @icon
      Text Label
}  }

Button "Foo", Save {
   @icon Image SaveIcon
}
```

Render IDs name concrete rendered nodes:

```tao
NameInput: TextInput Name
SaveButton: Button "Save", Save
```

The distinction:

- `@icon` declares, invokes, or fills a named hole in a view's render surface.
- `NameInput:` assigns a stable ID to the concrete node produced at that render site.
- `press id NameInput` targets the concrete rendered node.
- `press id SaveButton` targets the whole labeled button, not any internal or slotted child.

This gives tests stable handles without making slots double as test IDs.

## Verifying

Every verification is an `expect` step.

V1 assertions:

```tao
expect text "TODOs"
expect missing text "Loading tasks..."

expect id EmptyState
expect missing id LoadingSpinner

expect input label "New task title" value ""
expect input id NameInput value "Ro"
```

Future element-state assertions:

```tao
expect button "Add next task" enabled
expect button "Save" disabled
expect checkbox label "Complete" checked
```

Rules:

- `expect text "..."` asserts that exact normalized text or an exact normalized accessible name exists in the rendered tree.
- `expect id <Name>` asserts that a render ID exists in the rendered tree.
- `expect missing <selector>` asserts that a selector does not exist in the rendered tree.
- Rendered does not mean viewport-visible. A node can be rendered outside a small viewport or below the scroll position.
- `expect visible` should be a later, stricter assertion for viewport/screen visibility when Tao owns that runtime distinction.
- `expect input ... value ...` asserts the current value exposed by an input control.
- `expect button`, `expect checkbox`, and later element assertions depend on runtime accessibility-visible state.
- There is no public `expect Count = 1`, `expect TodoData.Todos.count = 2`, or `expect app.nav.screen = Detail` in this design.

To test state, data, or navigation, render the result in the app:

```tao
test "Counter app" {
   check "increments launch count" {
      run CounterApp

      expect text "Launch count: 0"
      press text "Launch"
      expect text "Launch count: 1"
   }
}

test "TODOs navigation" {
   check "opens task detail" {
      run TODOsTest

      expect text "Buy oat milk"
      press text "Buy oat milk"
      expect text "Task detail"
      expect text "Buy oat milk"
      expect missing text "Open tasks"
   }
}
```

Alternative assertion names considered:

- `expect rendered "..."`: technically accurate for the rendered tree, but it hides the selector kind and competes with `render` as the subject-launching step.
- `expect visible "..."`: good later when viewport visibility is implemented, but too strong for v1 rendered-tree assertions.
- `expect exists "..."`: technically accurate but less UI-oriented.
- `expect present "..."`: readable, but less specific than text/id/input selectors.
- `expect not text "..."`: explicit inverse, but `expect missing text "..."` generalizes cleanly to all selector kinds.

## Auto-Waiting And Determinism

Assertions and actions auto-wait by default.

- Before a press, the target must exist, be rendered, be enabled, and be actionable for the selected runtime.
- Before writing, an editable control must be focused and editable.
- `expect text` and `expect missing text` retry until they pass or time out.
- The runner waits for known Tao runtime work after each action, such as React updates, Tao state propagation, datasource provider flushes, and navigation completion.
- Waiting uses the real test runner timeout and event-driven settling or short rendered-tree retries. There is no sleep step and no v1 virtual clock to advance.
- Each check runs with a fresh app/subject instance and reset runtime capabilities.
- Datasource state comes from the configured datasource; provider cleanup or reset is outside the v1 runner unless a provider-specific integration environment adds it explicitly.

This follows the useful behavior of modern UI test tools: retrying assertions, realistic user events, semantic selectors, and runtime synchronization instead of sleeps.

## CLI

`tao test` is the user-facing test command.

```sh
tao test
tao test Apps/Test\ Apps/TODOs
tao test Apps/Test\ Apps/TODOs/TODOs.test.tao
tao test --grep "adds a task"
tao test --watch
tao test --json
tao test --fail-fast
tao test --runtime=expo
```

CLI behavior:

- `tao test [path]` discovers inline `test` declarations and `.test.tao` files under the project or path.
- `--runtime=expo` is the default and uses this repo's Expo runtime test harness.
- Future explicit runtimes include `web`, `ios`, `android`, `headless`, and device/simulator modes.
- `--grep` filters by test name, check name, or full `test > check` display path.
- `--watch` reruns affected checks.
- `--json` emits machine-readable results for CI and editor integrations.
- `--fail-fast` stops after the first failing check.
- Failure output includes the test name, check name, failing step, source location, selected runtime, rendered UI summary, and artifacts where the runtime supports them.

The current v0 implementation exposes `tao test [path]` for Tao files with inline or sidecar test declarations. It still delegates execution to the runtime Jest harness; richer CLI filtering, watch mode, JSON output, artifacts, and alternate runtimes remain future work.

## First Implementation Slice

This spec should not block useful Test App coverage on the full CLI and runtime-adapter design. The first repo slice can be much smaller:

- Parse a minimal test subset: inline `test`, sidecar `.test.tao`, nested `check`, `run <AppName>`, `expect text`, and `expect missing text`.
- Compile those checks to a small test-plan IR with source locations.
- Execute app-subject checks through the existing Expo runtime Jest harness in `packages/runtime/runtime-tests/test-compile-app.tsx`, especially `compileAndRenderApp` and `testCompileApp`.
- Defer `render`, `run ... with { ... }`, input actions, datasource-specific setup/reset, focused non-app subjects, and richer `tao test` options until after rendered smoke checks are running for `Apps/Test Apps/*`.

That path lets Test Apps start gaining Tao-authored behavior checks while preserving the broader design.

## Runtime API

The compiler should lower test declarations into a structured test plan, then runtime adapters execute that plan.

Internal adapter shape:

```ts
type TaoTestRuntimeAdapter = {
  launch(args: TaoTestLaunchArgs): Promise<TaoTestSubjectHandle>
  perform(handle: TaoTestSubjectHandle, step: TaoTestActionStep): Promise<void>
  assert(handle: TaoTestSubjectHandle, step: TaoTestAssertionStep): Promise<void>
  reset(): Promise<void>
  artifacts?(handle: TaoTestSubjectHandle, failure: TaoTestFailure): Promise<TaoTestArtifact[]>
}
```

The exact TypeScript shape can evolve during implementation, but the ownership boundary should stay stable:

- The compiler emits a test-plan IR, not executable test runner logic.
- Runtime adapters own launch, input, assertions, settling, reset, and artifacts.
- The default adapter uses the repo's Expo runtime test harness.
- A headless adapter from the old repo remains useful as an optional future target, but it should not be assumed to be faster or more meaningful than the Expo harness.
- Web and native adapters execute the same test-plan IR through platform-specific selectors and events.

## Compiler And Test IR

A compiled check should produce structured data:

- Suite name and source location.
- Check name and source location.
- Test-local helper declarations needed by the check.
- Launch subject: `run` app expression or focused `render` invocation.
- Initial render state overrides when present.
- Runtime requirements.
- Ordered action/assertion steps.
- Selector descriptions.
- Assertion descriptions.
- Source locations for launch and steps.

The IR should avoid embedding implementation details such as generated React component names, provider internals, or raw TypeScript assertions.

Example conceptual IR:

```ts
{
  suiteName: "TODOs",
  checkName: "adds a task",
  launch: { kind: "run", app: "TODOsTest" },
  steps: [
    { kind: "assertText", text: "TODOs", source: "TODOs.test.tao:10" },
    { kind: "press", selector: { label: "New task title" }, source: "TODOs.test.tao:11" },
    { kind: "writeText", value: "Buy oat milk", source: "TODOs.test.tao:12" },
    { kind: "press", selector: { text: "Add next task" }, source: "TODOs.test.tao:13" },
    { kind: "assertText", text: "Buy oat milk", source: "TODOs.test.tao:14" },
    { kind: "assertInputValue", selector: { label: "New task title" }, value: "", source: "TODOs.test.tao:15" },
  ],
}
```

Source locations in this IR are illustrative. Implementations should carry precise file, line, and column information from the parsed check steps.

## Test Apps Path

`Apps/Test Apps/*/Purpose.md` remains the contract for each test app.

When Tao-native behavior tests exist, `Behavior Test Notes` should name the inline tests or sidecar `.test.tao` file and summarize the rendered behavior asserted by them:

```md
## Behavior Test Notes

- `Runtime Stdlib Tests.test.tao` runs through `tao test`.
- It asserts rendered text for `Runtime stdlib smoke`, `3`, `Tap me`, `Label`, and `Wrapped`.
```

Initial target examples:

```tao
// Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.test.tao
use RuntimeStdlibTests from ./

test "Runtime stdlib primitives" {
   check "renders first runtime stdlib primitives" {
      run RuntimeStdlibTests

      expect text "Runtime stdlib smoke"
      expect text "3"
      expect text "Tap me"
      expect text "Label"
      expect text "Wrapped"
   }
}
```

```tao
// Apps/Test Apps/Type System Tests/Type System Tests.test.tao
use TypeSystemTiles from ./

test "Type system tiles" {
   check "renders typed tile values" {
      run TypeSystemTiles

      expect text "Open: 1"
      expect text "Done: 2"
   }
}
```

Future target examples:

- A state/actions test app presses buttons and asserts rendered counters.
- A datasource app targets a named local/staging datasource, creates or updates rows through the UI, and asserts rendered rows.
- A navigation app presses user-visible links and asserts the destination screen content while prior content is missing.
- Focused `view` and `layout` checks render rare UI states directly, instead of forcing the full app through awkward setup paths.

## Package Testing

Package testing is deferred.

When package testing is designed, the preferred starting point is focused subject testing, with project-root harness apps as a fallback:

- A package test imports package declarations.
- The check mounts an exported `view`, `layout`, `screen`, or `nav`.
- A full harness app, when needed, is declared from a project root that imports the package, not inside the package folder itself.
- The user drives that subject through rendered UI behavior.
- Assertions remain rendered-behavior-only.

Standalone value-level Tao package assertions may be considered later, but they are not part of this app/UI testing spec.

## Prior Art

The design borrows these stable ideas from existing UI testing systems:

- Playwright: locators, actionability checks, and retrying assertions.
- React Native Testing Library: render/query/user-event primitives for testing React Native UI by user-visible output.
- Maestro: readable ordered flows, `tapOn`, `assertVisible`, and automatic retrying.
- Detox: native app e2e through element matchers, actions, and expectations.
- The old Tao repo: scenario adapters proved that one ordered app-flow model can run against headless and Expo-like runtimes, but this spec replaces JSON scenarios with Tao-native `test` and `check` syntax.
- Old Tao named-render work: `@slot` syntax is valuable for render holes; render IDs should complement it instead of overloading it.

References:

- [Playwright assertions](https://playwright.dev/docs/test-assertions)
- [React Native Testing Library API](https://callstack.github.io/react-native-testing-library/docs/api)
- [RNTL User Event](https://callstack.github.io/react-native-testing-library/docs/api/events/user-event)
- [Maestro assertVisible](https://docs.maestro.dev/reference/commands-available/assertvisible)
- [Maestro tapOn](https://docs.maestro.dev/reference/commands-available/tapon)
- [Detox actions](https://wix.github.io/Detox/docs/api/actions/)

## Deferred Decisions

- Whether Tao-owned datasource row seeding should return after the real datasource contract exists.
- Exact runtime spelling for datasource integration mode and production-config opt-in.
- Whether `run ... with { ... }` should also own app state overrides, or whether app state setup should stay focused on rendered subjects.
- Exact ownership and spelling for role/name and accessibility-state selectors.
- Whether render IDs should be `Name: View`, `[id Name]`, or an `@Name:` family if named render syntax evolves.
- How selectors should target a specific row or region without overfitting to layout structure.
- How i18n string-key selectors should look once Tao strings/localization are first-class.
- How screenshots, rendered UI trees, and videos are named and retained in CI.
- Whether device runtime adapters should be implemented directly or through an export to tools such as Maestro.
