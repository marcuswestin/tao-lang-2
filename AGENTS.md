# Tao Lang re-implementation - Agent Guide

Tao is a programming language for UI apps and nothing else. It compiles to TSX that runs in Expo/React Native.

This is a clean and stepwise port of `~/code/tao-lang`. Treat the old repo as reference material, not source to copy. Use the `old-repo-porting` skill for durable porting gotchas.

You will do all your work with Ro, the project lead and language designer. They have 30 years of developer experience, and a clear vision for Tao. They are the authoritative voice on all decisions.

## Instructions:

1. Instructions:
   - On a fresh worktree, run `direnv allow`
   - Run `./agent help` once at the start of a fresh repo session; do not repeat it every turn unless you need to refresh the command list or diagnose agent command behavior
   - **ALWAYS** use `./agent <cmd> ...` for executable shell commands; use normal `cd` or tool workdirs to choose the command directory
   - Create a `feat/<name>` branch only for project-sized work that needs review and merge; small edits, instruction updates, and one-off commits should stay on the current branch unless Ro asks otherwise
   - Multiple agents may work in this repo in parallel; treat changes you did not make as expected peer work, and do not overwrite or revert them without explicit direction
   - Do not modify the Git index or stash state unless Ro explicitly asks; never stage, unstage, reset staged files, stash, pop, apply, drop, or otherwise affect staged or stashed work as cleanup. If a task appears to require touching staged or stashed work, ask Ro first.
   - Use the `agent-instructions` skill when Ro asks to add or update durable instructions
   - **ALWAYS** let the IDE soft-wrap lines
   - **ALWAYS** remove stale instructions and code

## Dev Env

1. Info:
   - We use `nix` and `direnv` + `devenv` for dev environment automation
   - Treat the direnv/devenv developer environment as a working fundamental; do not add defensive availability/version checks for its expected tools unless Ro explicitly asks for diagnostics
   - Use `bun` over `node` (except with `expo` and Jest)
   - Treat `just` as the workflow manager and main command runner
   - Use `./dev <command>` only as a script runner for focused TypeScript automation that would otherwise deserve a separate bash script; do not put workflow dependencies or prerequisite orchestration in `./dev`
   - Always use shared wrappers for platform invocations (`@shared` CLI/FS/HCI/Platform, etc.) instead of direct Bun or Node platform APIs
   - Use `HCI` for all user-intended terminal I/O, including messages, prompts, help text, replayed command output, and errors; reserve `Platform.runtimeProcess` and `Platform.runtimeConsole` for low-level process plumbing and shared wrappers
   - Use `CLI.run`/`CLI.mustRun` for completed child processes and `CLI.start` for long-running child processes; use `prefixedOutput` when output should be captured while streaming colored `[process]:` lines. Use `HCI.logProcessInfo`, `HCI.logProcessWarn`, and `HCI.logProcessError` for standalone process-prefixed messages.
   - Plain JS/CJS config and bootstrap files that cannot safely load `@shared` are the exception; keep direct `node:*` imports narrow, prefer slash-separated path strings where possible, and explain the loader constraint locally
   - Prefer `FS.resolvePath('foo/bar', { cwd })` for concrete filesystem locations. Use one slash-separated string with interpolation; omit `{ cwd }` when the intended base is the current process cwd; use `FS.joinPath('foo/bar')` only for ungrounded relative path fragments.
   - Never export raw `Platform.node*` APIs. Import `node:*` modules only inside the shared wrapper file that owns that capability, and use `FS` for filesystem access instead of `Platform`.
   - Keep this guide to durable agent instructions; omit transient implementation mechanics

## Priorities:

1. Succinct, Comprehensible, Effective, Minimal
   - **ALWAYS** prioritize writing the MINIMAL code that is MAXIMALLY readable and comprehensible
   - **ALWAYS** prioritize well-organized DRY code
   - Generated Tao TS should be minimal and use runtime wrappers from default `TR` imported via `@runtime/TR` wherever practical; use the `runtime-codegen` skill for generated-code runtime work
   - Use multiline template strings for multiline text; do not build static multiline strings with arrays joined by `\n`. Use `Text.stripIndent` from `@shared` when indentation should be removed.

2. Code Comments
   - Prefer self-documenting names and small functions over comments
   - Add comments only for intent, invariants, edge cases, or surprising constraints
   - Do not comment obvious mechanics
   - **ALWAYS** document exported functions and types with short, contract-focused JSDoc in the `<decl> <verb>s <description>` style
   - When touching existing exported code, add or update missing export docs as part of the same change
   - Export only real cross-file or package-boundary APIs; do not export helpers for convenience or tests
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
   - Each test app lives in `Apps/Test Apps/<App Name>/`, has one primary `<App Name>.tao`, and includes `Purpose.md` describing the app's purpose, what belongs there, when to edit it, and any planned behavior-test metadata
   - Test apps must be valid, positive functionality examples; put error and diagnostic cases in package unit tests
   - Prefer behavior tests over API-shape tests; avoid trivial tests
   - Do not test generated compiled with TypeScript substring/regex assertions; test compiler behavior through Tao AST, validator diagnostics, runtime/e2e behavior, or compilation success for positive fixture coverage.

## Porting Process and Rules

0. ALWAYS ask Ro questions until you have what you need to proceed
   - When in doubt, ask
1. Prep:
   - If your task is on `Roadmap.md`, identify it before implementation. Use an existing `Roadmap/<Task>/` folder when research or plan docs are already part of that project, but do not create roadmap folders or implementation notes just to summarize completed work.
   - Keep `Roadmap.md` to current tasks and status; put implementation details in tests, app purpose docs, code docs, commit messages, or PR summaries unless Ro asks for a roadmap research/plan document.
   - Use the `old-repo-porting` skill when comparable previous-repo behavior exists
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
  - `/ast-utils`: Tao AST semantic helpers shared across parser consumers
  - `/dev`: TypeScript dev tooling and the `./agent` implementation
  - `/tao-cli`: tao cli (e.g. `tao run ...` `tao fmt ...` etc)
  - `/ide-extension`: VSCode extension for tao
  - `/parser`: langium grammar + tao code -> langium AST
  - `/compiler`: langium AST -> generated `runtime` TS
  - `/validator`: langium AST -> compiler/IDE warnings
  - `/formatter`: langium AST -> formatted tao code
  - `/runtime`: expo app template, runtime app generation, the `TR` generated-code runtime API, and tao std-lib for use in tao apps (e.g `use ... from @tao/...` - not yet implemented)

## Git workflow

- Instructions
  - Create a `feat/<feature>` branch for project-sized work that needs review and merge; do not switch branches for small edits, instruction updates, or one-off commits unless Ro asks
  - Always run `./agent just prep` before making commits and as the final validation command; do not use `check` as the handoff or commit validation shortcut
  - Do not stage, unstage, reset staged files, stash, pop, apply, drop, or otherwise affect staged or stashed work unless instructed. If a task requires it, ask first.
  - Commit message format `<Summary line>\n\n<Bullet list of changes, one bullet per line with no blank lines between bullets>`
  - Always squash-merge into main with message `<Summary line>\n\n<Bullet list of changes, one bullet per line with no blank lines between bullets>\n\n<Git's default squash-merge list of commits and messages>`
  - When merged into main, rename branch to `merged/...`, and sync that with origin
