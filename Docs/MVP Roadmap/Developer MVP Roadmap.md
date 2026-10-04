# Developer MVP Roadmap

The judgments only the Developer can make before Tao goes out to a small number of outside developers. The
agent-executable half is `Agent MVP Roadmap.md` beside this file, and its entries name the decision
here they wait on.

Each entry states the question, what it blocks, the options as they stand, and a marked
recommendation. A recommendation is a starting position for the decision, never the decision.

## Pre-MVP language investigations

### R17 — Locale-aware core text

- Requested 2026-10-02: investigate before MVP; defer discussion from the current syntax work.
- Question: should locale-aware display content be a core value, should it be called `text`, and
  should raw unlocalized character data be a separate type such as `string`?
- Investigation: [A26](<Agent MVP Roadmap.md#a26--investigate-locale-aware-core-text>).
- Blocks: a change to the core text/storage/API contract; this is not approval to make that change.
- Options: retain current text and contextual localization; add a separate localizable message value;
  make `text` the display value and add raw `string`.
- **Recommendation:** assess all three against actual data flow and migration; retain typed message
  arguments until the rendering edge and keep user content verbatim under every option.
- Decision ready when A26 provides the representation, examples, compatibility costs, and proposed
  MVP boundary. No new core text representation is selected yet.

### R18 — Static data safety guarantees

- Requested 2026-10-02: investigate before MVP; defer the complete proof-system design from current
  syntax work. Runtime validation, guards, and error containment remain necessary in the meantime.
- Question: which availability, optional-read, and modeled failure-handling guarantees should Tao
  enforce statically, and which subset should ship in MVP?
- Investigation: [A27](<Agent MVP Roadmap.md#a27--investigate-static-read-and-failure-handling-proofs>).
- Blocks: promising or implementing complete static proofs, not current runtime safety behavior.
- S61 scope: automatic proven refinement through capability instances/call targets is
  [post-MVP](<../Roadmap/Capability failure refinement.md>); ordinary body/callee inference and
  declared failure bounds remain the selected direction. A27's investigation does not move this
  advanced implementation into MVP.
- Options: focused narrowing and outcome diagnostics with runtime safeguards; a broader checked
  read/effect system; a staged path between them.
- **Recommendation:** require explicit scope for each guarantee, distinguish invocation failures
  from later receipt outcomes, and select an evidence-backed MVP subset after A27. A proof covering
  arbitrary external implementations is not promised.

### R19 — Uninhabited types and representation protection

- Requested 2026-10-02: defer `never` from the active syntax design for pre-MVP investigation.
- Questions: do apps need an explicit uninhabited type for nonreturning operations and impossible
  cases? Separately, how should types prevent unwanted conversions or raw representation access?
- Investigation: [A28](<Agent MVP Roadmap.md#a28--investigate-uninhabited-types-and-representation-protection>).
- Options: bottom type versus inferred exhaustiveness/nonreturning effects; negative conversion
  permissions versus encapsulated storage with positively declared conversions.
- **Recommendation:** decide the two needs separately. A runtime-aborting converter does not ban
  a call statically. Opaque/secret wrappers may solve representation protection without `never`.
- Decision ready when A28 supplies concrete examples, alternatives, diagnostics, and an MVP scope.
  Neither a bottom type nor conversion-ban syntax is selected for the current fixture. The later
  selected `fails never` annotation means an empty propagated failure contract and does not reopen
  these investigations.

### R20 — Entity handle and query state model

- Requested 2026-10-04: review and reorganize before MVP; defer detailed redesign from current dialogue.
- Questions: which typed facets, predicates and freshness/provider policies describe reads coherently,
  how does expected none differ from a failed required contract, and how are overlapping states shown?
- Investigation: [A29](<Agent MVP Roadmap.md#a29--review-and-reorganize-entity-handle-and-query-states>)
  with [discussion context and completion criteria](<Review - Entity handles and query states.md>).
- Selected: remove public missing; default guards require available/present usable values and allow
  valid empty content. Typed failures preserve violated required contracts and permission privacy.
- **Recommendation:** independent typed facets with small ergonomic predicates; use source/provider
  evidence rather than guessing freshness, visibility or existence. Keep failure coverage and later
  receipt ownership explicit. Apply selected single-value pick/all-match when and settle their
  detailed observation, action and failure behavior separately from most-specific guard dispatch.
- Decision ready when A29 supplies written types, combination truth tables, forcing examples,
  adapter obligations and a scoped MVP migration proposal. This entry authorizes investigation only.

### R21 — Dates and remaining time APIs

- Requested 2026-10-04: defer remaining time API choices and review modern libraries before MVP.
- Questions: which types distinguish instants/local calendar values, which transformations and
  arithmetic should be supported, how are timezone ambiguities handled, and how should Time.Live work?
- Investigation: [A30](<Agent MVP Roadmap.md#a30--review-modern-date-and-time-library-designs>) with
  [selected context and completion criteria](<Review - Dates and time APIs.md>).
- Selected: Timer.Duration returns fixed elapsed samples while measurement continues; timers are
  runtime-only/nonpersistent and may be initialized in view state. Time.Now returns DateTime absolute
  instants. Signed unit-bearing Duration and sleep-inclusive monotonic measurement remain selected.
- **Recommendation:** use official modern-library evidence to separate elapsed time from calendar
  transformations, give ambiguous inputs explicit policies, and keep live-clock lifecycle explicit.
- Decision ready when A30 supplies typed forcing examples, sourced alternatives, host/adapter
  obligations and a scoped MVP proposal. DateTime arithmetic and remaining time API are not settled
  merely by creating this investigation.

## Deferred developer automation

Decided 2026-10-04: defer the remaining managed development-loop and isolated native acceptance
work until after MVP to preserve effort for release work. Land the completed implementation with
source verification; incomplete host and human acceptance stays explicitly open. The
[execution handoff](<../Roadmap/Managed development loops - Execution plan.md>) owns the remaining
cases, evidence limits, retained resources and safe resume order. This does not defer the separate
physical-device acceptance below.

Confirmed 2026-10-04 after implementation landed as `20bbeff06b95`: ownership-proved cleanup of
retained test resources is authorized now, with uncertain receipts kept quarantined. No further
managed-loop/native acceptance or unified-controller implementation belongs in the current thread.
Run ordinary installed CLI, marketplace-extension and browser-tutorial acceptance separately before
release 1. Physical Vision Pro remains pre-MVP. Genuine simulator interaction is required before
release 2 and installed native Studio interaction/windows before release 3; deferring this special
automation matrix does not waive those public-surface gates. Android and the persistent UI
controller remain post-MVP. A separate recurring repository review is recommended before publication.
