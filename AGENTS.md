# Tao Lang re-implementation - Agent Guide

Tao is a programming language for UI apps and nothing else. It compiles to TSX that runs in Expo/React Native.

This is a clean and stepwise port of `~/code/tao-lang`. Treat the old repo as a reference, with months of excellent work intermixed with cruft and poor choices. The goal is to identify, learn from, and incorporate the good parts, and establish a tight, succinct, efficient implementation of the language. Do NOT just copy and paste existing repo code (EXCEPT if perfectly written as-is).

You will do all your work with Ro, the project lead and language designer. They have 30 years of developer experience, and a clear vision for Tao. They are the authoritative voice on all decisions.

## Instructions:

1. Instructions:
   - On a fresh worktree or after `.envrc` / `devenv.*` changes, run `direnv allow` once, then `./agent help`
   - **ALWAYS** use `./agent <cmd> ...` for executable shell commands; use normal `cd` or tool workdirs to choose the command directory
   - **IF** in a git worktree, create a `feat/<name>` branch
   - **ALWAYS** let the IDE soft-wrap lines
   - **ALWAYS** remove stale instructions and code

## Dev Env

1. Info:
   - We use `nix` and `direnv` + `devenv` for dev environment automation
   - Use `bun` over `node` (except with `expo`)
   - Manage agent skills with `bunx skills`
   - Favor `packages/dev` TypeScript over shell scripts
   - Keep this guide to durable agent instructions; omit transient implementation mechanics

## Priorities:

1. Succinct, Comprehensible, Effective, Minimal
   - **ALWAYS** prioritize writing the MINIMAL code that is MAXIMALLY readable and comprehensible
   - **ALWAYS** prioritize well-organized DRY code

2. Code Comments
   - Prefer self-documenting names and small functions over comments
   - Add comments only for intent, invariants, edge cases, or surprising constraints
   - Do not comment obvious mechanics
   - Keep exported helper/type JSDoc short and contract-focused
   - Remove or update stale comments whenever code changes

3. Repo Dev Environment Efficiency and Efficacy
   - **ALWAYS** prioritize FAST, EFFICIENT, and EFFECTIVE automation of all development workflows
   - **ALWAYS** utilize, create, and update skills and tools to empower you in all your needs

4. Clear Goals and Process
   - **ALWAYS** FIRST write intended functioning demo tao code and/or unit tests, and THEN implement the intended functionality in the tao compiler/cli/etc
   - **ALWAYS** ensure that ALL implementation plans are expressed in `Apps/Kitchen Sink` code that demonstrates the intended functionality
   - **ALWAYS** ensure that `Apps/Test Apps/*` and `packages/<package>/tests/*` address all implemented functionality and encountered edge cases

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
  - `/runtime`: expo app template + Tao Runtime (`TR*`) code
  - `/std-lib`: `@tao/ui` etc

## Git workflow

- Instructions
  - Create a `feat/<feature>` branch _if in a worktree_
  - Do not stage changes unless instructed
  - Commit message format `<Summary line>\n\n<Newline-separated bullet list of changes>`
  - Always squash-merge into main with message `<Summary line>\n\n<Newline-separated bullet list of changes>\n\n<Git's default squash-merge list of commits and messages>`
  - When merged into main, rename branch to `merged/...`, and sync that with origin
