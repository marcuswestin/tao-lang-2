# WordFlower

WordFlower is the canonical Tao application: a workspace/document writing app that forces every language capability we ship. It replaces the earlier Still and Kitchen Sink apps as the single product target.

This folder is also the definition of **the implementation process** for Tao language work. All feature development flows through the four numbered versions below.

## The four versions

```text
1 - Current      the executable app — implemented, formatted, proven by behavior tests
2 - Next         the decision sketchpad — the next tranche of syntax/semantics, settled here first
3 - MVP          the full intended MVP release — everything Tao must cover to call v1 done
4 - Revolution   intended functionality beyond the MVP release
```

Each version is the same app written at a different distance from today. Reading them in order shows what Tao is, what it is about to become, what it must become to ship, and where it is going after that.

Only `1 - Current` is executable. The others use their own file extensions (`.tao-next`, `.tao-mvp`, `.tao-revolution`), which keeps them out of Tao discovery — Tao only discovers `.tao` and `.test.tao`.

## The process

1. **Decide in `2 - Next`.** New syntax and semantics are designed as sketches of WordFlower itself, with comments recording each decision. A Next sketch is the contract for upcoming implementation work.
2. **Propagate immediately.** Every decision made in Next is reflected into `3 - MVP` and `4 - Revolution` as part of making it — see the synchronization rule below.
3. **Implement into `1 - Current`.** Features move from Next into the language one slice at a time (grammar → validator → formatter → compiler → runtime → tests). Each slice lands in `1 - Current/WordFlower.tao` and its behavior tests, which must stay green through `./agent verify` at every commit.
4. **Cut the next tranche.** When Current expresses everything in Next, reconcile MVP with what implementation taught us, then cut a new Next from the gap between Current and MVP.

## Synchronization rule

**`2 - Next`, `3 - MVP`, and `4 - Revolution` are always kept in sync.** When a decision is made in Next, it is reflected in MVP and Revolution in the same change — the same syntax, the same semantics, the same spelling. The three later versions never disagree about a settled decision; they differ only in how much functionality they contain.

If reflecting a Next decision reveals a **contradiction** — the decision cannot express something MVP or Revolution depends on, or it conflicts with a decision those versions already assume — that contradiction is a blocker: **it must be resolved before Next becomes Current.** Resolve it by amending the Next decision, by changing what MVP/Revolution require, or by explicitly deferring the conflicting capability. Never implement a Next decision that leaves a known contradiction standing in a later version, and never silently drop the conflicting capability from MVP or Revolution to make the decision fit.

`3 - MVP` and `4 - Revolution` are deliberately malleable: they hold _all necessary language functionality_ in one coherent product sketch, not exact final detail. Treat any disagreement between them and a settled Next decision as a bug in the later version.

## Version contents

- **`1 - Current/WordFlower.tao`** + `WordFlower.test.tao` — the executable app and its journey tests. The repository's canonical compile target (`just _compile-word-flower-app`, the default `./dev` app) and the fixed-point fixture for parser/validator/formatter tests. It exercises the whole implemented language surface, including custom types and typed constructors (the starter writing prompt), nested `let` shadowing (the section labels), number state with compound `set` (the session save counter), and typed injection (the word count).
- **`2 - Next/WordFlower.tao-next`** + test — the currently proposed decisions: `guard`, `#id` tags, `Name:` labeled arguments with no commas, entity-first `data`, boolean cases, `loop`, the `ui`/navigator model, two-way input binding, overlay notices, and bare `data` test steps.
- **`3 - MVP/WordFlower.tao-mvp`** + test + `Justfile` — the full MVP target: three-level related data, every navigation family, dialogues with `ask`/`respond`, snapshots, `with` app variants, design tokens, a remote provider, functions, and the typed injection escape hatch. Its `Justfile` demonstrates every `tao` CLI capability the MVP release intends to ship.
- **`4 - Revolution/WordFlower.tao-revolution`** + test + `Justfile` — intended functionality that is explicitly _not_ part of the MVP release, plus a TODO list at the top of the app file naming intended capabilities that do not yet have expressible syntax. Its `Justfile` demonstrates the CLI surface intended beyond the MVP.

## Run and verify

From the repository root:

```sh
./tao check "Apps/WordFlower/1 - Current/WordFlower.tao"
./tao test "Apps/WordFlower/1 - Current"
./tao compile "Apps/WordFlower/1 - Current/WordFlower.tao"
./dev "Apps/WordFlower/1 - Current/WordFlower.tao"
```

The first three commands are automated verification paths. The final command launches the Expo development path for interactive use.

Focused feature coverage lives in `Apps/Test Apps/*` and the owning package tests; WordFlower stays a real product and should never accumulate demo-only surface. The full navigation contract and its decision log remain in `Roadmap/Add navigation and routing MVP/`.
