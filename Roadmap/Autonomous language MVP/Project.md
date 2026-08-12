# Autonomous language MVP

This branch-local project integrates Tao's functional application core around one executable forcing app (Still during the experiment, since restructured into WordFlower). The experiment intentionally owns its language decisions and does not wait for the independent roadmap slices that were active when the branch began. The first end-to-end implementation is complete; a consolidation pass is now incorporating the strongest independently proven ideas and hardening the result for merge consideration.

## Capability inventory

At the branch point Tao already has projects and apps, imported runtime-backed views, typed view/action parameters, text and number values, item/list constructors, member reads, layout clauses, reactive view state, named and inline actions, state mutation, and Tao-authored press/text behavior tests.

The MVP must add one integrated path for:

- boolean and absent values, value-producing expressions, comparisons, boolean logic, interpolation, and pure functions;
- conditional and repeated rendering over lists;
- text input, change/submit events, validation, disabled/submitting state, stable identifiers, labels, and roles;
- schema declarations, related records, typed queries, filtering/order, reactive create/update/delete, durable local storage, and deterministic loading/failure tests;
- a deterministic stack navigator with typed destination arguments and back behavior;
- a complete, pleasant forcing app whose product behavior is authored in Tao.

## Numbered vertical slices

1. [x] **Expressions and control.** Add boolean/absence literals, precedence-aware unary/binary expressions, interpolation, expression-bodied pure functions, conditional rendering, and `for` rendering. Cover parser, scope/type validation, formatter, compiler, runtime semantics, diagnostics, and a focused executable Test App.
2. [x] **Interaction and forms.** Add event bindings for press/change/submit, runtime-backed text input, field labels and identifiers, validation patterns, and Tao test steps for entering and submitting text.
3. [x] **Data.** Add Tao schemas and entity handles, provider-neutral query/mutation IR, a durable local provider, filtering/order, relationships, reactive consistency, and deterministic loading/error controls.
4. [x] **Navigation.** Add an app-owned stack, destination declarations with typed arguments, present/back actions, deterministic runtime state, and test steps that exercise navigation.
5. [x] **Still.** Advance `Apps/MVP/Current/Still.tao` into the forcing app; cover workspace/task CRUD, completion, forms, filtering/order, loading/empty/error/populated states, and list/detail navigation in Tao behavior tests.
6. [x] **Agreement and hardening.** Align active specifications, roadmap status, Test Apps, MVP README, formatter/diagnostics, and tool commands; remove stale executable claims; run final verification and audit branch cleanliness.
7. [x] **Independent implementation review.** Compare the completed parallel MVP at grammar, validator, compiler, runtime, app, and test level; retain only improvements confirmed by source evidence.
8. [x] **Language consolidation.** Make `let` canonical, replace split `if` forms with one total value/render/action `when`, add boolean-state `toggle`, and add typed parameter defaults while retaining explicit interpolation, pure functions, `none`, strict invocation parentheses, and dot-labeled arguments.
9. [x] **Data hardening.** Separate schemas from app datasource providers; add required/defaulted fields, `time`, `now()`, index metadata, explicit cascade relationships, stable live entity handles, versioned AsyncStorage persistence, serialized saves, and surfaced load/save errors while preserving structured queries and strict diagnostics.
10. [x] **Navigation and test polish.** Keep typed stack/destination contracts, preserve covered screen state, add an automatic accessible Back affordance, make entity destination arguments live, and extend direct selector-based tests with placeholder/input-value/back coverage.
11. [x] **Canonical-app and agreement pass.** Remove forcing-app boilerplate and ordering bugs, add a task detail/editor journey, split behavior checks by purpose, align Test Apps/specs/roadmap/readmes, audit every requirement, and run final verification.
12. [x] **WordFlower restructuring.** Replace Still and Kitchen Sink with the WordFlower app family (`Apps/WordFlower/{Current,Next,Future}`): port the executable app, journeys, tooling fixtures, and Next decision sketches to the WordFlower domain; write the full-envelope Future reference; document Current/Next/Future as the standing implementation process.

## Decision log

- **2026-08-12 — Adopt WordFlower as the single canonical app and Current/Next/Future as the process.** Still (the executable MVP) and Kitchen Sink (the v1 showcase) are deleted. `Apps/WordFlower/1 - Current` is the executable, test-passing app carrying Still's feature set in the WordFlower domain plus the typed injection escape hatch as a word-count view; `Apps/WordFlower/2 - Next` holds the active decision sketches; `Apps/WordFlower/3 - MVP` is the malleable full target covering every planned capability, reconciled whenever Current absorbs a Next slice. WordFlower/1 - Current itself exercises Kitchen Sink's full language surface organically — custom primitive/list/item types, typed constructors, list literals, item member access, view-local and nested shadowed `let`, number state with compound `set`, `claim`/`width fill` layout clauses, and typed injection — and Type System Tests keeps the focused nested-shadowing coverage; parser/validator/formatter/runtime fixtures, Just recipes, and the dev-loop default now anchor on WordFlower/1 - Current. The process contract lives in `Apps/WordFlower/README.md`.
- **2026-08-10 — Integrate on one experimental branch.** Existing active roadmap branches remain independent and read-only. This branch implements the dependency chain itself so the result can be validated as one product.
- **2026-08-10 — Favor expression-bodied pure functions.** MVP functions are deterministic value transformations with an explicit return type and one expression body. Stateful work remains in actions; this avoids a second imperative statement language.
- **2026-08-10 — Keep data and navigation semantics in the runtime.** Generated TypeScript describes Tao-authored schemas, queries, mutations, and destinations. Reusable behavior belongs behind provider-neutral `TR` APIs.
- **2026-08-10 — Ship one local provider.** Still uses a durable device-local provider with an in-memory deterministic test mode. A remote-provider interface remains possible without adding credentials or hosted infrastructure.
- **2026-08-10 — Preserve the existing layout system.** MVP presentation extends runtime-backed controls and useful defaults instead of introducing the planned design-system language.
- **2026-08-10 — Use explicit interpolation composition.** `interpolate "Count: ", Count` is the MVP text-composition form. It accepts text, number, boolean, and `none` parts, avoids a custom multi-mode lexer, and leaves `${…}` template sugar as a reversible future extension.
- **2026-08-10 — Make functions positional and expression-bodied.** `function Label Count is number returns text = …` has a declared return type, positional `Label(Count)` calls, lexical parameter scope, and no side-effecting body statements.
- **2026-08-10 — Consolidate on one total conditional.** `when` uses ordered boolean branches plus required `otherwise` in value, render, and action positions. Totality keeps every value defined, makes loading/error/empty/content ladders flat, and adds conditional side effects without a second control construct. `for … in` remains render-local.
- **2026-08-10 — Make `let` canonical without mechanical AST churn.** `let Name = …` is the source form. Legacy `alias` remains parseable with a deprecation diagnostic while the existing internal AST name remains until a separate cleanup is justified.
- **2026-08-10 — Name ambiguous invocation inputs explicitly.** `.Value Draft` binds directly to the `Value` parameter before Tao's type-based matching runs. This makes duplicate primitive and action parameters practical for forms without making ordinary arguments positional.
- **2026-08-10 — Keep interaction component-owned.** `TextInput` and `FormButton` expose change, submit, and press through action-valued parameters. Their runtime implementations own React Native event adaptation, stable IDs, labels, disabled state, and basic accessible defaults.
- **2026-08-10 — Make callback contracts structural and explicit.** `action()` and `action(text, …)` describe the positional values a reusable component will supply. Named actions infer default-aware signatures, callbacks can be forwarded across component boundaries, dynamic `do Callback(args)` is checked positionally, and generated `TR.Action` types preserve the same contract. Bare `action` remains a zero-argument compatibility spelling.
- **2026-08-10 — Extend tests with direct semantic input steps.** The executable MVP uses text/label/id/placeholder selectors, `enter … into …`, `submit …`, `expect input … value …`, and root-safe test `back`; the runtime adapter resolves accessibility-visible controls and fires the corresponding native events.
- **2026-08-10 — Make queries reactive list values.** A view-local query compiles to a provider-neutral plan, subscribes through the runtime store, and composes with ordinary `for`, `.Empty`, `.Count`, and member access. `Loading` and `Error` are query-specific members so app-visible states remain Tao-authored branches.
- **2026-08-10 — Keep writes strict while adding explicit defaults.** `create Schema.Entity { … }` must provide every field without a declared default. Runtime defaults are limited to authored literals and `now()` for `time`; `update` and `delete` accept only live entity handles. Relationships name their target explicitly and opt into `on delete cascade` rather than relying on hidden cleanup policy.
- **2026-08-10 — Separate schema from provider configuration.** `data` owns reusable shape; an app-owned `datasource Data through Local|Memory` selects storage. Tests replace that provider per check without touching durable data.
- **2026-08-10 — Use one asynchronous local-storage abstraction.** Local persistence uses injectable AsyncStorage on native and web, persists a versioned envelope and ID counter, serializes saves, reports failures, and never silently falls back to memory. A newer queued full snapshot can recover a transient earlier save failure once it succeeds. This replaces the custom localStorage/Expo FileSystem split.
- **2026-08-10 — Make entity values stable live identities.** Queries intern schema/entity/id handles. Member reads dereference current store data, writes validate handle liveness, and data revisions rerender presented screens so entity arguments do not become stale snapshots.
- **2026-08-10 — Isolate and control data in Tao tests.** Every check gets a fresh memory store even for a `local` schema. `data Schema loading|ready|error "…"` synchronously drives provider states without touching durable developer data.
- **2026-08-10 — Let destinations inherit view signatures.** `destination WorkspaceDetail` references the view directly, so its parameter list is the navigation contract instead of being duplicated in a route declaration. `present StillNavigation.WorkspaceDetail(.Workspace Workspace)` reuses ordinary argument binding and diagnostics with a live entity value.
- **2026-08-10 — Keep navigation to one typed app-owned stack.** A stack has one argument-free initial destination, pushes distinct occurrences of declared destinations, keeps covered occurrences mounted but inaccessible, and safely no-ops when back reaches the root. An automatic accessible Back control and native hardware back dispatch the same reducer; tests reset history before each check.
- **2026-08-10 — Delimit every invocation.** Rendering, action `do`, pure functions, and navigation `present` require parentheses, including zero-argument calls. Render layout and children remain separate following clauses: `render View(args) [layout] { children }` and `View(args) [layout] { children }`; actions use `do Action(args)`, pure functions use `Function(args)`, and navigation uses `present Stack.Destination(args)`.

The consolidation replaces direct `expo-file-system` use with `@react-native-async-storage/async-storage`, a maintained Expo-compatible key-value abstraction shared by native and web. Its injectable interface makes persistence ordering, reload, and failure behavior testable without platform branching. Any later dependency must be justified here before it is committed.

## Deliberate deferrals

- authentication, accounts, permissions, collaboration, and remote sync;
- multiple database providers and provider-specific query syntax;
- tabs, windows, overlays, toasts, restoration, and deep links;
- design-token declarations, themes, animation, and exhaustive platform styling;
- generics, macros, async functions, arbitrary higher-order collection APIs, and exhaustive operators;
- production deployment, publishing, project scaffolding, and broad IDE polish.

## Success checklist

- [x] `feat/autonomous-language-mvp` contains intentional consolidation work only and remains available for Ro's review.
- [x] `Apps/WordFlower/1 - Current/WordFlower.tao` is executable through the normal dev/runtime path after the consolidated syntax/runtime migration.
- [x] WordFlower persists related data and supports CRUD, completion, forms, filtering/order, reactive updates, and live detail editing without manual ordering state.
- [x] WordFlower visibly covers loading, empty, validation-error, provider-error, recovery, and populated states.
- [x] WordFlower has deterministic state-preserving list/detail navigation and automatic/native back behavior.
- [x] Primary WordFlower journeys are covered by focused Tao-authored behavior tests.
- [x] Expressions, control flow, collections, interaction, data, forms, and navigation compose without app-specific TypeScript business logic.
- [x] Common invalid usage has actionable diagnostics and accepted syntax formats deterministically.
- [x] Active specifications, roadmap, Test Apps, and MVP documentation agree with the consolidated implementation.
- [x] Focused tests and final `./agent verify` pass against the final working tree.
