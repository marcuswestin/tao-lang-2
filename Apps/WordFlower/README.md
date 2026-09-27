# WordFlower

WordFlower is the canonical Tao application: a workspace/document writing app that forces every language capability we ship.

This folder also defines **the implementation process** for Tao language work. All feature development flows through the four numbered versions below.

This README owns the **tranche mechanics** only — the four versions and their validation. The
program-level process (the sequence toward MVP and Revolution, the coverage matrix, and the role of
the `Apps/Tao Future/` demo apps, which carry no tiers and instead graduate files as capabilities
land) is owned by `Docs/Roadmap/Tao Revolution/Process.md`. The decided language itself is
`Docs/Roadmap/Tao Revolution/Decisions.md`. Two rules from there bind work here: **MVP is a subset of
Revolution by omission, never by respelling**, and **a capability exists only if a real feature in
one of the four apps forces it**.

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

`2 - Next` holds the tranche of decided syntax and semantics that implementation moves into `1 - Current`, slice by slice. Decisions live there as working code plus comments: the file's header lists the tranche, and every construct in the sketch is the agreed target form.

Current and Next each declare exactly one status for their whole directory. Current remains
`// Tranche status: absorbed`; Next is `// Tranche status: open` whenever any mapped file path or
content differs. Repository validation walks both directories recursively, maps each `.tao-next`
suffix to `.tao`, and compares the complete file set and byte content after normalizing only the
status line. The flat `@tao-next/` scratch package therefore keeps the tranche open until its
declarations graduate into the real stdlib and the scratch files are deleted. At a tranche boundary
the mapped directories are identical and both statuses are `absorbed`; sidecars and sibling files do
not carry independent markers.

## Moving Next into Current

Work the tranche one slice at a time; a slice is one decision group from Next's header.

1. **Implement the vertical.** Grammar → scoping → validator → formatter → compiler → runtime, with package tests at each layer. The validator is authoritative for AST correctness; downstream layers assume validated input.
2. **Migrate Current.** Rewrite the corresponding files in `1 - Current/` to the new form, matching Next's spelling exactly, and extend the journeys to prove the new behavior. Migrate any Test Apps and specs the slice touches in the same change.
3. **Verify and commit.** Focused tests and `./agent verify-changed` while working, `./agent verify --complete` before committing; every commit leaves Current green.
4. **Repeat** until Current expresses everything Next expresses. The tranche is done when the mapped directories have the same file set and byte-identical content after status normalization.
5. **Reconcile the later versions.** As the final step of the tranche, fold every decision Next settled — including changes discovered during implementation — into `3 - MVP` and `4 - Revolution` in one pass.

A change of mind mid-sprint goes through Next first: amend the sketch, then implement. Current never leads; it follows Next. The next tranche is then cut from the gap between Current and MVP.

## Synchronization rule

**`2 - Next`, `3 - MVP`, and `4 - Revolution` agree at every tranche boundary.** While a tranche is open, Next runs ahead and implementation feedback amends it freely; mid-tranche amendments accumulate in Next alone. Step 5 then reflects every settled decision into MVP and Revolution at once — same syntax, same semantics, same spelling — so changes move over exactly once. After that pass the three versions never disagree about a settled decision; they differ only in how much functionality they contain.

If reflecting a Next decision reveals a **contradiction** — the decision cannot express something MVP or Revolution depends on, or it conflicts with a decision those versions already assume — that contradiction is a blocker: **it must be resolved before Next becomes Current.** Resolve it by amending the Next decision, by changing what MVP/Revolution require, or by explicitly deferring the conflicting capability. Never implement a Next decision that leaves a known contradiction standing in a later version, and never silently drop the conflicting capability from MVP or Revolution to make the decision fit.

`3 - MVP` and `4 - Revolution` are deliberately malleable: they hold _all necessary language functionality_ in one coherent product sketch, not exact final detail. Treat any disagreement between them and a settled Next decision as a bug in the later version.

## Version contents

- **`1 - Current/`** — the executable app sources and journey sidecars. `WordFlower.tao` remains the repository's canonical compile entry and fixed-point fixture for parser/validator/formatter tests; the directory as a whole exercises the implemented language surface.
- **`2 - Next/`** — the sprint contract directory; the `WordFlower.tao-next` header lists the full tranche. A tranche may carry a flat `@tao-next/` scratch package while it develops a self-hosted stdlib contract. At absorption those declarations graduate into `packages/apps/stdlib/@tao`, imports return to their real stdlib paths, and the scratch package is deleted before the directory byte-identity gate arms.
- **`3 - MVP/WordFlower.tao-mvp`** + test + `Justfile` — the full MVP target: three-level related data, every navigation family, dialogues with `ask`/`respond`, snapshots, `with` app variants, design tokens, a remote provider, functions, and the typed injection escape hatch. Its `Justfile` demonstrates every `tao` CLI capability the MVP release intends to ship.
- **`4 - Revolution/WordFlower.tao-revolution`** + test + `Justfile` — intended functionality that is explicitly _not_ part of the MVP release, plus a TODO list at the top of the app file naming intended capabilities that do not yet have expressible syntax. Its `Justfile` demonstrates the CLI surface intended beyond the MVP. This tier is written directly to `Docs/Roadmap/Tao Revolution/Decisions.md` rather than to what ships today, so it may lead `2 - Next` and `1 - Current` in spelling; each such lead is a migration the tranche loop owes Current, and `3 - MVP` is derived from these spellings by omission. `4 - Revolution/Open questions.md` records what the decisions do not answer, as questions for the Developer rather than invented syntax, and is the tier's fourth file.

## Run and verify

From the repository root:

```sh
./tao check "Apps/WordFlower/1 - Current/WordFlower.tao"
./tao test "Apps/WordFlower/1 - Current"
./tao compile "Apps/WordFlower/1 - Current/WordFlower.tao" --app WordFlower
./tao dev "Apps/WordFlower/1 - Current" --app WordFlower
just dev "Apps/WordFlower/1 - Current/WordFlower.tao" WordFlowerInstantDB
```

The first three commands are automated verification paths. The final two commands launch the Expo
development path for interactive use.

`WordFlowerInstantDB` is the experimental synced demo variant. It uses Instant Cloud with the
hard-coded app ID in `WordFlower.tao`; it needs no local server. The hosted app must exist in the
Instant dashboard before using this variant on a device.

### The hosted Instant app's schema and admin token

Since `fd4c1012`, both InstantDB variants store one InstantDB row per Tao row. The hosted app still
holds the schema and rows of the earlier snapshot adapter, and `WordFlowerInstantDB` has not run
against it since the switch. Before the next hosted run, push WordFlower's schema and rules with
that app's admin token (Instant dashboard, the app's Admin tab) in `INSTANT_APP_ADMIN_TOKEN`:

```sh
./agent tao instantdb push "Apps/WordFlower/1 - Current/WordFlower.tao" --app WordFlowerInstantDB --dry-run
./agent tao instantdb push "Apps/WordFlower/1 - Current/WordFlower.tao" --app WordFlowerInstantDB
```

- The push compiles the app and applies the compiler's `TaoDataSchema.json` and, when the project
  declares `access` rules, `TaoDataPolicy.json`. WordFlower declares none, so the push makes every
  namespace public; whether it should refuse instead is an open question under `A20` in
  `Docs/MVP Roadmap/Agent MVP Roadmap.md`. The snapshot rows are not migrated.
- The repository secret store holds no token for this app. `AUTH_REVIEW_INSTANT_APP_ID` and
  `AUTH_REVIEW_INSTANT_ADMIN_TOKEN` belong to Auth Review's Instant app, which `just instant-review`
  pushes and runs. `just secrets` decrypts the store into `.env.secrets`, where the two app IDs can
  be compared.
- If Auth Review's app ID is WordFlower's (`9faf89c0-c15c-49b4-bf3f-3b5b2cd9a19f`), do not push:
  an Instant app holds one permission-rules document, so each app's push replaces the other's
  rules. Give WordFlower an app of its own first.
- To make this a one-liner like `instant-review`, store the token with
  `just secrets add WORDFLOWER_INSTANT_ADMIN_TOKEN` and add a recipe that pushes with it (`A20`).

For local development, `WordFlowerLocalInstantDB` uses the repository's fixture at
`http://localhost:9020` with the same seeded app ID. Start that fixture before launching it:

```sh
just start-local-instantdb
just dev "Apps/WordFlower/1 - Current/WordFlower.tao" WordFlowerLocalInstantDB
```

Stop the fixture with `just stop-local-instantdb`. Its Docker volumes are preserved, so the next
start keeps the local database.

The local variant's `localhost` endpoints work from web and the iOS Simulator. A physical device or
Android emulator needs endpoints using an address from which it can reach the Mac. The ordinary
`WordFlower` app continues to use device-local storage.

Files may declare more than one app. `tao dev` discovers runnable apps under any path, and both
`compile` and `dev` accept `--app <Name>`; without it they prompt when attached to an interactive
terminal and fail with the available names in noninteractive environments. They never select by
filename or source order.

Focused feature coverage lives in `Apps/Test Apps/*` and the owning package tests; WordFlower stays a real product and should never accumulate demo-only surface. The implemented navigation contract is `Docs/Spec/Tao Presentation and Navigation.md`; unimplemented navigation work is tracked in `Docs/Roadmap/Add navigation and routing MVP/Follow-ups - Add navigation and routing MVP.md`.
