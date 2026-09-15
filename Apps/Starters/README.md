# Starters

The starters are the projects `tao create` writes. Each folder here is the exact output of the create
command's lowering for one reference plan in `packages/tao-cli/cli-src/create/starter-plans.ts`, byte
for byte after canonical formatting, and `tao test Apps` runs every one of them. That is what keeps the
lowering a proven, runnable app rather than a template that can rot: a change to the lowering either
reproduces these folders or fails `creation-lowering.test.ts` with the first differing file.

Every starter follows the canonical layout from `Docs/Roadmap/Tao Revolution/Decisions.md` §1,
restricted to what the toolchain runs today: `App.tao` (project and app), `Data.tao` (entities),
`Chrome.tao` (shared navigation), `Design.tao` (always written), one folder per feature with its list
and detail scenes, `Scenarios.tao` (fixtures and Studio scenarios), `<App>.test.tao` (behavior
tests), `tsconfig.json` (sidecar TypeScript resolves `@tao/*` from the CLI-bundled runtime), and
the committed empty generated-package scaffold `@/.gitkeep`. Access, Rules, and Words join as
their tranches land.

To change a starter, change the lowering or its reference plan, then regenerate:

```bash
TAO_UPDATE_STARTERS=1 bun test packages/tao-cli/cli-tests/creation-lowering.test.ts
```

Do not edit the generated files by hand; the next test run would rewrite them. Add a `## <Name>`
entry below for every starter folder, as `repo-lint` requires.

## Notebook

The one-entity starter: a `StackNav` over a list scene, a row view, and a detail scene for `Notes`,
with a text title, a text body, a yes/no flag, and a creation time. It proves the single-feature
shape: adding a row, opening it, renaming it, and keeping rows across a relaunch.

## Pantry

The two-entity starter: a `SelectionNav` with one tab and stack per feature, `Ingredients` with a
number field and `Recipes` with a longer text field. It proves the multi-feature shape: tab labels
as test targets, number fields shown read-only in rows and detail, and per-entity scenario groups.
