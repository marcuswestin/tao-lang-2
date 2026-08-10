# Functional Language MVP

Status: active experimental project on branch `feat/functional-language-mvp`.

This project delivers the functional core of Tao as one coherent, executable MVP: expressions, control flow, iteration, events and forms, a persisted data layer, stack navigation, functions, and a small visual-styling surface — proven by making `Apps/MVP/Current/Still.tao` a real multi-screen CRUD application authored entirely in Tao.

This branch operates under an explicit experimental delegation: language, product, and implementation decisions are made autonomously and recorded in `Decisions.md`; consciously omitted scope is recorded in `Deferrals.md`. Active specifications are updated at the end of the project to describe what actually shipped.

## Authority anchors

1. `Spec/Tao Type System.md` — operators, `let`, `when`, `toggle`, property-constructor arguments (followed).
2. `Spec/Tao Testing.md` — interaction steps and selectors (followed).
3. `Spec/Tao Presentation and Navigation.md` + `Roadmap/Add navigation and routing MVP/Research…` — implemented here as a drastically reduced StackNav subset (see DEC-FMVP-012).
4. `Apps/MVP/.tao-future/Still.tao` + `@ui/ui.tao` — forcing-app seed. Data/query/mutation syntax is open design space (LANG-007..010) and is decided by this project.

## Capability inventory

| Family | Before this branch | This project adds | Slice |
| --- | --- | --- | --- |
| Values & expressions | text/number literals, typed constructors, member access | booleans, decimals, negatives, arithmetic/comparison/boolean operators, parens, interpolation | 1, 3 |
| Bindings | `alias` | `let` (spec-settled replacement; `alias` deprecated) | 2 |
| Control flow | none | `when` expression + render + action forms | 2 |
| Collections | list literals | `for` iteration, `.Count`/`.Empty`, text `.Length`/`.Empty` | 3 |
| Interaction & forms | positional action args, `press text` tests | `on press/change/submit`, `TextInput`, param defaults, named slot args, `Disabled`, `write`/`submit`/label+placeholder selectors | 4 |
| Data | none | `data` schema, entities/fields/relationships, `TR.Data` store, create/update/delete/toggle, Memory provider | 5 |
| Queries & persistence | none | `query` with where/order, status members, `run … with { data … }`, durable Local provider | 6 |
| Navigation | single root view | `ui` kind, `Navigator StackNav`, `present`/`dismiss`, back, `back` test step | 7 |
| Functions | none | expression-bodied `function`, call expressions, `now()` | 8 |
| Styling | layout clauses only | `bg fg size weight line radius border` + hex colors | 8 |
| Canonical app | Still counter sketch | full multi-screen CRUD Still with journey tests | 4–9 |

## Implementation slices

Each slice is a full vertical (grammar → scoping → validator/Typir → formatter → compiler → runtime → per-layer tests → executable Tao coverage), validated with focused tests plus `./agent verify`, and committed green.

- [ ] 1. Booleans and operators (+ `toggle` for boolean state) — Expressions test app
- [ ] 2. `let` binding and the three `when` forms — Control Flow test app; repo `alias` migration
- [ ] 3. `for` iteration, string interpolation, builtin members
- [ ] 4. Events (`on` clauses), `TextInput`, forms, test interaction steps — advance Still
- [ ] 5. `data` declarations, entity types, `TR.Data` store, mutations, Memory provider — Data MVP test app
- [ ] 6. `query` with where/order, loading/failure states, durable Local provider — advance Still
- [ ] 7. Navigation: `ui`, `Navigator StackNav`, `present`/`dismiss`, back — Navigation test app; advance Still
- [ ] 8. Functions and visual styling entries
- [ ] 9. Still assembly: full app + journey behavior tests
- [ ] 10. Coherence: `Spec/Tao Data.md`, spec status updates, Roadmap/README agreement, final `./agent verify`

## Success criteria

- [ ] Work committed on `feat/functional-language-mvp`; clean tree; nothing merged or pushed
- [ ] `Apps/MVP/Current/Still.tao` is a real executable app: persisted related data, CRUD, forms + validation, filtering/ordering, reactive updates, loading/empty/error states, multi-screen navigation with back
- [ ] Still business behavior authored in Tao (injection remains only as the typed escape hatch)
- [ ] Implemented features recombine to express apps adjacent to Still
- [ ] Per-layer parser/validator/formatter/compiler/runtime coverage; actionable diagnostics; deterministic formatting
- [ ] Primary Still journeys covered by Tao behavior tests, including loading and provider-failure states
- [ ] Active specs, `Roadmap.md`, Test Apps README, and MVP README agree with implemented behavior
- [ ] `./agent verify` passes at the final branch head
