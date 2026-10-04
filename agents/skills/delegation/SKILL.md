---
name: delegation
description: >-
  Decide whether to hand work to a subagent, which model tier and effort it runs at, what its brief must contain, and how to check what it returns. Use when a task involves broad search, codebase exploration, web research, long command output, independent review, or two workstreams that could run at once, whenever choosing between doing work yourself and spawning an agent, and whenever the Developer asks you to write, print, or hand over a prompt for another agent to run. Also covers dividing significant multi-piece work across concurrent writers with exclusive path ownership (`references/parallel-implementation.md`, used when two or more substantial workstreams can proceed concurrently without sharing mutable seams) and fanning a large read-only review out across many units (`references/review-fanout.md`, used to audit every merge on main, review a tranche, or review every commit).
---

# Delegation

Optimize wall-clock time to finish the whole task you own, not tokens, not your own context, and not the elegance of the split. A subagent starts with no memory of this session, pays a fixed startup cost before its first useful tool call, and sees only the brief you write; spend that when it buys back more than it costs. This skill owns whether to delegate, which tier, what the brief says, and what to do with the report; `references/parallel-implementation.md` owns coordinating concurrent writers, `references/review-fanout.md` owns dividing a review too large for one context.

## Delegate when

- **The work compresses**: large input, small conclusion — sweeping many files for a pattern, reading a long log down to the failures, a page of vendor docs for one fact. Holds even when you could do it quickly yourself, because what you'd carry afterwards is worse than what you'd carry now.
- **It is big enough to amortize**: roughly ten or more tool calls, or 15k+ tokens pulled through context for a conclusion you could state in a paragraph. That threshold is only recognisable once crossed, so apply it forward: before opening the third file to answer one question, hand the question over. Delegating raises total tokens, since the agent re-reads what you already know, and lowers what you carry for the rest of the session — the second is what the session is paid on.
- **It can run while you work**: anything your next two or three steps do not depend on goes to a background agent, launched before your own step rather than after.
- **It wants a different model than yours**: mechanical breadth deserves a cheaper model, a hard judgment call a stronger one — see routing below.
- **It should not be able to write**: review, audit, and second opinions are more trustworthy from an agent that cannot quietly fix what it finds and report success.

## Do not delegate when

You know the file and line (read it); the brief would take longer to write than the work takes to do, or needs "as we discussed" to make sense; the edits are coupled, so two agents on one seam cost more than one agent on both sides; the judgment is the point and the context is the input — naming, product semantics, what the Developer meant (delegate the evidence-gathering, keep the decision); or you are already at the answer and delegating is procrastination.

## Parallelism

Three to five concurrent agents is the working range; beyond that you become the bottleneck, since you still read and check every report. Launch, then continue, then collect each report as it lands rather than waiting for the whole fan-out. Hand a finished agent the next piece only when that piece needs what the agent already read: a resumed agent re-reads its whole history on every request, so an unrelated piece goes to a fresh one. Readers and a writer do not mix — a reader that opens a file while something else rewrites it reports a defect that was never there. Either the fan-out is read-only, or every agent owns its paths exclusively under `references/parallel-implementation.md`; never both over the same seam.

## Messaging another agent

A subagent you spawned is yours to talk to: its return, and continuing it with `SendMessage` to correct it, extend its task, or reuse its context, never need approval. Every other exchange waits for the Developer's approval in the current request: writing to another agent session on this machine or in the cloud, to a teammate's agent, and any relay that reaches an agent they did not point you at. `SendMessage` reaches those too and the harness cannot tell them apart, so the rule holds where no gate exists — a brief that tells a subagent to go message a third agent is the same message sent one remove away.

For those, ask when the exchange buys something a subagent of your own would not: name the recipient, what you would send, and what it unblocks, as one question the Developer can answer yes or no. An approval covers that message, not the exchange it opens; the next one asks again. Between asking and hearing back, do the rest of the task — a pending message is not a reason to idle.

## Model and effort routing

Work is routed to a tier, spelled per harness in one table, so a model release changes one table instead of every skill and profile.

| Work                                                                       | Tier                                        | Effort |
| -------------------------------------------------------------------------- | ------------------------------------------- | ------ |
| Mechanical sweeps, file inventories, single-fact lookups across many paths | fast                                        | low    |
| Codebase exploration, tracing behavior, web research, comparing call sites | standard                                    | medium |
| Running a verify lane and distilling the failures                          | standard                                    | low    |
| Implementing a slice that is already specified                             | standard, or deep when the seam is delicate | high   |
| Adversarial review, architectural judgment, root-cause dead ends           | deep                                        | xhigh  |
| Language semantics, decisions that are expensive to reverse                | frontier                                    | xhigh  |

| Tier     | Claude Code `model` | Codex CLI `model` | Cursor `model`     |
| -------- | ------------------- | ----------------- | ------------------ |
| fast     | `haiku`             | `gpt-6-luna`      | `composer-2.5`     |
| standard | `opus`              | `gpt-6.1-sol`     | `claude-opus-5-5`  |
| deep     | `opus`              | `gpt-6.1-sol`     | `claude-opus-5-5`  |
| frontier | `fable`             | `gpt-6-astra`     | `claude-fable-5-1` |

`repo-lint` checks profile pins against this table; Codex `[agents]` defaults come from the standard row. See [model routing](references/model-routing.md) for precedence, availability, effort syntax, and completed-task measurement.

Downward is the usual direction: a deep or frontier orchestrator almost never lets a subagent inherit its model, so say the tier explicitly. Upward, a standard or deep orchestrator escalates one hard question to `oracle` — a root cause that survived two attempts, a costly design fork, a diagnosis you keep circling — read-only, no mandate to fix; name the frontier tier on the call if you are already there, since `oracle` defaults to deep. Effort is separate from tier: a stronger model at low effort beats a weaker one at high effort for judgment, and loses for breadth.

## Choosing the tier

The table decides: when a task matches a row, take it and say which tier you chose in one line, without asking. Ask the Developer only when the work fits no row and your confidence between two tiers is low, when you are about to spend the frontier tier or expect the agent to run more than about ten minutes, or when the log already shows this kind of task re-run at a different tier — as one question with your recommendation marked, then write the answer into the table above so it does not recur.

## The brief

The agent sees the brief and nothing else. Every brief carries: **goal** and why it matters; **what is already known** — paths, findings, things ruled out; **decisions already made**, so it does not silently re-decide them; **boundaries** — paths it owns, must not touch, and whether it may write; **return format** and length; and a **stop condition** — what "done" is and what to do when the answer is not there.

Resume an agent when its earlier context helps the next question; start fresh when its history is large and unrelated. Review each parallel implementation wave's diff before the next wave or integration, and keep whole-diff review before landing.

For an agent you launch into this worktree, the `subagentStart` hook gives every Claude Code and Codex subagent the repository's standing rules (worktree root, `rg`, no Git index changes, no ledger edits, no agent identity), so a brief does not repeat them; a Cursor brief still does.

A brief the Developer asks you to print takes none of that worktree boilerplate: they paste it into a fresh agent that gets a worktree of its own, sharing nothing with this session — not this worktree's path, not its branch, not its uncommitted edits, not its `.artifacts/`. A request to print, paste, or hand over a prompt is always that kind; only an agent you launch through the harness yourself is the other. So: name no worktree path and never say where to run — pointing it at `…/worktrees/<name>` sends it to edit a tree that belongs to somebody else, which the rule against `cd` guards. Say what it starts from — `main`, or a named commit — rather than your own state, and carry every finding into the brief as a `file:line` that survives a clean checkout, along with reproductions runnable from one; a scratch fixture or a generated tree you built here does not exist for it. Exclusive path ownership still belongs in the brief but buys something different, since separate worktrees cannot corrupt each other's writes: the hazard is the merge and any shared ledger allocating IDs, where two branches taking the next `DEVENV` number collide silently and `_repo-lint` catches it. Its branch, its gates, and its merge message are its own, so say which it should reach — no integration owner is watching it.

## The return contract and what you do with it

Ask for, and hold agents to, three to seven hundred dense tokens for a routine finding, and up to two thousand only for a review or a design judgment whose reasoning is the deliverable: conclusion first; evidence as `file:line`, commands, or output, not description of evidence; decisions taken and reasoning not obvious from them; open questions and what it did not check. Name the budget in the brief — an agent told nothing writes to the larger figure, and a routine answer at that length is padding the caller pays to read. Agent-to-agent text is exempt from the response shape the Developer reads, not from these:

- **Restate nothing the brief said.** Answer what was asked, in the order asked, and stop.
- **Read `Docs/Roadmap/Developer environment upgrades/` before calling a finding new.** It often holds it, and may record the numbers it rests on as withdrawn — `DEVENV-046` had, for durations an analysis was later built on.
- **Say which numbers were measured and which inferred.** A mechanism in a measurement's voice is how an unchecked claim reaches a decision.

Completion is not correctness, and a confident summary is not evidence. Before building on a report, check one thing the agent could not have produced without doing the work — a cited `file:line`, the one command, the diff. A report that cites nothing checkable is a prompt to redo the work, not a result. Watch for two quiet failures: an agent that stopped early and reported as though it finished, and a summary that dropped the decision or open question that mattered.
