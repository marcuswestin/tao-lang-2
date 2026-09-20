# Reorganize Agent Context

## Purpose

Make Tao agent instructions shorter, more reliable, and more context-specific.

Before the reset, strong conventions were distributed across root and nested `AGENTS.md` files, twenty project skills, agent type definitions, Codex rules, and repo automation. Recent testing/dev-loop work also exposed a useful pattern: when a convention is repeatedly corrected in review, it should become a small, well-placed instruction rather than a long recap.

## Outputs In This Folder

- `Report - Patch conventions.md`: conventions and rule applications found in the source patch and chat thread that motivated this task.
- `Report - Current instruction inventory.md`: live inventory of AGENTS files, project skills, agent types, Codex config, and instruction-audit automation.
- `Plan - Reorganize agent context.md`: final structure, ownership boundaries, migration steps, and validation.

Reviewer context automation remains separate active roadmap work.

## Working Principles

- Keep root context minimal and universal.
- Put package-specific code rules in nested `AGENTS.md` files.
- Put conditional workflows in skills.
- Put mechanical workflow details in automation where practical.
- Keep skill descriptions broad enough to trigger correctly, but move long mechanics out of always-visible context.
- Prefer a routing table over repeating details.
- Preserve Git/index safety and direct repository workflow routing as always-visible rules.
- Measure root instruction size and visible skill count before and after reorganization.

## Non-Goals

- Do not change language/compiler/runtime behavior.
- Do not archive or rewrite historical roadmap documents.
- Do not reduce reviewer rigor; reduce only irrelevant context and duplicated mechanics.
