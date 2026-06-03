---
name: dev-automation
description: >-
  Write or modify Tao repository automation: packages/dev commands, ./agent dispatcher behavior, and Justfile recipes/variables run via `./agent just <recipe>`. Use when changing dev automation, adding just recipes or variables, or avoiding standalone Bun script entrypoints.
---

# Dev automation

Use this skill when adding or changing repo automation: `packages/dev` TypeScript, `./agent` behavior, or `Justfile` recipes.

## Where automation goes

- Put normal repo automation commands in `packages/dev/dev-src/dev.ts`.
- Put `./agent` behavior, allowlisted executable commands, help text, and command dispatch in `packages/dev/dev-src/agent-dev.ts`.
- Prefer `packages/dev` TypeScript over shell for durable logic; keep shell entrypoints thin. Avoid standalone Bun script entrypoints—expose automation through `dev.ts` or `agent-dev`.
- Keep commands small, typed, and covered by relevant package tests or repo checks.

## Justfile recipes

- Recipes are thin: delegate real logic to `./dev <command>` rather than embedding shell.
- **Variables are ALL CAPS** (e.g. `KITCHEN_SINK_APP`, not `kitchen_sink_app`); reference them as `{{VARIABLE}}`.
- Recipes are `kebab-case`; prefix private recipes with `_` under the `# Private` section.
- Write a one-line `#` comment above each public recipe (shown by `just --list`).
- Declare dependencies via prerequisites (e.g. `check: _compile-kitchen-sink-app`), not manual chaining.
- Run recipes via `./agent just <recipe>`, never bare `just`; verify with `./agent just help`.
