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

**Status: pre-consolidation.** These sources are design D's dialect, not yet the decided one. Where
they disagree with `Decisions.md`, the decisions win — known deltas include `if / then / else`
(retired for `when`), `does` on commands (commands are now intent references), `public publish`
(now bare `publish`), role-word test selectors (now text or `#tag`), `check "…"` journeys (now
`test "…"`; `check` is only the early-exit statement), `List(Rows)` (now `loop … on select`), and
the design-block structure. Consolidating them to the decided dialect is
step 3 of `Docs/Roadmap/Tao Revolution/Process.md`.

One decision group is already consolidated: the unified view kind (`Decisions.md` §9 amendment).
Every renderable declaration here reads `view`; the retired `ui`/`frame`/`layout`/`dialogue` heads
were rewritten when that tranche landed, with capabilities left to body inference (`@@content`,
`@name = empty` slots, `responds T`). The design blocks' `patterns { }` entries still await the
step-3 design consolidation.

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
