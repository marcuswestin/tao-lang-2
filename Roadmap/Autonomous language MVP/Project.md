# Autonomous language MVP

This branch-local project integrates Tao's functional application core around the executable Still app. The experiment intentionally owns its language decisions and does not wait for the independent roadmap slices that were active when the branch began.

## Capability inventory

At the branch point Tao already has projects and apps, imported runtime-backed views, typed view/action parameters, text and number values, item/list constructors, member reads, layout clauses, reactive view state, named and inline actions, state mutation, and Tao-authored press/text behavior tests.

The MVP must add one integrated path for:

- boolean and absent values, value-producing expressions, comparisons, boolean logic, interpolation, and pure functions;
- conditional and repeated rendering over lists;
- text input, change/submit events, validation, disabled/submitting state, stable identifiers, labels, and roles;
- schema declarations, related records, typed queries, filtering/order, reactive create/update/delete, durable local storage, and deterministic loading/failure tests;
- a deterministic stack navigator with typed destination arguments and back behavior;
- a complete, pleasant Still app whose product behavior is authored in Tao.

## Numbered vertical slices

1. [x] **Expressions and control.** Add boolean/absence literals, precedence-aware unary/binary expressions, interpolation, expression-bodied pure functions, `if` rendering, and `for` rendering. Cover parser, scope/type validation, formatter, compiler, runtime semantics, diagnostics, and a focused executable Test App.
2. [x] **Interaction and forms.** Add event bindings for press/change/submit, runtime-backed text input, field labels and identifiers, validation patterns, and Tao test steps for entering and submitting text.
3. [x] **Data.** Add Tao schemas and entity handles, provider-neutral query/mutation IR, a durable local provider, filtering/order, relationships, reactive consistency, and deterministic loading/error controls.
4. [x] **Navigation.** Add an app-owned stack, destination declarations with typed arguments, present/back actions, deterministic runtime state, and test steps that exercise navigation.
5. **Still.** Advance `Apps/MVP/Current/Still.tao` into the forcing app; cover workspace/task CRUD, completion, forms, filtering/order, loading/empty/error/populated states, and list/detail navigation in Tao behavior tests.
6. **Agreement and hardening.** Align active specifications, roadmap status, Test Apps, MVP README, formatter/diagnostics, and tool commands; remove stale executable claims; run final verification and audit branch cleanliness.

## Decision log

- **2026-08-10 — Integrate on one experimental branch.** Existing active roadmap branches remain independent and read-only. This branch implements the dependency chain itself so the result can be validated as one product.
- **2026-08-10 — Favor expression-bodied pure functions.** MVP functions are deterministic value transformations with an explicit return type and one expression body. Stateful work remains in actions; this avoids a second imperative statement language.
- **2026-08-10 — Keep data and navigation semantics in the runtime.** Generated TypeScript describes Tao-authored schemas, queries, mutations, and destinations. Reusable behavior belongs behind provider-neutral `TR` APIs.
- **2026-08-10 — Ship one local provider.** Still uses a durable device-local provider with an in-memory deterministic test mode. A remote-provider interface remains possible without adding credentials or hosted infrastructure.
- **2026-08-10 — Preserve the existing layout system.** MVP presentation extends runtime-backed controls and useful defaults instead of introducing the planned design-system language.
- **2026-08-10 — Use explicit interpolation composition.** `interpolate "Count: ", Count` is the MVP text-composition form. It accepts text, number, boolean, and `none` parts, avoids a custom multi-mode lexer, and leaves `${…}` template sugar as a reversible future extension.
- **2026-08-10 — Make functions positional and expression-bodied.** `function Label Count is number returns text = …` has a declared return type, positional `Label(Count)` calls, lexical parameter scope, and no side-effecting body statements.
- **2026-08-10 — Keep control flow render-local.** `if/else` and `for … in` are valid inside render child blocks, where each branch/iteration gets a lexical child scope. Value conditionals use `if … then … else …`.
- **2026-08-10 — Name ambiguous invocation inputs explicitly.** `.Value Draft` binds directly to the `Value` parameter before Tao's type-based matching runs. This makes duplicate primitive and action parameters practical for forms without making ordinary arguments positional.
- **2026-08-10 — Keep interaction component-owned.** `TextInput` and `FormButton` expose change, submit, and press through action-valued parameters. Their runtime implementations own React Native event adaptation, stable IDs, labels, disabled state, and basic accessible defaults.
- **2026-08-10 — Extend tests with direct semantic input steps.** The executable MVP uses `enter … into label|id …` and `submit label|id …`; the runtime adapter resolves accessibility-visible controls and fires the corresponding native events.
- **2026-08-10 — Make queries reactive list values.** A view-local query compiles to a provider-neutral plan, subscribes through the runtime store, and composes with ordinary `for`, `.Empty`, `.Count`, and member access. `Loading` and `Error` are query-specific members so app-visible states remain Tao-authored branches.
- **2026-08-10 — Keep writes strict and action-owned.** `create Schema.Entity { … }` requires every field, while `update Row { … }` and `delete Row` accept only query-produced row handles. Relationship values use stable row IDs, and deleting an owner cascades its directly related rows in the local MVP.
- **2026-08-10 — Persist locally without a service.** `local` uses browser local storage or Expo FileSystem document storage; `memory` shares the provider contract. The direct `expo-file-system` runtime dependency formalizes the native persistence module already shipped transitively with Expo.
- **2026-08-10 — Isolate and control data in Tao tests.** Every check gets a fresh memory store even for a `local` schema. `data Schema loading|ready|error "…"` synchronously drives provider states without touching durable developer data.
- **2026-08-10 — Let destinations inherit view signatures.** `destination WorkspaceDetail` references the view directly, so its parameter list is the navigation contract instead of being duplicated in a route declaration. `present Stack.WorkspaceDetail .WorkspaceId Id` reuses ordinary argument binding and diagnostics.
- **2026-08-10 — Keep navigation to one app-owned stack.** A stack has one argument-free initial destination, pushes one occurrence per `present`, and safely no-ops when `back` reaches the root. Native hardware back dispatches the same reducer operation; tests reset history before each check.

The data slice adds `expo-file-system` as a direct runtime dependency so the local provider can persist in Expo; it was already present transitively in the Expo toolchain. Any later dependency must be justified here before it is committed.

## Deliberate deferrals

- authentication, accounts, permissions, collaboration, and remote sync;
- multiple database providers and provider-specific query syntax;
- tabs, windows, overlays, toasts, restoration, and deep links;
- design-token declarations, themes, animation, and exhaustive platform styling;
- generics, macros, async functions, arbitrary higher-order collection APIs, and exhaustive operators;
- production deployment, publishing, project scaffolding, and broad IDE polish.

## Success checklist

- [ ] `feat/autonomous-language-mvp` contains intentional committed work only and is clean, unpushed, and unmerged.
- [ ] `Apps/MVP/Current/Still.tao` is executable through the normal dev/runtime path.
- [ ] Still persists related data and supports CRUD, completion, forms, filtering/order, and reactive updates.
- [ ] Still visibly covers loading, empty, validation-error, provider-error, and populated states.
- [ ] Still has deterministic list/detail navigation and back behavior.
- [ ] Primary Still journeys are covered by Tao-authored behavior tests.
- [ ] Expressions, control flow, collections, interaction, data, forms, and navigation compose without app-specific TypeScript business logic.
- [ ] Common invalid usage has actionable diagnostics and accepted syntax formats deterministically.
- [ ] Active specifications, roadmap, Test Apps, and MVP documentation agree with the implementation.
- [ ] Focused tests and final `./agent verify` pass at the branch head.
