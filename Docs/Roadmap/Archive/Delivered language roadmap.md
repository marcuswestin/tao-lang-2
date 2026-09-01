# Delivered — language roadmap

Archived record of completed roadmap work, moved out of `Roadmap.md` so that file holds only open
work. Descriptions are as they read when delivered; later tranches have since changed some of the
spellings. The live contracts are `Apps/WordFlower/` and `Docs/Spec/`.

## Language MVP slices

- Complete the autonomous functional-language MVP experiment. Record: `Docs/Roadmap/Archive/Autonomous language MVP/Project.md`.
- Add item/list/custom type MVP. Plan: `Docs/Roadmap/Archive/Add item list custom type MVP/`.
- Add layout clauses and app-shell baseline: runtime layout lowering, safe default app frame, safe-area and keyboard basics.
- Add state and action MVP: `state`, named and inline actions, `set`, `do`, action parameters, reactive rerendering.
- Expand the core expression/value language: booleans, `none`, interpolation inside strings, arithmetic/comparison/boolean expressions, function calls, collection and text members, and mandatory `Name(args)` invocation delimiters.
- Add control flow and collection rendering: expression-bodied functions, subject-based exhaustive `when`, block-scoped action and render guards, `toggle`, `is empty`/`.Count`, and `loop Plural / Singular`.
- Add datasource schema and query MVP: top-level `data Plural / Singular` catalogs, configured Local and Memory providers, defaults, `time`, index metadata, inferred relationships, reactive queries with filtering and ordering, live entity rows, strict writes, versioned persistence, and transitive cascade.
- Add navigation and routing MVP: configured StackNav/SlotNav/OverlayNav values, `ui` presentation with contextual and strict targets, dismiss, root replace, state-preserving history, accessible/native/test back, and explicit multi-app selection.
- Define the canonical buildable app target and acceptance bar: `Apps/WordFlower/1 - Current`.
- Implement Tao-native testing v0: inline and sidecar `test`, text/label/placeholder and `#tag` selectors, scoped row selection, grouped and input-value assertions, deterministic data states, structured test-plan IR, and `tao test [path]`.
- Add interaction event MVP: press/change/submit for built-in controls, action-valued parameters, disabled and submitting suppression, and deterministic event tests.
- Add render tags and minimal accessibility semantics: private test tags merged into native roots without layout wrappers, labels and roles, and scoped loop-row selection.
- Add forms and inputs MVP: TextInput, labels, local form state, validation display, submit/change flow, and accessible feedback.
- Add loading, empty, and error-state MVP: mutually exclusive query `loading` / `error -> Message` / ready-empty / ready-nonempty cases and app-visible provider failures.
- Absorb the 2026-08 WordFlower tranche into Current, then cut the following tranche.
- Implement the WordFlower tranche 3 contract into Current: selection navigation, entity availability guards, dialogues, keyed toasts as a presentation mode, reshaped data fields, the third data level, and self-hosted navs and datasources graduated into `packages/stdlib/tao`.
- Cut and solidify the WordFlower tranche 4 contract in Next: the declaration/value model, Prelude hierarchy, required declaration parentheses, block-bodied functions, typed injection, optional item fields, `list of T`, nominal enums, `@tao/text`, new UI surfaces, adaptive panes, non-blocking `async { ... }`, named frame slots, and the first flat-token design slice.
- Implement the WordFlower tranche 4 contract into Current, absorbing the complete Next directory slice by slice. Record: `Docs/Roadmap/Archive/Implement WordFlower tranche 4/`. InstantDB, remote authorization semantics, richer data test controls, snapshots, SplitNav/windows, semantic design recipes, and general concurrency policy remain in later tiers.
- Add typed TS value injection expressions: `let X is T = inject T …` with Tao-side typing and generated TypeScript return checking, delivered by tranche 4.
- Cut and implement the dialect-migration tranche (Process step 1). Record: `Docs/Roadmap/Archive/Dialect migration tranche/`.
- Implement the focused writing tranche. Record: `Docs/Roadmap/Archive/Focused writing tranche/`.

## Delivered from Ro's stack

- Retire the `ui` keyword — the unified-view tranche folded it into `view`. No `scene` construct was introduced, and none is intended; the original "rename UI to Scene" wording described a rename that did not happen.
- Upgrade all dependencies of e.g. expo/react-native/expo-router/etc.
- String interpolation syntax highlighting.
- Reorganize agent context. Reports and plan: `Docs/Roadmap/Archive/Reorganize agent context/`.
- Implement boolean operators — conventional precedence-aware expressions with `not`, `and`, `or`.
- Add the remaining control mini slice — expression-bodied functions with explicit return types and one exhaustive conditional.
- Add `on press|change|submit`, scoped inline handlers, and direct-state two-way input binding.
- Consolidate Test App purpose contracts into `Apps/Test Apps/README.md`.
- Create Langium statement types and add `check` statements to the language.
- Find direct `JSON.*` usages and move them behind shared helpers.
- Use `Switch*` over typed enum-like branch sites.
- Replace render child blocks with block syntax.
- Implement the dev menu.
- Port over scope functionality, including duplicate-identifier detection with scope.
- Let `inject` take key-value arguments available inside the injected fence.
- Add the runtime stdlib and module imports: `use … from @tao/ui`, relative `use`, visibility for stdlib declarations, and the first runtime-backed views.
- Add the formatter package with feature-sliced handlers, injection-fence re-indenting, and fixed-point tests.
- Wire the formatter into the IDE language server and add repo-wide `tao fmt`/`fix`/`check`.
- Add LSP source actions: organize use statements, unused-import warnings with quick fixes, `Tao:` command-palette entries, and move-render-last.
- Add layout clauses and the default app-shell UI baseline.
- Allow `TYPE Value` construction in general positions.
- Require the element type of lists with `list of T`.

## Minimal port: the first executable app

The original stepwise port that produced the parser, compiler, and runtime packages, delivered
between 2026-05 and 2026-06 against a Kitchen Sink app that no longer exists.

- **Parser** — the app fixture, `packages/parser` as `@parser`, split grammar under `parser-grammar`, generated Langium artifacts under `parser-src/_gen_tao-parser`, exported `AST`/`Langium`/`Parser`, support for `app`, `view`, text parameters, `render`, view calls, and `inject` fences, general statement parsing with placement checks left to the validator, and parser tests.
- **Compiler** — tests before implementation, `packages/compiler` as `@compiler`, exported entrypoints, Expo-compatible TSX for the supported AST, and a default exported React component.
- **Runtime** — an e2e test before implementation, `packages/runtime` as `@runtime`, minimal Expo web host files, compilation into the ignored `_gen_tao-app`, and a dev-loop Expo launch.
- **Follow-on work** — the plain codegen wrapper, a proper `inject` statement, removal of hard-coded fixture handling, the validator/type system and IDE diagnostics (plan: `Docs/Roadmap/Archive/Add validator and type system/`), and the `TR` runtime object with instructions for minimizing generated code.
- **Dev loop** — `./dev [app path]` starting a TUI that defaults to the canonical app, compiles it, launches Expo across web/iOS/Android, watches app and toolchain sources, and accepts single-key commands for reload, targets, tests, fix, verify, clean, app switching, and IDE extension install.
