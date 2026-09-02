---
name: dev-automation
description: >-
  Change Tao developer automation, including packages/dev, ./agent, ./dev, ./tao, Justfile recipes, command help, or repository workflow output.
---

# Dev Automation

- Keep common workflow definitions and human developer commands in `Justfile`; keep shell entrypoints and the `./tao` wrapper thin.
- Keep one setup entry, `./agent setup`, and route every harness through it: Worktrunk's blocking `pre-start` hook as `direnv allow && direnv exec . ./agent setup` (`.config/wt.toml`), the Claude Code and Codex `SessionStart` hooks (one source, `.rulesync/hooks.jsonc`, with harness-neutral commands), and Cursor's blocking worktree setup (`.cursor/worktrees.json` and its script). Trust, dependencies, and generated agent adapters must exist before a harness reads them; when setup changes, update the comments that cross-reference each other in all four places.
- Never name a Bun install backend. `--backend=copyfile` writes every packaged file through its own path, and npm packages ship `.idea/` and `.gitmodules` files that an agent sandbox protects inside the working directory and cannot be exempted from, so naming it makes `bun install` unrunnable sandboxed. Bun's macOS default clones whole directories and installs fine in a linked worktree.
- Keep `./agent` able to reuse the primary checkout's pinned devenv profile in linked worktrees where sandboxing hides `.envrc`; never fall back to an unpinned host Node. `direnv allow && direnv exec . ./agent setup` remains the fallback when no shared profile exists.
- Expose formatting, fixing, testing, checking, and final validation as thin `./agent` passthroughs to the matching Just recipes.
- Treat `just --list` as the human menu. Compose recipes so one command runs all fixing and gates and separate recipes stay individually invocable, and name and describe them for someone discovering a workflow rather than recalling it.
- Keep `./tao`, `Justfile`, and `./dev` distinct rather than collapsing them to one spelling: `./tao` is the published CLI and product surface for developers who prefer their own editor, the `Justfile` is the human menu of common tasks, and `./dev` holds what belongs in TypeScript rather than a recipe.
- Keep the Justfile the definition point for which gates belong to `check` and `verify`; `./dev gates` owns running them and reporting the one verification summary. Its help states how to declare a lane's deliberately unrun gates.
- `./dev`'s lane commands load Studio and Expo command modules lazily inside their actions, so `gates`, `test`, and `doctor` start in a checkout that has never generated the parser, and the `devLazyStudioImportIssues` repo lint rule fails any static `./studio/`, `./expo-dev-loop/`, or `@studio` import in `dev.ts` that would take that back.
- `GateCatalog.ts` in `packages/dev` owns each gate's scheduling shape: `needs`, `cost`, `priority`, `resources`, `mutatesTree`, `budgetEnvKeys`, `timeoutMs`. Adding a lane is one Justfile recipe plus one catalog entry; an unknown recipe runs untuned at cost 1, and an edge whose other end a lane omits is ignored.
- Costs are admission reservations against `cpuCount`, and a node whose width does not fit holds the admission queue — pick widths that fit side by side. `_test`'s cost is also the nested `./dev test` worker budget, so `SUITE_SCHEDULING`'s widest reservation must fit inside that cost, not inside a whole machine.
- A recipe that deletes and rewrites a `_gen_*` tree another gate reads is `mutatesTree: true` in the catalog, not an ordinary gate.
- Node names key the timings store `.artifacts/timings/durations.json`; renaming a recipe cold-starts its measured history.
- Every lane writes `.artifacts/logs/<lane>/<stamp>/<node>.log` plus `summary.json` and refreshes the lane's `latest` symlink when the run ends. Give a lane node a catalog `timeoutMs` rather than letting a hang hold the lane open with nothing written.
- Work-graph commands share one output contract: `--output tui|lines|quiet`, `TAO_OUTPUT_MODE` to pin a lane, and by default a terminal renders the dashboard while a pipe gets the quiet per-node report. `tao test` speaks the same contract, mapping `tui` to `lines`.
- The Studio smoke and canary lanes cannot run inside the Bash sandbox (Chrome cannot create its socket and Crashpad directories), and neither can a pty check like `script -q /dev/null`; run `just full-verify` and terminal-output verification from an unsandboxed shell.
- Derive `./agent help` descriptions for passthrough commands from live `just help` output instead of duplicating recipe help.
- Keep ordinary shell and Tao CLI commands outside `./agent`; run them directly or through `./tao`.
- Keep commands typed, focused, and covered by package tests or repository validation.
- Keep workflow output concise and stream interactive work. Save large diagnostic artifacts only when the owning workflow benefits from them.
- Use `kebab-case` Just recipe names and `ALL_CAPS` Just variables when changing the human workflow surface.
- Prefer self-contained command help and generated prompts over duplicating command recipes in skills.
- Run `./agent test [pattern]` for the repository test workflow and `./agent verify` for final validation. Direct `bun test <files>` remains appropriate for a single test file.
- `just` has no named-argument syntax. `just recipe run_id="local"` passes the literal string `run_id=local` as the recipe's _first positional_ parameter, so a composed recipe silently runs with the wrong arguments. Pass positionals in declaration order.
- Chrome never synthesizes HTML5 drag-and-drop from `Input.dispatchMouseEvent`. Pointer-driven UI (dividers, resizers) works with mouse events; anything using `dragstart`/`drop` needs drag interception: `Input.setInterceptDrags`, then the payload from `Input.dragIntercepted`, replayed through `Input.dispatchDragEvent`. A mouse-only drag against a drop target fails silently.
- `agents/skills/` is outside the agent sandbox's write allowlist. Editing a skill needs an unsandboxed shell; a sandboxed write fails with `PermissionError: Operation not permitted`.
