---
name: parallel-implementation
description: >-
  Implement significant multi-piece or multi-step changes with dependency-aware agent parallelism,
  explicit path ownership, integration checkpoints, progressive validation, and commits. Use when
  two or more substantial workstreams can proceed concurrently without sharing mutable seams.
---

# Parallel Implementation

The `delegation` skill owns whether to delegate at all, the model tier each agent runs at, what a
brief contains, and how to check what comes back. This skill owns what those rules do not cover:
dividing one outcome between agents that write at the same time, and putting the pieces back
together.

## Build the execution graph

1. Inspect live instructions, Git state, the affected architecture, and the requested validation
   surface before editing.
2. Decompose the outcome into workstreams with explicit inputs, outputs, shared seams, and dependency
   barriers. Parallelize substantial independent work; keep tightly coupled edits in one owner.
3. Identify the critical path and the first integration checkpoint. Sequence only the dependencies
   that require sequencing.
4. Assign each agent exclusive path or concept ownership, and state its forbidden paths in the brief.
   Ownership is the only thing that keeps concurrent writes safe; everything else is convention. The
   `implementer` profile is the worker this skill spawns; a workstream that still needs exploring is
   not ready for one.

## Run parallel work safely

- Keep one integration owner in the primary worktree. Unless isolated worktrees are intentional,
  prohibit subagents from staging, committing, switching branches, or editing another workstream's
  paths.
- Reserve shared root files, cross-workstream manifests, dependency locks, aliases, and generated
  artifacts for the integration owner unless ownership is transferred explicitly. Have workstream
  agents report the edits those seams need.
- Keep the critical path occupied. Reuse a completed agent for the next newly unblocked workstream or
  an independent review instead of waiting for every original stream.
- Communicate cross-stream discoveries immediately. Change ownership explicitly before allowing an
  agent to cross a seam.
- Preserve unrelated and concurrent work. Re-read shared files before integration and resolve against
  their current contents.
- Pause for product semantics, destructive actions, external publication, or scope expansion that the
  request does not authorize. Resolve routine implementation choices from repository evidence.

## Integrate at dependency barriers

1. Read every handoff against its diff. A workstream is integrated on the evidence in the diff, not
   on the agent's account of it.
2. Integrate shared manifests, generated artifacts, dependency locks, exports, and documentation only
   after their upstream workstreams settle.
3. Run focused validation for each integrated slice. Fix confirmed failures before unblocking dependent
   work.
4. When commits are authorized, use the repository's Git skill and commit green integration units as
   work stabilizes. Prefer continued parallel progress over artificial commit perfection.
5. Finish with independent review across workstream boundaries, then run the repository's full final
   gate and report any environment-limited validation separately.
