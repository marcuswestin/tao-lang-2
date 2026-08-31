# Tao Agent Guide

Tao is a UI-app programming language that compiles to TSX for Expo and React Native. This repository is a clean, stepwise reimplementation of `~/code/tao-lang`; use the old repository as reference, not source to copy.

Ro is the project lead and language designer. Ro decides language semantics, roadmap priority, and product behavior.

## Work

- Create agent worktrees with Worktrunk so its blocking setup runs before the harness starts. In other linked worktrees, `./agent` reuses the primary checkout's pinned devenv profile; if it reports no profile, run `direnv allow` and `direnv exec . ./agent setup`.
- Run ordinary shell commands directly. Use `./tao` for Tao CLI commands and `./agent <command>` for common repository workflows; run `./agent help` to discover them. Human developer commands are defined in `Justfile`.
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
- Merging onto `main` stops for Ro. Never read `.env` files, `~/.ssh`, `~/.aws`, or `~/.config/gh`, and never send repository contents to a third-party service.
- `.rulesync/permissions.jsonc` owns the shared rules; `./agent setup` generates `.claude/settings.json` and `.codex/config.toml` from it. Edit the source, not the generated files. `.cursor/permissions.json` is hand-maintained and must be updated in the same change.

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

## Developer environment feedback

- During implementation, keep a task-local ledger of material developer-environment problems and credible improvement opportunities encountered in repository setup, dependencies, commands, tests, builds, generators, worktrees, permissions, performance, or diagnostics. For each item, retain the symptom and relevant command, evidence or likely cause, any workaround, and the plausible repository or host-environment improvement. Do not classify ordinary product-code failures or unsupported speculation as environment issues.
- Keep the ledger in task context or ignored `.artifacts/` scratch state; do not add a tracked issue document unless Ro asks for one. Fix safe repository-owned workflow defects when they are within the task's authority and do not materially divert from its goal; otherwise preserve them as suggestions rather than silently expanding scope.
- When work is delegated, every subagent must return its environment-ledger entries to the owning agent. The owning agent deduplicates entries across participants and carries them through compaction and final validation.
- At the end of every implementation handoff, include a `Developer environment` summary that distinguishes issues fixed during the task, remaining repository improvement suggestions, and external or policy limitations. Give exact user steps for anything the agent could not complete, and say explicitly when no issues or suggestions were found.
