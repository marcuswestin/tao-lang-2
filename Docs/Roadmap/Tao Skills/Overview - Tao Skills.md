# Tao Skills

Installable agent skills that let an agent create, edit, run, test, and ship a Tao app in a project that has no access to this repository. This document is the implementation brief; the implementer decides routine details from the specs and starters.

## Shape

1. Source lives in `packages/ai/tao-skills/skills/<name>/SKILL.md` (one folder per skill, frontmatter `name` + `description`, optional `references/*.md` for long tables). The CLI imports the Markdown as text at build time so a compiled `tao` carries its skills. `agents/skills/tao-skills` links to the package's routing skill for work inside this repository.
2. Every skill is self-contained: no repository paths, no `./agent` or `just`, no references to Studio internals. The only tools it may assume are `tao <command>`, `bun`, and the project tree that `tao create` writes.
3. Installation targets, written by `tao create` for new projects:
   - `.agents/skills/<name>/` (canonical copy, not symlink).
   - `AGENTS.md` (the `tao-project` skill body, with a skills index) and `CLAUDE.md` containing `@AGENTS.md`.
   - `.claude/skills/<name>` → copy of the same folders. Cursor and Codex read `.agents/skills` directly.
   - `skillsVersion` in `.tao/store/lock.jsonc`, stamped with the skill package version.
4. Proof: `packages/ai/tao-skills/skills-tests/skills-snippets.test.ts` extracts every ` ```tao ` fence from every skill, drops each into a scratch copy of the `Pantry` starter (or a fenced file path if the fence names one), and runs `tao check`. A snippet that does not check fails the build. The byte-for-byte starter comparison in `test-starter-lowering.ts` gains the installed skill files.

## Skills

Each entry: purpose, then what the body must contain. Derive content from `Docs/Spec/*`, `Docs/Tutorials/Your First Tao App.md`, and `Apps/Starters/*`; keep each SKILL.md under ~150 lines and push tables into `references/`.

1. `tao-project` (always loaded; doubles as the generated `AGENTS.md`)
   - What Tao is (UI-app language → TSX for Expo/React Native), canonical file layout (`App.tao`, `Data.tao`, `Chrome.tao`, `Design.tao`, `Scenarios.tao`, `<App>.test.tao`, one folder per feature, `@/` generated package, `tsconfig.json`).
   - The edit loop: edit → `tao fix` → `tao check` → `tao test` → `tao run`. Never edit `@/`. Read diagnostics from `tao check` and how to act on the common ones.
   - Index of the other skills with one-line triggers.
2. `tao-create`
   - Running `tao create "<description>"`, what the two starter shapes look like (one entity + StackNav; multi-entity + SelectionNav), and how to add a feature folder by hand: list scene, row view, detail scene, wiring into `Chrome.tao`, fixtures and scenarios, a test.
3. `tao-syntax`
   - Declarations (`project`, `app`, `entity`, `nav`, `scene`, `view`, `design`, `test`), properties vs children vs `@slots`, `use X from …`, expressions, conditions on entries, comments. Formatter conventions (3-space indent, the `}  }` closing style) and the rule that `tao fix` owns formatting so agents never hand-format.
4. `tao-visibility`
   - Declaration visibility: file-local by default, `folder`, `project`, exported package surface; what `use X from ./Feature` sees and why an "unknown name" diagnostic usually means a missing `folder` keyword or `use`. The `@tao/*` package aliases and what each provides (`@tao/nav`, `@tao/data/providers/*`, …); the generated project package `@/`; using another Tao project.
5. `tao-layout`
   - The view family, layout properties (alignment, distribution, sizing, spacing, wrapping, scroll, overflow, layers), text layout, adaptive panes. `references/flexbox-mapping.md`: table from each Tao sizing/spacing/alignment keyword to the React Native style it resolves to, derived from `packages/apps/runtime/TaoRuntime-src/layout-engine/LayoutResolve.ts` and `LayoutMerge.ts`, so an agent that knows Flexbox can predict rendering.
6. `tao-design`
   - `Design.tao`: what the implemented first slice supports (tokens, colors, how a design is applied to an app and to views), how to restyle without touching layout, and what is explicitly not yet supported so agents do not invent syntax. Source: `Tao Design.md` §Implemented First Slice and `Apps/Starters/*/Design.tao`.
7. `tao-data`
   - Entities and field types, `Datasource Local` vs `remote none`, queries and relations as implemented, fixtures in `Scenarios.tao`, and the sidecar-TypeScript adapter pattern (`Apps/HNReader/HNAdapter.ts`, `StubAdapter.ts`) for data the language cannot yet express.
8. `tao-navigation-actions`
   - `StackNav`/`SelectionNav`, scenes and presentation, passing values between scenes, actions and state as implemented in `Tao Actions.md` and `Tao Presentation and Navigation.md`.
9. `tao-testing`
   - `.test.tao` behavior tests, scenarios and fixtures, tab labels and accessible names as targets, `tao test <paths>`, `tao review` for visual review, and how to read a failing test.
10. `tao-run-and-ship`
    - `tao run` (Metro port discovery, Expo Go for the iOS Simulator and Android, a development build for a physical iPhone), Studio in one paragraph as a user, `tao project` metadata (`id`, `version`), `tao ship` through TestFlight and App Store Connect, and publishing a project for other projects to use.

## Context the implementer cannot derive from the repository alone

1. Consumers have the CLI-bundled runtime only; anything a skill tells them to import must resolve through the `@tao/*` aliases the starter `tsconfig.json` maps. Check each alias against the bundle list before naming it.
2. The Flexbox mapping in `tao-layout` must describe the resolved runtime behavior, not the spec's aspirational sections; where `Tao Layout and UI.md` §Things Still Being Designed conflicts with the layout engine, the engine wins and the skill says the feature is unavailable.
3. Skills ship to other people's repositories, so no agent identity anywhere in them, and no repository-internal vocabulary (tranches, lanes, worktrees).

## Sequence

1. Package, snippet test, and `tao-project` + `tao-create` + `tao-syntax`; wire into `tao create` and regenerate starters.
2. `tao-visibility`, `tao-layout` (with the mapping table), `tao-design`.
3. `tao-data`, `tao-navigation-actions`, `tao-testing`, `tao-run-and-ship`, then the version stamp. A separate `tao skills install` upgrade command and stale-version warning remain follow-up work.
