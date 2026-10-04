# Tao Project

Tao is a UI-app language that compiles to TSX and runs through Expo and React Native. Prefer Tao
source for app structure, UI, state, data, navigation, design, and behavior tests. Use TypeScript
sidecars only for typed platform or network boundaries Tao cannot express.

## Project shape

- `.tao/project.json`: tracked stable project identity; the nearest `.tao/` directory defines ownership.
- `App.tao`: launchable apps with lowercase effective `id`, `version`, and `name`; no project block.
- Root `package { ... }` declarations: optional name, version, license, dependencies, and `includes`
  of named modules. At most one unnamed publication; multiple uniquely named publications may overlap.
- `Data.tao`: shared entity declarations.
- `Chrome.tao`: shared configured navigation.
- `Design.tao`: the app's color tokens and clause bundles.
- `Scenarios.tao`: deterministic fixtures and Studio scenarios.
- `<App>.test.tao`: black-box behavior journeys.
- `<Feature>/<Feature>.tao`: one folder per feature, normally containing its list scene, row view,
  detail scene, actions, and queries.
- `@/`: committed generated Tao package. Never edit anything under it.
- `@<name>/`: named module and its authored subfolders.
- `tsconfig.json`: developer overrides extending `.tao/typescript/tsconfig.json`.
- `.tao-ts/`: generated contracts and checks; never edit them. Handwritten sidecars keep relative
  type imports such as `import type { Drawer } from './Drawer.tao'`.
- `node_modules/`: native installed dependencies.
- `.agents/skills/`: the installed Tao reference skills.

## Edit loop

1. Edit authored `.tao` files or their explicit `.ts`/`.tsx` sidecars.
2. Run `tao fix` and accept its formatting and organized `use` statements.
3. Run `tao check`; fix every error and review every warning.
4. Run `tao test`, or `tao test <paths>` while iterating.
5. Run `tao run <path> --web` to exercise the app in release 1, or `tao watch <path>` for saved-file
   contract refresh only. Interactive scenario review arrives with native Studio in release 3;
   `tao review` remains outside the standalone binary.

Do not hand-format around `tao fix`. Never rewrite generated files under `@/`; change the authored
source or rerun the owning command.

## Reading diagnostics

- `unknown name` usually means the declaration needs broader visibility, the file needs a `use`, or
  the import points at the wrong folder. Load `tao-visibility`.
- `missing`, `ambiguous`, or `unmatched` arguments mean Tao could not bind values to owner-declared
  slots. Add `Name: Value` labels; source order never resolves ambiguity.
- `Needs fixes` means the source is valid but noncanonical. Run `tao fix`.
- A `Placeholder` warning means unfinished UI would disappear in release. Replace it before shipping.
- When a behavior journey fails, start at the reported file, line, and step; inspect what a person
  could see or operate rather than internal state.

## Skills index

- `tao-create`: create a project or add a feature in the starter shape.
- `tao-syntax`: declarations, calls, slots, expressions, control flow, and formatting.
- `tao-visibility`: make names visible across files, folders, and packages.
- `tao-layout`: choose views and predict implemented layout behavior.
- `tao-design`: edit the implemented token and bundle design surface.
- `tao-data`: model entities, queries, fixtures, datasources, and adapters.
- `tao-navigation-actions`: configure navigation, present scenes, and write actions or commands.
- `tao-testing`: write behavior journeys, fixtures, scenarios, and visual reviews.
- `tao-run-and-ship`: run apps in the browser and check later delivery phases.
