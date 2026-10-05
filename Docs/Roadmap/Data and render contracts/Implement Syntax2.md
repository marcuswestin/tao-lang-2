# Implement Syntax2 progressively

Requested 2026-10-04. Deliver [Apps/Syntax2](../../../Apps/Syntax2/README.md) as a runnable app by
implementing its accepted, non-deferred requirements and graduating dependency-complete source
from `.tao.future` to `.tao`. Source files are the forcing target, not evidence of parser acceptance.
This task records the implementation program. The design baseline landed on main at
`825637cd72395958bfbab396e5e8de13e604b90e`. The first render foundation and executable shell landed
at `3bcd71647bfcbc5e6a371c3cd8fcccba8b1fb6f2` after full host verification. Four separate manager
worktrees delivered A1 nominal/binding, B1 accessibility prefixes, D1 open failure contracts and
C1 checked-quantity runtime storage. The shared foundation landed at
`580f88cc5d8bec4682ebe430d08068f16aac3cb3` with public wildcard imports, erased native sidecar
type checks, preparatory comma migration and the runtime cleanup facade. Combined host verification
passed at that tree; lint, typecheck and runtime packaging reused exact-tree green evidence.

## Language baseline checkpoint — 2026-10-05

The accepted nondeferred language families are implemented on the integration branch. This is an
independently functioning baseline for other branches to consume, not completion of the full
forcing-app/platform acceptance program. On 2026-10-05 the Developer resumed implementation,
authorized adapting the incoming Photos/Files bindings to these contracts, and authorized landing
the combined baseline before completing the remaining acceptance work.

Implemented:

- Nominal ancestry and signature projections; contextual construction, order-independent role/type
  matching, repeated backing types, explicit conversions, wildcard imports and aliases.
- Structural capabilities, concrete Self and generic constraints, associated/static members,
  inferred result contracts, operators/converters and transitive pure-function restrictions.
- Checked numeric/Scalar/Duration/Ratio values, signed lowercase postfix units, owner-qualified
  units, canonical native storage/factories and retained unit views.
- Bare render views/values, quoted text, bare-empty-text omission, structural ui dispatch,
  parameterized/defaulted/repeated renderer slots, exact forwarding and accessibility prefixes.
- Snapshot multi-match when, single-result pick, app-owned failure guards, typed/inferred/open
  failure contracts, joined then/done, detached roots, cancellation and lexical LIFO defer.
- Data item/collection receivers, writable inverse fields, optional none/empty behavior, typed
  create/update inputs, adapter-owned bounded acquisition and revision acknowledgment.
- Standard-library Keyed/RenderKey/LazyList/Occurrence and active grouped row recipes through
  ordinary checked Tao builders and generated native capability contracts.

Latest pre-landing evidence: Syntax2 source validation (9 files, no errors/noncanonical issues),
WordFlower source validation (13 files, no errors/noncanonical issues; four existing style warnings),
combined package typechecking, the declaration-slot boundary suite (12 tests) and formatter suite
(52 tests). Focused compiled-source grouped-row and renderer-slot composition checks pass.
Four actual Library journeys passed again on 2026-10-05 after final lazy/grouped activation,
using the supported checkout-local TAO_HOME for test cache ownership. Final integrated landing gates own the baseline's
merge verdict; preserve separate host/device limits below even when those gates pass.

## Handing over the rest

The follow-up slice is `feat/syntax2-acceptance`, to start from the landed combined baseline. The
Developer authorized continuing through completion; deferred semantic investigations remain outside
that authorization's implementation scope.

1. **Combined lazy/grouped Library journeys.** Run `./agent tao test Apps/Syntax2` against active
   Shelf/GroupedShelf. The final source composes and typechecks; all four app journeys passed
   after lazy/grouped activation on 2026-10-05. The tests now distinguish 40/80/83 acquired counts from mounted
   viewport rows. Verify stable keys, regrouping/author changes, live row updates, seen revisions,
   writes, continuation/refresh failures and cancellation. Do not restore eager all-row assumptions.
2. **Native acceptance.** Compiled Export tests prove PDF bytes, checked Duration and cleanup on
   success/upload failure; native CompareTitles and grouped builder boundaries have focused proof.
   iOS clock compilation has arm64/x86_64 evidence. Installed-device, suspend/resume and Android
   behavior remain unproved. Use the existing managed native lanes and record their boundaries.
3. **Future-source and coverage reconciliation.** Compare Main.tao.future, Library.test.tao.future
   and library/GroupedRows.ts.future with active modules and the numbered obligations below. They
   remain undiscovered design fixtures, not runtime dependencies or acceptance evidence. Account for
   every obligation before retiring a fixture; update app documentation and coverage together.
4. **Final program acceptance.** Address failures from the combined journeys and applicable host
   checks, review the integrated seams, run the required final gates and land the acceptance slice.
   The broad deferred language investigations remain outside this task's completion criteria.

Planning readiness remains 100%; implementation of the language baseline and completion of the
whole app/platform program are deliberately separate milestones. Earlier workstream/wave sections
below describe the execution architecture and retained audit obligations, not outstanding language
feature families.

## Scope and boundaries

Use [Decisions](../Tao%20Revolution/Decisions.md) and the app README. S66's unit table, supplied-ancestor
inference and explicit conversions, and S67's five integration choices are selected. The final
forcing-source audit is complete; maintain its coverage obligations during implementation.
Owner-elided methods, named-state construction and bare-text rendering are implemented. Do not promote provisional app adapter/API
spellings into universal language decisions. The program supplements the existing Revolution process;
it does not silently change MVP priority or replace WordFlower tranche obligations.

Remain deferred: general never/bans (A28), localized core text/string (A26), comprehensive static
proof investigation (A27), general entity/query-state redesign (A29), remaining time/date APIs (A30)
and automatic whole-app capability/effect refinement (post-MVP). Implement already selected basic
effects and clock/quantity behavior; app-owned bounded adapter metadata can be narrow. If an app
requirement genuinely depends on an unresolved deferred design, settle that specific seam with
the Developer or explicitly omit the demonstration; do not invent a universal model.

## Required work and acceptance

| Slice                                    | Work required                                                                                                                                                                                                                      | App proof                                                                                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Contract and executable shell         | Audit current behavior versus target; settle remaining grammar/ABI and app root; build a dependency map and minimal launchable entry                                                                                               | Future files remain undiscovered; shell and a real journey run before graduation expands                                                                                                  |
| 1. Names and callable resolution         | is ancestry; signature projections/private types; raw contextual construction; bare/dot role binding; repeated types; literal lists; canonical named state; type/value contexts; use all, import renaming and collision validation | PersonName/Subtract work independent of argument order; ambiguous calls and implicit narrowing fail with unmatched/extra arguments identified; wildcard conflicts reject even when unused |
| 2. Capabilities and purity               | structural ui/Display/Ordered; concrete Self; where constraints; inherited/static result contracts; inferred results; owner-elided methods; transitive no-action/I/O/suspend funcs                                                 | Associated Render works for Title/Book/rows; incompatible methods/effects and sibling comparisons fail; factory result identity is preserved                                              |
| 3. Core numeric and quantities           | numeric storage, number/scalar operations; checked JS factories/accessor; explicit operators/converters; Duration/Ratio units, postfix negatives, precision/range effects                                                          | Mixed Duration units give correct canonical values and retained views; ratios/scaling/negative values work; invalid semantics/nonfinite input reject                                      |
| 4. Render frontend and runtime           | bare views/values; quoted sugar; styles before bodies; slots/default/replacement/empty, binders, repeated placements and exact forwarding; prefixes; bare empty text omission                                                      | Empty Feedback creates no layout node; Text("") retains one; default/forwarded/suppressed slots and accessible prefixes behave as specified                                               |
| 5. Outcomes and failure ownership        | sequential suspension, bound results, joined then/done/error/cancellation, detached roots; typed/inferred/unknown failures; fails bounds; fallible pure converters; app guards                                                     | Local InvalidInput recovery; other failures preserve healthy screen and skip later work; coverage required without repeated boilerplate                                                   |
| 6. Cleanup and timing consumers          | defer shorthand/LIFO, all exits, cleanup joining and primary failure preservation; selected Wait/monotonic fixed samples                                                                                                           | File cleanup follows upload release; cleanup-only failure suppresses done; cancellation cleans up; notifications detach and have owned failures                                           |
| 7. Data, input and adapter               | collection/item receivers, inverse fields, none/empty, default guard, create/update validation; adapter-owned schema/I/O conversion; revision acknowledgment                                                                       | Empty loaded results pass; absent author fallback is local; invalid input/write/ack failures surface; acknowledging old revision leaves newer one unseen                                  |
| 8. Acquisition and rendering collections | bounded continuation/refresh adapter, acquired-only collection methods, occurrences, keyed flattening, lazy viewport, grouped reactive row recipes                                                                                 | Request bounds before fetch; stable keys across reorder/author changes; live row updates, cancellation and failures; lazy rendering does not fetch all data                               |
| 9. Integration and graduation            | remaining source/tests become executable; source actions/formatter/Spec/coverage reconciliation; appropriate focused gates then full verification                                                                                  | Runnable app, user-visible transitions/failures and meaningful negative type/grammar tests; no successful placeholders or future-only executable dependencies                             |

Keyed/RenderKey and uniqueness policy belong to the standard-library LazyList implementation.
The compiler supplies ordinary capability/generic checking, not list-name or field-name magic.
Do not inject Key methods into all entities or impose this policy on loops/custom list components;
use ordinary associated/library adapters. The former stdlib/Keyed.tao.future target graduated into
its standard-library owner and is retired, rather than creating an app-local competing declaration.
Scalar is an abstract operation family; unit ambiguity
requires qualification; inverse alias double fills are rejected even if consistent.

Preserve existing effect-outcome machinery: transitive failure inference, contained-call savepoints,
bound action results and detached-root scheduling already exist. Workstream D implements the delta
to the selected `then`/`done`, coverage and cleanup contracts, with parity tests for existing behavior.
Do not replace proven rollback or effect inference with a parallel implementation.

Every slice is vertical: parser/AST where needed, semantic validation, formatter and source actions,
compiler lowering, runtime, native bridge and tests. Prove owner-specific behavior, not merely that a
fixture parses. For approved interface changes, add counterexamples at grammar/type seams and Tao
journeys for observable behavior. No tests are required merely to save this non-executable fixture.

### Final audit coverage

The current fixture is compact, not exhaustive acceptance evidence. Add focused fixtures and
behavior checks during the owning slices for the following accepted cases:

1. Supplied-ancestor generic inference, including argument-order independence and sibling rejection.
2. Inherited static factories preserving their declared result identity, and fallible pure converters.
3. Qualified and ambiguous unit names, concrete quantity domains, and rejection of direct scalar values.
4. Inverse writes and rejection of filling both aliases in one update.
5. Multiple matching action `when` branches, snapshot matching and failure interruption.
6. Multiple lexical defers, LIFO cleanup, cancellation and primary versus cleanup-only failures.
7. Actual stdlib numeric/scalar/Duration unit declarations and LazyList admission/runtime key checks.
8. Adapter validation mapped to InvalidInput; native bindings, revision races, bounded continuation
   and observable failure transitions. The initial future journey alone does not cover these.

Preserve the selected Time.StartTimer/Timer.Duration/Time.Now API and function restrictions. Classify
their permitted clock observations explicitly at implementation; do not create a blanket native I/O
exception. If these selected contracts cannot coexist, return only that narrow conflict for judgment.
The broader time API remains deferred to A30.

## High-level implementation plan

Use one integration coordinator and six vertical workstreams in dependency waves. Each workstream
manager can delegate implementation or validation to sub-agents with exclusive paths. Prefer three
or four active workstreams beside the coordinator; release new work when its prerequisites pass.
This is a dependency-based parallelism recommendation, not a measured speedup or time estimate.

### Workstream ownership

| Owner                        | Responsibility                                                                                                                                                                         | Inputs and deliverables                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Coordinator                  | Shared grammar/AST, type/effect representations, common dispatch, generated bridge contract, integration and graduation                                                                | Publish stable interfaces and bootstrap fixtures; sequence shared edits; own Apps/Syntax2 source moves and cross-stream tests                   |
| A. Names and capabilities    | Nominal admission and binding, private signature projections, use all/import collision validation, structural can, Self/generic inference, associated/static members, inferred results | Shared representation first; deliver order-independent binding and capability contracts needed by rendering/numeric/data                        |
| B. Rendering and slots       | Bare views/values, quoted text, empty text behavior, renderable ui, parameterized/repeated slots, forwarding, prefixes and handlers                                                    | Start independent grammar/formatting work after shared AST; capability dispatch and full slots wait for A's callable contracts                  |
| C. Numeric and native values | numeric/number/scalar, operators, explicit converters, Duration/Ratio, units, checked JS factories/accessors and selected timing consumers                                             | Needs A's generic/conversion contracts, coordinator bridge contract and D's modeled computational failures                                      |
| D. Outcomes and cleanup      | Failure inference/bounds, purity enforcement, when/pick, sequential/then/done/cancelled, detached roots, app failure guards and defer                                                  | Shared effect/callable representation; own transaction/cleanup semantics together; export action and failure interfaces for C/E                 |
| E. Data and adapters         | Item/collection receivers, inverse writes, typed input/create/update validation, adapter-owned decoding, BookIO file/revision/bounded acquisition                                      | Needs A's receiver/type contracts and D's outcomes; native values use the coordinator bridge and C's selected Duration contract                 |
| F. Lazy collection rendering | Exported stdlib Keyed/RenderKey/LazyList, viewport virtualization, occurrence metadata, reactive grouped row recipes and continuation integration                                      | Needs A structural capability, B renderer/slot ABI and E live handles/acquisition; own library identity policy, with generic compiler admission |

Each manager owns its feature-specific validator, formatter/source-action, compiler, runtime and
tests as one vertical slice. Shared files are requests to the coordinator, not concurrent edits.
Runtime reusable semantics remain in TR, and generated app code remains wiring. Native adapters
must use checked values and preserve live-handle dependency reads rather than return unchecked
snapshots or mounted JSX.

### Dependency waves and checkpoints

1. **Foundation and launchable shell — coordinator first.**
   a. Re-check current code and instructions; produce exact path ownership, dependency and acceptance
   manifests. Retain current implemented behavior until the selected replacement has parity proof.
   b. Extend shared callable/type/effect contracts and the existing checked native binding pipeline.
   BridgeMetadata plans contracts; ProjectToolingService publishes `.tao-ts` contracts, removes
   legacy adjacent outputs and runs mapped TypeScript checks. Preserve handwritten sidecars and
   that publication ownership when adding checked quantities, live handles and callback contracts.
   Prototype
   owner-elided members, named-state construction, unit suffixes and bare render parsing with
   ambiguity/precedence counterexamples. Implement a coherent minimum before publishing it.
   c. Extract the smallest dependency-complete entry and real Tao journey into `.tao`, omitting
   unsupported features while leaving their source in `.tao.future`. Do not respell selected
   syntax, widen discovery, create tier mirrors or graduate the entire Main file prematurely.
   Checkpoint: a launchable shell, stable shared interfaces and meaningful passing tests.
2. **Language feature work — A, B and D first; C as its inputs stabilize.**
   a. A supplies nominal/callable/capability contracts while B handles independent render syntax and
   D handles outcome/control flow. The coordinator integrates shared dispatch and grammar changes.
   b. C starts on agreed numeric/native contracts; complete generic operators/converters when A and
   D supply their interfaces. B completes ui dispatch and renderer slots once A is integrated.
   c. Graduate small demonstrations for each accepted family and its negative checks. Checkpoint:
   conversions, render callbacks and action failures interoperate without effect/type erasure.
3. **Data and lazy list work — E and F overlap only at stable interfaces.**
   a. E implements typed writes, associated receivers and controllable BookIO adapters. Publish live
   handles, cached revision reads and bounded continuation contracts before F depends on them.
   b. F implements the exported stdlib list using B's callback ABI and A's ordinary capability
   checking. It can build viewport/key tests against a fixed adapter while E completes native I/O.
   c. Integrate grouped rows, inverse writes, pagination and acknowledgment. Checkpoint: stable row
   identity/reactive updates, bounded requests, local recovery and owned root failures work together.
4. **Complete the app and prove the seams — coordinator plus independent reviewers.**
   a. Finish dependency-complete source graduation; implement the additional audit cases in focused
   fixtures and Tao journeys. No missing native backend or successful placeholder earns completion.
   b. Review combined changes across type/effect/native/render/data seams; run focused checks and
   applicable integration, runtime, visible UI and native/provider acceptance.
   c. Reconcile implemented Spec, canonical source actions, coverage and roadmap records. Checkpoint:
   Syntax2 runs and every in-scope requirement has evidence, with external/native limits explicit.

The main dependency path is shared callable/type/effect and bridge contracts → feature integration
→ data/live-handle and render-slot contracts → lazy list/app integration → acceptance. Start downstream
work on stable interfaces rather than waiting for every unrelated workstream to finish. If a wave
cannot keep file ownership exclusive, use one implementation manager for that coupled portion.

### Shared seams and dispatch requirements

Reserve the following representative existing seams for the coordinator. Re-audit actual files
before dispatch; these are architecture anchors, not exhaustive launch-time assignments:

- `packages/language/parser/parser-grammar/` and generated AST/parser output.
- `packages/language/ast-utils/ast-utils-src/Type.ts` and common binding/dispatch interfaces.
- `packages/language/validator/validator-src/validators/FunctionalCoreValidator.ts`.
- `packages/compiler/compiler-src/codegen/react-native/app/FunctionalCoreCompiler.ts`, common
  compiler aggregation and `packages/compiler/compiler-src/bridge-metadata.ts`.
- `packages/language/project-tooling/project-tooling-src/ProjectToolingService.ts`, contract publication
  and project TypeScript configuration when extending the native boundary.
- `packages/apps/runtime/TaoRuntime-src/TR.ts` and shared native value/effect representation.
- Apps/Syntax2 integration source, graduation/coverage ledger, shared exports/config and roadmap edits.

Representative feature owners include argument-bindings/type-binding-matches, functions/types
validators and InvocationsCompiler for A; ViewsCompiler/RenderStatementCompiler/TR-views for B;
Units/units-validator/TR-units and stdlib time declarations for C; effect-outcomes/ActionsCompiler/
TR-effect-outcomes/TR-action-transactions for D; DataCompiler/data-write-validator/TR-data and BookIO
for E; stdlib `packages/apps/stdlib/@tao/ui/` and grouped-row recipes for F. Transfer any shared file
explicitly before changing its owner. Current UI containment does not prove modeled action routing.

Before creating implementation threads, attach the complete design/future-source baseline to a
reviewable Git revision that every thread can start from; main alone does not include this dirty
checkout's new records. Preserve unrelated work. Each dispatch brief must carry selected decisions,
exact exclusive paths, forbidden shared paths, dependency versions, acceptance commands, a stopping
point and a return contract. Do not launch from uncommitted files that its worktree cannot see.

### Branches, threads and committed briefs

Recommended execution uses one coordinator thread with its own worktree, plus separate feature
branches/worktrees for each workstream manager. The four initial language managers are A–D;
E and F join later. They do not share a writable checkout or one long-lived implementation branch.
Each manager may delegate inside its owned feature, subject to the existing exclusive-path rules.

First commit and land the design/future-source baseline. Then land the coordinator's coherent shared
foundation slices. Start each feature branch from main containing its required foundation revision,
and record that exact revision in its dispatch brief. Land independently complete, verified slices
one at a time in dependency order; consumers update after their upstream interface lands. Do not
start all four from an older main without the foundations, or wait for an entire program-sized
branch before integrating. If an interface change cannot produce independently valid intermediate
slices, integrate that coupled change under the coordinator and land it as one coherent unit.

The shared plan is the authoritative process; task-specific briefs carry each manager's own scope,
prerequisites, allowed/forbidden paths and acceptance. Commit the
[coordinator brief](<Syntax2 coordinator brief.md>) with this baseline. The coordinator commits A–D
dispatch briefs after foundation extraction establishes exact ownership, and E/F briefs before
their wave. Those briefs must link the plan and decisions rather than duplicate their semantics.
Do not add task-specific parallelism instructions to universal AGENTS.md or create new skills.
High-level planning readiness does not claim that the uncreated, path-specific dispatch briefs
are already ready to launch.

### Validation and evidence

Run from the repository root once the owning `.tao` slices exist:

```sh
./agent tao check Apps/Syntax2
./agent tao test Apps/Syntax2
./agent verify-changed
```

Use `./agent test-file <owned-test-file>` for focused parser/type/compiler/runtime checks, supplying
the concrete path in each dispatch. Integrated completion needs full `./agent verify` and applicable
host/native lanes; focused checks do not establish integration or device acceptance. Record which
adapter proves external export/cleanup, and prove its declared completion/release boundary. Landing,
publication, dependencies and lockfile changes retain their existing authorization boundaries.

Before the broad integration review, recommend a dedicated repository-health pass covering the
language/runtime seams since the last recorded 2026-09-28 review; this implementation program does
not claim that older review covers its cross-cutting changes.

## Completion evidence

Track for every numbered forcing case: source location, selected contract, implementation owner,
graduated module, negative check where needed, Tao journey and acceptance boundary. A file rename
without its dependency and behavior proof earns no completion. Record local fixture versus real
provider/native I/O evidence separately. Land only with authorization for the implementation slice.
