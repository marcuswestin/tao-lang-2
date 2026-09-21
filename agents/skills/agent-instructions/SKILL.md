---
name: agent-instructions
description: >-
  Consolidate Tao agent instructions, subagent profiles, and project skills. Use when Ro asks to add, update, remove, place, or audit AGENTS.md, CLAUDE.md, .agents/skills, agents/, generated harness adapters, or durable agent guidance, and whenever writing or editing the text of an AGENTS.md or SKILL.md.
---

# Agent Instructions

- This file owns **where** a rule goes. `references/writing-agents-md.md` owns **how it is written** once you know — the size budgets and why they count characters, how much "why" a rule carries, what belongs and what does not. Read it before editing the text of an `AGENTS.md` or a `SKILL.md`.
- Put universal constraints and routing in root `AGENTS.md`.
- Put subtree invariants in the nearest nested `AGENTS.md` only when they apply to nearly every edit there.
- Put conditional workflows or domain knowledge in one focused skill under `agents/skills/<name>/SKILL.md`.
- Put mechanical checks, orchestration, and command details in repository automation. Put API-local usage rules in the owning JSDoc.
- Keep one owner for each rule. Remove stale, conflicting, or duplicated guidance in the same change.
- State outcomes, hard constraints, success criteria, and important exceptions. Do not explain routine engineering steps the model can infer from repository evidence.
- Keep skill directory and frontmatter names identical. Make descriptions concise and include the concrete phrases that should trigger the skill.
- Keep canonical agent sources under `agents/`: project skills in `agents/skills/` and reusable profiles in `agents/subagents/`.
- The `delegation` skill owns when to use a subagent, the model tiers, the brief, and the return contract; its routing table is the only place a model name belongs outside profile frontmatter, and `CodexConfigGenerator` reads the standard row for Codex's `[agents]` defaults. Give every new profile a `claudecode.model` and a `cursor.model` the table offers, a description saying when to reach for it, read-only settings that agree across all three harnesses, and a `claudecode.tools` allowlist naming only the tools it works with — `repo-lint` checks each of those. A profile that names no tools inherits every schema its caller was given — roughly 44k tokens against the 8k it uses, on every request. A read-only profile must not list `Edit` or `Write`, since `permissionMode` governs approval rather than availability.
- Keep `.claude/CLAUDE.md` as the root-instruction include. Point `.agents/skills`, `.codex/skills`, and `.claude/skills` at `agents/skills`; point `.rulesync/subagents` at `agents/subagents`.
- Generate tool-specific subagent adapters with `./agent setup`. Do not edit or commit generated `.codex/agents/`, `.claude/agents/`, or `.cursor/agents/` files. A profile reaches a harness only when its `targets:` list names that harness; rulesync skips an untargeted profile silently rather than failing.
- Keep shared permission rules in `.rulesync/permissions.jsonc` and agent hooks in `.rulesync/hooks.jsonc`; `./agent setup` generates `.claude/settings.json` and `.codex/hooks.json` (through rulesync) plus `.codex/config.toml` and `.codex/rules/tao.rules` (through `packages/dev/dev-src/agent-config/CodexConfigGenerator.ts`) from them. Cursor takes the `subagents` feature too, so `.cursor/agents/` is generated; its `.cursor/worktrees.json`, `.cursor/worktree-setup.sh`, and `.cursor/permissions.json` stay hand-maintained, because rulesync has no translator for their shape. The opt-in profiles (native, local-services, release, unsandboxed) live in `.rulesync/profiles.jsonc`; `./agent setup` renders each into `.claude/settings.<name>.json` (through `ClaudeProfilesGenerator.ts`, because Claude's settings model has no named permission profiles) and into the `tao-<name>` Codex profile in `.codex/config.toml`. Generated files are committed, unlike subagent adapters, so they exist before any harness starts. Update the hand-maintained Cursor counterparts in the same change.
- After edits, search active code and docs for removed names, paths, commands, and duplicated ownership. Keep `Docs/Archive/` frozen after merge unless Ro explicitly asks; other `Docs/Roadmap/` documents remain live.
- Run `./agent verify --complete` after instruction or automation changes.
