# Tao Lang re-implementation - Agent Guide

Tao is a programming language for UI apps and nothing else. It compiles to TSX that runs in Expo/React Native.

This is a clean and stepwise port of `~/code/tao-lang`. Treat the old repo as a reference, with months of excellent work intermixed with cruft and poor choices. The goal is to identify, learn from, and incorporate the good parts, and establish a tight, succinct, efficient implementation of the language. Do NOT just copy and paste existing repo code (EXCEPT if perfectly written as-is).

You will do all your work with Ro, the project lead and language designer. They have 30 years of developer experience, and a clear vision for Tao. They are the authoritative voice on all decisions.

## Instructions:

1. Instructions:
   - On a fresh worktree, run `direnv allow`
   - Always run `./agent help` at the start of a session
   - **ALWAYS** use `./agent <cmd> ...` for executable shell commands; use normal `cd` or tool workdirs to choose the command directory
   - **IF** in a git worktree, create a `feat/<name>` branch
   - Multiple agents may work in this repo in parallel; treat changes you did not make as expected peer work, and do not overwrite or revert them without explicit direction
   - **ALWAYS** let the IDE soft-wrap lines
   - **ALWAYS** remove stale instructions and code

## Dev Env

1. Info:
   - We use `nix` and `direnv` + `devenv` for dev environment automation
   - Use `bun` over `node` (except with `expo` and Jest)
   - Treat `just` as the main command runner; use `./dev <command>` only for script-like TypeScript automation that would otherwise deserve a separate bash script
   - Always use shared wrappers for platform invocations (`@shared` CLI/FS/HCI/Platform, etc.) instead of direct Bun or Node platform APIs
   - Keep this guide to durable agent instructions; omit transient implementation mechanics

## Priorities:

1. Succinct, Comprehensible, Effective, Minimal
   - **ALWAYS** prioritize writing the MINIMAL code that is MAXIMALLY readable and comprehensible
   - **ALWAYS** prioritize well-organized DRY code

2. Code Comments
   - Prefer self-documenting names and small functions over comments
   - Add comments only for intent, invariants, edge cases, or surprising constraints
   - Do not comment obvious mechanics
   - **ALWAYS** document exported functions and types with short, contract-focused JSDoc in the `<decl> <verb>s <description>` style
   - When touching existing exported code, add or update missing export docs as part of the same change
   - Remove or update stale comments whenever code changes
   - **ALWAYS** remove unused code and stale exports unless there is a specific documented reason to keep them

3. Repo Dev Environment Efficiency and Efficacy
   - **ALWAYS** prioritize FAST, EFFICIENT, and EFFECTIVE automation of all development workflows
   - **ALWAYS** utilize, create, and update skills and tools to empower you in all your needs

4. Clear Goals and Process
   - **ALWAYS** FIRST write intended functioning demo tao code and/or unit tests, and THEN implement the intended functionality in the tao compiler/cli/etc
   - Use `Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao` during research and planning when target syntax or functionality should change
   - As functionality is implemented, copy the relevant implemented target code into `Apps/Kitchen Sink/Kitchen Sink.tao`; that app is the executable Kitchen Sink used for testing
   - **ALWAYS** ensure that `Apps/Test Apps/*` and `packages/<package>/tests/*` address all implemented functionality and encountered edge cases
   - Prefer behavior tests over API-shape tests; avoid trivial tests
   - Test compiler behavior through Tao AST and runtime behavior, not generated TypeScript structure or string matches

## Porting Process and Rules

0. ALWAYS ask Ro questions until you have what you need to proceed
   - When in doubt, ask
1. Prep:
   - If your task is on `Roadmap.md`, identify it and ensure `Roadmap/<Task>/*` exists. Update it whenever relevant
   - Identify all relevant code in the previous repo for reference
2. Execute:
   - Write demo tao code and automated tests
   - Implement functionality in logical chunks and steps
   - Pass tests
3. Finalize:
   - Review with agents
   - Review with Ro
   - Commit and merge
4. Meta:
   - Note what didn't go well
   - Determine what skills and tools you should have had, if any
   - Research how to best fix this

## Repo Structure

- `.agents/*`: agent skills, etc.
- `Roadmap.md` + `Roadmap/`: Tao implementation roadmap
- `Apps/*`: apps built in tao for demo and testing
- `packages/`:
  - `/shared`: shared TS and scripts
  - `/dev`: TypeScript dev tooling and the `./agent` implementation
  - `/tao-cli`: tao cli (e.g. `tao run ...` `tao fmt ...` etc)
  - `/ide-extension`: VSCode extension for tao
  - `/parser`: langium grammar + tao code -> langium AST
  - `/compiler`: langium AST -> generated `runtime` TS
  - `/validator`: langium AST -> compiler/IDE warnings
  - `/formatter`: langium AST -> formatted tao code
  - `/runtime`: expo app template + Tao Runtime (`TR*`) code + tao std-lib for use in tao apps (e.g `use ... from @tao/...` - not yet implemented)

## Git workflow

- Instructions
  - Create a `feat/<feature>` branch _if in a worktree_
  - Do not stage or stash changes unless instructed. If a task requires it, ask first
  - Always run `prep-commit` before making commits
  - Commit message format `<Summary line>\n\n<Bullet list of changes, one bullet per line with no blank lines between bullets>`
  - Always squash-merge into main with message `<Summary line>\n\n<Bullet list of changes, one bullet per line with no blank lines between bullets>\n\n<Git's default squash-merge list of commits and messages>`
  - When merged into main, rename branch to `merged/...`, and sync that with origin
