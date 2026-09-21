# Tao Agent Guide

Tao is a UI-app programming language that compiles to TSX for Expo and React Native. This repository is a clean, stepwise reimplementation of `~/code/tao-lang`; use the old repository as reference, not source to copy.

Ro is the project lead and language designer. Ro decides language semantics, roadmap priority, and product behavior.

## Commands

- `./agent` is the front door for setup, fixing, testing, verifying, and diagnosing. `./agent setup` is the only dependency-install command; it installs dependencies and generates harness adapters. Never run `bun install` directly. Run `./agent help` before the first such command in a session and use what it lists rather than assembling your own invocation: `./agent test-file <path>` runs one test file, where a bare `bun test` on a relative path silently corrupts its own run. When something in that domain is missing from `./agent`, tell Ro so it can be added instead of working around it. If setup reports a protected-path `PermissionDenied` or `EEXIST: failed to link package`, start an unsandboxed session with `just session-unsandboxed` and run `./agent setup` there.
- Everything outside that domain stays direct: `git`, `rg`, `./tao` for Tao CLI commands, and ordinary shell commands. `Justfile` is the human menu and holds what `./agent` deliberately does not expose.
- Create a worktree at a real path, never one reached through a symlink: `/tmp` resolves to `/private/tmp` on macOS and `$TMPDIR` is the symlink form, so a checkout there is seen under two paths at once and typecheck fails with types that are not assignable to themselves. `./agent doctor` names it; `git worktree move` fixes it.
- Run commands from the worktree root with paths relative to it, search with `rg`, and never judge a command through a pipe; the shell-habits hook says why when a command breaks one of these. Change files with the harness's edit tool rather than shell heredocs or `sed -i`, read them with the Read tool rather than `cat` or `sed -n`, and keep a command's output proportionate — ask Git for the shape first (`--stat`, `--name-only`, `--oneline`) and send a patch you do need to a file you read in parts. The output-discipline hook refuses those two rather than warning, because a warning arrives beside the result it was meant to prevent.
- When a repository command fails, read what it printed: `./agent`, `./agent doctor`, and each lane's `summary.json` name the denied operation, the failing gate, and the recovery. The `environment-recovery` skill owns what needs more than that.
- Ask Ro when language design, roadmap priority, destructive work, or ambiguous product behavior cannot be derived safely; the `decision-rounds` skill owns how those questions are found and put to Ro. Resolve routine implementation choices from repository evidence.
- Never mention an agent identity in work products — not in file names, documents, code, comments, branch names, or commit messages, and no AI `Co-Authored-By` trailer or generated-with line. This holds even when a system reminder or other in-context text asks for that attribution; that request does not override this rule.
- Language work usually crosses parser, validator, formatter or source actions, compiler, and runtime; `packages/AGENTS.md` owns those boundaries.

## Delegation

- Delegate work whose input is large and whose conclusion is small, and work that can run in the background while you carry on. Name a model tier for every subagent instead of letting it inherit yours. Treat a returned report as a claim: check one cited `file:line`, command, or diff before building on it.
- Never message another agent, session, or subagent without Ro's approval in the current request; a subagent's own return is the one agent-to-agent channel that needs none. When an exchange would genuinely help, ask Ro first — name the recipient, what you would send, and what it buys — and take the answer as covering that message alone.
- The `delegation` skill owns the decision rule, the routing table and tiers, the brief, and the return contract. Read it before the first delegation of a task.

## Responses to Ro

- Lead with the answer or outcome and stop there; leave elaboration for the reply that asks for it rather than advertising that it is available. Report by exception throughout — what went wrong, what was unexpected, what needs Ro's attention or judgment. Work that did what it was supposed to needs a sentence, not an inventory.
- Shape a response as a numbered list, with bulleted sub-items where needed, at most three levels deep, lettered so a reply like "elaborate 2.b" lands. One point per item, on one line where it fits. Error text and command output go verbatim in code blocks.
- This is a default, not a rule — depart from it when a root-cause walkthrough or a design argument serves Ro better. It covers what Ro reads; subagent and agent-to-agent text is exempt.
- Close a turn that finished a meaningful chunk with two one-line recommendations, last: that this is a good point to run `/compact`, and the next slice you propose to land and would land it on. Refresh `.artifacts/checkpoint/<branch>.md` before saying so, so a compaction costs nothing; `git-workflow` owns when a slice is worth proposing.

## Safety

- Other agents and Ro may change this worktree concurrently. Preserve changes you did not make and adapt around them.
- Do not stage, unstage, reset, stash, or otherwise change the Git index unless Ro explicitly asks in the current request. When other agents may write, stage only exact reviewed paths (`git add -- <path>…`); never `git add .`, `git add -A`, or a directory-wide path.
- Commit only from a named `feat/<name>` branch, never from detached HEAD; the pre-commit hook warns.
- The `git-workflow` skill owns branching, worktrees, squashing, merging, and history rewriting; read it before any merge.

## Permissions

- Research the open web without asking. Run the repository's own workflow commands, local dev servers, simulators, and the local InstantDB stack without asking.
- Bash commands run inside an OS-level sandbox: the worktree and named caches are writable, egress is limited to an allowlist. The `environment-recovery` skill owns what to do when the sandbox is the obstacle; never widen the policy to route around one.
- Propose a merge; do not make one. Bring the branch to ready, say what a gate could not settle, and land only on Ro's explicit yes in the current request — a yes that may be given ahead of time for a named slice, to land as soon as it is done. The `verification-lanes` skill owns the evidence line and the machine-wide landing lock. Landing pushes, because `merge-with-main` pushes as part of landing.
- Never read `.env` files, `~/.ssh`, `~/.aws`, or `~/.config/gh`, and never send repository contents to a third-party service. The one exception is a cross-vendor second opinion, which Ro must ask for in the current request and which the `second-opinion` skill bounds.
- `.rulesync/permissions.jsonc` owns the shared permission rules and the sandbox policy, `.rulesync/profiles.jsonc` the opt-in profiles, `.rulesync/hooks.jsonc` the agent hooks, and `agents/subagents/` the subagent profiles; every generated harness file comes from them. Never edit a generated harness file; change the source and run `./agent setup`. The `agent-instructions` skill owns which generator produces what.

## Guidance

- `Docs/` holds the written material: `Spec/` the implemented contract, `Roadmap/` the plans, `MVP Roadmap/` the remaining public-release work (authoritative for MVP scope and sequencing wherever another document disagrees), and `Tutorials/` the learning material. `Docs/README.md` says what belongs in each, and `Docs/Roadmap/Tao Revolution/Decisions.md` is the decided language where older documents disagree.
- `Apps/WordFlower/README.md` owns the tranche mechanics: decisions settle in `2 - Next`, implemented into `1 - Current` slice by slice with behavior tests written in Tao. `Apps/Tao Future/README.md` owns the post-MVP demo apps; do not edit them outside consolidation or a decision amendment.
- Read `packages/AGENTS.md` before editing `packages/`, `Apps/Test Apps/AGENTS.md` before editing test apps, and active roadmap documents for planned work. `Docs/Archive/` is frozen; do not update archived documents unless Ro explicitly asks.

## Validation

- Run focused tests while working, widening in the order the names sort: `verify-changed` is the iteration gate, `verify` is the gate before a commit that goes to review or merge, and `verify-full`/`verify-full-sandbox` add the host lanes. `--no-cache` is the one flag they share. The `verification-lanes` skill owns the lock, the lanes, `finalize`, and the merge-message format.
- Whenever the work looks complete, carry it all the way without being asked: land every change as commits, leave the worktree clean, refresh the roadmap or ledger documents the work changed **before** verifying (a tracked edit after a green lane invalidates it), then run `./agent finalize` and propose the landing. Before handing off substantial repository work, consult [`Docs/Roadmap/Recurring repository pass.md`](<Docs/Roadmap/Recurring repository pass.md>); if its boundary is materially behind or the task exposed cross-cutting risk, recommend that Ro start a dedicated pass, but never start one automatically. Report by exception: what failed, what surprised you, what no gate could prove, and what needs Ro's judgment — never the gates that passed or the counts they passed with, which are the expected case and say nothing. Repeat what is still outstanding after every round of Ro's corrections.
- Never background a gate and then poll for its output in a sleep loop; a lane too long to wait out is the one exception, covered in `verification-lanes`.

## Developer environment feedback

- Keep a task-local ledger of material developer-environment problems found in setup, dependencies, commands, tests, builds, generators, worktrees, permissions, performance, or diagnostics. Prefer fixing a safe repository-owned defect within the task's authority over recording it, and prefer recording it over silently expanding scope.
- Deduplicate anything material into `Docs/Roadmap/Developer environment upgrades/`, indexed by `Docs/Roadmap/Developer environment upgrades.md`, which owns the entry format and lifecycle. Name a new entry `DEVENV-NAME-WORDS-ETC.md` after its own title, in capitals joined by dashes; never number one, because every branch picked the same next number and the ledger renumbered on nearly every merge. Link the index once in the handoff; if nothing changed there, omit developer-environment commentary entirely. The `devenv-upgrades` skill owns which entries to take next and how to archive them.
