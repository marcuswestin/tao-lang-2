# Tao Reimplement Roadmap

Track the clean, stepwise Tao reimplementation. Keep this current as each slice is ready for Ro review and commit.

## MVP Roadmap

- [x] Add item/list/custom type MVP
  - Item/object literals, list literals, typed item constructors, simple custom type declarations, and field/member validation.
  - Plan: `Roadmap/Add item list custom type MVP/Plan - Add item list custom type MVP.md`

- [ ] Add layout/style arguments and app-shell baseline
  - `[gap 8, pad 12, width fill]`, runtime layout lowering, safe default app frame, safe area/keyboard basics, and deterministic cross-platform behavior.

- [ ] Add state and action MVP
  - `state`, named/inline `action`, `set`, `do`, action parameters, stateful type behavior, and reactive rerendering.

- [ ] Expand core expression/value language
  - Booleans, string interpolation, arithmetic, comparison, basic boolean operators, member access, call expressions, and better diagnostics.

- [ ] Add control flow and collection rendering MVP
  - `if/else`, `when` if still preferred, pure functions/returns, `.Empty`, `for` over lists/query results, and formatter/compiler support.

- [ ] Add datasource schema and query MVP
  - `data`, entities/fields/relationships, `query`, `where`, ordering, `guard`, typed query rows, and Memory provider support.
  - `create`, strict row-handle `update`, provider-neutral IR, local InstantDB support, local dev setup, and post-write UI consistency.

- [ ] Add typed TS value injection expressions
  - `alias X = inject text/number ...`, with Tao-side declared type and generated TS return checking.

- [ ] Add navigation and routing MVP
  - `navigator`, stack/tabs, screen params, path metadata, `navigation push/pop/tab`, generated React Navigation runtime, and route tests.

- [ ] Define canonical buildable app target and acceptance bar
  - Pick the forcing app, probably a Still/TODOs-class app: local data, relationships, empty states, create/update flows, navigation, forms, polished defaults, and tests.

- [ ] Implement Tao-native testing v0
  - Inline/sidecar `test`, `expect text`, `expect missing text`, test-plan IR, runtime Jest execution through the existing Expo harness.

- [ ] Add `tao test` and migrate Test Apps to Tao-authored behavior tests
  - Make Test Apps assert behavior in Tao instead of only package/runtime Jest fixtures.

- [ ] Add interaction event MVP
  - Press/change/submit/focus behavior for built-in controls, event-to-action binding, disabled/loading behavior, and testable event semantics.

- [ ] Add render IDs and minimal accessibility semantics
  - Stable test/accessibility identifiers, labels, roles for built-ins, useful TextInput/Button semantics, and validator guidance.

- [ ] Add forms and inputs MVP
  - TextInput, field labels, local form state, validation/error display, submit/change/focus flow, keyboard handling, and accessible feedback.

- [ ] Add loading, empty, and error-state MVP
  - Practical `guard`/boundary semantics, app-visible failure states, provider/runtime errors, and canonical patterns for first apps.

- [ ] Add beautiful app defaults mini slice
  - Polished default text/input/button styles, seeded accent, neutral palette, app-shell content frame, empty/error/loading surfaces.

- [ ] Add `tao create` project scaffold
  - New app folder, minimal Tao app, default package layout, AGENTS/docs, dev/test scripts, and immediate “open and run” path.

- [ ] Finish dev loop/device experience
  - `tao dev`/`./dev` parity, app switching, file watching across imports, iOS device LAN support, Android/web parity where practical.

- [ ] Add production/staging runtime targets
  - Build profiles, environment handling, runtime manifest boundaries, secrets policy, Expo web/native build expectations.

- [ ] Polish IDE MVP
  - Syntax, diagnostics, formatting, source actions, go-to-definition/reference basics, and live preview once runtime/test flow is stable.

- [ ] Complete Kitchen Sink as the v1 feature showcase
  - One navigable app demonstrating every shipped v1 feature, separate from focused Test Apps.

- [ ] Complete canonical app and v1 hardening
  - Build the selected real app end to end, close gaps, tighten diagnostics/docs, remove stale roadmap/spec drift, and validate `prep`.

## Ro's STACK

- [ ] Create "validators" directory for all the "*-validator.ts" files
- [x] Port over scope functionality
  - E.g: `aliasesOwnedByView`, reportAliasReferenceOrder/isDeclaredBefore - S should simply detect if there are duplicate identifiers, but then add the aspect of scope.
- [x] Add ability for `inject` to take kvp arguments, which become available inside the inject statement directly, e.g. `inject Value, Name UserName`.
- [x] Add runtime stdlib and module imports
  - Import previous-repo `use ... from @tao/ui` / relative `use` behavior, enough package/project/publish visibility for stdlib declarations, and first runtime-backed UI views: `Text`, `Number`, `Button`, `Col`, `Row`, `Box`, `Stack`, `WrappingRow`, `TextFrame`, and `TextMultiline`.
- [x] Add formatter package: feature-sliced `Format` handlers over a succinct `NodeFormat` helper layer, injection-fence re-indenting, and Kitchen Sink fixed-point tests
- [x] Wire the formatter into the IDE extension language server and add repo-wide `tao fmt`/`tao fix`/`tao check` (tao-cli), run by `just fmt`/`fix`/`check`
- [x] Add LSP/IDE source actions: `Tao: Organize Use Statements` (source.organizeImports), unused/out-of-section import warnings with quick fixes, command-palette entries prefixed `Tao:`, a move-render-last quick fix, and `tao fix` applying all source fixes (run by `just fix`)
- [ ] Consider only allowing state inside view declarations. App state maybe should be a datasource, that could be persisted to disk
- [ ] Figure out tao testing story. How are tests stated? Datasource injection, Initial data, actions and checks, etc ...
- [ ] Add typed TS value injection expressions: `alias X = inject <type>`ts ...`
  - Plan: `Roadmap/Inject typed TS values/Plan - Inject typed TS values.md`
- [ ] Add layout/style arguments and default app-shell UI baseline
  - Import previous-repo layout modifiers such as `[gap 8, pad 12, width fill]`, runtime `__tao.layout` forwarding, app-shell content frame, and deterministic default styling for stdlib primitives.
- [ ] Remove magical strings
- [ ] Add state/actions/control mini slice
  - Import `state`, `action`, action parameters/values, inline `action {}`, `set`, `do`, `if/else`, `function` return, string interpolation, and basic operators needed by old `Action Invocation` and `Control Syntax` examples.
- [ ] Improve util fn usages, e.g GenUtil instead of importing seperate functions
- [ ] Improve code structure such that `fmt` layout of switch -> gen statements doesn't have gen`...` appear on the next line, somehow.
- [ ] Update target kitchen sink to have lots of intended parts featured
- [ ] Add generic compiled-add test declarations
  - Should this map to test writing for the actual apps?
- [ ] Enable over-the-network dev app running for ios device

- Add followups for later:
  - Formatter: keep standalone comments attached to the following top-level declaration when separating with blank lines
  - Formatter: drop redundant `render` keywords automatically per `Spec/Tao Type System.md` once the language makes `render` optional in view bodies
  - Think through how to do app testing, and how to use that for our repo test apps tests
  - Compiler: Add codegen tracing/source maps when needed
  - Dev loop: watch resolved relative import roots outside the selected app folder.

## Language

- Spec
  - Copy/fill spec
- Apps
  - Kitchen Sink
    - Target: intended Tao syntax/functionality written during research and planning when the target should change
    - Current: executable Tao app used by tests; copy in target slices only after that functionality is implemented

## Minimal Port: Kitchen Sink Current

- 26-05-xx
  - [x] Parser
    - [x] Add `Apps/Kitchen Sink/Kitchen Sink.tao`
    - [x] Add `packages/parser` as `@parser`
    - [x] Split grammar under `packages/parser/parser-grammar`
    - [x] Generate Langium parser artifacts under `parser-src/_gen_tao-parser`
    - [x] Export `AST`, `Langium`, and the `Parser` object API
    - [x] Support current syntax: `app`, `view`, text parameters, `render`, view calls, optional empty blocks, and `inject` TS fences
    - [x] Keep `Render` named `Render`
    - [x] Parse general statements and leave context-specific placement checks for the validator
    - [x] Cover parser grammar mechanics without adding validator behavior
    - [x] Add parser tests for Kitchen Sink and source strings
    - [x] Ro review
  - [x] Compiler
    - [x] Write compiler tests before implementation
    - [x] Add `packages/compiler` as `@compiler`
    - [x] Export compiler entrypoints
    - [x] Emit Expo-compatible TSX for the supported AST only
    - [x] Generate a default exported React component
    - [x] Include `Hello, World!`, `MainView`, `Text`, and view props in generated output
    - [x] Fix Kitchen Sink `Text` injection to return evaluated text in `<RN.Text>`
    - [x] Ro review
  - [x] Runtime
    - [x] Write runtime e2e test before implementation
    - [x] Add `packages/runtime` as `@runtime`
    - [x] Add minimal Expo web host files
    - [x] Compile app into ignored `packages/runtime/_gen_tao-app`
    - [x] Add dev-loop Expo launch to compile Kitchen Sink and start Expo web
    - [x] E2E render verifies `Hello, World!`
    - [x] Verify `./agent just dev` starts Expo web
    - [x] Ro review
- 26-06-05
  - [x] Compiler: Create plain codegen wrapper and start using that
  - [x] INSTRUCT: How to to separate parts of the language into different files
  - [x] Implement proper inject statement
  - [x] Remove hard-coded kitchen sink stuff
  - [x] Add validator, type system, and IDE diagnostics
    - Plan: `Roadmap/Add validator and type system/Plan - Add validator and type system.md`
  - [x] Add runtime TR object, create instructions for minimizing generated code and maximizing functionality existing in the runtime
- 26-06-13
- [x] Port over scope functionality
  - E.g: `aliasesOwnedByView`, reportAliasReferenceOrder/isDeclaredBefore - S should simply detect if there are duplicate identifiers, but then add the aspect of scope.
- [x] Add ability for `inject` to take kvp arguments, which become available inside the inject statement directly, e.g. `inject Value, Name UserName`.
- [x] Add runtime stdlib and module imports
- [x] Have `./dev [path/to/tao/app]` without command start a dev TUI, which:
  - defaults to Kitchen Sink when no app path is supplied
  - compiles the tao app
  - launches the app in an expo runtime, opening web/ios and already-available android targets
  - watches the tao app folder and recompiles on changes, including files not yet in the imported dependency tree
  - watches the compiler/runtime/etc and its dependencies and recompiles on changes
  - accepts input with
    - 'd' to quit and reload the dev process
    - 'r' to reload the Expo app
    - 'w' to open Expo web
    - 'i' to open Expo iOS
    - 'a' to open Expo Android
    - 't' to run all tests
    - 'q' to quit
    - 's' to switch app
    - 'e' to build and install the ide extension
    - 'f' to fix
    - 'c' to clean, reinstall deps, quit, and reload
    - 'p' to run prep
