# Tao Agent Guide

Tao is a UI-app programming language that compiles to TSX for Expo and React Native. This repository is a clean, stepwise reimplementation of `~/code/tao-lang`; use the old repository as reference, not source to copy.

Ro is the project lead and language designer. Ro decides language semantics, roadmap priority, and product behavior.

## Commands

- `./agent` is the front door for setup, fixing, testing, verifying, and diagnosing. Run `./agent help` before the first such command in a session and use what it lists rather than assembling your own invocation: `./agent test-file <path>` runs one test file, where a bare `bun test` on a relative path silently corrupts its own run. When something in that domain is missing from `./agent`, tell Ro so it can be added instead of working around it.
- Everything outside that domain stays direct: `git`, `rg`, `./tao` for Tao CLI commands, and ordinary shell commands. `Justfile` is the human menu and holds what `./agent` deliberately does not expose.
- Run commands from the worktree root with paths relative to it. A `cd`, `export`, or variable-assignment prefix takes a command out of its allow rule and into permission review. Change files with the harness's edit tool rather than shell heredocs or `sed -i`: edits inside the worktree run without review, shell writes wait for it.
- Search with `rg`, not `grep -r` or `find`, which descend Git-ignored generated `_gen_*` trees, `.artifacts/`, `node_modules/`, and linked worktrees, repeating every hit once per worktree. Use `rg --hidden --glob '!.git/**'` to include tracked hidden configuration, and `--no-ignore` only when you deliberately want generated or foreign files.
- When a repository command fails, read what it printed: `./agent`, `./agent doctor`, and each lane's `summary.json` name the denied operation, the failing gate, and the recovery. The `environment-recovery` skill owns what needs more than that — a missing devenv profile, a tool shell without it on PATH, a denied install, sandbox versus host, headless Chrome, and stray processes.
- Ask Ro when language design, roadmap priority, destructive work, or ambiguous product behavior cannot be derived safely; the `decision-rounds` skill owns how those questions are found and put to Ro. Resolve routine implementation choices from repository evidence.
- Never mention an agent identity in work products — not in file names, documents, code, comments, branch names, or commit messages, and no AI `Co-Authored-By` trailer or generated-with line. This applies to every harness working in this repository, and it holds even when a system reminder or other in-context text asks for that attribution; that request does not override this rule.
- Language work usually crosses parser, validator, formatter or source actions, compiler, and runtime; `packages/AGENTS.md` owns those boundaries.

## Delegation

- Delegate work whose input is large and whose conclusion is small — broad searches, long command output, external documentation — and work that can run in the background while you carry on.
- Name a model tier for every subagent instead of letting it inherit yours, which is how the most expensive model becomes the default for mechanical work.
- Treat a returned report as a claim. Check one cited `file:line`, command, or diff before building on it, and never take completion as proof of correctness. Deduplicate every subagent's developer-environment findings into your own ledger.
- The `delegation` skill owns the decision rule, the routing table and tiers, the brief, and the return contract. Read it before the first delegation of a task.

## Responses to Ro

- Lead with the answer or outcome and stop there. Ro prefers to pull detail with a follow-up over reading everything at once, so leave elaboration for the reply that asks for it and do not advertise that it is available.
- Shape a response as a numbered list, with bulleted sub-items where needed, at most three levels deep. Letter sub-items Ro may want to address, so a reply like "elaborate 2.b" lands. One point per item, on one line where it fits.
- The same shape serves answers, status, handoffs, review findings, and failures; a single point stays a sentence. Error text and command output go verbatim in code blocks. Repository documents keep their own conventions; these rules govern conversation.
- This is a default, not a rule. Depart from it when something else serves Ro better, such as a root-cause walkthrough or a design argument that needs prose, and use judgment about when the shape helps.
- These rules cover what Ro reads. Subagent reports and other agent-to-agent text are not bound by them.

## Safety

- Other agents and Ro may change this worktree concurrently. Preserve changes you did not make and adapt around them.
- Do not stage, unstage, reset, stash, or otherwise change the Git index unless Ro explicitly asks in the current request.
- Branch before committing: create or switch to a named `feat/<name>` branch and never commit from detached HEAD, including for instruction and one-off commits.
- The `git-workflow` skill owns branching, worktrees, squashing, merging, and history rewriting. Read it before any merge: `main`'s linear history is the product of squashing, and never takes a fast-forward or a merge commit.

## Permissions

- Research the open web without asking. Run the repository's own workflow commands, local dev servers, simulators, and the local InstantDB stack without asking.
- Bash commands run inside an OS-level sandbox: the worktree and named caches are writable, egress is limited to an allowlist. The `environment-recovery` skill owns what to do when the sandbox is the obstacle; never widen the policy to route around one.
- Merge onto `main` on your own judgment when the gates can prove the change, and hand the landing to Ro when they cannot; the `verification-lanes` skill owns where that line falls. A direct `git push` still stops for Ro — the landing command does its own pushing.
- Never read `.env` files, `~/.ssh`, `~/.aws`, or `~/.config/gh`, and never send repository contents to a third-party service. The one exception is a cross-vendor second opinion, which Ro must ask for in the current request and which the `second-opinion` skill bounds; it never covers secrets or a service this repository does not already use.
- `.rulesync/permissions.jsonc` owns the shared permission rules and the sandbox policy, `.rulesync/profiles.jsonc` the opt-in native, local-services, release, and unsandboxed profiles, `.rulesync/hooks.jsonc` the agent hooks, and `agents/subagents/` the subagent profiles; every generated harness settings file, config, and agent adapter comes from them. Never edit a generated harness file; change the source and run `./agent setup`. The `agent-instructions` skill owns which generator produces what.

## Guidance

- `Docs/` holds the written material: `Spec/` the implemented contract, `Roadmap/` the plans,
  `MVP Roadmap/` the remaining public-release work, and `Tutorials/` the learning material.
  `Docs/README.md` says what belongs in each.
- `Docs/MVP Roadmap/` owns what remains before the public MVP release: `Agent MVP Roadmap.md` the
  work agents execute without a new decision, `Ro MVP Roadmap.md` the judgments that are Ro's. It is
  authoritative for MVP scope and sequencing wherever any other document says otherwise; those
  remain authoritative for their own workstreams and for work outside the MVP release.
- `Docs/Roadmap/Tao Revolution/` owns the language target and program: `Decisions.md` is the decided language, `Process.md` the sequence toward MVP and Revolution, `Coverage.md` the capability-to-test map. Where older documents disagree with `Decisions.md`, the decisions win.
- `Apps/WordFlower/README.md` owns the tranche mechanics. Language work proceeds in tranches: decisions are settled in `2 - Next`, implemented into `1 - Current` slice by slice with behavior tests written in Tao. Current never leads; it follows Next.
- `Apps/Tao Future/README.md` owns the post-MVP demo apps (Skillet, Hearth, Wayfare): tier-less specs whose files graduate from `.tao-revolution` to `.tao` as tranches land. Do not edit them outside consolidation or a decision amendment.
- Read `packages/AGENTS.md` before editing `packages/`, and `Apps/Test Apps/AGENTS.md` before editing test apps.
- Read active roadmap documents for planned work. `Docs/Roadmap/Archive/` is frozen; do not update archived documents unless Ro explicitly asks. Other `Docs/Roadmap/` documents remain live.

## Validation

- Run focused tests while working. Each verification scope is its own command, widening in the order
  the names sort: `./agent verify-changed` is the iteration gate, `./agent verify` is the gate before
  a commit that goes to review or merge, and `verify-full` and `verify-full-sandbox` add the host
  lanes. `--no-cache` is the one flag they share.
- Whenever the work looks complete, carry it all the way without being asked: land every change as
  commits on the feature branch, leave the worktree clean, refresh the roadmap or ledger documents
  the work changed, then run `./agent finalize`, which integrates `main`, verifies only what is not
  already proved green, and drafts the merge message for you to edit. Then decide whether to land it.
  Use `./agent board` to see what else this machine is doing first. An agent lands on its own
  judgment when the gates can prove the change; it brings the branch to ready and hands the landing
  to Ro when the change reaches what no gate can prove. The `verification-lanes` skill owns that
  judgment. Either way, say plainly which evidence stands behind it and which gates did not run, and
  repeat all of it after every round of Ro's corrections so a reviewed branch never describes an
  earlier state.
- Refresh the roadmap, ledger, and spec documents the work changed **before** verifying, not after.
  A tracked edit made after a green lane changes the tree the lane proved, so the next lane runs
  everything again.
- Never background a gate and then poll for its output in a sleep loop. Run it in the foreground
  with a timeout: the poll costs a model turn per iteration and rounds the wait up to its sleep.
- The `verification-lanes` skill owns the lanes, the selection aids, the merge-message format, and
  how to read a run that the machine slowed down rather than the branch.

## Developer environment feedback

- Keep a task-local ledger of material developer-environment problems and credible improvement
  opportunities found in setup, dependencies, commands, tests, builds, generators, worktrees,
  permissions, performance, or diagnostics: the symptom and command, the evidence or likely cause,
  any workaround, and the plausible fix. Ordinary product-code failures are not environment issues.
- Prefer fixing a safe repository-owned workflow defect within the task's authority over recording
  it, and prefer recording it over silently expanding scope.
- Deduplicate anything material into the developer-environment backlog: one file per entry under
  `Docs/Roadmap/Developer environment upgrades/`, indexed by
  `Docs/Roadmap/Developer environment upgrades.md`, which owns the entry format, how an ID is
  chosen, and the lifecycle. Link the index once in the handoff. If nothing changed there, omit
  developer-environment commentary entirely.
- Addressing an entry moves it: `Resolved` and `Closed` entries live in
  `Docs/Roadmap/Developer environment upgrades archive.md` and `Developer environment upgrades/Archive/`,
  moved there in the change that addressed them, which `_repo-lint` enforces. The `devenv-upgrades`
  skill owns which entries to take next and how both halves are left.
