---
name: agent-instructions
description: >-
  Consolidate Tao agent instructions, subagent profiles, and project skills. Use when Ro asks to add, update, remove, place, or audit AGENTS.md, CLAUDE.md, .agents/skills, agents/, generated harness adapters, or durable agent guidance.
---

# Agent Instructions

- Put universal constraints and routing in root `AGENTS.md`.
- Put subtree invariants in the nearest nested `AGENTS.md` only when they apply to nearly every edit there.
- Put conditional workflows or domain knowledge in one focused skill under `agents/skills/<name>/SKILL.md`.
- Put mechanical checks, orchestration, and command details in repository automation. Put API-local usage rules in the owning JSDoc.
- Keep one owner for each rule. Remove stale, conflicting, or duplicated guidance in the same change.
- State outcomes, hard constraints, success criteria, and important exceptions. Do not explain routine engineering steps the model can infer from repository evidence.
- Keep skill directory and frontmatter names identical. Make descriptions concise and include the concrete phrases that should trigger the skill.
- Keep canonical agent sources under `agents/`: project skills in `agents/skills/` and reusable profiles in `agents/subagents/`.
- Keep `.claude/CLAUDE.md` as the root-instruction include. Point `.agents/skills`, `.codex/skills`, and `.claude/skills` at `agents/skills`; point `.rulesync/subagents` at `agents/subagents`.
- Generate tool-specific subagent adapters with `./agent setup`. Do not edit or commit generated `.codex/agents/` or `.claude/agents/` files.
- Keep shared permission rules in `.rulesync/permissions.jsonc`; `./agent setup` generates `.claude/settings.json` (through rulesync) and `.codex/config.toml` (through `packages/dev/dev-src/agent-config/CodexConfigGenerator.ts`) from them. Both generated files are committed, unlike the subagent adapters, so they exist before any harness starts. Update the hand-maintained `.cursor/permissions.json` in the same change.
- After edits, search active code and docs for removed names, paths, commands, and duplicated ownership. Keep `Docs/Roadmap/Archive/` frozen after merge unless Ro explicitly asks; other `Docs/Roadmap/` documents remain live.
- Run `./agent verify` after instruction or automation changes.
