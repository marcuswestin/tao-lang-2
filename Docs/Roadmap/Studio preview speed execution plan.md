# Studio preview speed execution plan

Prepared 2026-10-06. Status: awaiting Developer approval; production implementation and landing
are not authorized. The [continuation roadmap](<Studio preview speed continuation.md>) remains
the project owner. The [tracked POC handover](<Studio preview speed POC handover.md>) records the
experimental mechanisms and historical evidence. This plan supersedes the supplementary archive's
main-only preparation plan as the proposed execution sequence, without superseding its raw evidence.

## Integrated starting state

1. New managed worktree: `/Users/ro/.codex/worktrees/studio-preview-speed-execution/tao-lang-2`;
   branch `feat/studio-preview-speed-execution`, created from exact checkpoint
   `4efc6ff2aff31fa3c0a8f45d270444c836fe7a9d`.
2. The supported merge workflow fetched and integrated main
   `5d9330f85e402a0a9bf28bf5b4de2700b6094fc8`. Merge commit
   `aed4c9ad807cf5bcf2ceb7855c499e995958be54` resolves compiler and validator conflicts.
   It retains main's associated-effect validation evidence, workspace union, and emission context,
   plus the checkpoint's profiling and independent final native freshness audit.
3. The complete checkpoint delta against `b1cc156c775b92d8095bd3ce6eee2214dabbf02b`
   was reviewed: 44 files, 3,776 insertions and 119 deletions, including all six experiments and
   their tests. All remain experimental in this branch. Frozen setup, typecheck and lint pass;
   focused integration evidence is recorded in the task checkpoint. No new latency measurement,
   broad verification, push, hosted run or landing has occurred.
4. Main's native inspection memo, manifest capture/probes, two optimistic passes, locked fallback,
   and stale-publication recovery are retained. Explicit native roots remain cold under main's
   existing contract. The POC's mutable `experimentalInspection` option is not a production API.
5. The original performance and POC worktrees, user edits and supplementary handover archive
   remain untouched. The separate `feat/studio-preview-production` branch contains no POC source.
   Project store/local/cache layout, activation persistence, stable links, identical-publication
   suppression and the landed timer patches remain the baseline.

## Proposed enablement

1. Enable preview-first and bounded authoritative scheduling by default only after their admission
   and lifecycle proofs pass. Preserve publication checks on by default. Unknown or unsupported
   input states use authoritative compilation; initial activation is authoritative. This first
   enablement covers browser Studio sessions; native/device publication stays authoritative.
2. Enable direct scalar padding by default only for eligible browser previews in publication-off
   mode, within the tested `Design.tao` boundary. Native/device publication and checked browser
   publication retain the normal compiler path; sessions requiring native/device publication are
   ineligible for direct delivery. Extending this boundary needs a separately proved
   contract and a Developer decision.
3. Retain explicit diagnostic opt-outs for preview-first and direct delivery and opt-in tracing.
   Remove the held/paused-full mode and the revision-only experimental paint endpoint from the
   production surface. Scheduling has one production policy, with deterministic injected clocks
   for tests. No experimental enabling flags are required for approved production behavior.
4. Exclude unchanged source-read reuse and additional whole-document validation replay. Preserve
   their source, tests and measured evidence in checkpoint `4efc6ff2a` and its original worktree.
   Deliberately remove their production plumbing from parser, validator and Workspace; retain
   main's existing guarded local report, type, document and traversal reuse. Compare the restored
   fallback against the covered corpus before retiring any branch-specific behavior.

## Execution slices and barriers

1. **Contracts, baseline and experiment separation.** Freeze the fetched-main control SHA and
   integrated candidate SHA. Establish matched baselines using identical copied authored inputs,
   Studio editor saves, publication modes, Metro settings and active previews. Measure native
   inspection calls, cold hashes, memo hits and lock/barrier crossings before selecting extra reuse.
   Separate the two excluded experiments and the held mode. Freeze input-classification,
   accepted-source snapshot, paint identity, overlay baseline and fresh-realm contracts before
   implementation workers start. No dependency, lockfile or permission-policy change is planned.
2. **Preview-first and bounded authoritative work, together.** Admit only one known current
   versioned Tao edit with otherwise proven consumed inputs and current tooling identity. Treat
   watch events as hints: source versions and consumed config/package/sidecar/native observations
   must establish equivalence. Unknown observations, additions/deletions, graph/ownership changes,
   stale or multiple changes, configuration/dependency/native changes and failed baselines go
   authoritative. Keep source overrides immutable per attempt, candidate epochs separate from
   successfully consumed snapshots, and recheck identity before publication. Serialize mutable
   parser/workspace use and preserve diagnostics and generated-output repair.
   Schedule one current and one latest pending authoritative request. Authenticate child paint
   using origin/window and project/app/cell/instance/compile/manifest identity; carry the complete
   identity through the server API and validate it against registration and the pending attempt.
   Observe two child frames, then a one-second quiet delay; anchor the ten-second maximum to the
   first pending work. An absent paint still reaches the maximum. Rejection, compilation failure,
   invalidation and loss of all useful active previews release recovery promptly. Close flushes
   required work once and disposes timers, subscriptions, watch and runtime state even on failure.
   Reject superseded results. Already-running synchronous full work remains non-preemptible;
   the maximum bounds intended scheduling delay, not completion time under a blocked event loop.
3. **Direct padding and authoritative publication barriers.** The compiler owns syntax admission:
   exactly one finite nonnegative unconditional scalar pad literal and identical bytes outside it.
   Require a successful baseline, current source version, unique declaration/path/owner/member,
   exact entry index/prior value and valid half-open ranges. Shift later provenance immutably for
   literal-width changes. Authenticate revision delivery to retained realms; reject stale or
   mismatched baselines and take normal compilation for unsupported or rejected updates. Do not
   advance an accepted baseline merely because an attempt started. Before any new realm registers,
   publish authoritative generated bytes for the pending overlay, retaining stale-manifest
   rejection and only the existing bounded changed-context activation retry. This is not a Metro
   revision-recovery retry. Cover whole-app compile-only identity, complete cell identity, and
   local whole-app versus server cell geometry. Authoritative diagnostics eventually catch up.
4. **Conditional native reuse.** Use main's owning memo and locking implementation first. Add
   immutable attempt-local inspection handoff only if measurements and deterministic work counts
   show remaining duplicate work. Keep exact roots/input provenance, explicit lifetime, error
   cleanup and a separately invoked final freshness audit. No shared mutable options object,
   blanket freshness bypass, redundant cache or reused final audit. Retain main's locked fallback
   and publication recovery. If no useful work remains to eliminate, keep main and document that
   disposition instead of shipping another mechanism.
5. **Integrate, qualify and review.** Integrate at each contract barrier, read every worker diff,
   and run focused checks with writers paused. Commit coherent reviewed task-owned slices, update
   the continuation roadmap before each changed-scope gate, and run the local iteration lane.
   Run sequential paired measurements and the standalone performance proof after source is stable.
   Perform the full integrated review personally at completion; there are no subagent reviews.
   Prepare the reviewed merge message and report readiness, remaining risks and measured costs.
   Stop before push/CI/landing unless separately authorized. At project completion remind the
   Developer to review Tao test and scenario syntax and structure.

## Exclusive implementation ownership

All workers use bounded briefs, settled interfaces and exact paths; planned code writers use
a lower model tier at high effort. They return diffs and evidence, with no Git/index, ledger, dependency,
generated configuration, cross-session messaging or review work. They are not alone in the checkout
and must preserve unrelated edits. No workers start before approval of this plan.

| Owner                      | Exclusive paths/responsibility                                                                                                                                                                                                                                                                                                      | Integration barrier                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Input worker               | `ProjectFileWatch.ts`, `ProjectTooling.ts`, classified-input tests under project-tooling                                                                                                                                                                                                                                            | Lead freezes observation classes and source-versus-topology rules; worker does not edit `ProjectToolingService.ts`                        |
| Scheduling worker          | `StudioBackgroundValidation.ts`, `StudioPreviewEligibility.ts`, their two focused test files                                                                                                                                                                                                                                        | Lead freezes source snapshot and paint-release contracts; worker does not edit the session, protocol or runtime                           |
| Design worker              | `studio-design-delta.ts`, `TR-design.ts`, their focused compiler/runtime padding tests                                                                                                                                                                                                                                              | Lead freezes typed delta, baseline and provenance contract; worker does not edit `compiler.ts`, `Workspace.ts` or `TR-studio-preview.tsx` |
| Native worker, conditional | `maintained-native-bindings.ts` and its focused native-bindings tests                                                                                                                                                                                                                                                               | Starts only after measured duplication and an attempt-lifetime API are specified; compiler/Workspace wiring stays with lead               |
| Lead                       | `StudioPreviewSession.ts`, coordinator/project session/server/routes/protocol, client bridge/matrix/app wiring, device gateway, `TR-studio-preview.tsx`, `Workspace.ts`, `compiler.ts`, expo-host `runtime.ts`, `ProjectToolingService.ts`, excluded parser/validator plumbing, integrated tests, harness, enablement, docs and Git | One owner for every shared seam; worker changes settle before dependent integration                                                       |

Input and scheduling helpers can proceed concurrently after contracts freeze. The design helper can
proceed independently against its frozen wire type; delivery wiring waits for preview-first and
paint identity integration. Native work is optional after baseline measurement. Numeric trials
run with all writers and task tests stopped, one measurement lane at a time.

## Correctness and measurement acceptance

1. Deterministic regressions establish work counts, input identities, invalidation, ordered
   diagnostics, output/cold-result parity and zero stale publication. Cover imports, membership,
   package/config/sidecar/native changes, generated-file repair, failed attempts and independent
   final freshness checks. Preserve main's associated-effect contracts across multi-entry builds.
2. Ordering/lifecycle mutations must fail their intended witnesses: stale source admission,
   superseded result acceptance, extending the first deadline, missing rejection/close cleanup,
   missing identity checks and removing fresh-realm barriers. A green helper test alone does not
   establish the real session's scheduling or delivery contract.
3. Run real-Metro editor-save trials for 12 → 16 → 100 → 12 padding, rapid saves and revert,
   invalid-to-valid recovery, paired-file bursts plus a following save, one cell, whole app,
   multiple active previews, fresh activation during an overlay, and a save during proven running
   authoritative work. Use editor transactions/shortcuts for the felt-path trials; API burst
   probes supplement those trials. Assert actual computed padding, subsequent paint, retained
   state, no unexpected iframe reload, final source/manifest parity and eventual diagnostics.
4. Keep normal timings separate from profiling/tracing. Eight saves per sequential case, retain
   the cold first sample, report warm median and nearest-rank p95 from seven samples, raw failures,
   load/CPU observations and lane contention. Use matched main/feature and opt-out/opt-in repeats
   with alternating order to reduce host drift; compare each coherent mechanism before combining
   results. Never add independently measured gains together.
5. Preserve all executable ceilings in `StudioPreviewPerformance.ts`. Keep the six canonical
   compiler/publication cases and their independent source/publication and total limits, using
   the documented direct-delivery opt-out for that control. Qualify the production-default direct
   path separately against the existing applicable total limits, with explicit source-to-delivery
   and delivery-to-paint timestamps. Also record eventual authoritative publication and scheduler
   delay. Never fabricate generated mtimes, relabel a delta as generated publication, drop a
   canonical case or raise a limit to pass. Adapt the harness explicitly for default enablement;
   the POC currently refuses direct-delivery mode in canonical performance qualification.
6. Full-overlap diagnostics identify actual attempt start/end around each save, queue delay,
   event-loop lag, tooling, emission and paint. Do not infer overlap from a fixed sleep. Quiet
   admission failures remain inconclusive; eligible budget breaches remain failures. Correct
   rendering precedes timing interpretation. Historical 179/188ms compiler/HMR, 38–47/48–52ms
   direct padding and 523/1154ms overlap figures belong to differing POC configurations and loads,
   not this integrated tree. A general 100–150ms warm goal remains an aspiration.

## Verification and stopping boundary

1. Focused tests and changed-scope verification prove iteration; the standalone performance lane
   proves the numerical budgets. Do not repeat portable CI gates locally as merge evidence.
2. On later explicit landing authorization, reread live help and the current hosted route: reviewed
   message, `open-pr --auto-merge`, hosted Verify plus the local host-only complement. The Developer's
   stricter rule prevails over the repository's two-run capacity: wait until no Verify run is
   running, checking every ten seconds before starting one. Monitor owned runs frequently and
   promptly cancel failed-head work through the supported cancellation command. Never cancel
   another owner's healthy run, jump the queue or merge through a raw GitHub command.
3. No landing authorization exists for this slice. No Metro revision fallback/retry, editor
   configuration file, dependency/version/lockfile edit or new host permission is part of it.
   Keep UI automation quiet through the existing headless smoke surface; separate visible native
   acceptance remains subject to its own authorization.

## Separate later plans

1. Worker isolation plus independent interactive admission: measure remaining queue/lag/full-stage
   costs, then propose a persistent background worker with its own mutable workspace, immutable
   requests, one latest pending input, restart/error/close handling and a short stale-checked
   publication boundary. Moving emission alone does not bypass coordinator drain or generation lock.
2. Shared immutable tooling/preview snapshots: measure repeated preparation, define complete
   config/package/sidecar/native identity and lifetime, and prohibit shared mutable linked ASTs.
3. Dependency-directed compilation/validation: partition global versus local reports, certify
   reverse dependencies, membership/unresolved/ownership changes and cold parity before selecting
   emission/output-plan reuse.
4. Broader design/token delivery: extend the compiler-owned protocol only from measured costs and
   parity. Selective subscriptions wait for demonstrated consumed-style fan-out in larger apps or
   many previews; the current whole-app timing does not establish that bottleneck.

The recurring repository pass still records a 2026-09-28 review boundary. Recommend a separate pass
for subsequent cross-package landings; it is outside this production speed slice.
