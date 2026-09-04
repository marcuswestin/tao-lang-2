# Tao Agent Guide

Tao is a UI-app programming language that compiles to TSX for Expo and React Native. This repository is a clean, stepwise reimplementation of `~/code/tao-lang`; use the old repository as reference, not source to copy.

Ro is the project lead and language designer. Ro decides language semantics, roadmap priority, and product behavior.

## Work

- `./agent setup` is the one setup entry: Worktrunk's blocking pre-start hook runs it before a launched harness starts, the Claude Code and Codex session-start hooks run it for worktrees those harnesses create, and Cursor's worktree setup runs it for its own. In a linked worktree `./agent` reuses the primary checkout's pinned devenv profile; if it reports no profile, run `direnv allow` and `direnv exec . ./agent setup`.
- `direnv exec .` works in an unsandboxed shell but fails in a sandboxed one: it re-resolves the devenv lock through `.devenv/bootstrap`, which needs the nix daemon socket the sandbox denies. It surfaces as `cannot connect to socket at '/nix/var/nix/daemon-socket/socket'` or, misleadingly, `Failed to get attribute 'config.cachix.enable'`. In a sandboxed shell use the already-materialized profile instead — `export PATH="$PWD/.devenv/profile/bin:$PATH"` — and then call `bun`, `bunx`, `dprint`, `just`, and `node` directly.
- `EEXIST: failed to link package` from `bun install`, or a package the doctor reports as declared but not installed, means a sandboxed install cannot replace one of the few packages shipping `.idea/` or `.gitmodules`, which the sandbox protects and no setting exempts. Recover from an unsandboxed shell: `rm -rf node_modules && bun install --frozen-lockfile`.
- Run ordinary shell commands directly. Use `./tao` for Tao CLI commands and `./agent <command>` for common repository workflows; run `./agent help` to discover them. Human developer commands are defined in `Justfile`.
- Inspect all processes with `ps -axo pid=,ppid=,lstart=,command=` or selected PIDs with `ps -o pid=,ppid=,lstart=,command= -p <pid-list>`; inspect one listening port with `lsof -nP -iTCP:<port> -sTCP:LISTEN -t`. Agents may stop processes: confirm the PID belongs to the intended task when practical, send `kill -TERM <pid>` first, and use `kill -KILL <pid>` only when it survives graceful shutdown.
- Run headless Chrome through `just studio-smoke` or `just studio-proof-real-app`. Those repository entrypoints may escape the shell sandbox because they force headless mode, an ephemeral DevTools port, and a fresh `tao-studio-chrome-*` temporary profile; arbitrary Chrome launches and existing browser profiles remain approval boundaries.
- Run `./agent capabilities` to distinguish sandbox denials from missing host tools. Codex defaults to `tao-workspace`; select `tao-review` for read-only work, `tao-native` for native build directories, `tao-local-services` only for Docker-backed InstantDB, and `tao-release` only for release artifacts. Claude Code uses `just claude-review`, `just claude-native`, `just claude-local-services`, or `just claude-release` because its settings model has no named permission profiles.
- Search the repository with `rg`, not `grep -r`: `rg` skips hidden directories and everything Git ignores — the generated `_gen_*` trees, `.artifacts/`, `node_modules/`, and the linked worktrees under `.claude/worktrees/` — while `grep -r` and `find` descend all of them and repeat every hit once per worktree. Pass `--hidden` or `--no-ignore` only when you mean to search a generated or foreign tree.
- Ask Ro when language design, roadmap priority, destructive work, or ambiguous product behavior cannot be derived safely. Resolve routine implementation choices from repository evidence.
- Never mention Claude or any other agent identity in work products — not in file names, documents, code, comments, branch names, or commit messages (no AI `Co-Authored-By` trailers).
- Language work usually crosses parser, validator, formatter or source actions, compiler, and runtime; `packages/AGENTS.md` owns those boundaries.

## Safety

- Other agents and Ro may change this worktree concurrently. Preserve changes you did not make and adapt around them.
- Do not stage, unstage, reset, stash, or otherwise change the Git index unless Ro explicitly asks in the current request.
- Before committing in a worktree, create or switch to a named `feat/<name>` branch; never commit from detached HEAD. This applies to instruction and one-off commits as well as project work.
- A feature branch lands on `main` as a **squash** commit that keeps Git's `Squashed commit of the following:` appendix; `main` never takes a fast-forward or a merge commit. Read the `git-workflow` skill before any merge — `main`'s linear history is the product of squashing and does not imply fast-forwarding.

## Permissions

- Research the open web without asking. Run the repository's own workflow commands, local dev servers, simulators, and the local InstantDB stack without asking.
- Bash commands run inside an OS-level sandbox: the worktree and named caches are writable, egress is limited to an allowlist. On a sandbox violation, retry the command unsandboxed rather than abandoning the task; never widen the policy to route around one.
- Merge onto `main` only when Ro asks for it; the command no longer prompts, but the decision is still Ro's. Pushing always stops for Ro. Never read `.env` files, `~/.ssh`, `~/.aws`, or `~/.config/gh`, and never send repository contents to a third-party service.
- `.rulesync/permissions.jsonc` owns the shared permission rules and the sandbox policy, and `.rulesync/hooks.jsonc` owns the agent hooks; `.claude/settings.json` is generated from both and `.codex/hooks.json` from the hooks. Never edit a generated harness file; change the source and regenerate with `just _agent-config`. The `agent-instructions` skill owns which generator produces what.

## Guidance

- `Docs/` holds the written material: `Spec/` the implemented contract, `Roadmap/` the plans, and
  `Tutorials/` the learning material. `Docs/README.md` says what belongs in each.
- `Docs/Roadmap/Tao Revolution/` owns the language target and program: `Decisions.md` is the decided language, `Process.md` the sequence toward MVP and Revolution, `Coverage.md` the capability-to-test map. Where older documents disagree with `Decisions.md`, the decisions win.
- `Apps/WordFlower/README.md` owns the tranche mechanics. Language work proceeds in tranches: decisions are settled in `2 - Next`, implemented into `1 - Current` slice by slice with behavior tests written in Tao. Current never leads; it follows Next.
- `Apps/Tao Future/README.md` owns the post-MVP demo apps (Skillet, Hearth, Wayfare): tier-less specs whose files graduate from `.tao-revolution` to `.tao` as tranches land. Do not edit them outside consolidation or a decision amendment.
- Read `packages/AGENTS.md` before editing `packages/`.
- Read `Apps/Test Apps/AGENTS.md` before editing test apps.
- Read active roadmap documents for planned work. `Docs/Roadmap/Archive/` is frozen; do not update archived documents unless Ro explicitly asks. Other `Docs/Roadmap/` documents remain live.

## Validation

- Run focused tests while working.
- Run `./agent verify` as the final validation and before commits.
- Read the `verification-lanes` skill when choosing between changed, retry, complete, sandbox, and
  host-only verification. Selection lanes are iteration aids, never merge evidence, and
  `merge-with-main` is a human-only command that agents do not invoke.
- Several worktrees share one machine. Lanes divide its CPUs between themselves automatically, so a
  lane is slower, not oversubscribed, while another agent works. A timeout under that load is
  reported as `machine-contention`, re-run once on its own, and named in the summary's `contention`
  block — read that before treating a timed-out suite as a regression. `packages/dev/README.md` owns
  what is shared and what is not; `just full-verify` is the exception that still needs the machine's
  GUI to itself.

## Developer environment feedback

- During implementation, keep a task-local ledger of material developer-environment problems and credible improvement opportunities encountered in repository setup, dependencies, commands, tests, builds, generators, worktrees, permissions, performance, or diagnostics. For each item, retain the symptom and relevant command, evidence or likely cause, any workaround, and the plausible repository or host-environment improvement. Do not classify ordinary product-code failures or unsupported speculation as environment issues.
- Keep the task-local ledger in task context or ignored `.artifacts/` scratch state. Fix safe repository-owned workflow defects when they are within the task's authority and do not materially divert from its goal; otherwise preserve them as suggestions rather than silently expanding scope.
- When a task discovers a material new issue or improvement, or materially changes one already recorded, deduplicate and update `Docs/Roadmap/Developer environment upgrades.md`. Follow that document's entry format and lifecycle; do not create a second tracked issue list.
- When work is delegated, every subagent must return its environment-ledger entries to the owning agent. The owning agent deduplicates entries across participants and carries them through compaction and final validation.
- If the durable ledger changed, mention that once in the implementation handoff with a short link; the details already live in the ledger. If nothing was added or updated, omit developer-environment commentary entirely.
