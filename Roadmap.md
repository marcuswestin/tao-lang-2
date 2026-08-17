# Tao Roadmap

Open work only. Completed work is recorded under `Roadmap/Archive/`.

Language features are built in tranches through the WordFlower app family: decisions are settled in
`Apps/WordFlower/2 - Next`, implemented into `1 - Current` slice by slice, then `3 - MVP` and
`4 - Revolution` are reconciled once. `Apps/WordFlower/README.md` owns that process.

## Documentation cleanup

Two scoped passes over the repository's own records. Both are bookkeeping, not language work, and
neither blocks a tranche.

- [ ] Reorganize this roadmap by category and size
  - `Toward v1` and `Ro's stack` are flat lists that mix multi-week workstreams with one-line
    follow-ups, so nothing can be scanned for what to pick up next. Group entries by area and mark
    their rough size, keeping this file the single index of open work.
- [ ] Rework the rest of the markdown set
  - Covers `Spec/` and the remaining `Roadmap/` folders: archive the landed declaration-model
    records, de-duplicate the design-system open questions and the project-ID contract into one
    home each, settle the descriptor-identity draft, and write down the draft-suffix convention plus
    an authoritative map of what every document is for. An audit produced concrete per-file
    dispositions, but it predates the tranche 4 documentation edits, so re-verify each finding
    against the current files before acting on it.

## Current tranche

- [ ] Cut tranche 5 from the gap between Current and MVP
  - Tranche 4 is absorbed: `1 - Current` and `2 - Next` are byte-identical and both read
    `Tranche status: absorbed`. InstantDB, remote authorization semantics, richer data test controls,
    snapshots, SplitNav/windows, semantic design recipes, and general concurrency policy are the
    largest capabilities still held in the later tiers.

## Toward v1

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
- [ ] Bridge React Native and Expo APIs into Tao
  - Design how a native API becomes a Tao binding before building more of them: whether bindings can
    be generated from TypeScript type definitions or published documentation, driven by per-API
    configuration through one bridging engine, or must stay hand-written — optimizing for the least
    work per additional API. Settle whether React Native or Expo is the primary target, or whether
    both stay first-class. Then prove the design on `Vibration` and `Share` (React Native core) and
    `Clipboard`, `Haptics`, and `Location` (Expo), chosen to span fire-and-forget, async-with-result,
    and permission-gated fallible shapes. `Haptics` and `Vibration` overlap deliberately: decide
    whether one capability may ever expose two bindings.
  - Reference: the `reference/rn-expo-bridge-drafts` branch holds 47 unreviewed draft modules
    covering both targets, each using one pattern worth evaluating — a driver type, a test-driver
    escape hatch, and lazy native `require()`. It is reference only and does not merge; its runtime
    entry point conflicts structurally with the current domain-split `TR.ts`.
- [ ] Finish shell completions for the Tao CLI
  - `tao complete <shell>` and `tao completion install` ship for bash, zsh, and fish through
    `@bomb.sh/tab`. Remaining: PowerShell installation, which the library generates but the installer
    does not place, and per-argument completions for app names, paths, and test patterns.
- [ ] Build the enforcement and diagnostics surface
  - A hosted gate that runs `verify` on pushed work, and a real diagnostic rendering for `tao check`,
    which today only reports canonicalization. Brief:
    `Roadmap/Enforcement and diagnostics surface/`. Its repository claims were verified against a
    much older commit, so re-check them before planning.
- [ ] Complete canonical app and v1 hardening
  - Build WordFlower end to end, close gaps, tighten diagnostics and docs, remove stale drift, and validate `verify`.

## Ro's stack

Product and codebase backlog, unordered.

- [ ] Add simulation mode: local datasources with simulated network delays, saved library states, and demo renders.
- [ ] Improve the imports and exports structure. Decide whether namespaces are used commonly, and whether types and values can be exported together from one default export.
- [ ] Review all tests: remove unnecessary surfaces and overlaps, favor e2e coverage of the underlying packages, and justify each remaining test.
- [ ] Allow only one project definition per project root; scope workspace package lookup to that root, have the IDE extension manage one workspace per project folder, and stop requiring a Git repo at the project root.
- [ ] Implement styling, and then all of `Spec/Tao Layout and UI.md`.
  - Consider declaration-level style defaults that a caller may override, and settle how the two
    merge — in particular how a caller clears a default rather than adding to it:
    ```tao
    view Foo() [pad 12, bg red] {
       render Text("Foo")
    }

    render Foo()                  // red, padded
    render Foo() [pad 0, bg none] // caller clears the declared default
    ```
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
