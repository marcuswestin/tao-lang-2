# Tao Lang re-implementation - Agent Guide

Tao is a programming language for UI apps and nothing else. It compiles to TSX that runs in Expo/React Native.

This is a clean and stepwise port of `~/code/tao-lang`. Treat the old repo as a reference, with months of excellent work intermixed with cruft and poor choices. The goal is to identify, learn from, and incorporate the good parts; and establish a tight, succinct, efficient implementation of the language. Do NOT just copy and paste existing repo code (EXCEPT if perfectly written as-is)

You will do all your work with Ro, the project lead and language designer. They have 30 years of developer experience, and a clear vision for Tao. They are the authoritive voice on all decisions.

## Instructions:

1. Instructions:
   - **ALWAYS** start with `direnv allow` then `./agent help`
   - **ALWAYS** use `./agent <cmd> ...` for all shell commands
   - **ALWAYS** let the IDE soft-wrap lines
   - **ALWAYS** Remove stale instructions and code

## Dev Env

1. Info:
   - We use `nix` and `direnv`+`devenv` for dev env automation
   - Use `bun` over `node` (except with `expo`)
   - Manage agent skills with `bunx skills`

## Priorities:

1. Succinct, Comprehensible, Effective, Minimal
   - **ALWAYS** prioritize writing the MINIMAL code that is MAXIMALLY readable and comprehensible.
   - **ALWAYS** prioritize well organized DRY code.

2. Repo Dev Environment Efficiency and Efficacy
   - **ALWAYS** propritize FAST, EFFICIENT and EFFECTIVE automation of all development workflows.
   - **ALWAYS** utilize, create and update skills and tools to empower you in all your needs.

3. Clear Goals and Process
   - **ALWAYS** FIRST write intended functioning demo tao code and/or unit tests, and THEN implement the indended functionality in the tao compiler/cli/etc.
   - **ALWAYS** ensure that ALL implementation plans are expressed in `Apps/Kitchen Sink` code that demonstrates the intended functionality.
   - **ALWAYS** ensure that `Apps/Test Apps/*` and `packages/<package>/tests/*` address all implemented functionality and encountered edge cases.

## Porting Process and Rules

0. ALWAYS ask Ro questions until you have what you need to proceed
1. Prep
   - Review `Roadmap.md` and identify your task
   - Identify all relevant code in previous repo for reference
   - Ensure `Roadmap/<Task>/*` exists. Update it whenver needed
2. Execute
   - Write demo tao code and automated tests
   - Implement functionality in logical chunks and steps
   - Pass tests
3. Finalize
   - Review with agents
   - Review with Ro
   - Commit and Merge
4. Meta
   - Note what didn't go well
   - Determine what skills and tools you should have had, if any
   - Research how to best fix this

## Repo Structure

- `.agents/*`: agent skills, etc
- `Roadmap.md`+`Roadmap/`: Tao implementation roadmap
- `Apps/*`: apps built in tao for demo and testing
- `packages/`
  - `/shared`: shared TS and scripts
  - `/cli`: tao cli, e.g `tao run ...`, `tao fmt ...`, etc
  - `/ide-extension`: vscode extension for tao
  - `/parser`: langium grammar + tao code -> langium AST
  - `/compiler`: langium AST -> generated `runtime` TS
  - `/validator`: langium AST -> compiler/IDE warnings
  - `/formatter`: langium AST -> formatted tao code
  - `/runtime`: expo app template + Tao Runtime (`TR.*`) code
  - `/std-lib`: `@tao/ui`, etc

## Git workflow

- Create a `feat/<feature>` branch if on a worktree
- Do not stage changes unless instructed
- Commit message format: `<Summary line>\n\n<Bullet list of changes>`
- Always squash-merge into main with message: `<Summary line>\n\n<Summary bullet list of changes>\n\n<List of all squashed commits+messages>`
