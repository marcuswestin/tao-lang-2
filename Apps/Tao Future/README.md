# Tao Future

The three post-MVP demo apps — **Skillet** (a household kitchen), **Hearth** (a shared home), and
**Wayfare** (a collaborative trip planner). Together with WordFlower they are the four apps that
drive Tao's implementation: the demos are the spec, and a language capability exists only if a real
feature in one of these apps forces it.

## Origin

Four independent designs of post-MVP Tao were produced and compared item by item; Ro resolved every
agreement and disagreement into `Docs/Roadmap/Tao Revolution/Decisions.md`, which is the authoritative
record of the decided language. These app sources were seeded from design D
(`tao-revolution-synthesis-da6265`), the design whose dialect the decisions most often selected.

**Status: consolidated** (Process step 3, 2026-09-17). These sources began in design D's dialect;
`Decisions.md` now wins everywhere, and the deltas that were exactly the decisions going against or
beyond D have been applied. The keyboard-driven command dialect was consolidated first: a command
declares its slots in its parameter list, owns its static `Title`, and contains exactly one `do`; its
action is a private procedure with no title metadata. App-wide module commands are mounted through
`Commands`, view commands are local to their mounted view, and duplicate module/view declarations
have been removed. Modifier shortcuts use the portable `primary + "…"` form, while the runtime-owned
command palette is always present rather than declared by an app. App roots use `view`, including
when the root value is itself a nav.

The step-3 pass then closed the remaining groups. `if / then / else` retired for `when` — the compact
`when C A / not B` for two outcomes, the block form where a branch is a render body. `public publish`
is bare `publish`. Test journeys are `test "…"`, selecting by visible text or `#tag` only, with store
checks as ordinary queries (`expect (Households where …).Count is 1`) rather than an `expect stored`
sub-language; `check` is only the action-only early exit, and `stop if` / `stop unless` are gone with
it. `List(Rows)` retired: a container wraps and `loop` iterates, so `Grid`, `Pages`, and an ordinary
`Col` hold a `loop` and selection is `on select`. The design block is §13's shape — `colors` with
derived conditional entries in place of the tokens → meaning → dark stack, `sizes`, `shadows`,
`text`, `screens`, `styles` (lowercase bundles and Capitalized element defaults, with `pressed` /
`focused` / `hovered` as ordinary conditions), and `rules`; `patterns { }`, `style X { base / variant
/ state }`, `environment`, `platform`, and the separate `design check` declaration are all retired.
Alongside those: the safety net is §5's five cases with no `failed`, effect outcomes read `saved` /
`queued` / `rejected` / `conflict` / `error`, identity is `use Account from @tao/auth` plus one
`let Me = Account`, a ticking clock is `Interval` from `@tao/time`, the TypeScript boundary is
`<expression> from <path>` with declared `fails` cases, optionality is a postfix `?`, relations whose
name differs from their entity carry `(relation X)`, `search` is a field trait, unit literals are
`7.days` / `5.km`, `SplitNav` reads `Progression @a, @b` and `CollapseOrder N`, permissions are one
binding each with a `Reason`, and neither an app language picker nor a provider quiet-hours window
survives.

**Spellings this pass had to choose without a decision.** Each is recorded in the step-3 handoff for
Ro: the reorder affordance and drop target as container members (`Col(Reorderable: …)`,
`Col(Accepts: …)`, `on drop`), `where` on a `loop`, `first N of`, composite `unique A, B`,
`order by relevance`, `device.timeZone`, `Connection` and `Sync` as environment values, `X.Cases`,
`to X otherwise Y` and a `never` schedule case, `runs single per Row`, and the world controls a
journey uses (`clock`, `advance`, `collaborator`, `capture shared link`, `expect notification`,
`expect window`, `move … onto …`). They are marked so a later tranche either decides them or
replaces them; none is assumed to be settled.

The `scene is view` split and host-read view slots are also consolidated with the native navigation
kit (`Decisions.md` §9 amendments). Presented declarations that own `Title` or `Toolbar` read
`scene`; reusable content and sheet-only presentations read `view`. The retired
`ui`/`frame`/`layout`/`dialogue` heads were rewritten when that tranche landed, with capabilities
left to body inference (`@@content`, `@name = empty` slots, `responds T`). Every scene directly
hosted by a `StackNav` now fills its own reactive `Title`; window-presented scenes do the same,
without call-site title overrides. A toolbar lists command values in source order; the
earlier call-site `[primary]` annotations are gone, and the leading commands are retained first when
overflow moves a trailing suffix under `More`. Store authorization on the command's action
determines whether a command is visible, while boolean `Enabled` represents a permitted action that
is not yet ready; the obsolete
command-side `Available` member is gone. A delete action and its confirmation carry destructive
behavior; commands need no separate role marker. The design blocks' `patterns { }` entries retired in
the step-3 consolidation: the empty state is an ordinary content-accepting view, and the row pattern
is ordinary `styles { }` bundles (`line`, `lead`, `main`, `trail`) over ordinary containers.

SlotNav intentionally reads neither host slot, so detail panes keep their replacement and Back
semantics without acquiring navigation chrome. Hearth's list/item detail, Skillet's recipe detail,
and Wayfare's day/stop details therefore expose each host command twice: `Toolbar` remains the
host-read surface when the same scene is presented by a StackNav or window, while a compact
`Button(Command)` row renders the commands inside the content when SlotNav hosts the view. Both
surfaces reference the same commands and actions, so permission, enabled state, labels, and effects
stay identical. Sheet-presented editors likewise use an in-content `Button(Command)` dismissal;
sheets read neither `Title` nor `Toolbar`, so their only exit is never placed in ignored host chrome.

## How these apps drive implementation

- **One source tree per app, no tiers.** Only WordFlower carries the Current/Next/MVP/Revolution
  structure. Each app here is written once, in the final dialect (after consolidation), as the
  standing target.
- **Progressive activation.** Files use `.tao-revolution`, which Tao discovery ignores. When a
  tranche lands the capabilities a file needs, that file **graduates**: rename to `.tao`
  (tests to `.test.tao`), fix nothing else — if graduation requires edits beyond the rename, either
  the consolidation was incomplete or the implementation diverged from `Decisions.md`, and both are
  findings to resolve, not to patch around. Graduated tests join `tao test` and become part of the
  permanent suite.
- **Coverage.** `Docs/Roadmap/Tao Revolution/Coverage.md` maps each language capability to the app
  feature that forces it and the test that proves it. When touching these apps, keep the matrix
  true.
- **Expansion order.** WordFlower alone carries the program to MVP. After MVP, Skillet activates
  first (automations, notifications, timers, measurement, and a second shape of sharing), then
  Hearth (occurrence queries, nearness) and Wayfare (files, offline documents, draft conflict).

## Rules

- Do not edit these sources casually. A change is either **consolidation** (aligning to
  `Decisions.md`, step 3) or a **decision amendment** (which updates `Decisions.md` in the same
  change, per the process). The apps and the decisions never disagree silently.
- Product behavior is spec: renaming a feature, tab, or flow here changes what the language must
  support, and belongs to Ro.
- Each app folder keeps its own README describing the product; this file owns their shared role in
  the process.
