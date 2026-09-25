# Test Apps

Test apps are valid, positive, executable examples of **implemented** Tao behavior. Diagnostics, invalid sources, and parser/compiler edge cases belong in package unit tests instead.

Each entry below owns one folder of Tao sources and behavior tests:

```text
Apps/Test Apps/<Entry Name>/
  <Subject>.tao
  <Subject>.test.tao
```

A folder may hold several `app` declarations and several subject pairs. Every check names the app it
drives with `run <AppName>`, so journeys over one language surface share a folder without sharing an
app, and each subject keeps its own source and test file.

This file is the contract for each entry's scope. When a change would expand an entry beyond its
scope below, update the entry first. Product behavior belongs in `Apps/WordFlower/`, never here.

## Tranche 4 reconciliation

The entries below describe the executable apps today. Tranche 4 expanded the positive examples
without erasing compatible coverage:

- Language Core covers parenthesized block-bodied functions, explicit `return`, and non-blocking
  `async { ... }`; WordFlower and package tests additionally prove inferred return types.
- Layout and App Shell covers `width max`, `Panes`, and `ScrollView`. WordFlower and package tests
  own `@@content` placement, optional single-fill named slots, named design bundles, and
  direct-clause precedence.
- Runtime Stdlib covers `Image`, `Spinner`, and `Progress`; Forms and Interaction owns `Checkbox`,
  and Layout and App Shell owns `ScrollView`. Collection rendering remains language-owned through
  `loop`, and no `List` component is added. Package coverage includes `@tao/text` `CountWords` and
  `Join`.
- The Type System Tests app covers `list of T`, parenthesized declarations, and explicit `render inject`
  bindings. WordFlower's Foundation harness and package tests own nominal enums, optional item fields,
  `let Name is Type = Value`, primitive app/nav/datasource value heads, and the settled `with`
  construction-versus-value-derivation rules.
- Forms and Interaction covers `expect checkbox <selector> checked|unchecked`.
- Packages covers `use package` namespace imports and pass-through view aliases
  (`public view Badge = widgets.Badge`), the mechanism `@tao/ui` uses to publish implementations.
- Native Components covers `@tao/ui`'s published components — Button, Switch, Slider, Picker,
  SegmentedControl, DatePicker, Spinner — resolving to their platform-native implementations,
  exercised through the behavior every implementation must share.
- Navigation covers `present X as sheet`, the platform-hosted modal presentation.
- Time covers the `duration` family end to end — construction, reading back, long aliases,
  dimensional arithmetic, and `.Clock` — and `@tao/time`: a held ticker, live derivation over it,
  `Stop`/`Start`/`Running`, and the `advance` step that drives the clock a check holds. WordFlower's
  focused writing session owns units in a product feature, and package tests own the diagnostics.
- Device Kit covers the first `@tao/device` contracts: semantic Haptic playback, reactive Clipboard
  reads and writes, and opening the system Share sheet through deterministic native-module fakes.
- All `view`, `action`, and `function` declarations use a parenthesized parameter list,
  including `()`.
- Every `StackNav` destination fills its own `Title`. Navigation's native-stack app keeps the bare
  `@tao/nav` native-default import, while its basic-kit app proves that explicit `@tao/nav/basic`
  renders the same title and toolbar command contract deterministically.

## Navigation

Exercise the navigation layer: the native stack, the portable basic kit, platform sheet and overlay
presentation, the split surface, the root-view app form, the shell that renders a navigator as
ordinary content, and the toggle bar that replaces a stack's header. Ten `app` declarations share
the folder, one or more per source file, and each check picks its app with `run`.

**Belongs here:**

- _Native stack_ (`Navigation MVP.tao`): an `app` with `Name` and a configured
  `Navigator StackNav { Initial <view> }` taken from the bare, native-default `@tao/nav` root;
  presented `view` declarations with typed parameters; `present Detail(Name: "…")` with required
  parentheses; a covered entry that stays mounted and hidden and restores its state when revealed;
  the accessible Back control, native back, and the test `back` step through the same reducer; the
  test `relaunch` step reopening the presented screen with the typed argument it was opened with,
  `relaunch fresh` opening on the initial screen instead, and the check boundary that keeps a
  position one check reached out of the next; `ask` with a `responds` dialogue, both answered and
  left suspended when the app is quit, where the action that was waiting never resumes into the
  launch that replaces it.
- _Basic kit_ (`Basic Navigation.tao`): `StackNav` from `@tao/nav/basic`, with the same required
  `Title` and optional `Toolbar` slots as native StackNav; command-title label defaulting; host
  command invocation; deterministic basic chrome assertions.
- _Toggle bar_ (`Toggle Navigation.tao`): `SelectionNav { Display "toggle" }` over two stacks; the
  visible screen's `Title` and `Toolbar` shown once, in the bottom bar, with no stack header; the
  bar's own Back walking the active stack; the right-hand control naming and switching to the other
  item while each stack keeps its position; a plain-view item titled by its `Label`; the test
  `relaunch` step restoring both.
- _Sheets and overlays_ (`Sheet Presentation.tao`): `present X as sheet`, the platform's own modal
  presentation; `present X as overlay` from inside one, drawing inside the sheet's window while the
  sheet stays showing beneath it; dismissing from inside with `dismiss`; dismissing with Back; the
  cover dismissing back to the sheet — a sheet behaving as an overlay does for every navigation
  operation except that what it presents lives in its window.
- _Split_ (`Resizable Split.tao`): `SplitNav` with keyed `Content`, numeric `Width`, and
  `Resizable`; an app-level `state Name is number = default (persist)` read by a pane and
  changed by an app-level action — the journey observes the value, not the resulting geometry; simultaneous pane rendering; the test `relaunch` step,
  which replaces the mounted app with a new launch so the persisted width outlives it and the
  sidebar's view-local state does not, including across `relaunch fresh`, which opts a launch out
  of restoring navigation and not out of the device.
- _Root view_ (`Root View App.tao`): the `app X { view Y }` form, whose navigator Tao synthesizes
  rather than the source naming one; `present` and `back` through that synthesized navigator; the
  test `relaunch` step reopening the presented screen it left, and `relaunch fresh` opening on the
  root view and recording that as the stored position.
- _Shell_ (`Shell.test.tao`): a test-only app root as a view with arguments,
  `view Shell(CenterStack, "…")`, and a variant that rebinds it with
  `with { view Shell(OtherStack, "…") }`; a nav-typed parameter
  rendered inside a `Col` as ordinary content, `Navigator() [fill]`; `present` and Back reaching the
  navigator the shell renders; the test `relaunch` step reading that navigator's position back and
  `relaunch fresh` opening it at its root; a conditional sibling of the navigator mounting and
  unmounting while the navigator's position is untouched; and `present @key` reaching a rendered
  `SelectionNav` through the shell.

**Does not belong here:** toasts, windows, routes, or transition policy; split,
target-resolution, and argument diagnostics; native adapter appearance or transitions; the platform
chrome a sheet is hosted in, which is not assertable from a journey; arbitrary row/column resizing,
multi-window layout, collapse policy, or product-specific workbench behavior; WordFlower product
behavior.

The complete Shell app family lives in its test sidecar because its only purpose is to drive these
implementation journeys without adding duplicate interactive choices. The shell journeys assert on
the label the root view was bound to and on the content of the
navigator it renders, never on a navigation title: the synthesized root navigator is a slot and
renders no chrome of its own. The label is what tells a variant's rebinding apart from the base
app, and the status bar's own text is what tells an unmounted sibling from a mounted one that
renders nothing. The runtime's own suite in `packages/apps/runtime/TR-tests/` proves the mechanism the
journeys stand on: a rendered navigator mounts once on the occurrence that hosts it, that host
routes Back and activation to it, and it restores by its own identity when it attaches.

The split journey never drags a divider: the Tao test language has no `resize` step, and resize
interaction is the adapter's. `relaunch` proves that device-local `(persist)` state outlives the
launched instance while ephemeral view state does not; encoding and decoding that state through
device storage stays with the runtime's persisted-state suite in `packages/apps/runtime/TR-tests/`,
because a relaunch reads that same store again rather than rebuilding it. Reading it again is what
gives the journey its teeth: break the storage key and the split journey fails. The same split holds
for navigation: the Navigation MVP journey proves where a relaunch reopens and what an abandoned
action does not do to the launch after it, while snapshot encoding and the launch-boundary lifecycle
stay with the runtime's restoration and relaunch suites in the same directory.

The root-view journey asserts content and never a navigation title: the navigator the `view` form
synthesizes is a slot, which renders no chrome of its own. It is the only journey over that app
shape, so it is what says a synthesized navigator restores at all — the same relaunch a written
`nav` gets, rather than a launch that quietly gives up and reopens on the root view.

## Forms and Interaction MVP

Exercise controlled text input, event configuration, and form feedback.

**Belongs here:** `TextInput`, `Checkbox`, and `FormButton` from `@tao/ui`; labeled arguments such as `Value:`, `Placeholder:`, and `Disabled:`, including control defaults; automatic two-way text updates when `Value:` directly references writable text state; `on press|change|submit` with named actions or inline handlers, including boolean checkbox change and the scoped `on change -> Payload` form that replaces automatic text binding; `#tag`, label, and placeholder selectors for entry, submission, presses, and checkbox state; input-value and checkbox-state assertions; reactive validation, disabled submit, and duplicate-press suppression while submitting.

**Does not belong here:** durable collections, relationships, filtering, or ordering; navigation; invocation, selector, or event diagnostics.

## Reactive Editing

Exercise settled writable and copied parameters through ordinary controls and action bodies.

**Belongs here:** direct writable parameter forwarding through a child `TextInput`; parent and child writes over the same value; independent writable literal occurrences surviving a parent rerender; `copy` view parameters that initialize once and detach from later caller changes; copied action and command parameters whose mutations do not change their input; configured command fills retaining caller storage; and configured root views writing persisted app state.

**Does not belong here:** parameter grammar and diagnostic cases, runtime transaction internals, entity-field projection, or native callback lifecycle. Those belong to language, runtime, and WordFlower coverage respectively.

## Write Rules

Exercise `required` completeness and the writes that consume it through an ordinary form.

**Belongs here:** `required "<sentence>"` deriving `Incomplete` and `Problems` on a stored row and on a projection that selects the field; a projection that leaves a required field out never reporting it; a projection-backed form disabling its submit while incomplete; `check` stopping an action on an incomplete input; `create Entity with Input` creating a row from a projected item; and a row written incomplete that reads complete after an update.

**Does not belong here:** `validate` and store-side rejection, which are not implemented; diagnostic cases for the completeness members and `create … with`, which belong to package tests; and a stdlib view that presents `Problems`, whose spelling is undecided.

## Data MVP

Exercise the provider-neutral data catalog and an app-configured isolated Memory datasource.

**Belongs here:** top-level `data Plural / Singular` declarations with field modifiers, `index`, and declaration-level `order by`; boolean case fields; relations with cascade lifetime, spelled `Tasks (owned)`; `Datasource Memory { }` on the app; reactive `query` values with filtering and ordering; `guard` over query `loading` and `error -> Message` cases; strict action-owned `create`, live-handle `update` and `delete`; relationship cleanup, empty and populated transitions, and stored rows surviving a `relaunch`. Query status is proved through `guard` cases in the app, not through a test step: the test language has no `data` step.

**Does not belong here:** remote providers, credentials, auth, permissions, sync, pagination, or aggregation; navigation or WordFlower product behavior; schema, query, and write diagnostics.

## Local Data

Exercise the entity-level `local only` storage fact. One `app` declaration and one datasource
variant share the folder — `LocalData` over a `Local` datasource and `LocalDataMemory` over `Memory`
— with the catalog in the folder's `@data` package.

**Belongs here:** `local only` as a trailing entity-level storage fact beside `order by`; a focus
session row operating and surviving `relaunch` in the Memory harness; and an integration smoke test
that both ordinary and local-only entity APIs work when the same program runs as a Memory-datasource
variant. Those journeys cannot distinguish the two memory-backed connections. Compiler tests prove
that ordinary and local-only entities route to separate emitted catalogs regardless of the
configured `Datasource`.

**Does not belong here:** the storage-boundary relation diagnostic and duplicate-`local only`
diagnostic, which are package tests; the emitted two-catalog shape, which is a compiler test; remote
providers, sync, or credentials; navigation beyond the app's root stack.

## Language Core

Exercise the executable language core: expressions, pure functions, control flow, view-local state,
and actions. Two `app` declarations share the folder — `FunctionalCoreMVP` in
`Functional Core MVP.tao` and `StateActionMVP` in `State Action MVP.tao` — and each behavior test
picks its app with `run`.

**Belongs here:** boolean, absence, arithmetic, comparison, and boolean-logic expressions;
parenthesized block-bodied `function` declarations with explicit `return`; interpolated strings;
exhaustive `when Subject { … otherwise -> … }` in value and render positions; block-scoped `guard`
in actions and renders; `loop Plural / Singular` in render blocks; `toggle`; non-blocking
`async { ... }`; `state` declarations; named actions with parameters; `action()`-typed view
parameters; inline `on press -> { }` handlers and named action references; `set`, compound `set`,
and `do`; state-derived immutable bindings; reactive branch changes driven by Tao state and actions.

**Does not belong here:** control-flow, expression, placement, or type diagnostics; input, submit,
and non-press events, which belong to Forms and Interaction MVP; data, navigation, or custom types;
collection transforms beyond the shipped list members and iteration.

## Layout and App Shell

Exercise bracketed layout clauses and the default app-shell baseline.

**Belongs here:** layout clauses on render sites, including `content`, `claim`, `gap`, `pad`, `margin`, numeric, `fill`, and maximum `width`, numeric and `fill` `height`, `fill`, `hug`, `compress`, `rigid`, `aligned`, and `centered`; a declaration's header clause as its public layout default, a caller replacing it (`pad 0`) or clearing it (`pad none`), and a root's private clause staying put; adaptive `Panes` and viewport-owning `ScrollView`; app-root content rendered inside the safe default shell; text asserted by the layout smoke path.

**Does not belong here:** visual style clauses; `@@content`, named render slots, or render elision; state, actions, forms, data, navigation, or richer scrolling behavior.

## Packages

Exercise local workspace package resolution, project metadata, and the namespace-import and alias
mechanism component kits publish through. Two `app` declarations share the folder — `PackageAccess`
in `Package Access.tao` and `ComponentAliases` in `Component Aliases.tao` — over one fixture set of
local packages in `Packages/`: `@cards` and `@copy` for resolution, `@widgets` as the stand-in
implementation package an alias republishes.

**Belongs here:** `project { name … remote none license … }` metadata; `use … from @package/subfolder`
for package folders nested in the project; bare `use Foo` for `package` declarations across sibling
files, sibling folders, and child folders in the same `@package`; `workspace`-visible declarations
imported across indexed local packages; runtime rendering for package-imported views and bindings;
`use package @pkg [as name]` with a derived namespace name and an `as` rename; `public view Name =
ns.Member` publishing a package member under the file's own name; a same-named alias proving the
namespace avoids shadowing; call sites binding through the alias to the target's parameters.

**Does not belong here:** resolution, duplicate-package, and visibility diagnostics;
namespace-import diagnostics — duplicate namespaces, unresolvable packages, non-view targets — which
are package tests; external projects, `requires`, install/update/publish, remotes, or lockfiles; the
stdlib's own native components, which `@tao/ui` and its conformance suite own.

## Runtime Stdlib Tests

Exercise runtime-backed `@tao/ui` imports and the first stdlib primitives.

**Belongs here:** `use … from @tao/ui`; rendering for `Text`, `Number`, `Button`, `Box`, `Stack`, `Col`, `Row`, `WrappingRow`, `TextFrame`, `TextMultiline`, `Image`, `Spinner`, and `Progress`; informative and decorative image accessibility, bounded progress, a no-op `on press` binding required by `Button`, and basic nested stdlib composition.

**Does not belong here:** type-system cases owned by Type System Tests; import-visibility errors; design and styling behavior; stateful interaction beyond the no-op binding.

## Time

Exercise the time surface: unit values (Decisions §2) through the one family the language registers,
and the ticking clock (Decisions §9) with the deterministic clock a check holds. Two `app`
declarations share the folder, one per source file — `UnitValues` in `Unit Values.tao` and
`TickingClock` in `Ticking Clock.tao` — and each keeps its own behavior test. `TickingClock` also
holds an app-level `time` state `(persist)`, which is what lets a journey witness that the held clock
survives a `relaunch`: a view-local `now` cannot, because the launched instance re-reads it.

**Belongs here:**

- _Unit values_ (`Unit Values.tao`): `.unit` on a number and on a unit value; canonical units and
  their long singular and plural aliases; equality after normalization; dimensional arithmetic —
  duration ± duration, duration × number, duration ÷ duration; the `.Clock` reading and its
  boundaries at an hour and at zero.
- _Ticking clock_ (`Ticking Clock.tao`): `Interval(Every)` held as view-local state; `Tick.Value` as
  a live reading; `let` derivations that recompute per tick; `do Tick.Stop()` and `do Tick.Start()`;
  `Tick.Running`; `advance <duration>` moving the clock and firing due ticks in order; the compact
  `when Subject Yes / not No` form.

**Does not belong here:** unit diagnostics, which are package tests; families beyond `duration`,
which are not registered until a feature forces one; the product shape of a writing session and its
live units, which WordFlower's focused writing session owns; toast expiry, which WordFlower's
documents journey proves.

## Device Kit

Exercise the frozen-language `@tao/device` binding pattern through Haptic, Clipboard, and Share.

**Belongs here:** parameterized action fields on sidecar-built values; semantic haptic cases; a
Clipboard read updating reactive `Value`; Clipboard copy followed by read; opening Share with text;
deterministic native-module substitutes owned by the runtime test harness.

**Does not belong here:** Location, permissions, declared failures, `when do` outcomes, raw
Vibration, vendor enums or result objects, or app-authored native bindings.

## Native Components

Exercise `@tao/ui`'s published components against their platform-native implementations.

**Belongs here:** importing from bare `@tao/ui` and getting the native set; pressing a native button by its title; a disabled native button; a switch, slider, picker, segmented control, and date picker reporting their values through actions; the portable rendering each falls back to where its platform host is absent; behavior that must hold identically whichever implementation is bound.

**Does not belong here:** the alias mechanism itself, which Packages owns; per-implementation appearance, which is not assertable from a journey; navigation surfaces, which the nav layer owns.

## Type System Tests

Exercise the type system through a small UI that passes typed values into views.

**Belongs here:** text, number, and list literals; custom type declarations for primitive, list, and item shapes; typed constructors and invocation type-fixing; item member access; `let` bindings whose inferred types are used as arguments; nested render-block `let` shadowing while captured outer references keep their value; argument binding by type, including out-of-order; inject arguments exposing typed values inside injected TS.

**Does not belong here:** grammar edge cases without type-system meaning; layout, styling, navigation, data, or action behavior beyond what type coverage needs; stdlib runtime coverage; invalid or intentionally failing cases.
