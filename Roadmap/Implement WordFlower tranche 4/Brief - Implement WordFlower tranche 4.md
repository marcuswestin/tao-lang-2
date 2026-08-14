# Brief - Implement WordFlower Tranche 4

Draft for review. Orchestrator brief: findings and constraints, not a plan. Devise the plan yourself.
Verified against `main` at `6cfd88be` on 2026-08-14. **Substantial repository work is scheduled to
land before you start**, so re-verify everything below against `main` as it stands when you begin.

`Apps/WordFlower/README.md` owns the tranche process and is the first thing to read. This brief
records where the contract lives, what it spans, and what it collides with.

> **Correction, 2026-08-14 — parts of "Scope" below are superseded.** Ro settled a unified declaration
> model after this brief was written. See `Roadmap/Declaration model spike/`. Two scope items are
> affected: the **Declaration kinds** bullet is wrong as written (`let` survives; `=` no longer
> connects a kind to a base), and the **stdlib surfaces** bullet now sits under a decision that stdlib
> components become ordinary `@tao/ui` declarations rather than compiler-known names. Whether tranche 4
> builds those surfaces the current way and migrates later, or waits, is Ro's call — ask before
> planning either. `List` specifically is an open question (Q4 in that spike's open-questions file).

## What changed before you

Four repository foundations were deliberately landed ahead of this tranche so that you build on them
rather than retrofit them afterwards. Confirm each against live `main`; if one did not land, say so
before planning around it.

- **`packages/runtime` was split.** The shipped React Native runtime, the app-generation and Jest
  harness, and the `.tao` stdlib no longer share one package or one dependency manifest. A boundary
  now exists for what ships to users versus what stays in the toolchain — your remote-provider package
  lands inside that established structure, not alongside it.
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

The tranche contract is **uncommitted in the working tree** at `Apps/WordFlower/2 - Next/`. It was
restored there from tag `archive/wip-7354-tranche` after the worktree that authored it was archived. A
byte-identical copy is at `archive/wip-2b19-tranche`.

Nothing is committed. Treat it as a proposal under Ro's review until Ro says otherwise, and confirm it
is still the current contract before planning against it.

`Roadmap.md` reads `- [ ] Cut tranche 4 from the gap between Current and MVP`. That item is satisfied
by this contract — update it as part of the work rather than leaving it stale.

## What the contract changes structurally

**The tier becomes a directory.** `2 - Next` goes from two files to eleven:

```text
WordFlower.tao-next   project, apps, navigation, providers, variants, app shell
Data.tao-next         the data catalog
Shared.tao-next       shared types, functions, injected views
Workspaces.tao-next   the workspace area
Documents.tao-next    the document area
Foundation.tao-next   the deterministic navigation harness
Design.tao-next       the minimal design system — implement LAST, see that file
```

plus `Foundation`, `Documents`, `Workspaces`, and `WordFlower` test sidecars. Roughly 1,070 lines.

This is the first time a WordFlower tier is a directory, and it is the single most disruptive part of
the tranche, because two mechanical gates assume single files. See "Collisions" below.

## Scope

Taken from the contract header; the file itself is authoritative.

- **Stdlib surfaces**: `ScrollView`, `Image`, `Icon`, `Checkbox`, `List` with `on select`, `Spinner`,
  `Progress`.
- **Adaptive layout**: `Panes()` lays children side by side when the container is wide enough and
  stacks them otherwise; `width max <n>` bounds a readable column. Responsiveness is a container
  behavior, not a language-level breakpoint.
- **App shell** honors safe-area and keyboard insets. Runtime behavior with no source surface; apps do
  not opt in.
- **Remote data**: `Datasource InstantDB { AppId "…" }` on the published provider protocol, extended
  for inbound subscription deltas, write acknowledgement, externally originated store revisions, and
  reconciliation between provider row identity and generated ids.
- **`unauthorized`** becomes a provider-produced availability state; `data unauthorized` and
  `data delayed <ms>` drive it and latency deterministically in checks.
- **`async { }`** runs its block without delaying following statements; failures surface as provider
  error state. Concurrency policy vocabulary stays deferred under `DEF-NAV-011`.
- **Declaration kinds** name configured values, replacing `let` for them: `Kind Name { … }` declares,
  `Kind Name = <value>` names or derives. The `AppValueDeclaration` union collapses to
  `AppDeclaration`.
- **`inject <type>`** produces a typed value outside render position.
- **`optional <Name> <type>`** declares an item field that may be absent.
- **`expect checkbox <selector> checked|unchecked`** joins the test vocabulary.
- **Minimal design**: flat tokens plus named clause bundles applied at render sites, and an app
  `Design` property. `Design.tao-next` is explicitly ordered last — it styles primitives, so the
  primitives must exist first.

Deliberately excluded: splits and windows, snapshots, restoration and routes, the concurrency policy
vocabulary, and bare asset literals.

## Collisions to plan around

**1. The absorption gates assume single files.** They do not live in the formatter and parser suites —
they live in `repo-lint.ts` under `packages/dev`, wired into both `_parallel-check` and
`_parallel-verify-check` in the `Justfile`. Its `readWordFlowerPairs` hardcodes two file paths
(`WordFlower.tao` / `WordFlower.tao-next`). The contract says teaching the gates about directories is
part of this tranche, so this file must change. The dev-package reorganization may have relocated it —
find it before planning the edit.

A broken gate that silently passes is worse than one that fails. Land the directory-aware version
before, or with, the first multi-file change.

**2. `Justfile` hardcodes a single app file:**
`WORD_FLOWER_APP := justfile_directory() + "/Apps/WordFlower/1 - Current/WordFlower.tao"`. Absorption
turns Current into a directory, so this changes too. Any CI added concurrently is expected to go
through `just` / `./agent` recipes rather than paths, so updating the recipe should be sufficient —
verify that assumption rather than trusting it.

**3. Your provider package is a packaging decision.** `@instantdb` ships to users. The runtime split
that preceded you established where that boundary sits; put the provider inside it rather than
inventing a parallel arrangement, and record what you decided and why.

## Reference material worth reading once

`archive/wip-1493` holds 47 `TR-*` modules (~4,100 lines) wrapping React Native and Expo surfaces —
accessibility, alerts, animation, app state, clipboard, keyboard, linking, location, media, modal,
permissions, safe-area, secure store, share, status bar, storage, vibration, and more. It is typed,
documented, and uses a driver-injection pattern for testability, but it sits on an old base and
conflicts structurally with the current runtime, so **do not merge it**.

Its value is the inventory and the shape: `TR-safe-area`, `TR-keyboard`, `TR-image`, `TR-native-list`,
and `TR-indicator` overlap directly with this tranche's stdlib surfaces and app-shell insets. Read it
before writing those, then write them fresh against the current runtime.

## Constraints

- `packages/AGENTS.md` owns package boundaries: implement as vertical slices with the same feature
  name in each participating parser, validator, formatter, source-actions, compiler, and runtime file.
  Expected semantic and source-shape diagnostics belong in the validator; codegen assumes validated
  input and uses assertions only for local type contraction.
- `Roadmap/Code cleanup spike/Report.md` holds the R1–R13 rulebook; it is the live quality bar.
- `./agent verify` before every commit. The baseline was 14 suites, 782 tests, 9.0s suite wall time at
  `6cfd88be`; re-measure on current `main` before you start, since preceding work will have moved it.
- Branch `feat/<name>`; never commit from detached HEAD. Fifteen-plus worktrees share this repo and
  other agents work concurrently — preserve changes you did not make.
- `Roadmap/Archive/` is frozen.
- Ask Ro on language semantics, roadmap priority, and ambiguous product behavior. Resolve routine
  implementation choices from repository evidence.

## What a plan should be explicit about

- Slice order, and how it honors the contract's own instruction that `Design.tao-next` lands last.
- When the directory-aware gates land relative to the first multi-file change.
- Which parts of the provider protocol extension are observable from Tao source and therefore need
  validator diagnostics, versus pure runtime reconciliation.
- What gets deferred, recorded against the existing `DEF-NAV-*` numbering rather than a new scheme.
- Which of the four preceding foundations you confirmed actually landed, and what you changed in
  response if one did not.
