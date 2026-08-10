# Checklist - Prepare navigation MVP

## Authority And Decisions

- [x] Active specifications are normative and cross-link the roadmap research.
- [x] Research records every settled rule with a stable `DEC-NAV-*` ID.
- [x] Remaining questions and follow-ups have stable `DEF-NAV-*` or `FOLLOW-NAV-*` IDs.
- [x] Glossary distinguishes definitions, descriptors, occurrences, mounts, targets, auxiliaries, and providers.
- [x] Archived material is clearly historical and has no active TODO ownership.

## Intended Surface

- [x] `.tao-future/Writer.tao` is the sole authoritative navigation usage sketch.
- [x] Writer covers every settled surface and later implementation family; the policy matrix and planned tests own exhaustive transition branches.
- [x] The nav stdlib stub agrees with the spec and Writer.
- [x] The Still target app uses the settled model without duplicating the navigation contract.
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
- [x] `./agent just verify` passes.
- [x] Final staged/unstaged audit confirms the complete intended tree is staged with unrelated changes separated or intentionally included.
- [x] Ro receives the completed checklist and explicit remaining deferrals before any commit.

## Required Before Merge

- [ ] Fix commented compact-action formatting in its own commit, following `Roadmap/Pre-merge MVP exploration follow-ups.md`.
- [ ] Define and bootstrap immutable project IDs in its own commit, following the same document.
- [x] Consolidate `Apps/MVP*` into one full target, one rolling executable integration app, and focused tests.
- [ ] Merge current `main` and reconcile its layout/testing documentation changes without reverting them.
- [ ] Rerun the final staged-scope audit and `./agent just verify`.

The preparation initially left the Git index untouched. Ro subsequently staged the complete intended state, including the final `.tao-future` paths and owner-scoped `@` decision. The current commit must not be made from a mixed index/worktree snapshot.
