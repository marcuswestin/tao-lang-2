# Starters

The starters are the projects `tao create` writes. Each folder here is the exact output of the create
command's lowering for one reference plan in `packages/cli/tao-cli/cli-src/create/starter-plans.ts`, byte
for byte after canonical formatting, and `tao test Apps` runs every one of them. That is what keeps the
lowering a proven, runnable app rather than a template that can rot: a change to the lowering either
reproduces these folders or fails that starter's test — `creation-starter-notebook.test.ts` or
`creation-starter-pantry.test.ts` — with the first differing file.

Every starter follows the canonical layout from `Docs/Roadmap/Tao Revolution/Decisions.md` §1,
restricted to what the toolchain runs today: `App.tao` (app identity and configuration), `Data.tao` (entities),
`Chrome.tao` (shared navigation), `Design.tao` (always written), one folder per feature with its list
and detail scenes, `Scenarios.tao` (fixtures and Studio scenarios), `<App>.test.tao` (behavior
tests), `tsconfig.json` (extending the generated `.tao/cache/typescript/tsconfig.json`),
the tracked identity `.tao/store/project.json`, the generated-Tao scaffold `@/.gitkeep`, and copied Tao
skills plus `AGENTS.md`, harness guidance, and `skillsVersion` in `.tao/store/lock.jsonc`.
`.tao/.gitignore` ignores only `local/` and `cache/`; `store/` is committed. Access, Rules, and Words join as
their tranches land.

To change a starter, change the lowering, reference plan, or
`packages/ai/tao-skills/skills/` source, then regenerate:

```bash
TAO_UPDATE_STARTERS=1 ./agent test-file packages/cli/tao-cli/cli-tests/creation-starter-notebook.test.ts
TAO_UPDATE_STARTERS=1 ./agent test-file packages/cli/tao-cli/cli-tests/creation-starter-pantry.test.ts
```

Do not edit the generated files by hand; the next test run would rewrite them. Add a `## <Name>`
entry below for every starter folder, as `repo-lint` requires.

## Notebook

The one-entity starter: a `StackNav` over a list scene, a row view, and a detail scene for `Notes`,
with a text title, a text body, a yes/no flag, and a creation time. It proves the single-feature
shape: adding a row, opening it, and renaming it. Persistence is covered by the local-data
and runtime ownership suites.

## Pantry

The two-entity starter: a `SelectionNav` with one tab and stack per feature, `Ingredients` with a
number field and `Recipes` with a longer text field. It proves the multi-feature shape: tab labels
as test targets, number fields shown read-only in rows and detail, and per-entity scenario groups.
