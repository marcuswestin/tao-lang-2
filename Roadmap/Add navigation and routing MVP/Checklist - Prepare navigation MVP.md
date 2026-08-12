# Checklist - Prepare navigation MVP

## Authority And Decisions

- [x] Active specifications are normative and cross-link the roadmap research.
- [x] Research records every settled rule with a stable `DEC-NAV-*` ID.
- [x] Remaining questions and follow-ups have stable `DEF-NAV-*` or `FOLLOW-NAV-*` IDs.
- [x] Glossary distinguishes definitions, descriptors, occurrences, mounts, targets, auxiliaries, and providers.
- [x] Archived material is clearly historical and has no active TODO ownership.

## Intended Surface

- [x] `Apps/WordFlower/2 - Next/` is the sole product decision sketch; this roadmap owns navigation semantics and the stdlib contract, not a second app sketch.
- [x] `Apps/WordFlower/3 - MVP/WordFlower.tao-mvp` covers every settled surface and later implementation family; the policy matrix and planned tests own exhaustive transition branches.
- [x] The nav stdlib stub agrees with the spec and the WordFlower Next/Future app family.
- [x] The full target app uses the settled model without duplicating the navigation contract in this roadmap folder.
- [x] Traceability maps every settled feature to a rule, example, and planned test.
- [x] Invalid operations have a specified validation error or structured runtime diagnostic.

## Preservation And Cleanup

- [x] Unique content from `MVP-Writer-2.tao`, `Decided/`, and `@ToBeDecided/` is classified and preserved.
- [x] Unique non-navigation triage ideas are moved to an appropriate active spec/roadmap record or explicitly retained.
- [x] Superseded exploration files are deleted only after preservation is complete.
- [x] Unique content from the orphaned `Apps/MVP/` folder is preserved before the folder is deleted.
- [x] Remaining target/example comments describe decisions or referenced deferrals, not implementation chores.
- [x] Unrelated staged and unstaged changes remain untouched.

## Handoff

- [x] First implementation scope and non-goals are explicit.
- [x] Follow-up projects are ordered by dependency.
- [x] Post-implementation repository conformance audit is recorded.
- [x] Next-agent prompt is self-contained and stops after a reviewed implementation plan.
- [x] Context-free review prompt checks syntax, semantics, runtime feasibility, expressiveness, and maintainability.

## Review And Validation

- [x] Context-free architectural review is complete.
- [x] Stringent independent review is complete.
- [x] Accepted findings are applied; rejected findings have a recorded reason.
- [x] No unresolved new major language bifurcation remains; implementation-level gaps used the plan's recommended defaults.
- [x] Stale-reference audit passes for active artifacts.
- [x] Coverage table has no unexplained gaps.
- [x] Active TODOs all reference a deferral ID.
- [x] Relevant discovery tests pass.
- [x] `git diff --check` passes.
- [x] `./agent verify` passes.
- [x] Final staged/unstaged audit confirms the complete intended tree is staged with unrelated changes separated or intentionally included.
- [x] Ro receives the completed checklist and explicit remaining deferrals before any commit.

## Required Before Merge

- [x] Fix commented compact-action formatting in its own commit, following `Roadmap/Pre-merge MVP exploration follow-ups.md`.
- [x] Defer project-ID implementation until stable navigation identity has its first runtime consumer; preserve the settled contract in the same document.
- [x] Consolidate `Apps/MVP*` into one full target, one rolling executable integration app, and focused tests.
- [x] Merge current `main` and reconcile its layout/testing documentation changes without reverting them.
- [x] Rerun the final committed-scope audit and `./agent verify`.

All required pre-merge changes are split into scoped commits. The final handoff requires a clean index and worktree after the conformance cleanup commit.
