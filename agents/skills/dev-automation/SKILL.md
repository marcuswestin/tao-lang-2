---
name: dev-automation
description: >-
  Change Tao developer automation, including packages/dev, ./agent, ./dev, ./tao, Justfile recipes, command help, review orchestration, or repository workflow output.
---

# Dev Automation

- Keep common workflow definitions and human developer commands in `Justfile`; keep shell entrypoints and the `./tao` wrapper thin.
- Keep Worktrunk's blocking `pre-start` hook routed through `direnv exec . just setup` so dependencies and generated agent adapters exist before a launched harness reads them. `./agent setup` remains the agent-facing fallback once the wrapper is available.
- Expose formatting, fixing, testing, checking, and final validation as thin `./agent` passthroughs to the matching Just recipes.
- Derive `./agent help` descriptions for passthrough commands from live `just help` output instead of duplicating recipe help.
- Keep ordinary shell and Tao CLI commands outside `./agent`; run them directly or through `./tao`.
- Keep commands typed, focused, and covered by package tests or repository validation.
- Keep workflow output concise and stream interactive work. Save large diagnostic artifacts only when the owning workflow benefits from them.
- Use `kebab-case` Just recipe names and `ALL_CAPS` Just variables when changing the human workflow surface.
- Prefer self-contained command help and generated prompts over duplicating command recipes in skills.
- Run `./agent test [pattern]` for the repository test workflow and `./agent verify` for final validation. Direct `bun test <files>` remains appropriate for a single test file.
