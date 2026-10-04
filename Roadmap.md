# Tao Roadmap

Open work only. Completed work is recorded under `Docs/Archive/`.

`Apps/WordFlower/README.md` owns the tranche mechanics language features are built through. The
language target and the program that reaches it — first MVP, then Revolution — are owned by
`Docs/Roadmap/Tao Revolution/`: `Decisions.md`
(what Tao becomes), `Process.md` (how the program proceeds, step by step), and `Coverage.md` (which
app feature and Tao test proves each capability).

The public MVP release has its own two lists: `Docs/MVP Roadmap/Agent MVP Roadmap.md` for the work
agents can execute without a new decision, and `Docs/MVP Roadmap/Developer MVP Roadmap.md` for the
judgments that are the Developer's. Both point back into this file and into `Docs/Roadmap/` for context.
[The staged release plan](<Docs/MVP Roadmap/Plan - Staged public releases.md>) owns five cumulative
public releases and supersedes older all-at-once launch scope. [The QA register](Docs/QA/README.md)
tracks on-demand coverage and evidence; later roadmap work is not automatically a release-1 blocker.

## Tao tooling performance

- [ ] Implement [projects, modules, publications, and generated TypeScript](Docs/Roadmap/Plan%20-%20Tao%20projects%20modules%20and%20packages.md).
  - Replace project declarations with marker roots, introduce app/package dependencies, relocate
    contracts, and share the CLI/editor/host watch service through six integration slices.

- [ ] Make the `tao` commands interactive-grade.
  - An uncached `tao check` of WordFlower takes 20-27s against 14ms of actual parsing; the causes are
    product defects that also set the floor of every verification lane. Measurements, root causes,
    the floor of the current stack, the phased fix, and the stack alternatives considered live in
    [`Docs/Roadmap/Tao tooling performance.md`](Docs/Roadmap/Tao%20tooling%20performance.md).

## Real-host testing

- [ ] Prove the additive [real-host testing prototype](Docs/Roadmap/Real-host%20testing%20prototype.md)
      on browser, simulator, and physical-device UI before proposing replacement of existing suites.

## Documentation cleanup

Two scoped passes over the repository's own records. Both are bookkeeping, not language work, and
neither blocks a tranche.

- [ ] Reorganize this roadmap by category and size
  - `Toward v1` and `Backlog` are flat lists that mix multi-week workstreams with one-line
    follow-ups, so nothing can be scanned for what to pick up next. Group entries by area and mark
    their rough size, keeping this file the single index of open work.
- [ ] Rework the rest of the markdown set
  - Part 6 of the simplification plan holds the per-page dispositions, the archive moves, and the
    document-map rewrite. Not started.
  - Covers `Docs/Spec/` and the remaining `Docs/Roadmap/` folders: archive the landed declaration-model
    records, de-duplicate the design-system open questions and the project-ID contract into one
    home each, settle the descriptor-identity draft, and write down the draft-suffix convention plus
    an authoritative map of what every document is for. An audit produced concrete per-file
    dispositions, but it predates the tranche 4 documentation edits, so re-verify each finding
    against the current files before acting on it.

## Subagent delegation

How agents in this repository delegate, and at which model tier. The guidance, the profiles, the
three harnesses' defaults, and the fan-out and second-opinion procedures have landed;
`Docs/Roadmap/Subagent delegation/Plan - Subagent delegation.md` owns what is left and the
calibration period that ends the "ask the Developer" clause.

- [ ] Decide whether the two fan-outs get saved `Workflow` scripts. The plan states the case against
      shipping them unasked: one harness only, unprovable without a supervised run, and a fan-out at
      September's scale is the machine-contention problem rather than a use of it.
- [ ] Benchmark a few representative tasks with and without delegation, once load-aware admission
      lands and the machine is quiet enough for the measurement to mean anything.
- [ ] End calibration when the delegation log says the routing table is right, then delete the
      "ask the Developer" clause and the three logging hooks.

## The Tao Revolution program

- [ ] [Implement Syntax2 progressively](<Docs/Roadmap/Data and render contracts/Implement Syntax2.md>)
      — future-source Library app forces the selected type/render/quantity/action contracts. Graduate
      dependency-complete pieces from `.tao.future` to `.tao`; settle named open seams before dispatching
      parallel implementation workstreams. This task does not change MVP priority or deferred scope.

The language target is decided except for explicitly open or deferred questions recorded below and in
active workstream ledgers (`Docs/Roadmap/Tao Revolution/Decisions.md`); the steps below are
`Process.md`'s sequence as open work, in order. The dialect tranche is absorbed (`1 - Current` and
`2 - Next` are byte-identical, both `Tranche status: absorbed`), so everything written anywhere is
now written once, in the final dialect. Each step lands per the tranche definition of done: behavior
tests written in Tao, green in Current, for every construct introduced.

- [x] Rewrite `4 - Revolution` in the decided dialect (Process step 2)
  - WordFlower's Revolution tier re-expressed per `Decisions.md`, with the `Apps/Tao Future/` apps
    as sibling references.
  - `Apps/WordFlower/4 - Revolution/Open questions.md` carries the eleven questions the rewrite could
    not answer from `Decisions.md` — chiefly whether empty argument lists on containers are omitted
    (§9 says yes, §10's own example and the implementation say no, and `3 - MVP` inherits whichever
    wins), whether the visibility ladder is §1's two words or the implemented five, and whether
    `DynamicSelectionNav` is a decided nav kind. Its Q1, the authority cluster, is `R5` in
    `Docs/MVP Roadmap/Developer MVP Roadmap.md` rather than a new question. Three internal contradictions in
    `Decisions.md` were amended in the same change: `TabNav` → `SelectionNav`, the missing `overlay`
    presentation mode, and two parameter lists still written `Name is Type`.
  - `Coverage.md` rows for the tier remain unwritten; step 3 owns that file.
- [ ] Consolidate the `Apps/Tao Future/` apps to the decided dialect (Process step 3)
  - The three demos are design D's dialect today; align them to `Decisions.md` and complete
    `Coverage.md`'s rows during the port.
- [ ] Re-derive `3 - MVP` by omission (Process step 4)
  - Same spellings as Revolution, fewer capabilities. Includes the focused-writing mode (the
    `@tao/time` forcing feature); excludes automations; settles the authority-cluster scope
    question recorded in `Process.md`.
- [ ] Cut tranches from the Current ↔ MVP gap until Current ≡ MVP (Process step 5)
  - One tranche at a time per the definition of done; then expand to the Tao Future apps
    (Skillet first) and continue toward Revolution the same way. The previously noted gap
    capabilities — InstantDB, remote authorization semantics, richer data test controls, snapshots,
    SplitNav/windows, semantic design recipes, concurrency policy — are now scoped by
    `Coverage.md`'s tier column.
- [ ] [Design the Time.Live API](Docs/Roadmap/Time.Live%20API.md)
  - Updating time is a separate library API from fixed `Timer.Duration()` samples and `Time.Now()`
    DateTime readings. Remaining time API design is deferred to pre-MVP
    [A30/R21](<Docs/MVP Roadmap/Review - Dates and time APIs.md>).
- [ ] Decide the runtime action-transaction contract
  - Deferred by the Developer on 2026-08-31. Settle whether root actions serialize, nested `do` calls join one
    transaction, state/data use private read-your-writes overlays, commits apply deltas to the latest
    snapshot through prepare/publish phases, and publish failures restore already-published resources.
  - Keep external effects explicitly non-rollbackable and do not treat the implemented Studio runtime
    behavior as a settled distributed-atomicity or automatic-retry language contract.
- [ ] Decide the semantic failure capture and replay contract
  - Deferred by the Developer on 2026-08-31. Settle the versioned artifact and domain-registry contract, domain
    compatibility and restore timing, credential and opaque-state exclusions, Studio cell-environment
    participation, and validation of loaded or pasted artifacts.
  - Automatic render-failure containment and guarded recovery are adopted independently. Do not treat the
    implemented `action-history`, `data`, `navigation`, `persisted-state`, or Studio replay behavior as an
    adopted language contract until this decision is resumed.
- [ ] Decide fixture-through-action result and handle semantics
  - Deferred by the Developer on 2026-08-31. Keep `through` setup fail-closed until result multiplicity, fixture-handle
    identity, transaction and rollback behavior, capture/replay, and test-harness seeding are settled.
  - Successful captured-fixture source writing is not evidence that the current runner can execute that
    setup path; do not infer the language contract from Studio's transient capture workflow.

## Toward v1

- [ ] Refine capability failure contracts where implementations can be proven (post-MVP)
  - Preserve ordinary inferred/declared failure contracts first. Investigate per-instance and
    whole-program narrowing without treating unknown external targets as closed. Scope and forcing
    examples: [Capability failure refinement](<Docs/Roadmap/Capability failure refinement.md>).

- [ ] Design the public Tao sidecar value API after MVP
  - Deferred from the package and generated-TypeScript migration. Explore explicit constructors,
    semantic value operations, conversion, and entity identity without exposing internal reactive
    wrappers. Open decisions and acceptance evidence live in
    [Tao sidecar value API](Docs/Roadmap/Tao%20sidecar%20value%20API.md).
