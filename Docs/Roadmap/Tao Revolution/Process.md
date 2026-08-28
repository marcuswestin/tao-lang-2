# Tao Revolution — Program Process

How the repository moves from today's implementation to MVP and then toward Revolution. This
document owns the _program-level_ process only; the tranche mechanics — the four WordFlower tiers,
`Tranche status:` lines, extension mapping, and the byte-identical absorption check — stay owned by
`Apps/WordFlower/README.md` and are not restated here.

## Authority map

| Document                    | Owns                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `Decisions.md` (here)       | Every language decision, with rationale. The single source of truth for _what_ Tao becomes. |
| `Coverage.md` (here)        | The capability → forcing-feature → test matrix. The proof that every decision is exercised. |
| This document               | The program sequence, principles, and the tranche definition of done.                       |
| `Apps/WordFlower/README.md` | Tranche mechanics: the four tiers and their validation.                                     |
| `Apps/Tao Future/README.md` | The future apps: origin, status, and graduation rules.                                      |
| `Roadmap.md`                | The index of open work. Points here; duplicates nothing.                                    |

## Principles

1. **Subset by omission, never by respelling.** Everything MVP contains is written exactly as
   Revolution writes it — MVP is fewer capabilities, never different spellings. This is what makes
   the MVP → Revolution path monotonic: nothing implemented for MVP is ever migrated again.
2. **A capability exists only if a real feature forces it.** A language feature with no honest
   product feature behind it gets a contrived test and an untrustworthy design. `Coverage.md` is
   the enforcement: every capability names its forcing feature, and a capability with none is
   either cut or a red flag to resolve.
3. **The demos are progressively activated specs, not tier mirrors.** Only WordFlower carries the
   four-tier structure. Each app in `Apps/Tao Future/` is one source tree in the final dialect;
   files the toolchain cannot yet run stay `.tao-revolution`, and as tranches land, enabled files
   graduate to `.tao` and enter `tao test`. Progress is "how much of the spec runs".
4. **Every tranche ends in Tao tests.** A tranche is not absorbed until behavior tests _written in
   Tao_ exercise every construct the tranche introduced, running green in `1 - Current`. Tests are
   the encoding of the language's intended functionality; prose never substitutes.
5. **Decisions and code never disagree.** A tranche that amends a decision updates `Decisions.md`
   in the same change.

## MVP scope

- **WordFlower only.** Additional apps join after MVP is reached (Skillet first — it has the
  broadest remaining coverage and re-tests sharing in a second shape).
- **MVP adds a "focused writing" mode** — spend X minutes free-writing before stopping — which is
  the honest forcing feature for `@tao/time` (`time.Interval`, live derived values, `Stop()/
  Start()/Running`, duration literals like `10.min`).
- **Automations are not MVP.** Provider-owned scheduled work, notifications, and interruption
  levels wait for the app expansion (Skillet's timers and reminders force them honestly).
- **Open scope question, settled at step 4 (MVP derivation):** whether the authority cluster —
  `access` rules, transactions, invites, `publish`, presence — enters MVP through collaborative
  WordFlower workspaces, or waits for the app expansion. Neither answer is assumed; `Coverage.md`
  carries the cluster as unassigned until this is decided.

## The sequence

Steps 0–1 are this branch and the next piece of work; later steps each become roadmap items and
tranches as they are reached.

- **Step 0 — encode the program (this branch).** Decisions, process, and coverage documents in
  `Docs/Roadmap/Tao Revolution/`; the four-design analysis archived; the future apps seeded in
  `Apps/Tao Future/` from design D's demos, pre-consolidation.
- **Step 1 — the dialect-migration tranche.** The _Migrations from what ships today_ section of
  `Decisions.md` is the checklist: `enum` → `type … is one of`, leading `optional` → postfix `?`,
  `Name is Type` → juxtaposition in parameter lists, `implement inject …` → `provider X from
  ./X.ts`, named exports only, text-or-`#tag` test selectors. Mechanical but broad: it
  touches `1 - Current`, `2 - Next`, `Docs/Spec/`, the parser/validator/formatter/compiler, and every
  test. Run through Next as an ordinary tranche. After it, everything written anywhere is written
  once, in the final dialect.
- **Step 2 — rewrite `4 - Revolution`.** Replace WordFlower's Revolution tier with the same app
  expressed in the decided dialect, using `Decisions.md` as the rationale and the Tao Future apps
  as sibling references. This is where "Revolution contains everything decided" becomes spec-code.
- **Step 3 — consolidate the Tao Future apps.** Align the three demos to `Decisions.md` (they are
  design D's dialect today; the deltas are exactly the decisions that went against or beyond D).
  Write `Coverage.md`'s remaining rows during this pass — gaps surface while porting.
- **Step 4 — re-derive `3 - MVP` by omission.** From the rewritten Revolution tier: same
  spellings, fewer capabilities. Include the focused-writing mode; exclude automations; settle the
  authority-cluster scope question. The result plus Skillet's future milestone defines v1-done.
- **Step 5 — the tranche loop.** Cut tranches from the Current ↔ MVP gap, one at a time, until
  Current ≡ MVP. Then expand to the Tao Future apps and continue toward Revolution the same way.
  The focused writing tranche is the first of these and is closed
  (`Docs/Roadmap/Archive/Focused writing tranche/`); it ran ahead of steps 2–4 because its forcing
  feature was already named in MVP scope, and its reconcile pass folded the session into both later
  tiers.

## Cutting a tranche

A tranche is cut along `Decisions.md` sections, sized so its Next contract is reviewable in one
sitting. For each tranche:

1. **Contract.** Write the slice into `2 - Next` as working code with the tranche header, per the
   WordFlower mechanics. The Next diff _is_ the decision record for the slice; cite the
   `Decisions.md` sections it implements.
2. **Implement** into `1 - Current` slice by slice — parser, validator, formatter, compiler,
   runtime, as the slice demands (`packages/AGENTS.md` owns those boundaries).
3. **Prove.** Behavior tests in Tao for every construct introduced, green under `tao test`.
4. **Graduate.** Any `Apps/Tao Future/` files the tranche enables move from `.tao-revolution` to
   `.tao` and their tests join the suite.
5. **Reconcile.** Update the affected `Docs/Spec/` pages and `Coverage.md` rows; amend `Decisions.md`
   only if implementation taught something, in the same change.
6. **Absorb.** Current ≡ Next byte-identical, both statuses `absorbed`, `./agent verify` green.

**Definition of done for every tranche:** 1–6 complete — with 3 as the gate that matters: the
language's intended functionality is encoded as running Tao tests, not as prose.
