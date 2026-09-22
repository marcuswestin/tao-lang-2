# Plan - Tao Studio as a Tao app

Status: Not started. Split out of `Docs/Archive/Plans/Repository simplification 2/Plan - Repository
simplification 2.md` (its "Package restructure" § "Later slices" item 2) as its own task, because it
touches product-facing packages daily worked in and needs its own fences and sequencing rather than
riding on a documentation-and-instructions plan.

## Goal

Studio's browser client is a large hand-maintained `.tao` app living inside its own package rather
than under `Apps/` like every other Tao app, its code editor is reached through a TypeScript sidecar
that could be an ordinary foreign view instead of bespoke wiring, and its local-development InstantDB
stack and client are scattered across `config/`, the `Justfile`, and `expo-host`'s dependencies
instead of owned packages. This plan moves each into its normal place: the app under `Apps/`, the
editor as an app-local package, the local-InstantDB stack behind `packages/services/tao-cloud`, and
the InstantDB client behind `packages/providers/instantdb`.

## What exists

- `packages/ides/studio/studio-src/TaoStudioClient.tao` (about 1,540 lines) is Studio's own Tao app:
  the workbench view tree, panels, and state. `Project.tao` sits beside it.
- The code editor lives at `packages/ides/studio/studio-src/code-editor/` (`CodeEditor.tsx`,
  `CodeEditorLens.ts`) and is reached from `TaoStudioClient.tao` through a foreign view,
  `view StudioEditorSurface() from ./TaoStudioProductHost.tsx` — the sibling `.tsx` re-exports the
  surface from `product-host/StudioEditorSurface.tsx`, which imports `../code-editor/CodeEditor`.
- `StudioClientAssets.ts` finds the `.tao` by its own folder
  (`FS.resolvePath('TaoStudioClient.tao', import.meta.dir)`) and reaches sibling packages by counting
  directories (`'../../../apps/expo-host'`, `'..'`); `packages/ides/studio-tooling` holds several more
  literal references to `packages/ides/studio/studio-src` for dev reload, watch health, and doctor
  checks; `packages/testing/verification`'s `repo-lint` allowlist and tests carry more still.
- The local-InstantDB stack — `config/local-instantdb/` (a compose file and seed SQL), the
  `start-local-instantdb`/`stop-local-instantdb` `Justfile` recipes and their variables, and the
  doctor and capability checks that mention it — has no owning package.
- The InstantDB client and its vendor dependency (`@instantdb/react-native`, declared today in
  `packages/apps/expo-host/package.json`) sit behind
  `packages/apps/stdlib/@tao/data/providers/instantdb/InstantDB.ts`, the TypeScript implementation
  beside `InstantDB.tao`.

## No language or product decision is needed

Both mechanisms this plan uses are already decided, so this is a location move, not a design:

- **Foreign views and the TypeScript boundary** are decided in
  `Docs/Roadmap/Tao Revolution/Decisions.md` §15, "The TypeScript boundary": a view declares a named
  TypeScript sidecar in its head (`from ./CodeEditor.tsx`), the sidecar provides the named export, and
  the compiler follows transitive relative imports for it. `TaoStudioClient.tao`'s
  `StudioEditorSurface` already uses this mechanism; moving the editor package keeps it, since a
  foreign view's path is sibling-relative and the `.tao` and its `.tsx` move together.
- **App-local packages under `@name/`** are decided precedent, not new: WordFlower's own tiers carry
  `@ui/`, `@nav/`, and `@data/` beside the app source
  (`Apps/WordFlower/1 - Current/@ui`, `@nav`, `@data`, and the same under `2 - Next`). An app-local
  `@editor/` (or similar) package for Studio's code editor follows the same pattern already in use.

## Slices

1. **Move the Tao client to `Apps/Tao Studio/`.** Update every literal that names
   `packages/ides/studio/studio-src`: `StudioClientAssets.ts`'s own-folder and directory-hop
   constants, `packages/ides/studio-tooling`'s dev-reload path check
   (`StudioClientDevReload.ts`), watch-health root (`StudioWatchHealth.ts`), and doctor file list
   (`StudioDoctor.ts`), the packaged-app payload (which must include the moved app folder, not just
   `packages/` one level deep — the class of defect this run's package restructure already found
   once), studio-smoke fixture paths, and the `repo-lint` allowlist entries and tests that hardcode
   the old path. Sweep by searching the literal path string, not by memory of which files use it.
2. **The code editor as an app-local Tao package**, its `.tao` declaration beside its `.tsx` sidecar
   so the foreign view's sibling-relative path keeps working. Moves together with slice 1 rather than
   as a separate step, since the editor is inside `studio-src` today.
3. **`packages/services/tao-cloud`**: a minimal package that receives `config/local-instantdb/` (the
   compose file and seed SQL), the `start-local-instantdb`/`stop-local-instantdb` `Justfile` recipes
   and their variables, and the doctor/capability checks that mention the stack. Named for what it
   becomes later, not only what it holds now: eventually the production server offering hosted
   defaults such as an InstantDB data endpoint, so the package boundary is drawn for that future
   without building it now.
4. **`packages/providers/instantdb`**: the InstantDB client and its vendor dependency
   (`@instantdb/react-native`, declared today in `packages/apps/expo-host/package.json`) move out of
   `packages/apps/stdlib/@tao/data/providers/instantdb/InstantDB.ts`. The constraint that a
   `provider … from ./X.ts` file must be a sibling of its `.tao` means stdlib keeps a sibling
   `InstantDB.ts` that re-exports from the new package; the `@tao/...` import path a Tao app writes
   does not change.

## Risks

- Build wiring is location-sensitive: every one of `StudioClientAssets.ts`'s directory-hop constants,
  `studio-tooling`'s literal path checks, the packaged-app payload, and `repo-lint`'s allowlist is a
  place a move breaks silently rather than at typecheck, the exact lesson the package-restructure run
  that preceded this plan drew from its own moves (`Docs/Archive/Plans/Repository simplification
  2/Plan - Repository simplification 2.md`, "What this run taught").
- Other work lands in Studio daily; a move that touches this many files needs a short-lived branch and
  a merge of `main` immediately before the move commit, not partway through it.
- Unchecked question: whether `Apps/Tao Studio/` needs its own `Project.tao` the way `Apps/WordFlower/`
  and the other example apps do. It has one today (`packages/ides/studio/studio-src/Project.tao`);
  whether that stays as-is, moves as-is, or needs a different shape once Studio is an ordinary
  `Apps/` entry is open and should be checked against how other `Apps/` entries declare their project
  before the move, not assumed.

## Method

Apply the `simplify-repo` skill's lessons, freshly folded in from this plan's parent run: after the
move, sweep every string, regex, table key, cache key, allowlist entry, and relative directory hop
that named the old location, and prefer resolving through a package name over counting directories to
reach a sibling. Run a deep-tier read-only review before landing, briefed to hunt what typecheck
cannot see — a moved literal that still resolves to something, just not the thing it used to.

---

```
Execute the plan at `Docs/Roadmap/Tao Studio as a Tao app/Plan - Tao Studio as a Tao app.md`. If that
file is missing, check `Docs/Archive/Plans/Tao Studio as a Tao app/` instead — the plan is done and
this prompt is stale.

Read `packages/AGENTS.md` and the `simplify-repo` skill (`agents/skills/simplify-repo/SKILL.md` and
its `references/`) before starting; the skill's package and post-move-sweep rules apply directly to
this move.

Work on one short-lived branch. Before the move commit, merge `main` so the diff lands against
current work rather than reintroducing files other sessions removed or changed.

Execute the plan's four slices in order: move the Tao client and `Project.tao` to `Apps/Tao Studio/`;
move the code editor to an app-local package beside it; extract `packages/services/tao-cloud` for the
local-InstantDB stack; extract `packages/providers/instantdb` for the InstantDB client, keeping
stdlib's sibling `InstantDB.ts` as a re-export so the `@tao/...` import path apps use does not change.

After each slice, search for every remaining reference to the old path by the literal string, not by
memory of which files used it, and fix strings, regexes, table keys, cache keys, allowlist entries,
and relative directory hops the same way; prefer resolving through a package name over counting
directories. Run `./agent verify` after each slice.

Before the final landing, run a deep-tier read-only review of the whole diff, briefed to find what
`./agent typecheck` cannot: a moved literal that still resolves to something, just not the thing it
used to point at. Check the open question of whether `Apps/Tao Studio/` needs its own `Project.tao`,
or a different shape, against how other `Apps/` entries declare their project, before assuming its
current one carries over unchanged.

Run `./agent finalize` when ready and report what evidence stands behind the change and what did not
run.
```
