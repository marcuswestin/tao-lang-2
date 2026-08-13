# WordFlower

WordFlower is the canonical Tao application: a workspace/document writing app that forces every language capability we ship. It replaced Still and Kitchen Sink as the single product target.

This folder also defines **the implementation process** for Tao language work. All feature development flows through the four numbered versions below.

## The four versions

```text
1 - Current      the executable app — implemented, formatted, proven by behavior tests
2 - Next         the sprint contract — the next tranche of syntax/semantics, settled here first
3 - MVP          the full intended MVP release — everything Tao must cover to call v1 done
4 - Revolution   intended functionality beyond the MVP release
```

Each version is the same app written at a different distance from today. Reading them in order shows what Tao is, what it is about to become, what it must become to ship, and where it is going after that.

Only `1 - Current` is executable. The others use their own file extensions (`.tao-next`, `.tao-mvp`, `.tao-revolution`), which keeps them out of Tao discovery — Tao only discovers `.tao` and `.test.tao`.

## Next is the sprint contract

`2 - Next` holds the tranche of decided syntax and semantics that implementation moves into `1 - Current`, slice by slice. Decisions live there as working code plus comments: the file's header lists the tranche, and every construct in the sketch is the agreed target form. `3 - MVP` and `4 - Revolution` always stay in sync with those decisions.

## Moving Next into Current

Work the tranche one slice at a time; a slice is one decision group from Next's header.

1. **Implement the vertical.** Grammar → scoping → validator → formatter → compiler → runtime, with package tests at each layer. The validator is authoritative for AST correctness; downstream layers assume validated input.
2. **Migrate Current.** Rewrite `1 - Current/WordFlower.tao` and its journeys to the new form, matching Next's spelling exactly, and extend the journeys to prove the new behavior. Migrate any Test Apps and specs the slice touches in the same change.
3. **Verify and commit.** Focused tests while working, `./agent verify` before committing; every commit leaves Current green.
4. **Repeat** until Current expresses everything Next expresses. The tranche is done when the two files say the same thing — Next just says it with decision comments.

A change of mind mid-sprint goes through Next first: amend the sketch, propagate to MVP and Revolution, then implement. Current never leads; it follows Next.

When the tranche is absorbed, reconcile `3 - MVP` with what implementation taught us, then cut a new Next from the gap between Current and MVP.

## Synchronization rule

**`2 - Next`, `3 - MVP`, and `4 - Revolution` are always kept in sync.** When a decision is made in Next, it is reflected in MVP and Revolution in the same change — the same syntax, the same semantics, the same spelling. The three later versions never disagree about a settled decision; they differ only in how much functionality they contain.

If reflecting a Next decision reveals a **contradiction** — the decision cannot express something MVP or Revolution depends on, or it conflicts with a decision those versions already assume — that contradiction is a blocker: **it must be resolved before Next becomes Current.** Resolve it by amending the Next decision, by changing what MVP/Revolution require, or by explicitly deferring the conflicting capability. Never implement a Next decision that leaves a known contradiction standing in a later version, and never silently drop the conflicting capability from MVP or Revolution to make the decision fit.

`3 - MVP` and `4 - Revolution` are deliberately malleable: they hold _all necessary language functionality_ in one coherent product sketch, not exact final detail. Treat any disagreement between them and a settled Next decision as a bug in the later version.

## Version contents

- **`1 - Current/WordFlower.tao`** + `WordFlower.test.tao` — the executable app and its journey tests. The repository's canonical compile target (`just _compile-word-flower-app`, the default `./dev` app) and the fixed-point fixture for parser/validator/formatter tests. It exercises the whole implemented language surface.
- **`2 - Next/WordFlower.tao-next`** + test — the sprint contract; the header comment lists the full tranche.
- **`3 - MVP/WordFlower.tao-mvp`** + test + `Justfile` — the full MVP target: three-level related data, every navigation family, dialogues with `ask`/`respond`, snapshots, `with` app variants, design tokens, a remote provider, functions, and the typed injection escape hatch. Its `Justfile` demonstrates every `tao` CLI capability the MVP release intends to ship.
- **`4 - Revolution/WordFlower.tao-revolution`** + test + `Justfile` — intended functionality that is explicitly _not_ part of the MVP release, plus a TODO list at the top of the app file naming intended capabilities that do not yet have expressible syntax. Its `Justfile` demonstrates the CLI surface intended beyond the MVP.

## Run and verify

From the repository root:

```sh
./tao check "Apps/WordFlower/1 - Current/WordFlower.tao"
./tao test "Apps/WordFlower/1 - Current"
./tao compile "Apps/WordFlower/1 - Current/WordFlower.tao" --app WordFlower
./dev "Apps/WordFlower/1 - Current/WordFlower.tao" --app WordFlower
```

The first three commands are automated verification paths. The final command launches the Expo development path for interactive use.

Files may declare more than one app. `compile` and `dev` accept `--app <Name>`; without it they
prompt when attached to an interactive terminal and fail with the available names in noninteractive
environments. They never select by filename or source order.

Focused feature coverage lives in `Apps/Test Apps/*` and the owning package tests; WordFlower stays a real product and should never accumulate demo-only surface. The full navigation contract and its decision log remain in `Roadmap/Add navigation and routing MVP/`.
