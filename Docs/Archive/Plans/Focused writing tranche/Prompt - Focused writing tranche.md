# Focused Writing Tranche

You are the orchestrating implementation agent for Tao's focused writing tranche — the first tranche
cut from the Current ↔ MVP gap (**Process step 5** of `Docs/Roadmap/Tao Revolution/Process.md`), and the
first capability tranche after the dialect migration.

## Goal

Give WordFlower a focused writing session and, through it, give Tao unit values, the ticking clock,
the expression-position TypeScript boundary, and a controllable test clock. The contract is already
written into `Apps/WordFlower/2 - Next/`; make `Apps/WordFlower/1 - Current/` parse, validate,
format, compile, and execute it, with behavior tests written in Tao green for every construct. Close
the tranche only when Current and Next meet the directory absorption gate and `./agent verify`
passes.

**This tranche adds exactly the capability the contract names.** If you find yourself building
distance units, absolute clock pinning, `check`, or anything the Next header does not list, you have
left scope — stop and check the brief.

## Start here

Read these before planning or editing:

1. `AGENTS.md` and `packages/AGENTS.md`.
2. `Apps/WordFlower/README.md` — the tranche mechanics and the absorption gate.
3. `Docs/Roadmap/Tao Revolution/Process.md` — the program, the principles, and the tranche definition of
   done. Principle 4: not absorbed until behavior tests **written in Tao** cover every construct.
4. `Docs/Roadmap/Focused writing tranche/Brief - Focused writing tranche.md` — the findings, the
   decisions taken at the cut, and the slices. Its first cut decision (`use time from @tao/time` as
   a lowercase service import) must be confirmed with Ro before slice 3 begins; ask at the start,
   not when you reach it.
5. `Apps/WordFlower/2 - Next/WordFlower.tao-next`'s header — the decision list — then
   `2 - Next/@ui/Focus.tao-next`, `2 - Next/Focus.test.tao-next`, `2 - Next/@tao-next/`, and the
   `Documents` diff against Current.
6. `Docs/Roadmap/Tao Revolution/Decisions.md` §2, §8, §9, §15, §16 — the authority for every spelling.
   Where any other document disagrees, the decisions win.

## What changes

The brief's _Slices_ section is the order. In dependency order:

1. **Units.** `duration` primitive and value head; the family table; `.unit` construct and read;
   normalization, dimensional arithmetic, and the diagnostics; `now` as an expression; `.Clock`.
2. **`from` in expression position.** The §15 operator; `@tao/text` migrated off its fences.
3. **`@tao/time`.** The stdlib package and its sidecar; the reactive `Interval` value.
4. **Live derivation and the compact ternary.**
5. **The test clock.** `advance <duration>` in the runner; toast expiry proved.
6. **The feature.** `@ui/Focus.tao` into Current; its journeys green.

## How to proceed

- **Work one slice at a time and keep Current green at every commit.** Each slice is a vertical:
  grammar → scoping → validator → formatter → compiler → runtime, with package tests at each layer,
  then the Current migration for that slice.
- **Prove every construct in Tao.** The journeys in `Focus.test.tao-next` and the toast expiry step
  in `Documents.test.tao-next` are the gate. Add focused package tests underneath for the
  diagnostics (cross-family read, bare-number arithmetic, wrong-family parameter) and the
  conversion table, since a behavior journey cannot assert a compile error.
- **Follow every rule change through the toolchain**: parser, validator, formatter, source actions,
  compiler, runtime, and the IDE's TextMate overlay if a new token shape needs highlighting.
- **Graduate the scratch package at the end.** `2 - Next/@tao-next/Prelude.tao-next` folds into
  `packages/stdlib/@tao/Prelude.tao`; `Time.tao-next` becomes `packages/stdlib/@tao/time/Time.tao`
  plus `Time.ts`; then delete `@tao-next/` so the directory gate can arm.
- **Reconcile in the same change**: new `Docs/Spec/` pages for the unit family and `@tao/time`;
  `Docs/Spec/Tao Testing.md` for the clock and toast expiry; `Docs/Spec/Tao Data.md` for `now` as an
  expression; `Coverage.md`'s _Ticking clock_, _unit values_, and _conditionals_ rows; and the
  focus session folded into `3 - MVP` and `4 - Revolution` in one pass.

## Boundaries

- **`Apps/Tao Future/` is out of scope.** Their `advance 1 minute` spellings are aligned at Process
  step 3, not here.
- **Decisions win over older documents.** If a `Docs/Spec/` page or roadmap note disagrees with
  `Decisions.md`, respell to the decision and reconcile the page. Do not reopen a decision.
- **If implementation proves a decision wrong**, amend `Decisions.md` in the same change with the
  reason, per Process principle 5 — and amend the Next contract first, then Current. Do not leave
  code and decisions divergent, and do not amend silently.
- **Ask Ro** for the lowercase service import confirmation, and for anything that would change a
  spelling the Next header fixes.

## Done when

Every item in Process.md's _Cutting a tranche_ is complete: Current implements the contract;
behavior tests in Tao are green for every construct introduced; the package tests guard the
diagnostics; the `Docs/Spec/` pages above are reconciled; `Coverage.md` is updated; `3 - MVP` and
`4 - Revolution` carry the focus session; `@tao-next/` is graduated and deleted; Current ≡ Next
byte-identical with both statuses `absorbed`; `./agent verify` green.
