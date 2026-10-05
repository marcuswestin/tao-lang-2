# Syntax2 implementation coordinator

## Start condition

Start from main after the design/future-source baseline has landed. Record its exact revision in
the execution manifest; do not rely on another thread's uncommitted files. Read
[Implement Syntax2](<Implement Syntax2.md>), its linked decisions and Apps/Syntax2/README.md,
then the applicable repository/package instructions. This brief starts foundation preparation,
not all implementation workstreams at once.

## Responsibility

Own the program dependency graph, shared interfaces, integration and source graduation. You are
one coordinator thread in your own worktree. The four initial implementation managers will run
in separate threads/worktrees and feature branches, followed by the data and lazy-list managers.
Keep their shared prerequisites available through coherent landed slices of main.

During the foundation wave, no other writer owns the shared grammar/AST, common type/effect and
native bridge representation, compiler/runtime dispatch or Syntax2 integration source. Re-check
the plan's representative paths against the checkout and produce exact exclusive ownership before
fan-out. Preserve other work; do not assume the broad directories named in the plan are blanket
permission to rewrite unrelated features.

1. Map implemented behavior to the accepted target and additional coverage obligations. Keep all
   explicitly deferred investigations out of implementation scope.
2. Prototype selected grammar seams and establish a coherent minimum callable/type/effect and
   checked native-value contract. Return a concrete author-level contradiction if found; routine
   ABI and module choices are engineering work, not new language decisions.
3. Activate a dependency-complete shell and a meaningful Tao journey by extracting working source
   from `.tao.future`. Keep unsupported target source intact; never enable future-file discovery
   or create successful native placeholders.
4. Publish foundation interfaces, tests and a reviewable revision. Prepare landing under the
   repository workflow; actual landing retains its authorization requirement.
5. Create and commit exact dispatch briefs for A names/capabilities, B rendering/slots,
   C numeric/native values and D outcomes/cleanup as their prerequisites become available.
   Prepare E data/adapters and F lazy collections only when their prerequisite contracts are stable.

## Dispatch and integration

Each manager's brief must state its goal, accepted decisions, exact starting/dependency revision,
exclusive allowed paths, forbidden shared paths, interface inputs/outputs, acceptance commands,
stopping point and return contract. Link the shared plan for process/semantics. Register ownership
transfers explicitly; a separate worktree prevents file clobbering but does not remove merge hazards.
Managers may use their own sub-agents only within those ownership boundaries.

Inspect returned diffs and focused evidence before dependent work starts. Follow the
[review cadence](<Syntax2 ownership.md#review-cadence>): managers make multiple commits across
substantial implementation batches before one independent review of the accumulated range. Keep
shared source generation and cross-workstream exports with the coordinator. Integrate complete
slices into main in dependency order; use one coherent coordinator-owned change when a shared
interface cannot be split safely. Reserve independent cross-seam review before calling the
integrated app complete.

## Acceptance and handoff

The first foundation handoff must contain actual paths/interfaces, dependency revisions, executable
shell/journey evidence, focused negative checks, ownership manifests and ready briefs for the first
unblocked wave. Run the plan's focused commands and report source, runtime, UI and native/provider
proof separately. Create implementation progress weights at execution start; the completed design
percentage is not implementation progress.

Report failures, unresolved author judgments and environment limits explicitly. Stop at the
authorized commit/landing boundary; do not publish or land simply because the plan recommends it.
