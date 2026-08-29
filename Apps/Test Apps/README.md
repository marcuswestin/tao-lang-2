# Test Apps

Test apps are valid, positive, executable examples of **implemented** Tao behavior. Diagnostics, invalid sources, and parser/compiler edge cases belong in package unit tests instead.

Each app lives in its own folder with its Tao source and behavior test:

```text
Apps/Test Apps/<App Name>/
  <App Name>.tao
  <App Name>.test.tao
```

This file is the contract for each app's scope. When a change would expand an app beyond its entry below, update the entry first. Product behavior belongs in `Apps/WordFlower/`, never here.

## Tranche 4 reconciliation

The entries below describe the executable apps today. Tranche 4 expanded the positive examples
without erasing compatible coverage:

- Functional Core covers parenthesized block-bodied functions, explicit `return`, and non-blocking
  `async { ... }`; WordFlower and package tests additionally prove inferred return types.
- Layout and App Shell covers `width max`, `Panes`, and `ScrollView`. WordFlower and package tests
  own `frame`, intrinsic `@@content`, optional single-fill named slots, named design bundles, and
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
- Component Aliases covers `use package` namespace imports and pass-through view aliases
  (`public view Badge = widgets.Badge`), the mechanism `@tao/ui` uses to publish implementations.
- Native Components covers `@tao/ui`'s published components resolving to their platform-native
  implementations, exercised through the behavior every implementation must share.
- Unit Values covers the `duration` family end to end: construction, reading back, long aliases,
  dimensional arithmetic, and `.Clock`. WordFlower's focused writing session owns units in a product
  feature, and package tests own the diagnostics.
- Ticking Clock covers `@tao/time`: a held ticker, live derivation over it, `Stop`/`Start`/`Running`,
  and the `advance` step that drives the clock a check holds.
- All `ui`, `view`, `layout`, `frame`, `dialogue`, `action`, and `function` declarations use a
  parenthesized parameter list, including `()`.

## Navigation MVP

Exercise app-mounted navigation: presentation, covered-entry state preservation, and back behavior.

**Belongs here:** an `app` with `Name` and a configured `Navigator StackNav { Initial <ui> }`; `ui` declarations with typed parameters; `present Detail(Name: "…")` with required parentheses; a covered entry that stays mounted and hidden and restores its state when revealed; the accessible Back control, native back, and the test `back` step through the same reducer.

**Does not belong here:** selection, split, overlays, toasts, windows, restoration, routes, or transition policy; target-resolution and argument diagnostics; WordFlower product behavior.

## Forms and Interaction MVP

Exercise controlled text input, event configuration, and form feedback.

**Belongs here:** `TextInput`, `Checkbox`, and `FormButton` from `@tao/ui`; labeled arguments such as `Value:`, `Placeholder:`, and `Disabled:`, including control defaults; automatic two-way text updates when `Value:` directly references writable text state; `on press|change|submit` with named actions or inline handlers, including boolean checkbox change and the scoped `on change -> Payload` form that replaces automatic text binding; `#tag`, label, and placeholder selectors for entry, submission, presses, and checkbox state; input-value and checkbox-state assertions; reactive validation, disabled submit, and duplicate-press suppression while submitting.

**Does not belong here:** durable collections, relationships, filtering, or ordering; navigation; invocation, selector, or event diagnostics.

## Data MVP

Exercise the provider-neutral data catalog and an app-configured isolated Memory datasource.

**Belongs here:** top-level `data Plural / Singular` declarations with field modifiers, `index`, and declaration-level `order by`; boolean case fields; relations with `on delete cascade`; `Datasource Memory { }` on the app; reactive `query` values with filtering and ordering; `guard` over query `loading` and `error -> Message` cases; strict action-owned `create`, live-handle `update` and `delete`; relationship cleanup, empty and populated transitions, and the deterministic `data loading|error|ready` test steps.

**Does not belong here:** remote providers, credentials, auth, permissions, sync, pagination, or aggregation; navigation or WordFlower product behavior; schema, query, and write diagnostics.

## Functional Core MVP

Exercise the executable functional core: expressions, pure functions, and control flow.

**Belongs here:** boolean, absence, arithmetic, comparison, and boolean-logic expressions; parenthesized block-bodied `function` declarations with explicit `return`; interpolated strings; exhaustive `when Subject { … otherwise -> … }` in value and render positions; block-scoped `guard` in actions and renders; `loop Plural / Singular` in render blocks; `toggle`; non-blocking `async { ... }`; reactive branch changes driven by Tao state and actions.

**Does not belong here:** control-flow or expression diagnostics; input events, data, or navigation; collection transforms beyond the shipped list members and iteration.

## Layout and App Shell

Exercise bracketed layout clauses and the default app-shell baseline.

**Belongs here:** layout clauses on render sites, including `content`, `claim`, `gap`, `pad`, `margin`, numeric, `fill`, and maximum `width`, numeric and `fill` `height`, `fill`, `hug`, `compress`, `rigid`, `aligned`, and `centered`; adaptive `Panes` and viewport-owning `ScrollView`; app-root content rendered inside the safe default shell; text asserted by the layout smoke path.

**Does not belong here:** visual style clauses; `frame`, `@@content`, named render slots, or render elision; state, actions, forms, data, navigation, or richer scrolling behavior.

## Package Access

Exercise local workspace package resolution and project metadata.

**Belongs here:** `project { name … remote none license … }` metadata; `use … from @package/subfolder` for package folders nested in the project; bare `use Foo` for `package` declarations across sibling files, sibling folders, and child folders in the same `@package`; `workspace`-visible declarations imported across indexed local packages; runtime rendering for package-imported views and bindings.

**Does not belong here:** resolution, duplicate-package, or visibility diagnostics; external projects, `requires`, install/update/publish, remotes, or lockfiles; import aliases.

## Runtime Stdlib Tests

Exercise runtime-backed `@tao/ui` imports and the first stdlib primitives.

**Belongs here:** `use … from @tao/ui`; rendering for `Text`, `Number`, `Button`, `Box`, `Stack`, `Col`, `Row`, `WrappingRow`, `TextFrame`, `TextMultiline`, `Image`, `Spinner`, and `Progress`; informative and decorative image accessibility, bounded progress, a no-op `on press` binding required by `Button`, and basic nested stdlib composition.

**Does not belong here:** type-system cases owned by Type System Tests; import-visibility errors; design and styling behavior; stateful interaction beyond the no-op binding.

## State Action MVP

Exercise view-local state, actions, and reactive rerendering.

**Belongs here:** `state` declarations; named actions with parameters; `action()` -typed view parameters; inline `on press -> { }` handlers and named action references; `set`, compound `set`, and `do`; state-derived immutable bindings.

**Does not belong here:** placement or type diagnostics; input, submit, and non-press events, which belong to Forms and Interaction MVP; control flow, data, navigation, or custom types.

## Unit Values

Exercise unit values (Decisions §2) through the one family the language registers.

**Belongs here:** `.unit` on a number and on a unit value; canonical units and their long singular and plural aliases; equality after normalization; dimensional arithmetic — duration ± duration, duration × number, duration ÷ duration; the `.Clock` reading and its boundaries at an hour and at zero.

**Does not belong here:** the ticking clock and live derivation, which WordFlower's focused writing session owns; unit diagnostics, which are package tests; families beyond `duration`, which are not registered until a feature forces one.

## Ticking Clock

Exercise the ticking clock (Decisions §9) and the deterministic clock a check holds.

**Belongs here:** `Interval(Every)` held as view-local state; `Tick.Value` as a live reading; `let` derivations that recompute per tick; `do Tick.Stop()` and `do Tick.Start()`; `Tick.Running`; `advance <duration>` moving the clock and firing due ticks in order; the compact `when Subject Yes / not No` form.

**Does not belong here:** unit construction and conversion, which Unit Values owns; the product shape of a writing session, which WordFlower owns; toast expiry, which WordFlower's documents journey proves.

## Component Aliases

Exercise namespace imports and pass-through view aliases, the mechanism behind component kits.

**Belongs here:** `use package @pkg [as name]`; a derived namespace name and an `as` rename; `public view Name = ns.Member` publishing a package member under the file's own name; a same-named alias proving the namespace avoids shadowing; call sites binding through the alias to the target's parameters.

**Does not belong here:** namespace-import diagnostics (duplicate namespaces, unresolvable packages, non-view targets), which are package tests; the stdlib's own native components, which `@tao/ui` and its conformance suite own.

## Native Components

Exercise `@tao/ui`'s published components against their platform-native implementations.

**Belongs here:** importing `Button` and `Switch` from bare `@tao/ui` and getting the native set; pressing a native button by its title; a disabled native button; a native switch reporting its value through an action; behavior that must hold identically whichever implementation is bound.

**Does not belong here:** the alias mechanism itself, which Component Aliases owns; per-implementation appearance, which is not assertable from a journey; navigation surfaces, which the nav layer owns.

## Type System Tests

Exercise the type system through a small UI that passes typed values into views.

**Belongs here:** text, number, and list literals; custom type declarations for primitive, list, and item shapes; typed constructors and invocation type-fixing; item member access; `let` bindings whose inferred types are used as arguments; nested render-block `let` shadowing while captured outer references keep their value; argument binding by type, including out-of-order; inject arguments exposing typed values inside injected TS.

**Does not belong here:** grammar edge cases without type-system meaning; layout, styling, navigation, data, or action behavior beyond what type coverage needs; stdlib runtime coverage; invalid or intentionally failing cases.
