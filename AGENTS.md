# Tao Agent Guide

Tao is a UI-app programming language that compiles to TSX for Expo and React Native. This repository is a clean, stepwise reimplementation of `~/code/tao-lang`; use the old repository as reference, not source to copy.

Ro is the project lead and language designer. Ro decides language semantics, roadmap priority, and product behavior.

## Work

- Create agent worktrees with Worktrunk so its blocking setup runs before the harness starts. In other linked worktrees, `./agent` reuses the primary checkout's pinned devenv profile; if it reports no profile, run `direnv allow` and `direnv exec . ./agent setup`.
- Run ordinary shell commands directly. Use `./tao` for Tao CLI commands and `./agent <command>` for common repository workflows; run `./agent help` to discover them. Human developer commands are defined in `Justfile`.
- Ask Ro when language design, roadmap priority, destructive work, or ambiguous product behavior cannot be derived safely. Resolve routine implementation choices from repository evidence.
- Language work usually crosses parser, validator, formatter or source actions, compiler, and runtime; `packages/AGENTS.md` owns those boundaries.

## Safety

- Other agents and Ro may change this worktree concurrently. Preserve changes you did not make and adapt around them.
- Do not stage, unstage, reset, stash, or otherwise change the Git index unless Ro explicitly asks in the current request.
- Before committing in a worktree, create or switch to a named `feat/<name>` branch; never commit from detached HEAD. This applies to instruction and one-off commits as well as project work.

## Guidance

- `Apps/WordFlower/README.md` owns the language implementation process. Language work proceeds in tranches: decisions are settled in `2 - Next`, implemented into `1 - Current` slice by slice, and `3 - MVP` and `4 - Revolution` are reconciled once when the tranche is absorbed. Current never leads; it follows Next.
- Read `packages/AGENTS.md` before editing `packages/`.
- Read `Apps/Test Apps/AGENTS.md` before editing test apps.
- Read active roadmap documents for planned work. `Roadmap/Archive/` is frozen; do not update archived documents unless Ro explicitly asks. Other `Roadmap/` documents remain live.

## Validation

- Run focused tests while working.
- Run `./agent verify` as the final validation and before commits.
