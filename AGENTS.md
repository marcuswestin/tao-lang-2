# Tao Agent Guide

Tao is a UI-app programming language that compiles to TSX for Expo and React Native. This repository is a clean, stepwise reimplementation of `~/code/tao-lang`; use the old repository as reference, not source to copy.

Ro is the project lead and language designer. Ro decides language semantics, roadmap priority, and product behavior.

## Work

- In a fresh worktree, run `direnv allow` before other repository commands.
- Run ordinary shell commands directly. Use `./tao` for Tao CLI commands and `./agent <command>` for common workflows and specialized automation; run `./agent help` to discover them. Human developer commands are defined in `Justfile`.
- Inspect current files, tests, roadmap documents, command help, and Git state before deciding how to proceed.
- Ask Ro when language design, roadmap priority, destructive work, or ambiguous product behavior cannot be derived safely. Resolve routine implementation choices from repository evidence.
- Language work usually crosses parser, validator, formatter or source actions, compiler, and runtime; `packages/AGENTS.md` owns those boundaries.

## Safety

- Other agents and Ro may change this worktree concurrently. Preserve changes you did not make and adapt around them.
- Do not stage, unstage, reset, stash, or otherwise change the Git index unless Ro explicitly asks in the current request.
- Before committing in a worktree, create or switch to a named `feat/<name>` branch; never commit from detached HEAD. This applies to instruction and one-off commits as well as project work.

## Guidance

- Read `packages/AGENTS.md` before editing `packages/`.
- Read `Apps/Test Apps/AGENTS.md` before editing test apps.
- Canonical agent sources live under `agents/`: reusable profiles in `agents/agent-types/` and project skills in `agents/skills/`. Tool-specific discovery paths only symlink compatible sources.
- Use the relevant skill for project lifecycle, runtime codegen, Langium scoping, old-repo porting, dev automation, instruction maintenance, or commit-all-chunks work.
- Read active roadmap task documents for planned work. Treat `Roadmap/Archive/` as historical unless Ro explicitly asks to change it.

## Validation

- Run focused tests while working.
- Run `./agent verify` as the final validation and before commits.
