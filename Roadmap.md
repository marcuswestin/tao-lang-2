# Tao Roadmap

Open work only. Completed work is recorded under `Roadmap/Archive/`.

Language features are built in tranches through the WordFlower app family: decisions are settled in
`Apps/WordFlower/2 - Next`, implemented into `1 - Current` slice by slice, then `3 - MVP` and
`4 - Revolution` are reconciled once. `Apps/WordFlower/README.md` owns that process.

## Current tranche

- [x] Implement the WordFlower tranche 3 contract into Current
  - Selection navigation, entity availability guards, dialogues, keyed toasts as a presentation mode, reshaped data fields, the third data level, and self-hosted navs and datasources graduated into `packages/stdlib/tao`.
- [x] Cut and solidify the WordFlower tranche 4 contract in Next
  - `2 - Next` is now the complete implementation contract: the declaration/value model, Prelude
    hierarchy, required declaration parentheses, block-bodied functions, typed injection, optional
    item fields, `list of T`, nominal enums, `@tao/text`, new UI surfaces, adaptive panes,
    non-blocking `async { ... }`, named frame slots, and the first flat-token design slice.
- [x] Implement the WordFlower tranche 4 contract into Current
  - Follow `Roadmap/Implement WordFlower tranche 4/Brief - Implement WordFlower tranche 4.md` and
    absorb the complete Next directory slice by slice. InstantDB, remote authorization semantics,
    richer data test controls, snapshots, SplitNav/windows, semantic design recipes, and general
    concurrency policy remain in later tiers.

## Toward v1

- [x] Add typed TS value injection expressions
  - Tranche 4 added `let X is T = inject T ...` with Tao-side typing and generated TypeScript return
    checking.
- [ ] Harden `tao test`
  - Filters, watch and CI output, richer failure reporting, and broader runtime coverage. Test Apps already assert behavior in Tao.
- [ ] Add the Tao design system MVP
  - Deterministic design declarations, tokens, semantic tokens, component recipes, source-level application, runtime lowering, and first diagnostics. Plan: `Roadmap/Add Tao design system MVP/`.
- [ ] Add beautiful app defaults
  - Polished default text, input, and button styles, seeded accent, neutral palette, app-shell content frame, and empty/error/loading surfaces.
- [ ] Add `tao create` project scaffold
  - New app folder, minimal Tao app, default package layout, docs, dev and test scripts, and an immediate open-and-run path.
- [ ] Finish the device experience
  - `tao dev` now owns discovery, app selection, and switching. Remaining: file watching across imports, iOS device LAN support, and Android/web parity where practical.
- [ ] Add production and staging runtime targets
  - Build profiles, environment handling, runtime manifest boundaries, secrets policy, and Expo build expectations.
- [ ] Polish the IDE MVP
  - Syntax, diagnostics, formatting, source actions, go-to-definition and references, and live preview once the runtime and test flow are stable.
- [ ] Complete canonical app and v1 hardening
  - Build WordFlower end to end, close gaps, tighten diagnostics and docs, remove stale drift, and validate `verify`.

## Ro's stack

Product and codebase backlog, unordered.

- [ ] Add simulation mode: local datasources with simulated network delays, saved library states, and demo renders.
- [ ] Improve the imports and exports structure. Decide whether namespaces are used commonly, and whether types and values can be exported together from one default export.
- [ ] Review all tests: remove unnecessary surfaces and overlaps, favor e2e coverage of the underlying packages, and justify each remaining test.
- [ ] Allow only one project definition per project root; scope workspace package lookup to that root, have the IDE extension manage one workspace per project folder, and stop requiring a Git repo at the project root.
- [ ] Implement styling, and then all of `Spec/Tao Layout and UI.md`.
- [x] Allow `TYPE Value` construction in general positions.
- [x] Require the element type of lists with `list of T`.
- [ ] Change the argument order of `ValidationContext.error` and its siblings.
- [ ] Clean up the TR package: inter-dependencies, structure, and a slow pass simplifying each file.
- [ ] Remove magical strings.
- [ ] Improve utility function usage, preferring grouped helpers over many free imports.
- [ ] Apply the named-const export pattern across the repo, then rename modules to match their main export in one coordinated sweep.
- [ ] Rename `gen` helper properties to capitalized names, and stop `fmt` from breaking `gen\`…\`` onto the next line.
- [ ] Add generic compiled test declarations.
- [ ] Enable over-the-network dev app running for iOS devices.

### Smaller follow-ups

- Formatter: keep standalone comments attached to the following top-level declaration when separating with blank lines.
- Formatter: drop redundant `render` keywords once the language makes `render` optional in view bodies.
- Compiler: add codegen tracing and source maps when needed.
- Dev loop: watch resolved relative import roots outside the selected app folder.

## Records

- `Apps/WordFlower/README.md` — the implementation process and the four app tiers.
- `Roadmap/Deferred Tao language decisions.md` — the LANG-001..030 deferred-decision inventory.
- `Roadmap/Add navigation and routing MVP/Follow-ups - …md` — unimplemented navigation work and `DEF-NAV-*` deferrals.
- `Roadmap/Archive/Repository foundations/` — the package, automation, and language-service foundation record.
- `Roadmap/Archive/Code cleanup spike/Report.md` — the completed cleanup spike and R1–R13 rulebook.
- `Roadmap/Archive/` — frozen records of completed work.
