# Tao Reimplement Roadmap

Track the clean, stepwise Tao reimplementation. Keep this current as each slice is ready for Ro review and commit.

## Ro's STACK

- [x] Port over scope functionality
  - E.g: `aliasesOwnedByView`, reportAliasReferenceOrder/isDeclaredBefore - S should simply detect if there are duplicate identifiers, but then add the aspect of scope.
- [x] Add ability for `inject` to take kvp arguments, which become available inside the inject statement directly, e.g. `inject Value, Name UserName`.
- [ ] Add runtime stdlib and module imports
  - Import previous-repo `use ... from @tao/ui` / relative `use` behavior, enough `share`/visibility for stdlib declarations, and first runtime-backed UI views: `Text`, `Number`, `Button`, `Col`, `Row`, `Box`, `Stack`, `WrappingRow`, `TextLabel`, and `MultiLineText`.
- [ ] Figure out tao testing story. How are tests stated? Datasource injection, Initial data, actions and checks, etc ...
- [ ] Add typed TS value injection expressions: `alias X = inject <type>`ts ...`
  - Plan: `Roadmap/Inject typed TS values/Plan - Inject typed TS values.md`
- [ ] Add layout/style arguments and default app-shell UI baseline
  - Import previous-repo layout modifiers such as `[gap 8, pad 12, width fill]`, runtime `__tao` layout forwarding, app-shell content frame, and deterministic default styling for stdlib primitives.
- [ ] Remove magical strings
- [ ] Add state/actions/control mini slice
  - Import `state`, `action`, action parameters/values, inline `action {}`, `set`, `do`, `if/else`, `function` return, string interpolation, and basic operators needed by old `Action Invocation` and `Control Syntax` examples.
- [ ] Improve util fn usages, e.g GenUtil instead of importing seperate functions
- [ ] Improve code structure such that `fmt` layout of switch -> gen statements doesn't have gen`...` appear on the next line, somehow.
- [ ] Update target kitchen sink to have lots of intended parts featured
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
- [ ] Add generic compiled-add test declarations
  - Should this map to test writing for the actual apps?
- [ ] Enable over-the-network dev app running for ios device

- Add followups for later:
  - Think through how to do app testing, and how to use that for our repo test apps tests
  - Compiler: Add codegen tracing/source maps when needed

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
    - [x] Support current syntax: `app`, `ui`, text parameters, `render`, view calls, optional empty blocks, and `inject` TS fences
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
