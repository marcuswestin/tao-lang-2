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

**Status: partially consolidated.** These sources began in design D's dialect, and
`Decisions.md` wins wherever an unconsolidated form still disagrees. The keyboard-driven command
dialect is consolidated: a command declares its slots in its parameter list, owns its static
`Title`, and contains exactly one `do`; its action is a private procedure with no title metadata.
App-wide module commands are mounted through `Commands`, view commands are local to their mounted
view, and duplicate module/view declarations have been removed. Modifier shortcuts use the portable
`primary + "…"` form, while the runtime-owned command palette is always present rather than declared
by an app. Each app now binds its root through `view`, including reactive `view when …` roots.

Remaining known deltas include `if / then / else` (retired for `when`), `public publish` (now bare
`publish`), role-word test selectors (now text or `#tag`), `check "…"` journeys (now `test "…"`;
`check` is only the early-exit statement), `List(Rows)` (now `loop … on select`), and the
design-block structure. Consolidating these groups is step 3 of
`Docs/Roadmap/Tao Revolution/Process.md`.

The unified view kind and host-read view slots are also consolidated with the native navigation kit
(`Decisions.md` §9 amendments). Every renderable declaration here reads
`view`; the retired `ui`/`frame`/`layout`/`dialogue` heads were rewritten when that tranche landed,
with capabilities left to body inference (`@@content`, `@name = empty` slots, `responds T`). Every
view directly hosted by a `StackNav` now fills its own reactive `Title`; window-presented views do
the same, without call-site title overrides. A toolbar lists command values in source order; the
earlier call-site `[primary]` annotations are gone, and the leading commands are retained first when
overflow moves a trailing suffix under `More`. Store authorization on the command's action
determines whether a command is visible, while boolean `Enabled` represents a permitted action that
is not yet ready; the obsolete
command-side `Available` member is gone. A delete action and its confirmation carry destructive
behavior; commands need no separate role marker. The design blocks' `patterns { }` entries still
await the step-3 design consolidation.

SlotNav intentionally reads neither host slot, so detail panes keep their replacement and Back
semantics without acquiring navigation chrome. Hearth's list/item detail, Skillet's recipe detail,
and Wayfare's day/stop details therefore expose each host command twice: `Toolbar` remains the
host-read surface when the same view is presented by a StackNav or window, while a compact
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
