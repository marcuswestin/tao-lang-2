# Plan - Reorganize Agent Context

## Goal

Minimize always-loaded agent context while preserving the repository-specific constraints that prevent costly mistakes.

## Decisions

- Keep one short root `AGENTS.md` for universal behavior, safety, routing, and validation.
- Keep only `packages/AGENTS.md` and `Apps/Test Apps/AGENTS.md` as nested instruction files.
- Preserve `.claude/CLAUDE.md` as the Claude include for root instructions.
- Keep seven focused project skills under canonical `agents/skills/`: instruction maintenance, dev automation, runtime codegen, Langium scoping, old-repo porting, commit-all-chunks, and project lifecycle.
- Replace the numbered roadmap workflow with one `project-lifecycle` skill.
- Keep read-only reviewer and architectural reviewer profiles under canonical `agents/subagents/`.
- Point `.agents/skills`, `.codex/skills`, and `.claude/skills` at `agents/skills`; generate harness-specific profile adapters through Rulesync before agent launch.
- Keep review mechanics self-contained in `./agent review`; do not require a review skill.
- Let agents use the sandboxed shell directly and run common repository workflows and specialized automation through `./agent`; back common agent commands with the matching human recipes in `Justfile`.
- Remove the shallow instruction-audit command and use targeted searches plus repository validation after instruction changes.
- Remove repo-local model and approval preferences; retain only a permission profile that extends `:workspace` and denies `.env*` files.

## Implementation

1. Rewrite root and nested instructions around outcomes and hard constraints.
2. Move and rewrite the seven retained skills under the tool-neutral canonical source; remove overlapping skills and workflow copies.
3. Consolidate lifecycle guidance without preserving the long merge command cookbook.
4. Move and shorten custom agent profiles into the canonical source and generate tool-specific adapters through Rulesync.
5. Remove obsolete discovery paths and instruction-audit code, help, and tests.
6. Make review command help, artifact paths, and reviewer prompts self-contained.
7. Update active documentation and search for stale names and paths.
8. Verify discovery in a fresh Codex process, check Claude resolution, and run `./agent verify`.

## Acceptance Criteria

- Three concise `AGENTS.md` surfaces remain—root, packages, and Test Apps—plus `.claude/CLAUDE.md` as the Claude include.
- Exactly seven Tao project skills exist under `agents/skills/` and resolve through each compatible discovery symlink.
- The two custom agent profiles exist under `agents/subagents/` and generate native Codex and Claude adapters.
- No active code, documentation, or help references removed skills or discovery paths.
- Review automation works without skill-owned instructions.
- Codex prompt inspection and Claude path resolution show the intended instructions and skills.
- Full repository validation passes.
