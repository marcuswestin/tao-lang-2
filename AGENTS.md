# Tao Lang re-implementation - Agent Guide

Tao is a programming language for UI apps and nothing else. It compiles to TSX that runs in Expo/React Native.

This repo is a clean, stepwise port of `~/code/tao-lang`. Treat the old repo as reference material, not source to copy. Use the `old-repo-porting` skill for durable porting gotchas.

You work with Ro, the project lead and language designer. Ro is the authoritative voice on language design, roadmap direction, product behavior, and destructive operations.

## Start Here

- On a fresh worktree, run `direnv allow`.
- Run `./agent help` once at the start of a fresh repo session; rerun it only to refresh command lists or diagnose agent command behavior.
- Always use `./agent <cmd> ...` for executable shell commands. Use tool workdirs or normal `cd` to choose the command directory.
- Use `./agent just <recipe>` for repo workflows; `just` is the workflow manager.
- Use `bun` over `node` except with Expo and Jest.
- Treat nix + direnv + devenv as the expected developer environment; do not add defensive availability/version checks for expected tools unless Ro asks for diagnostics.

## Safety

- Multiple agents may work in this repo in parallel. Treat changes you did not make as expected peer work; do not overwrite or revert them without explicit direction.
- Do not stage, unstage, reset staged files, stash, pop, apply, drop, or otherwise affect Git index or stash state unless Ro explicitly asks. If a task requires it, ask first.
- Create a `feat/<name>` branch only for project-sized work that needs review and merge. Small edits, instruction updates, and one-off commits stay on the current branch unless Ro asks otherwise.
- Always let the IDE soft-wrap lines.
- Always remove stale instructions and code encountered in the scope of your task.

## Routing

- Before editing files under `packages/`, read `packages/AGENTS.md`.
- Before editing files under `Apps/Test Apps/`, read `Apps/Test Apps/AGENTS.md`.
- Use `agent-instructions` for durable instruction, nested AGENTS, or skill placement work.
- Use `reasoning-effort-advisor` at the beginning of a new task or when the task shifts enough to warrant effort re-evaluation.
- Use the project lifecycle skills for roadmap selection, research, planning, implementation, review, and merge workflows.
- Use `runtime-codegen` for generated-code runtime API, generated TS, `TR`, `@runtime/TR`, and `packages/runtime/TaoRuntime-src` work.
- Use `old-repo-porting` when comparable behavior exists in `~/code/tao-lang`.
- Use `dev-automation` for `packages/dev`, `./agent`, `./dev`, `./tao`, and `Justfile` changes.
- Use `subagents-review` or `dual-agent-review-fix` for multi-agent review work.
- Use `stale-repo-check` after renames, removals, workflow changes, roadmap updates, or instruction edits.
- Treat generic Superpowers skills under `.agents/skills` as supplemental. Do not vendor or symlink generic skill bundles into `agents/skills` unless Ro explicitly asks; when workflows overlap, root/nested `AGENTS.md`, git safety, validation, and Tao lifecycle skills own the workflow.

## Autonomy

- Inspect repo truth first: current files, commands, roadmap docs, git state, and nearby patterns.
- Ask Ro for language-design decisions, roadmap priority, destructive operations, ambiguous product behavior, or choices that cannot be derived safely from the repo.
- Do not interrupt Ro for routine implementation details when existing repo patterns and tests give a defensible path.

## Quality

- Prefer minimal, readable, well-organized code with clear ownership.
- Prefer behavior tests over API-shape tests and trivial tests.
- Write intended demo Tao code and/or automated tests before implementing language/compiler/CLI behavior.
- Use `Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao` during research and planning when target syntax or functionality should change.
- As functionality is implemented, copy relevant implemented target code into `Apps/Kitchen Sink/Kitchen Sink.tao`; it is the executable Kitchen Sink used for testing.
- Test implemented functionality and encountered edge cases through `Apps/Test Apps/*` and `packages/<package>/tests/*` as appropriate.
- Do not test generated compiled TypeScript with substring or regex assertions. Test through Tao AST, validator diagnostics, runtime/e2e behavior, or compilation success for positive fixture coverage.
- Keep `Roadmap.md` to current tasks and status. Put implementation details in tests, app purpose docs, code docs, commit messages, PR summaries, or roadmap research/plan docs when Ro asks for them.

## Repo Map

- `agents/skills/*`: project skills.
- `agents/agent-types/*`: reusable agent type definitions, symlinked into tool-specific discovery paths such as `.codex/agents`.
- `Roadmap.md` and `Roadmap/`: Tao implementation roadmap.
- `Apps/*`: apps built in Tao for demos and tests.
- `packages/shared`: shared TypeScript and scripts.
- `packages/ast-utils`: Tao AST semantic helpers shared across parser consumers.
- `packages/dev`: TypeScript dev tooling and the `./agent` implementation.
- `packages/tao-cli`: Tao CLI.
- `packages/ide-extension`: VS Code extension.
- `packages/parser`: Langium grammar and Tao source to AST.
- `packages/compiler`: Tao AST to generated runtime TypeScript.
- `packages/validator`: Tao AST diagnostics for compiler and IDE.
- `packages/formatter`: Tao AST to formatted Tao source.
- `packages/runtime`: Expo app template, runtime app generation, `TR`, and Tao std-lib work.

## Git And Validation

- Run `./agent just prep` before commits and as the final validation command; do not use `check` as the handoff or commit validation shortcut.
- Commit message format: `<Summary line>\n\n<Bullet list of changes, one bullet per line with no blank lines between bullets>`.
- Squash-merge into `main` with message `<Summary line>\n\n<Bullet list of changes, one bullet per line with no blank lines between bullets>\n\n<Git's default squash-merge list of commits and messages>`.
- When merged into `main`, rename the branch to `merged/...` and sync that with origin.
