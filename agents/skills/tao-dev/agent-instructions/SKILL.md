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
- Existing skill: update it instead of duplicating the same rule elsewhere.
- Docstrings/JSDoc: use for API-local usage rules that should be visible at the call site, especially when choosing between sibling APIs such as `FS.joinPath` and `FS.resolvePath`.
- Code/docs comments: use for API or human-facing documentation, not broad agent process rules.

## Write instructions

- Start by reading the current root `AGENTS.md`, nearest nested `AGENTS.md`, and relevant skills.
- Write the minimum rule that prevents the mistake or preserves the pattern.
- Prefer direct imperatives with scope: what to do, where it applies, and the important exception or gotcha.
- Use broad descriptions only when they safely include the class of future cases; add specific details only for costly or non-obvious failures.
- Avoid restating general engineering principles, long rationale, and examples unless they disambiguate a fragile rule.
- Put instructions in docstrings when the rule is part of the API contract, the mistake happens at call sites, and the guidance should travel with completions/type hover.
- Keep docstring instructions terse: state preferred use, exception, and sibling API when relevant.
- Keep one source of truth. Remove or update stale, conflicting, or duplicated instructions in the same change.

## Maintain instructions

- If a problem would have been avoided by a better instruction, update the instruction while the context is fresh.
- When repeated friction appears, suggest the smallest skill or AGENTS update that would prevent it next time.
- Encode well-settled repo patterns after observing existing code; do not invent instructions that fight the codebase.
- Keep skill frontmatter trigger descriptions broad enough to load when needed, but keep skill bodies terse.
