# Brief - Implement WordFlower Tranche 4

Implementation brief: findings and constraints, not a plan. Devise the plan yourself. Re-verify all
repository seams against the live checkout before beginning.

`Apps/WordFlower/README.md` owns the tranche process and is the first thing to read. This brief
records where the contract lives, what it spans, and what it collides with.

`Apps/WordFlower/2 - Next/` is the authoritative, settled tranche contract. Its code and header replace
older scope wording in this brief and in the declaration-model spike; do not reopen those decisions
while planning implementation.

## What changed before you

Four repository foundations were deliberately landed ahead of this tranche so that you build on them
rather than retrofit them afterwards. Confirm each against live `main`; if one did not land, say so
before planning around it.

- **`packages/runtime` was split.** The shipped React Native runtime, the app-generation and Jest
  harness, and the `.tao` stdlib no longer share one package or one dependency manifest. Preserve the
  established boundary between shipped runtime code and toolchain-only support.
- **`packages/dev` was reorganized**, and the AI review subsystem, AI usage accounting, and the
  merge-readiness command were deleted. `repo-lint.ts` survived but may have moved; locate it before
  assuming a path.
- **A performance harness exists with a pre-tranche baseline**, and the compiler and validator entry
  points now reuse a constructed language-service session instead of rebuilding it per call. Use that
  session rather than adding a second mechanism, and check your work against the baseline.
- **A diagnostic-identity scheme may exist** across the feature validators. If it does, the validators
  you add participate in it from the start rather than being retrofitted.

Separately and concurrently: a CI enforcement gate and a CLI surface that renders diagnostics with
source positions may be landing while you work. Neither touches your files. The second one is worth
knowing about — it means syntax errors report line and column instead of an internal assertion string,
which matters when you are adding a dozen language features at once.

## Where the contract is

The tranche contract is at `Apps/WordFlower/2 - Next/`. Treat the live directory as authoritative;
do not substitute archived copies or earlier descriptions from this brief.

`Roadmap.md` records both the tranche cut and its implementation into Current as complete at the
absorbed boundary.

## What the contract changes structurally

**The tier becomes a directory.** Its product contract contains:

```text
WordFlower.tao-next   project, apps, navigation, local datasource, variants, app shell
Data.tao-next         the data catalog
Shared.tao-next       shared types, functions, injected views
Workspaces.tao-next   the workspace area
Documents.tao-next    the document area
Foundation.tao-next   the deterministic navigation harness
Design.tao-next       the minimal design system — implemented last, see that file
```

plus `Foundation`, `Documents`, `Workspaces`, and `WordFlower` test sidecars.

The absorbed scratch contracts graduated to `packages/stdlib/tao/Prelude.tao` and
`packages/stdlib/tao/text/Text.tao`; their former `@tao-next/` copies are intentionally absent.

This is the first time a WordFlower tier is a directory, and it is the single most disruptive part of
the tranche, because two mechanical gates assume single files. See "Collisions" below.

## Scope

The complete scope and semantics are the code and `This tranche decides` header in
`Apps/WordFlower/2 - Next/WordFlower.tao-next`. Do not maintain a second copied scope list here.
Everything represented in Next is required in this tranche; nothing there is a sketch or deferral.
InstantDB, authorization states, and `data ...` provider-control journeys belong to `3 - MVP`, not
this tranche.

## Collisions to plan around

**1. The absorption gates assume single files.** They do not live in the formatter and parser suites —
they live in `repo-lint.ts` under `packages/dev`, wired into both `_parallel-check` and
`_parallel-verify-check` in the `Justfile`. Its `readWordFlowerPairs` hardcodes two file paths
(`WordFlower.tao` / `WordFlower.tao-next`). The contract says teaching the gates about directories is
part of this tranche, so this file must change. The dev-package reorganization may have relocated it —
find it before planning the edit.

A broken gate that silently passes is worse than one that fails. Land the directory-aware version
before, or with, the first multi-file change.

**2. Live implementation result: the `Justfile` entry path remains correct.**
`WORD_FLOWER_APP := justfile_directory() + "/Apps/WordFlower/1 - Current/WordFlower.tao"` names the
canonical compile entry, not the absorption unit. `tao compile` intentionally takes an entry file,
while `tao test` takes the Current directory and discovers all sidecars. The directory migration
therefore required the repository absorption gate to change, but did not require widening the
compile recipe to a directory.

## Reference material worth reading once

`archive/wip-1493` holds 47 `TR-*` modules (~4,100 lines) wrapping React Native and Expo surfaces —
accessibility, alerts, animation, app state, clipboard, keyboard, linking, location, media, modal,
permissions, safe-area, secure store, share, status bar, storage, vibration, and more. It is typed,
documented, and uses a driver-injection pattern for testability, but it sits on an old base and
conflicts structurally with the current runtime, so **do not merge it**.

Its value is the inventory and the shape: `TR-image`, scrolling, and indicator modules overlap with
this tranche's stdlib surfaces. Read those relevant pieces before writing fresh implementations
against the current runtime; do not import unrelated safe-area, keyboard, or native-list scope.

## Constraints

- `packages/AGENTS.md` owns package boundaries: implement as vertical slices with the same feature
  name in each participating parser, validator, formatter, source-actions, compiler, and runtime file.
  Expected semantic and source-shape diagnostics belong in the validator; codegen assumes validated
  input and uses assertions only for local type contraction.
- `Docs/Archive/Reports/Code cleanup spike/Report.md` holds the R1–R13 rulebook; it is the live quality bar.
- `./agent verify` before every commit. The baseline was 14 suites, 782 tests, 9.0s suite wall time at
  `6cfd88be`; re-measure on current `main` before you start, since preceding work will have moved it.
- Branch `feat/<name>`; never commit from detached HEAD. Fifteen-plus worktrees share this repo and
  other agents work concurrently — preserve changes you did not make.
- `Docs/Archive/` is frozen.
- Ask the Developer on language semantics, roadmap priority, and ambiguous product behavior. Resolve routine
  implementation choices from repository evidence.

## What a plan should be explicit about

- Slice order, and how it honors the contract's own instruction that `Design.tao-next` lands last.
- When the directory-aware gates land relative to the first multi-file change.
- When the Prelude and `@tao/text` scratch contracts graduate to their final stdlib locations and
  their scratch copies are deleted.
- How `TagOrHexColor` is introduced across lexer, AST contexts, validator diagnostics, formatter,
  syntax highlighting, and tests without regressing existing `#tag` syntax.
- Which of the four preceding foundations you confirmed actually landed, and what you changed in
  response if one did not.
