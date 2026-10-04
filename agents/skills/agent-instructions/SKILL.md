---
name: agent-instructions
description: >-
  Place and maintain Tao agent guidance. Use when adding, editing, removing, or auditing
  AGENTS.md, CLAUDE.md, SKILL.md, subagent profiles, generated harness adapters, or durable
  instructions; read before writing AGENTS.md or SKILL.md text.
---

# Agent Instructions

- This file owns **where** a rule goes. `references/writing-agents-md.md` owns **how it is written** once you know — the size budgets and why they count characters, how much "why" a rule carries, what belongs and what does not. Read it before editing the text of an `AGENTS.md` or a `SKILL.md`.
- Put universal constraints and routing in root `AGENTS.md`.
- Put subtree invariants in the nearest nested `AGENTS.md` only when they apply to nearly every edit there.
- Put conditional workflows or domain knowledge in one focused skill under `agents/skills/<name>/SKILL.md`.
- Put mechanical checks, orchestration, and command details in repository automation. Put API-local usage rules in the owning JSDoc.
- Keep one owner for each rule. Remove stale, conflicting, or duplicated guidance in the same change.
- State outcomes, hard constraints, success criteria, and important exceptions. Do not explain routine engineering steps the model can infer from repository evidence.
- Keep skill directory and frontmatter names identical. The YAML `description` owns discovery:
  state what the skill does and when to use it, with concrete task phrases, within 1024 characters.
  Keep workflow detail in the body; do not duplicate activation conditions in `AGENTS.md`.
- Keep canonical agent sources under `agents/`: project skills in `agents/skills/` and reusable profiles in `agents/subagents/`.
- CLI-shipped Tao app skills are the exception: their source lives in `packages/ai/tao-skills/skills/`, with `agents/skills/tao-skills` linking to its router so the shipped text has one owner.
- The `delegation` skill owns when to use a subagent, the model tiers, the brief, and the return contract; its routing table is the only place a model name belongs outside profile frontmatter, and `CodexConfigGenerator` reads the standard row for Codex's `[agents]` defaults. Give every new profile a `claudecode.model` and a `cursor.model` the table offers, a description saying when to reach for it, read-only settings that agree across all three harnesses, and a `claudecode.tools` allowlist naming only the tools it works with — `repo-lint` checks each of those. A profile that names no tools inherits every schema its caller was given — roughly 44k tokens against the 8k it uses, on every request. A read-only profile must not list `Edit` or `Write`, since `permissionMode` governs approval rather than availability.
- Keep `.claude/CLAUDE.md` as the root-instruction include. Point `.agents/skills`, `.codex/skills`, and `.claude/skills` at `agents/skills`; point `.rulesync/subagents` at `agents/subagents`.
- Generate tool-specific subagent adapters with `./agent setup`. Do not edit or commit generated `.codex/agents/`, `.claude/agents/`, or `.cursor/agents/` files. A profile reaches a harness only when its `targets:` list names that harness; rulesync skips an untargeted profile silently rather than failing.
- Keep shared permission rules in `.rulesync/permissions.jsonc`, agent hooks in `.rulesync/hooks.jsonc`, and the opt-in profiles in `.rulesync/profiles.jsonc`; `./agent setup` renders each into the harness-specific generated files, and the agent-config freshness gate in `repo-lint` keeps them in sync. Cursor's `.cursor/worktrees.json`, `.cursor/worktree-setup.sh`, and `.cursor/permissions.json` stay hand-maintained — rulesync has no translator for their shape — so update them by hand in the same change. Never edit a generated file directly; change the source and run `./agent setup`.
- After edits, search active code and docs for removed names, paths, commands, and duplicated ownership. Keep `Docs/Archive/` frozen after merge unless the Developer explicitly asks; other `Docs/Roadmap/` documents remain live.
- Validate instruction or automation changes under the checkout's `AGENTS.md` policy. In a
  Developer-directed primary `dev/<name>` checkout, use focused checks and defer full verification
  until authorized landing.
