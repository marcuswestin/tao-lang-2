---
name: working-with-skills
description: >-
  Author, edit, and organize Tao project agent skills, including the agents/skills source layout and the .codex/skills symlink. Use when creating or modifying a SKILL.md, adding a skill, or reasoning about where project skills live.
---

# Working with skills

Use this skill when creating or editing project agent skills in this repo.

## Layout and symlink

- Canonical source: `agents/skills/<group>/<skill>/SKILL.md` (project skills live under `agents/skills/tao-dev/`).
- `.codex/skills` is a symlink to `../agents/skills`, so tools discover the same files through `.codex/skills/...`. Always edit the real `agents/skills` source; never treat the symlinked path as a separate copy.
- The skill directory name MUST match the `name:` field in its frontmatter.

## External skills

- Third-party skills are pulled via `bunx skills` and pinned in `skills-lock.json` (github sources). Do not hand-edit installed external skills; change `skills-lock.json` and re-sync instead.

## Authoring conventions

- Frontmatter needs `name` (kebab-case, matches dir) and a third-person `description` covering WHAT it does and WHEN to use it, with trigger terms.
- Keep `SKILL.md` concise and focused on durable, repo-specific knowledge the agent lacks.
- Match the existing `tao-dev` skill style: short intro line, then tight bulleted rules.

## Renaming a skill

1. Rename the directory under `agents/skills/<group>/`.
2. Update the `name:` field and heading to match.
3. Fix any references to the old name.
