# Test Apps

Test apps are valid, positive, executable examples of **implemented** Tao behavior. Diagnostics, invalid sources, and parser/compiler edge cases belong in package unit tests instead.

Each app lives in its own folder with its Tao source and behavior test:

```text
Apps/Test Apps/<App Name>/
  <App Name>.tao
  <App Name>.test.tao
```

This file is the contract for each app's scope. When a change would expand an app beyond its entry below, update the entry first. Product behavior belongs in `Apps/WordFlower/`, never here.

## Settled expansion when Next is implemented

The entries below describe the executable apps today. Absorbing `Apps/WordFlower/2 - Next` must
expand the positive examples without erasing compatible coverage:

- Functional Core covers parenthesized block-bodied functions, explicit `return`, inferred return
  types, and non-blocking `async { ... }`.
- Layout and App Shell covers `frame`, intrinsic `@@content`, optional single-fill named slots,
  named design bundles and direct-clause precedence, `width max`, `Panes`, and `ScrollView`.
- Runtime Stdlib covers `Image`, `Checkbox`, `ScrollView`, `Spinner`, and `Progress`, while collection
  rendering remains language-owned through `loop` and no `List` component is added. Package coverage
  includes `@tao/text` `CountWords` and `Join`.
- Type System Tests cover `list of T`, nominal enums including one-case enums, optional item fields,
  `let Name is Type = Value`, primitive app/nav/datasource value heads, and the settled `with`
  construction-versus-value-derivation rules.
- Forms and Interaction covers `expect checkbox <selector> checked|unchecked`.
- All `ui`, `view`, `layout`, `frame`, `dialogue`, `action`, and `function` declarations use a
  parenthesized parameter list, including `()`.

The current expression-bodied function and pre-frame statements below remain accurate until that
absorption; the settled expansion supersedes those particular forms when Current advances.

## Navigation MVP

Exercise app-mounted navigation: presentation, covered-entry state preservation, and back behavior.

**Belongs here:** an `app` with `Name` and a configured `Navigator StackNav { Initial <ui> }`; `ui` declarations with typed parameters; `present Detail(Name: "…")` with required parentheses; a covered entry that stays mounted and hidden and restores its state when revealed; the accessible Back control, native back, and the test `back` step through the same reducer.

**Does not belong here:** selection, split, overlays, toasts, windows, restoration, routes, or transition policy; target-resolution and argument diagnostics; WordFlower product behavior.

## Forms and Interaction MVP

Exercise controlled text input, event configuration, and form feedback.

**Belongs here:** `TextInput`, `Checkbox`, and `FormButton` from `@tao/ui`; labeled arguments such as `Value:`, `Placeholder:`, `Disabled:`, and the represented optional `Icon:`, including control defaults; automatic two-way text updates when `Value:` directly references writable text state; `on press|change|submit` with named actions or inline handlers, including boolean checkbox change and the scoped `on change -> Payload` form that replaces automatic text binding; `#tag`, label, and placeholder selectors for entry, submission, presses, and checkbox state; input-value and checkbox-state assertions; reactive validation, disabled submit, and duplicate-press suppression while submitting.

**Does not belong here:** durable collections, relationships, filtering, or ordering; navigation; invocation, selector, or event diagnostics.

## Data MVP

Exercise the provider-neutral data catalog and an app-configured isolated Memory datasource.

**Belongs here:** top-level `data Plural / Singular` declarations with field modifiers, `index`, and declaration-level `order by`; boolean case fields; relations with `on delete cascade`; `Datasource Memory { }` on the app; reactive `query` values with filtering and ordering; `guard` over query `loading` and `error -> Message` cases; strict action-owned `create`, live-handle `update` and `delete`; relationship cleanup, empty and populated transitions, and the deterministic `data loading|error|ready` test steps.

**Does not belong here:** remote providers, credentials, auth, permissions, sync, pagination, or aggregation; navigation or WordFlower product behavior; schema, query, and write diagnostics.

## Functional Core MVP

Exercise the executable functional core: expressions, pure functions, and control flow.

**Belongs here:** boolean, absence, arithmetic, comparison, and boolean-logic expressions; expression-bodied `function` declarations with explicit `returns` types; interpolated strings; exhaustive `when Subject { … otherwise -> … }` in value and render positions; block-scoped `guard` in actions and renders; `loop Plural / Singular` in render blocks; `toggle`; reactive branch changes driven by Tao state and actions.

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

**Belongs here:** `use … from @tao/ui`; rendering for `Text`, `Number`, `Button`, `Box`, `Stack`, `Col`, `Row`, `WrappingRow`, `TextFrame`, `TextMultiline`, `Image`, `ScrollView`, `Spinner`, and `Progress`; informative and decorative image accessibility, bounded progress, a no-op `on press` binding required by `Button`, and basic nested stdlib composition.

**Does not belong here:** type-system cases owned by Type System Tests; import-visibility errors; design and styling behavior; stateful interaction beyond the no-op binding.

## State Action MVP

Exercise view-local state, actions, and reactive rerendering.

**Belongs here:** `state` declarations; named actions with parameters; `action()` -typed view parameters; inline `on press -> { }` handlers and named action references; `set`, compound `set`, and `do`; state-derived immutable bindings.

**Does not belong here:** placement or type diagnostics; input, submit, and non-press events, which belong to Forms and Interaction MVP; control flow, data, navigation, or custom types.

## Type System Tests

Exercise the type system through a small UI that passes typed values into views.

**Belongs here:** text, number, and list literals; custom type declarations for primitive, list, and item shapes; typed constructors and invocation type-fixing; item member access; `let` bindings whose inferred types are used as arguments; nested render-block `let` shadowing while captured outer references keep their value; argument binding by type, including out-of-order; inject arguments exposing typed values inside injected TS.

**Does not belong here:** grammar edge cases without type-system meaning; layout, styling, navigation, data, or action behavior beyond what type coverage needs; stdlib runtime coverage; invalid or intentionally failing cases.
