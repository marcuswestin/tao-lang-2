# Parallel Implementation

Implement significant multi-piece or multi-step changes with dependency-aware agent parallelism,
explicit path ownership, integration checkpoints, progressive validation, and commits. Use when two
or more substantial workstreams can proceed concurrently without sharing mutable seams. Owns dividing
one outcome between agents that write at the same time, and putting the pieces back together, once
`delegation`'s own rules have said to delegate at all. All of it assumes agents writing into your
worktree, which is what makes ownership the thing keeping them safe; a fan-out Ro will run from
printed briefs is the other case, where each agent takes a worktree of its own and there is no
integration owner, and `delegation` says what changes.

## Build the execution graph

Inspect live instructions, Git state, the affected architecture, and the requested validation surface
before editing. Decompose the outcome into workstreams with explicit inputs, outputs, shared seams,
and dependency barriers; parallelize substantial independent work and keep tightly coupled edits in
one owner. Identify the critical path and the first integration checkpoint, sequencing only the
dependencies that require it. Assign each agent exclusive path or concept ownership and state its
forbidden paths in the brief — ownership is the only thing that keeps concurrent writes safe,
everything else is convention. The `implementer` profile is the worker this fan-out spawns; a
workstream that still needs exploring is not ready for one.

## Run parallel work safely

Keep one integration owner in the primary worktree; unless isolated worktrees are intentional,
prohibit subagents from staging, committing, switching branches, or editing another workstream's
paths. Reserve shared root files, cross-workstream manifests, dependency locks, aliases, and
generated artifacts for the integration owner unless ownership is transferred explicitly — have
workstream agents report the edits those seams need instead. Keep the critical path occupied by
reusing a completed agent for the next unblocked workstream or an independent review rather than
waiting for every stream. Communicate cross-stream discoveries immediately, and change ownership
explicitly before letting an agent cross a seam. Re-read shared files before integration and resolve
against their current contents, preserving unrelated concurrent work. Pause for product semantics,
destructive actions, external publication, or scope expansion the request does not authorize;
resolve routine implementation choices from repository evidence.

## Integrate at dependency barriers

Read every handoff against its diff — a workstream is integrated on the evidence in the diff, not the
agent's account of it. Integrate shared manifests, generated artifacts, dependency locks, exports,
and documentation only after their upstream workstreams settle, running focused validation for each
integrated slice and fixing confirmed failures before unblocking dependent work. When commits are
authorized, use `git-workflow` and commit green integration units as work stabilizes, preferring
continued parallel progress over artificial commit perfection. Finish with independent review across
workstream boundaries (`references/review-fanout.md`), then run the repository's full final gate and
report any environment-limited validation separately.
