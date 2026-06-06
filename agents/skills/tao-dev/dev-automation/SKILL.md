---
name: dev-automation
description: >-
  Write or modify Tao repository automation: packages/dev commands, ./agent dispatcher behavior, and Justfile recipes/variables run via `./agent just <recipe>`. Use when changing dev automation, adding just recipes or variables, or avoiding standalone Bun script entrypoints.
---

# Dev automation

Use this skill when adding or changing repo automation: `packages/dev` TypeScript, `./agent` behavior, or `Justfile` recipes.

## Where automation goes

- Treat `Justfile` as the main command runner.
- Treat `Justfile` as the workflow manager: declare prerequisites and cross-step orchestration there.
- Put simple command recipes directly in `Justfile`.
- Put durable TypeScript automation in `packages/dev/dev-src/dev.ts` only when it would otherwise make sense to create a separate bash script.
- Keep `./dev <command>` as a script runner for focused actions; do not put workflow dependencies or prerequisite orchestration in `./dev`.
- Put `./agent` behavior, allowlisted executable commands, help text, and command dispatch in `packages/dev/dev-src/agent-dev.ts`.
- Prefer `packages/dev` TypeScript over complex shell for durable logic; keep shell entrypoints thin. Avoid standalone Bun script entrypoints—expose script-like automation through `dev.ts` or `agent-dev`.
- Keep commands small, typed, and covered by relevant package tests or repo checks.

## Command output

- Default successful automation to concise output: command or recipe name, elapsed time, and parsed counts when useful.
- Emit full logs on failure, but write large stdout/stderr to `.artifacts/logs/agent/<timestamp>/...` and print only the command, exit code, focused excerpt, and log path.
- Replay full failure output only when it is small enough to be useful in agent context.
- Prefer machine-readable summaries for audit/preflight commands when another agent or tool will consume the result.
- Keep intentionally interactive or long-running commands streamed, such as app servers and device workflows.

## Justfile recipes

- Recipes can contain straightforward shell command lines. Delegate to `./dev <command>` only for script-like automation that is clearer in TypeScript.
- **Variables are ALL CAPS** (e.g. `KITCHEN_SINK_APP`, not `kitchen_sink_app`); reference them as `{{VARIABLE}}`.
- Recipes are `kebab-case`; prefix private recipes with `_` under the `# Private` section.
- Write a one-line `#` comment above each public recipe (shown by `just --list`).
- Declare dependencies via prerequisites (e.g. `check: _compile-kitchen-sink-app`), not manual chaining.
- Run recipes via `./agent just <recipe>`, never bare `just`; verify with `./agent just help`.
