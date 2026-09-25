# Merge list - live explorations

For the Developer's sign-off, per `Plan - Repository simplification 2.md` 4.f: groups of live `Docs/Roadmap/`
documents that overlap in topic. No merge has been done; this only proposes targets and what would
be archived once a merge lands. Line counts are current-file `wc -l`.

## 1. Tao Studio v1 / v2 / AI / companion app (13 files, ~4,940 lines)

- **v1 vs v2 core**: `Tao Studio v1/Plan - Tao Studio v1.md` (439) already states v2 supersedes its
  Electron architecture, client shape, launch assumption, and scenario syntax, and that "the
  remaining v1 text is a historical ledger." `Tao Studio v2/Decision memo - Tao Studio v2.md` (90),
  `Plan - Tao Studio v2.md` (137), and `Prompt - Complete Tao Studio v2.md` (788) are the live v2
  record. **Merge**: fold any still-open v1 item (the real-device spike, unresolved "Remaining:"
  bullets in Slices 2-4) into `Plan - Tao Studio v2.md`; **archive** `Plan - Tao Studio v1.md` once
  absorbed — it is already self-described as historical.
- **Native-device exploration**: `Tao Studio v1/Exploration - Native device as Studio canvas.md`
  (222) is v1 Plan's own "Final exploration" output, status "historical architecture exploration."
  Travels with the v1 Plan decision above — **archive** alongside it, not standalone.
- **Studio AI**: `Tao Studio AI/Exploration - Semantic agent proof of concept.md` (784) and
  `Plan - Studio agent chat.md` (495) are both explicitly "proof-of-concept, not a production
  design," on the same semantic-agent idea. **Merge**: fold durable findings from the Exploration
  into the Plan; **archive** the Exploration once absorbed (or keep as cited backing research — the Developer's
  call).
- **Companion app**: `Plan - Tao Studio companion app.md` (529), `Prompt - Implement Slice 1.md`
  (228), `Slice 1 - Device protocol and trust.md` (407, "Barrier 0 contract for" the Prompt), and
  `Slice 2 - Everyday development canvas.md` (380, "in progress"). Lower confidence: each serves a
  distinct role (product plan, execution prompt, per-slice spec) rather than duplicating content.
  **Candidate**: once Slice 1 fully lands, fold `Prompt - Implement Slice 1.md` into
  `Slice 1 - Device protocol and trust.md` and archive the Prompt, unless the Developer wants the Prompt kept as
  a reusable per-slice template.
- **Proposed amendment**: `Proposed Decisions amendment - Action failures and transactions.md` (119,
  partially adopted) overlaps `Decision memo - Tao Studio v2.md`. Leave separate until the partial
  adoption resolves, then fold into the Decision memo.

## 2. Datasource-provider set (5 files, 859 lines)

`Multiple datasources/Plan - Multiple datasources.md` (317, "implemented, with named gaps") is the
umbrella, citing `Decisions.md` §6 and `Spec/Tao Data.md`. `CloudKit granular datasource
provider/Implementation...md` (152), `HTTP Datasource/Overview...md` (191), `InstantDB datasource
provider/Implementation...md` (79, "semi-experimental"), and `iCloud datasource provider/
Implementation...md` (120, "implemented boundary, not yet proven on devices") are one per-provider
status report each. **Merge**: fold each provider's status into a per-provider section of the
umbrella Plan; **archive** the four provider docs into `Docs/Archive/Reports/` once summarized.

## 3. `Tao ship.md` vs `Tao ship/` (3 files, 1,445 lines)

`Tao ship.md` (594, "historical exploration with landed-contract reconciliation, 2026-09-16") and
`Tao ship/Plan - Beta distribution in one command.md` (587, "implemented software contract,
reconciled 2026-09-16") were reconciled the same day and describe the same landed `tao ship`
contract; `Research - Beta distribution lanes.md` (264) is background. **Merge**: fold any
design-rationale value from `Tao ship.md` into the Plan or Research doc, then **archive**
`Tao ship.md` into `Docs/Archive/Explorations/` — its own title calls it a design exploration.

## 4. Freehand UI sketching (7 files, 2,327 lines)

`Design...md` (249, "product discovery closed"), `Product...md` (634, "reconciled to Design"),
`Plan - Freehand UI sketching.md` (414), `Plan - Figma-at-home strides.md` (268, "adopted"),
`Plan - Canvas-first design mode.md` (235, "implementation record, reconciled"),
`Prompt...md` (261), and `Roadmap - Studio review and refinement.md` (266, "approved product
direction"). Most are marked closed, adopted, or reconciled. **Merge**: consolidate the three
overlapping `Plan -` documents into one current plan; **archive** `Design...md` and `Prompt...md`
once their content is absorbed into `Product...md` and the merged plan.

## 5. Declaration model spike (5 files, 654 lines)

Single folder split across too many files: `Implementation...md` (231) plus `Now 1 Unified
declaration slots.md` (99) and `Now 2 Sidecar TypeScript implementations.md` (69) read as landed
slices; `Open questions...md` (197) and `Follow-ups...md` (58) are the live tracking documents.
**Merge**: fold `Now 1` and `Now 2` into `Implementation...md` (already the closed record); fold
`Follow-ups...md` into `Open questions...md` (both track undecided items).

## 6. Add Tao design system MVP (3 files, 543 lines)

`Plan...md` (191, "predates the WordFlower tranche process," Steps 1-4 landed, "continue from Step 5")
and `Research...md` (48) overlap directly; `Design tooling and rollout.md` (304) may duplicate the
Plan's Step 5+ content — needs a read to confirm. **Merge**: fold `Research...md` into `Plan...md`.
Worth checking together with `Component kits/Overview - Component kits.md` (186, same design-system
territory) for a cross-folder overlap the Developer may want in this group too.
