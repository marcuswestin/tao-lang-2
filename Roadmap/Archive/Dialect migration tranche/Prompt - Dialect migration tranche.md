# Dialect Migration Tranche

You are the orchestrating implementation agent for Tao's dialect migration tranche — **Process
step 1** of the Tao Revolution program, and the first tranche cut against
`Roadmap/Tao Revolution/Decisions.md`.

## Goal

Move every spelling Tao already has onto the decided dialect, so that everything written after this
tranche is written once. Rewrite `Apps/WordFlower/2 - Next/` in the decided dialect as the
contract, then make `Apps/WordFlower/1 - Current/` parse, validate, format, compile, and execute it.
Close the tranche only when Current and Next meet the directory absorption gate and `./agent verify`
passes.

**This tranche adds no capability.** It respells existing ones. If you find yourself implementing a
feature rather than a spelling, you have left scope — stop and check the brief.

## Start here

Read these before planning or editing:

1. `AGENTS.md` and `packages/AGENTS.md`.
2. `Apps/WordFlower/README.md` — the tranche mechanics and the absorption gate.
3. `Roadmap/Tao Revolution/Process.md` — the program, the principles, and the tranche definition of
   done. Note principle 4: the tranche is not absorbed until behavior tests **written in Tao** cover
   every construct it touches.
4. `Roadmap/Dialect migration tranche/Brief - Dialect migration tranche.md` — the spike findings,
   the resolved decisions, and the measured blast radius. Read _Resolved since the spike_ carefully;
   it settles questions this prompt does not repeat.
5. `Roadmap/Tao Revolution/Decisions.md` §2, §8, §15, §16 — the authority for every spelling.
   Where any other document disagrees, the decisions win.

## What changes

The brief's _Scope_ section is the checklist. In dependency order:

1. **Types.** `enum Name { Cases }` → `type Name is one of A, B, C`, with cases as values,
   case-test targets, and dialogue answers (Decisions §2 shows all three). `yes / [Alias] no` with
   the alias **before** `no`, which deletes the `BOOLEAN_NO_ALIAS` contextual token and its token
   builder block. `{ … }` stays the item type — no `item` keyword in type position.
2. **Slots.** Leading `optional` → postfix `?` on entity fields, item fields, and parameters.
   The closed nine-trait list trails in parentheses on `data` declarations only; parameters keep
   their bare `default <expr>`. A slot is optional or defaulted, never both.
3. **Parameters.** `Name is Type` → juxtaposition `Name Type`.
4. **Sidecar bindings.** `implement inject provider|nav "./X.ts"` → `provider X from ./X.ts` and
   `nav X from ./X.ts`; inline `ts` fences retire with them. **General expression-position `from` is
   out of scope** — no scope-provider work in this tranche.
5. **Tests.** Selectors become text-or-`#tag`; journeys are `test "…"` and nest; `select` stays;
   `CheckDeclaration` and `DataStatusStep` are deleted.
6. **Numbers.** Decimal literals and unit accessors (`1.5`, `220.ms`, `10.px`).

## How to proceed

- **Re-apply the spike, do not rediscover it.** `Roadmap/Dialect migration tranche/grammar-spike.patch`
  is a working grammar diff for items 1–3 and 6, and `dialect-spike.test.ts.txt` is its probe file.
  Apply them first, confirm the probes pass, then adjust: replace the permissive trait placeholder
  with the closed list, trim `FromExpression` to the binding sites, and drop what item 4's narrowed
  scope no longer needs.
- **Promote the probes to permanent parser tests.** They cover the findings that cost the most to
  learn: the `yes / Alias no` token deletion, `1.ms` beside `1.5`, juxtaposed parameters, and
  `returns { … } { … }` adjacency.
- **Expect the migration to dominate.** With the grammar in place the suite showed 243 failures,
  overwhelmingly `Name is Type` in parameter lists (1,056 parse errors). Prefer a scripted
  respelling with a reviewed diff over hand edits, and land it in slices the absorption gate can
  follow.
- **Follow every rule change through the toolchain**: parser, validator, formatter, source actions,
  compiler, runtime. The spike touched only the grammar; the validator additions are where the new
  rules live (trait legality by context, optional-xor-default, duplicate case names).
- **Reconcile the specs in the same change**: `Spec/Tao Type System.md` (enums, leading `optional`),
  `Spec/Tao Data.md` and `Spec/Tao Packages.md` (`implement inject provider`),
  `Spec/Tao Presentation and Navigation.md` (`implement inject nav`), `Spec/Tao Testing.md`
  (selectors).

## Boundaries

- **`Apps/Tao Future/` is out of scope.** Those apps are pre-consolidation by declaration and are
  aligned at Process step 3.
- **Decisions win over older documents.** If a `Spec/` page, the current Next header, or a roadmap
  note disagrees with `Decisions.md`, respell to the decision and reconcile the page. Do not reopen
  a decision.
- **If implementation proves a decision wrong**, amend `Decisions.md` in the same change with the
  reason, per Process principle 5. Do not leave code and decisions divergent, and do not amend
  silently.

## Done when

Every item in Process.md's _Cutting a tranche_ is complete: the Next contract is written and cites
its Decisions sections; Current implements it; behavior tests in Tao are green for every respelled
construct; the promoted parser tests guard the spike's findings; the `Spec/` pages above are
reconciled; `Coverage.md`'s _pending dialect tranche_ rows are updated; Current ≡ Next byte-identical
with both statuses `absorbed`; `./agent verify` green.
