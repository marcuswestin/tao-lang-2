# Reviewer Context Automation

## Status

This is future follow-up work, not part of the completed agent-context reorganization.

The current review automation still has enough custom context assembly and orchestration to justify reassessing it against maintained community tooling. The agent-context reorganization simplified ordinary workflow pass-through commands, so that earlier concern no longer belongs in this follow-up.

## Purpose

Investigate replacing or simplifying the repository's custom reviewer-context plumbing while preserving the useful command surface:

- `./agent review new [--stringent] [--slug <name>]`
- `./agent review <lens> --run <run> [--profile <profile>]`, over the repository's review lenses

The target shape is a thin repository adapter around a maintained upstream context-bundling or reviewer orchestration tool, rather than a repository-owned system for collecting diffs, snapshots, filters, and prompt payloads.

## Research Questions

1. Which tools can collect working-tree or branch context, honor ignore files, run saved prompt modes, and emit text or Markdown suitable for another harness?
2. Which tools are actively maintained and usable in CI or a non-interactive shell?
3. Can one tool replace both the current context collector and the direct reviewer launch path, or should those stay separate?
4. How should branch-base review and dirty-worktree review differ?
5. Can the repository keep the existing `./agent review` interface while delegating the heavy lifting?

## Acceptance Criteria

- Compare at least three credible maintained tools against Tao's actual workflows.
- Prototype one branch-review mode and one dirty-worktree mode.
- Preserve repository-specific reviewer profiles and mode prompts as source files.
- Keep secrets, generated files, and irrelevant build output out of reviewer context.
- Measure context size and failure behavior against the current implementation.
- Prefer deletion of custom code over adding another orchestration layer.
