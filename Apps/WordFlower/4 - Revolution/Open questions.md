# Revolution tier — open questions

Written while rewriting `WordFlower.tao-revolution` into the decided dialect (`Process.md` step 2).

Every spelling in this tier traces to a section of `Docs/Roadmap/Tao Revolution/Decisions.md`. The
questions below are the places where it could not: constructs the tier needs that the decisions do
not answer, and places where the decisions answer twice. Nothing here was invented to fill a gap —
where the tier still uses an undecided construct it is because the construct is already implemented
or already inherited, and the file says so at the use site.

Three internal contradictions were resolved in `Decisions.md` itself, in this same change, because
the document disagreed with itself rather than with the implementation; they are listed at the end
and are not questions. A fourth looked like one and was not — it is Q9.

---

## Q1 — Is WordFlower the app that forces the authority cluster?

**Decided but unused:** `access`, `audience`, `transaction`, `publish`, `presence` (§3, §4).

This is already the Developer's tracked decision **R5** in `Docs/MVP Roadmap/Developer MVP Roadmap.md`, whose standing
recommendation is to defer the cluster to the app expansion with Skillet. It is repeated here only
because it is the one open question that changes what this file contains: if the cluster enters MVP
through collaborative WordFlower workspaces, the forcing feature lives in this tier and this tier has
to grow it.

The tier is written the way R5's recommendation implies — no authority surface at all — and the TODO
list at the head of the app file says why. Taking the recommendation therefore changes nothing here.
Answering the other way means adding accounts, `data Accounts / Account with { … }`, memberships, a
share code, and a `publish Document … by capability` projection to this file.

Inventing collaborative workspaces to have something to point `access` at would have answered R5 by
writing code, which is why the tier does not.

**Blocks:** `Coverage.md` rows for §3 and §4 — a coverage row cannot name a forcing feature until R5
is answered.

## Q2 — Is the visibility ladder two words or five?

§1 decides **"Two visibility modifiers and no others"**: `file` narrows to the source file, `public`
widens past the folder or package boundary, and an unmarked declaration is folder-visible.

The implementation has five — `file`, `folder`, `package`, `workspace`, `public` — and
`Docs/Spec/Tao Packages.md` documents each, with `file` as the default rather than folder. Both
halves of that differ from §1: the default is inverted, and three words exist that §1 says do not.

§8 does not help: its own worked example writes `package command Finish(Document)`, so the wider
ladder has already leaked into a section that postdates §1.

This tier is written to §1, which is cheap here because it is one file: the `workspace` and `package`
markers are gone, only `file` and `public` remain, and everything the test file imports is unmarked
and therefore folder-visible. That is not cheap in `1 - Current`, where `@ui/`, `@nav/`, and `@data/`
are real package folders using the wider ladder, so the migration is real and the decision is the Developer's.

## Q3 — Which nav kinds are decided?

§10 decides four container kinds. The tier uses two that are not among them:

- **`DynamicSelectionNav`** — a selection container that may begin empty and receive items at
  runtime, which is what makes the documents pane's comparison tabs possible. It is inherited from
  the MVP tier and appears nowhere in `Decisions.md`.
- **`Occurrence { Content:, Key: }`** — the value that asks a dynamic selection for a second
  occurrence of the same semantic content. Also inherited, also undecided.

Both are used in `WorkspaceSplit` and `FileTree` and are marked at the use site. Either they are
decided kinds §10 should list, or the comparison-tab feature is cut.

## Q4 — How is a declaration gated on the platform?

The previous tier wrote `<platform is Desktop>` blocks around whole declarations. That syntax is in
no decision, and its cases (`Desktop`, `iOS`, `Android`) name devices and operating systems, which
§13 and §18 both rule out — the decided vocabulary is the project's own `targets phone, tablet,
laptop`, read through the `Platform` environment value.

The tier now writes the split as a value instead:

```swift
nav WorkspaceNav = when Platform {
   laptop -> SlotNav { Initial WorkspaceChooser }
   otherwise -> StackNav { Initial WorkspaceChooser }
}
```

Every part of that is decided — `Platform` (§13), value-producing `when` (§8), a keywordized nav
binding (§10) — so nothing was invented. What remains open is whether gating a **whole declaration**
(a view that exists only on one target, a provider only one target can bind) needs its own form, or
whether the value-level `when` is the whole answer.

## Q5 — What is a periodic in-view effect?

§9 removed the `every` clause deliberately: a ticking clock is a library value, and `@tao/time`'s own
source repeats that. `Interval` gives a _reading_ that changes, which is exactly right for the focus
bar's countdown and is what the tier uses.

It is not enough for an effect per tick. The previous tier wrote `on every 30.seconds -> { update
Document { … } }` for autosave, importing an `every` that `@tao/time` does not export. §12's
`automation` is not the answer either: it is provider-owned scheduled work driven by data, and is
"explicitly not a timer on one mounted device".

Autosave is therefore dropped from this tier and listed in the app file's TODO. Either a periodic
effect gets a spelling, or the answer is that a writing app saves on submit and on write-through,
which is what the tier does today.

## Q6 — Where does `?` sit on a relation field?

§2 decides that optionality is a postfix `?` on the slot, and separately that relation fields do not
use juxtaposition — a differently named relation carries its target in the trait list
(`Person (relation Accounts)`). It does not show the two together.

`Paragraphs` needs an optional self-referential parent, so the tier writes:

```swift
Parent? (relation Paragraphs)
```

This applies both rules mechanically, but it is the one slot spelling in the file with no worked
example behind it. The alternative reading is `Parent (relation Paragraphs)?`.

## Q7 — Constructs the implementation has and `Decisions.md` does not record

These are used in the tier because they are implemented today and the tier would be poorer without
them, but `Decisions.md` — the record of the decided language — never mentions them. Each is either a
decision that was never written down or an implementation detail that should not be in a spec tier.

| Construct                                                                               | Used by                                   | Where it is specified today        |
| --------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------- |
| `async { … }`                                                                           | `AddDocument`, `AddParagraph`             | `1 - Current` tranche header       |
| `guard <subject> <case> -> …` inside an **action**                                      | — (retired here, see below)               | `Docs/Spec/Tao Actions.md`         |
| `snapshot <row>`, `T.Snapshot`                                                          | `DocumentSnapshot`                        | `3 - MVP`                          |
| `Panes()`                                                                               | `WorkspaceDetails`                        | `Docs/Spec/Tao Layout and UI.md`   |
| `Occurrence`                                                                            | `FileTree` (see Q3)                       | `3 - MVP`                          |
| `hide <Command>` on a view                                                              | `DraftDocumentRow`, `FinishedDocumentRow` | §8 (decided — listed for contrast) |
| `remote none`, `requires <ref>`                                                         | `project`                                 | `Docs/Spec/Tao Packages.md`        |
| `press text "…"`, `press key "…"`, `narrow`, `expect navigation title`, `expect target` | the journeys                              | `Docs/Spec/Tao Testing.md`         |

§16 decides `press "New recipe"` and a _physical_ `Slash` for hints; the tier writes `press text "…"`
and `press key "?"` because that is the implemented vocabulary and the journeys are meant to be
readable beside `1 - Current`'s. Most of the attention vocabulary — `narrow`, `expect target`,
`expect focus region`, `expect verbs` — has no recorded spelling at all, which is a gap in §16 rather
than a choice this tier made.

One of these went the other way. `1 - Current` uses `guard WorkspaceName empty -> { … }` as an
action's early exit, but §8 is explicit that `guard` is **views only** and tests a data object's
availability, while an action stops with `check <boolean>`. This tier is written to §8:

```swift
action AddWorkspace() {
   if WorkspaceName is empty {
      present WorkspaceNameNotice() as overlay
   }
   check WorkspaceName is not empty
   …
}
```

That is a real migration Current owes, and it is the one place where following the decisions changed
how an existing WordFlower action reads rather than only how it is spelled. If §8 is wrong and
availability guards belong in actions too, this is the moment to say so.

## Q9 — Are empty argument lists on containers omitted?

§9 says yes — "`Col [page]`, not `Col()`" — and calls it the one place the mirroring rule yields.
§10's shell example, `Docs/Spec/Tao Layout and UI.md`, and `1 - Current` all say no, and this tier
writes `Col()` throughout because that is what §10's example and every sibling reference write.

This rewrite first amended §9 to match them, and that was wrong: the document's own preamble says a
decision is made on its merits and may supersede a shipped spelling, so "the implementation does it
the other way" is not evidence against a decision — it is the thing a decision is allowed to
overrule. The amendment was reverted, and the question is put here instead.

It is not cosmetic. Whichever way it goes, `3 - MVP` inherits it, and the loser is a migration across
every render tree in the repository.

## Q10 — Two inherited navigation spellings with no decision behind them

- **A split pane's `Title`** (`WorkspaceSplit`, three panes). §10's `SplitNav` contract is `Content`,
  `Width`, `CollapseOrder`, and `Compact`, and its host-read-set says `SplitNav` reads neither host
  slot and that panes "retain their own configuration". A journey asserts the pane titles render.
- **`Badge`** on a `SelectionNav` item. §9 defers `Icon`, `Badge`, detents, and appearance "for
  forcing features", and §10's host read-set enumerates a selection item as `Label` and `Icon`.

Both came from `3 - MVP` rather than from this rewrite, and both are now marked at the use site.

## Q11 — How does a foreign action's declared failure reach the calling site?

§15 gives a foreign action `fails <Case> "<sentence>"` and says a provider failure "selects a
declared case". §5 gives the calling site `queued`, `saved`, `rejected`, and `error`, and defines
`rejected` as a `refuse when` or `validate` failure and `error` as a thrown exception. Neither says
which arm a declared `fails` case arrives in, or whether the arm binds the case or the sentence.

`ExportPanel` guesses: it treats `Offline` and `Rejected` as `rejected` and renders the bound
sentence. The export journey rests on that guess.

## Q8 — Does the Revolution tier stay one file?

§1 decides a file decomposition every app shares — `App`, `Data`, `Access`, `Rules`, `Chrome`,
per-feature folders, `Design`, `Words`, `Scenarios`, `Tests` — specifically so that reviewing what a
person may do never requires reading what a row contains. `1 - Current` is already a directory,
though along different lines (`@ui/`, `@nav/`, `@data/`).

`Apps/WordFlower/README.md` describes this tier as one app file plus a test and a `Justfile`, so the
tier stays one file and the rewrite did not restructure it. Splitting it is tranche mechanics, which
that README owns, not a dialect change.

---

## Resolved in `Decisions.md` in this change

Three places where the document contradicted itself. Each is amended rather than raised, because
there was no second party to ask: the decision already existed twice, in two spellings.

1. **§10 "Four container kinds … `TabNav`."** The same section's host-read-set bullet, amended by
   KEY-D11, names `SelectionNav`, which is what is implemented, specified, and used everywhere. §10
   now names `SelectionNav` and records `TabNav` as the retired name. The rename is the whole
   amendment; nothing about the kind's behaviour is added.
2. **Presentation modes omit `overlay`.** §9 and §10 list sheet, window, root, menu, and toast, but
   §10's own Back rules talk about "that presentation's own overlays", the grammar has
   `as overlay | sheet | toast`, and every WordFlower tier uses it. `overlay` is now in the list,
   with one sentence distinguishing it from a sheet and a pointer to the spec page that owns its
   lane, stacking, and Back precedence — recording those rather than deciding them.
3. **`Name is Type` in two parameter lists.** §2 and Migration 3 both retire it, and the tier never
   writes it, but `transaction LeaveKitchen(Membership is Membership)` and
   `function FirstOwner(Household is Household)` still did. Same class as the two above.
