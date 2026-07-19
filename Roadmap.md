# Tao Reimplement Roadmap

Track the clean, stepwise Tao reimplementation. Keep this current as each slice is ready for Ro review and commit.

## MVP Roadmap

- [x] Add item/list/custom type MVP
  - Item/object literals, list literals, typed item constructors, simple custom type declarations, and field/member validation.
  - Plan: `Roadmap/Add item list custom type MVP/Plan - Add item list custom type MVP.md`

- [x] Add layout clauses and app-shell baseline
  - `[gap 8, pad 12, width fill]`, runtime layout lowering, safe default app frame, safe area/keyboard basics, and deterministic cross-platform behavior.

- [x] Add state and action MVP
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

- [x] Implement Tao-native testing v0
  - Inline/sidecar `test`, `expect text`, `expect missing text`, test-plan IR, runtime Jest execution through the existing Expo harness, and minimal `tao test [path]`.

- [ ] Migrate Test Apps to Tao-authored behavior tests and harden `tao test`
  - Make Test Apps assert behavior in Tao instead of only package/runtime Jest fixtures; add filters, watch/CI output, richer failure reporting, and broader runtime coverage.

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
  - Build the selected real app end to end, close gaps, tighten diagnostics/docs, remove stale roadmap/spec drift, and validate `verify`.

## Ro's STACK

- [ ] Add typed TS value injection expressions: `alias X = inject <type>`ts ...`
  - Plan: `Roadmap/Archive/Inject typed TS values/Plan - Inject typed TS values.md`
- [x] Reorganize agent context
  - Reports and plan: `Roadmap/Reorganize agent context/`
- [ ] Improve imports/exports structure. Decide whether namespaces are used commonly. See if possible to have types and values exported at the same time, keyed off from the same default export.
- [ ] Review all tests, remove uneccessary test surfaces, remove test surface overlaps; favor e2e testing that covers the underlying packages. For each test, justify why we should test it (vs assuming the underlying functionality works). Where to be thorough, where to smoke test
- [ ] Ensure that a project doesn't have multiple project definitions inside it - only in the root directory.
  - [ ] Then ensure that a workspace only looks inside its root folder for packages; and have the ide extension manage multiple workspaces (one for each project folder); and stop requiring a tao project to have a git repo at its root, as long as it is inside a git repo (to allow for multiple tao projects in a single repo)
- [ ] Implement styling
- [ ] Actions
  - [ ] Add `on press` etc
  - [ ] Switch other test apps to use tao testing rather than ts
- [ ] Change argument order of `ValidationContext.error`/etc
- [ ] Require type of lists: `view TagText Tags is list {`
- [ ] Implement boolean operators, requiring `EXPRESSION is OPERATOR EXPRESSION`, e.g `Age is < 10`
- [ ] Allow `TYPE Value` in general, e.g `alias TYPENAME value literal`, `VIEW TYPEVALUE, TYPENAMEItemInThisCase { Foo 1, Bar 2 } < VIEW RENDER BODY >`
- [ ] Implement all of `Tao Layout and UI.md`
- [ ] /refactor all test files that are getting really big
- [ ] Review all validator file structure; and consider simplifying
- [ ] Create "validators" directory for all the "*-validator.ts" files
- [ ] Cleanup TR package inter-dependencies and general structure for cleanliness
- [ ] Go through each TR/ file, and review them slowly, and simplify and cleanup code where possible.
- [ ] Update validator code to walk through the tree once, as opposed to filtering out odes and validating them in order of type.
- [ ] Change validator structure, to go away from walking the tree multiple times and filtering for type; and instead walking each node once, and validating it based on its type.
- [ ] Remove magical strings
- [ ] Add remaining control mini slice
  - Import `if/else`, `function` return, string interpolation, and basic operators needed by old `Action Invocation` and `Control Syntax` examples.
- [ ] Improve util fn usages, e.g GenUtil instead of importing seperate functions
- [ ] Improve code structure such that `fmt` layout of switch -> gen statements doesn't have gen`...` appear on the next line, somehow.
- [ ] Rename all `gen` helper properties to capitalized names, e.g. `gen.Comment`, `gen.Block`, and `gen.List`.
- [ ] Apply the main named const export pattern across the rest of the repo
  - Prefer `export const ModuleName = { ... }` over default exports or many free function exports. Keep existing filenames while converting existing modules.
- [ ] Rename existing TypeScript module files to match their main named const exports
  - Do this in one coordinated sweep after current projects have merged, rather than inside each active feature branch.
- [ ] Add generic compiled-add test declarations
  - Should this map to test writing for the actual apps?
- [ ] Enable over-the-network dev app running for ios device

### Ro's STACK Archive

- [x] Update Roadmap.md, to move all completed STACK items to the Archive section.
- [x] Consolidate Test App purpose contracts into `Apps/Test Apps/README.md`.
- [x] Create langium types for Statement, such that we have e.g ViewStatement, ProjectStatement, FileStatement, etc
  - [x] And add comments to the Statement rule, to separate ones that are in one context only (e.g test statements).
  - [x] Consider adding `check` statements to the language, as asserts
- [x] Find all direct usages of JSON.* and see if they should be put in e.g shared.
- [x] Use Switch* over clear production typed/enum-like branch sites handled by this spike, leaving guard and narrowing checks alone.
- [x] Add actions to kitchen sink tests
- [x] Replace render child blocks with angle blocks: `render VIEW ... < ... VIEW < .. > .. >`
- [x] Implement Dev menu etc in tao
- [x] Port over scope functionality
  - E.g: `aliasesOwnedByView`, reportAliasReferenceOrder/isDeclaredBefore - S should simply detect if there are duplicate identifiers, but then add the aspect of scope.
- [x] Add ability for `inject` to take kvp arguments, which become available inside the inject statement directly, e.g. `inject Value, Name UserName`.
- [x] Add runtime stdlib and module imports
  - Import previous-repo `use ... from @tao/ui` / relative `use` behavior, enough package/project/publish visibility for stdlib declarations, and first runtime-backed UI views: `Text`, `Number`, `Button`, `Col`, `Row`, `Box`, `Stack`, `WrappingRow`, `TextFrame`, and `TextMultiline`.
- [x] Add formatter package: feature-sliced `Format` handlers over a succinct `NodeFormat` helper layer, injection-fence re-indenting, and Kitchen Sink fixed-point tests
- [x] Wire the formatter into the IDE extension language server and add repo-wide `tao fmt`/`tao fix`/`tao check` (tao-cli), run by `just fmt`/`fix`/`check`
- [x] Add LSP/IDE source actions: `Tao: Organize Use Statements` (source.organizeImports), unused/out-of-section import warnings with quick fixes, command-palette entries prefixed `Tao:`, a move-render-last quick fix, and `tao fix` applying all source fixes (run by `just fix`)
- [x] Add layout clauses and default app-shell UI baseline
  - Import previous-repo layout modifiers as Tao-owned clauses such as `[gap 8, pad 12, width fill]`, runtime `__tao.layout` forwarding, app-shell content frame, and deterministic default layout for stdlib primitives.

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
    - Executable Tao app used by tests; add slices only after that functionality is implemented

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
    - [x] Verify `just dev` starts Expo web
    - [x] Ro review
- 26-06-05
  - [x] Compiler: Create plain codegen wrapper and start using that
  - [x] INSTRUCT: How to to separate parts of the language into different files
  - [x] Implement proper inject statement
  - [x] Remove hard-coded kitchen sink stuff
  - [x] Add validator, type system, and IDE diagnostics
    - Plan: `Roadmap/Archive/Add validator and type system/Plan - Add validator and type system.md`
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
    - 'v' to run verify
