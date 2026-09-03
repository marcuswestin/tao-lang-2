# Roadmap - Studio review and refinement

Status: **approved product direction; implementation begins with interaction recording and collaborative
visual review**.

This follow-on roadmap turns Studio's scenario matrix into a development loop: demonstrate behavior,
ask for useful variants, review every affected rendering with collaborators, and improve the design
system from evidence. It builds on deterministic scenario replay, source-linked render identity and
geometry, server-canonical source-action proposals, checkpoints, and undo delivered by the freehand UI
sketching project. It does not change the FS-D1–FS-D20 decisions or reorder the remaining Feed,
Variants, Tao-rendered-canvas, focus-in, or companion work in
`Plan - Freehand UI sketching.md`.

The accessibility work considered alongside this roadmap remains represented only by the checks already
present in Tao's design/scenario direction. It does not enlarge this project into a new accessibility
tranche.

## Product loop

1. A person demonstrates a behavior in a real preview and keeps the useful interaction as Tao source.
2. Studio proposes a small, relevant matrix around that behavior and keeps only variants the person
   accepts.
3. Studio renders the accepted scenarios and fixtures before and after a change into one collaborative
   review artifact.
4. Design rules diagnose violations across those cells, and Studio proposes semantic design-system
   improvements with the affected evidence attached.

Each stage produces input for the next. None requires an AI model to preserve, replay, compare, or apply
the result.

## 1. Record interaction into a scenario or test

### Experience

`Record` starts an ephemeral interaction draft for one selected preview cell. The person uses the app
normally, stops recording, and sees the canonical Tao steps beside the exact scenario, fixture,
arguments, environment, and starting revision. Studio offers `Save to scenario` first and `Save as test`
when the recorded sequence has an assertion or the person adds one. Every write goes through the normal
proposal, diff, checkpoint, compile, and undo path.

Studio records semantic operations Tao can replay — `press`, `enter`, `submit`, `select`, `hover`,
tagged `focus`, and intentional virtual-clock advances — rather than DOM events, coordinates, arbitrary
delays, or a video. It never approximates an operation it cannot represent. An ambiguous target or an
unsupported interaction remains visibly unresolved until the person chooses a stable visible-text or
`#tag` selector.

Sensitive text input is redacted in the draft by default. The person must explicitly retain a literal
secret-like value, and Studio warns that accepted scenario and test source is committed project data.

### User stories

- As a designer, I press Record, demonstrate opening and completing a form, and keep the result as a
  replayable scenario without learning the journey grammar first.
- As a developer reproducing a bug, I record the shortest failing path, add the expected outcome, and
  save it as a test whose source diff my teammate can review.
- As a keyboard or assistive-technology user, I record the semantic action I performed rather than a
  pointer coordinate, so replay proves the same product behavior through Tao's supported interaction
  boundary.
- As a reviewer, I can see unresolved or redacted steps before accepting source and can reject the
  proposal without mutating the project.

### Boundaries

- Recording starts from one identified cell and source revision; recompilation or remount stops it
  rather than silently rebasing the interaction.
- Existing scenario-prefix steps remain the sole replay representation. A recording is Studio data
  until explicitly accepted.
- Wall-clock pauses are discarded. A person may add an explicit `advance` only when virtual time is
  product behavior.
- `Save as test` must not manufacture assertions. An interaction-only recording is honestly a scenario
  or a smoke journey until the person supplies an observable expectation.

## 2. Prompted scenario expansion

### Experience

From a view or scenario group, a person can ask Studio for a few useful variants: “show the boundary
states for this checkout row” or simply “Suggest variants.” Studio creates an ephemeral matrix, explains
why each cell was selected, and lets the person keep individual cells as authored scenarios and fixtures.
The default is a compact pairwise set, not a full stress run or a combinatorial wall. `Full cross` is an
explicit choice available only when every selected axis is finite.

The deterministic engine always supplies the useful floor:

- alternate values from declared yes/no and case-set parameters;
- numeric minima, maxima, zero, and values adjacent to declared boundaries when those bounds exist;
- empty, short, and deliberately long text where the type and constraints permit it;
- existing fixture rows and captured examples;
- supported viewport, appearance, network, locale, direction, motion, contrast, and text-scale axes as
  they become executable;
- state prefixes already representable by scenario steps.

A small local macOS model built into Studio may rank, name, and explain candidates or propose
domain-specific combinations. It receives the compiler-owned schema, current scenarios, available fixture
handles, supported axes, and the person's prompt. Its output is validated against that closed inventory.
Unavailable, invalid, or declined model output falls back to the deterministic set, so core expansion
never depends on AI. The development Studio already has a local generation-provider seam; packaged Studio
must own that helper's lifecycle before this capability can claim the model is present there.

### User stories

- As a developer, I ask for “a few risky variants,” receive empty, long-title, narrow, dark, and offline
  cells selected pairwise, and keep only the two that teach me something.
- As a designer, I ask for likely real-world states; the local model ranks compiler-valid candidates and
  explains its choices, but Studio still works when the model is disabled.
- As a maintainer, I rerun suggestions after parameters change and see existing authored scenarios
  deduplicated rather than receiving renamed copies of the same state.
- As a design-system author, I expand every finite declared variant and ask Studio to evaluate the
  project's design rules over the resulting cells.

### Rules and limits

- Candidate identity is the normalized subject, arguments, fixture, environment, and ordered prefix.
  Duplicate identity is one cell regardless of its suggested label.
- The default budget is small and visible. Studio explains excluded axes and how to request more.
- “All variants” means the finite cross-product of explicitly selected, finite axes. Arbitrary text,
  numbers, data graphs, clocks, and network behavior are never presented as exhaustively covered.
- Rendering suggestions does not require design rules. Calling a matrix conformant does: the app must
  select a design and declare the applicable rules before Studio reports a rule verdict.
- Model suggestions cannot invent Tao syntax, fixture handles, environment capabilities, or design-rule
  results. They remain proposals until a person keeps them.

## 3. Collaborative visual review

### Experience

`tao review` renders selected scenario and journey states at a base revision and a candidate revision.
It produces a stable static review containing paired images, cell metadata, applicable diagnostics, and
source links. Reviewers can switch among side-by-side, swipe, overlay, and changed-pixel views; filter
added, removed, changed, unchanged, and incomparable cells; and mark each difference `expected`,
`regression`, or `question`.

The most useful unit is not a loose screenshot. It is a stable cell key containing the scenario source,
group and entry, fixture or captured-data identity, environment, and journey checkpoint. Renames and
changed inputs are shown as structural changes instead of being misreported as pixel regressions.

### User stories

- As an author, I compare my working tree with its merge base and see every affected component across
  its checked-in scenarios and fixtures before asking for review.
- As a reviewer, I comment on one changed cell, jump to its Tao scenario and render occurrence, and mark
  the difference intentional without dismissing unrelated changes.
- As a remote collaborator, I can open a self-contained static artifact without running Studio and see
  the renderer fingerprint, source revisions, scenario inputs, diagnostics, and prior decisions.
- As a team, we rerun a review after a fix and preserve resolved decisions while stale comments are
  identified rather than attached to the wrong pixels.

### Collaboration and determinism

- The default comparison is Git merge-base versus the candidate working tree or commit. A named pair of
  revisions is also allowed. Baseline PNGs are derived artifacts, not hand-maintained source truth.
- Review decisions live in a small portable manifest separate from images. They are addressable by cell
  key plus image digest, so a changed rendering reopens the decision.
- The static artifact contains no project secrets or live provider credentials. Captured data follows
  the same redaction and explicit-acceptance boundary as fixtures.
- Pixel comparison is valid only when viewport, scale, fonts, browser/runtime versions, platform, color
  profile, animation state, and renderer fingerprint match. Otherwise Studio provides side-by-side
  review and labels the pair incomparable instead of manufacturing a percentage.
- Visual differences are evidence for people, not design-rule verdicts. Machine-decidable violations
  appear independently and cannot be accepted away by marking a screenshot expected.

## 4. Design conformity and semantic refactoring

### Experience

Studio evaluates the selected app design and its rules over every chosen matrix cell. It traces resolved
style provenance rather than searching source text, then groups violations and repeated raw decisions by
semantic role and visual effect. A proposed refactor shows the source diff and every affected before/after
cell and applies as one checkpoint.

Examples include promoting a repeated spacing or color into a semantic token, replacing near-duplicate
bundles with one named treatment, finding a rule that never exercises a relevant state, or proposing a
new rule because the same manual review decision recurs across the matrix.

Suggestions may improve rules, not merely satisfy them. Deterministic evidence identifies uncovered
contexts, repeated exceptions, unreachable rules, inconsistent thresholds, and values already acting as
an unnamed convention. A local model may propose names and concise rationales over that evidence. It may
not weaken a threshold, add an exception, or claim conformity solely to make current violations disappear.

### User stories

- As a developer, I learn that three spacing values are visually equivalent, preview one semantic-token
  refactor across all affected scenarios, and apply it transactionally.
- As a design-system owner, I see that the compact rule is never evaluated in dark mode and add the
  missing rule or scenario from the attached evidence.
- As a reviewer, I distinguish a source-level conformity violation from a subjective visual question and
  discuss each at the relevant rule and cells.
- As a team, we discover that a frequently accepted review pattern is an undeclared design convention;
  Studio proposes a rule that makes the convention explicit for future changes.

### Boundaries

- Conformity requires an app-selected design and applicable project/app rules. Projects without them can
  inspect resolved styles but cannot receive a conformity badge.
- Static rules run in validation; layout-dependent rules run against rendered cells; perceptual rules
  remain review criteria for people. The tool never converts a subjective judgment into a fake test.
- Refactors use semantic source actions with full provenance, proposal/apply parity, compilation, and
  undo. Text replacement is not an implementation path.
- A rule-improvement suggestion includes supporting and counterexample cells and states whether it
  strengthens, clarifies, broadens, or narrows the rule.

## Implementation sequence

### First target — record one semantic interaction into the current scenario

Deliver the smallest complete recording loop: one selected cell can record supported `press`, `enter`,
and `submit` operations, show a canonical draft with unresolved/redacted steps, and append accepted steps
to that same focused scenario through the authenticated source-action/checkpoint path. Recompile and
replay prove that the saved source performs the demonstrated behavior. Broader selection, hover/focus,
virtual time, assertions, and `Save as test` follow only after this loop is trustworthy.

This is first because scenario-step parsing, manifest lowering, replay, cell identity, proposals, and
undo already exist. The new work is capture, canonical target resolution, and an append-steps source
action rather than a second recording architecture.

### Second target — review capture, pairing, and portable decisions

Capture scenario cells from two renderer-compatible revisions, pair them structurally, and generate the
static side-by-side artifact plus review manifest first. Pixel heatmaps and hosted pull-request adapters
come after the renderer fingerprint and portable comment/decision identity are proven.

This is second because authored scenarios can already produce useful review evidence, the current CDP
lane already drives real Studio and captures PNGs, and the artifact creates immediate collaboration value
without depending on unfinished Feed, L2, or design rules.

### Third target — deterministic suggestions for one view

Begin after Freehand Slice 4 has landed in its mandated order. Add a pure candidate engine over the current
manifest and selected cell. It proposes a bounded, deduplicated pairwise set from declared parameter values
and executable environment axes, explains each candidate, and mounts accepted candidates ephemerally in
the matrix. One candidate can be kept through a server-canonical add-scenario source action. The local
model is an optional ranker/namer behind Studio's generation-provider boundary; deterministic behavior
ships and is tested first.

Implementing persistent or ephemeral generated variant cells before Slice 4 would duplicate and reorder
that slice's owned behavior. A pure planner may be prototyped earlier, but it is not a delivered Studio
feature until it uses Slice 4's canonical variant path.

### Fourth target — rule evaluation and evidence-backed refactors

Land after the design-rule and semantic-token/recipe surface it consumes. Begin with deterministic rule
evaluation and resolved-style provenance, then semantic refactor proposals, then evidence-backed rule
improvement suggestions. The local model remains optional throughout.

## Verification

- Recording tests prove capture uses stable semantic selectors, refuses ambiguity, redacts sensitive
  input, stops on revision change, proposes exact source, recompiles, replays, and undoes.
- Suggestion tests pin candidate normalization, boundary generation, pairwise selection, budgets,
  explanations, deduplication, model fallback, ephemeral isolation, keep, and undo.
- Review tests pin cell keys, structural pairing, renderer compatibility, artifact determinism, redaction,
  portable decisions, and digest-based reopening.
- Conformity tests separate static, rendered, and perceptual rules and mutation-test every source refactor
  against the rendered cells it claims to preserve or improve.
- Real browser evidence is required for recording, ephemeral matrix mounting, and screenshot capture.
  Focused package tests alone cannot close those behaviors.

## Explicit deferrals

- The inspection-lens/theming proposal and sketch-to-production component promotion are not part of this
  approved roadmap.
- No remote model, cloud review service, or third-party design registry is required.
- Accessibility remains within existing scenario and design-rule responsibilities until it receives its
  own decided tranche.
- Hosted pull-request comments, pixel-diff thresholds, design-rule syntax still open in Tao Revolution,
  and exhaustive simulation of infinite domains remain future decisions.
