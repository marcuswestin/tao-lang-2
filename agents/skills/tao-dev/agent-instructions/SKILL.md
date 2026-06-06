---
name: agent-instructions
description: >-
  Use when Ro asks to add, update, consolidate, or decide placement for agent instructions, AGENTS.md rules, nested AGENTS.md files, or project skills.
---

# Agent instructions

Use this skill when implementing durable instructions for future agents.

## Place instructions

- Root `AGENTS.md`: repo-wide rules that should always be in context.
- Nested `AGENTS.md`: subtree rules that should apply to nearly every task in that directory.
- Skill: conditional workflows, detailed gotchas, or domain knowledge that should load only when relevant.
- Automation: mechanical workflows, command scaffolding, validation orchestration, review setup, merge preflights, and stale/duplication audits.
- Existing skill: update it instead of duplicating the same rule elsewhere.
- Docstrings/JSDoc: use for API-local usage rules that should be visible at the call site, especially when choosing between sibling APIs such as `FS.joinPath` and `FS.resolvePath`.
- Code/docs comments: use for API or human-facing documentation, not broad agent process rules.
- Agent types: keep canonical reusable definitions under `agents/agent-types/`; symlink tool-specific discovery paths such as `.codex/agents` to that source so non-Codex agents can inspect the same definitions.
- Codex nested `AGENTS.md` caveat: agents normally receive instructions from the repo root to the current working directory. Repo-root sessions do not automatically load nested files for later edits, so root `AGENTS.md` must explicitly route agents to read important nested files before editing those paths.

## Write instructions

- Start by reading the current root `AGENTS.md`, nearest nested `AGENTS.md`, and relevant skills.
- Write the minimum rule that prevents the mistake or preserves the pattern.
- Prefer direct imperatives with scope: what to do, where it applies, and the important exception or gotcha.
- Use broad descriptions only when they safely include the class of future cases; add specific details only for costly or non-obvious failures.
- Avoid restating general engineering principles, long rationale, and examples unless they disambiguate a fragile rule.
- Use progressive disclosure: root routes and protects, nested AGENTS own durable local invariants, skills own conditional workflows, and referenced docs/source hold details.
- Prefer an inspect-first autonomy model. Ask Ro for language design, roadmap priority, destructive operations, ambiguous product behavior, or non-derivable choices; do not require questions for routine implementation details.
- Put instructions in docstrings when the rule is part of the API contract, the mistake happens at call sites, and the guidance should travel with completions/type hover.
- Keep docstring instructions terse: state preferred use, exception, and sibling API when relevant.
- Keep one source of truth. Remove or update stale, conflicting, or duplicated instructions in the same change.

## Maintain instructions

- If a problem would have been avoided by a better instruction, update the instruction while the context is fresh.
- When repeated friction appears, suggest the smallest skill or AGENTS update that would prevent it next time.
- Encode well-settled repo patterns after observing existing code; do not invent instructions that fight the codebase.
- Keep skill frontmatter trigger descriptions broad enough to load when needed, but keep skill bodies terse.
- After instruction edits, run an instruction audit or targeted `rg` for stale command names, obsolete skill names, duplicated ownership rules, and repeated workflow mechanics.
