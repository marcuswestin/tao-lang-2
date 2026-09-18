---
name: delegation
description: >-
  Decide whether to hand work to a subagent, which model tier and effort it runs at, what its brief
  must contain, and how to check what it returns. Use when a task involves broad search, codebase
  exploration, web research, long command output, independent review, or two workstreams that could
  run at once, and whenever choosing between doing work yourself and spawning an agent.
---

# Delegation

Optimize wall-clock time to finish the whole task you own. Not tokens, not your own context, and not
the elegance of the split. A subagent starts with no memory of this session, pays a fixed startup
cost before its first useful tool call, and sees only the brief you write. Spend that when it buys
back more than it costs.

`parallel-implementation` owns coordinating concurrent writes once you have decided to run several
agents. This skill owns whether to delegate at all, which tier to give the agent, what the brief
says, and what you do with what comes back.

## Delegate when

- **The work compresses.** Its input is large and its conclusion is small: sweeping many files for a
  pattern, reading a long log or verify summary down to the failures, checking how five call sites
  differ, reading a page of vendor documentation for one fact. This is the strongest signal, and it
  holds even for work you could do quickly yourself, because what you would carry afterwards is
  worse than what you would carry now.
- **It is big enough to amortize.** Roughly ten or more tool calls, or fifteen thousand or more
  tokens pulled through context for a conclusion you could state in a paragraph.
- **It can run while you work.** Anything your next two or three steps do not depend on goes to a
  background agent, launched before you start your own step rather than after.
- **It wants a different model than yours.** Mechanical breadth deserves a cheaper model than the
  one reasoning about the task; a hard judgment call deserves a stronger one. Routing, below.
- **It should not be able to write.** Review, audit, and second opinions are more trustworthy from an
  agent that cannot quietly fix what it finds and then report success.

## Do not delegate when

- You know the file and roughly the line. Read it.
- The brief would take longer to write than the work takes to do, or would have to reproduce the
  conversation to make sense. If you cannot state the task without "as we discussed", do it
  yourself.
- The edits are coupled. Two agents editing one seam cost more than one agent editing both sides.
- The judgment is the point and the context is the input: naming, product semantics, deciding what
  Ro meant. Delegate the evidence-gathering, keep the decision.
- You are already at the answer and delegating is procrastination.

## Parallelism

Three to five concurrent agents is the working range. Beyond that you become the bottleneck, because
every report still has to be read and checked by you. Keep your own critical path occupied while
they run: launch, then continue, then collect. Reuse a finished agent for the next unblocked piece
rather than waiting for the whole fan-out to land.

Readers and a writer do not mix. A reader that opens a file while something else is rewriting it
sees half of it and reports a defect that was never there — that has already happened here, four
subagents into one task, and `Docs/Roadmap/Parallel agents on one machine.md` records it. Either the
fan-out is read-only, or every agent in it owns its paths exclusively under
`parallel-implementation`. Never both at once over the same seam.

## Model and effort routing

Work is routed to a tier, and the tier is spelled per harness in one place below, so that a model
release changes one table instead of every skill and profile.

| Work                                                                       | Tier                                        | Effort |
| -------------------------------------------------------------------------- | ------------------------------------------- | ------ |
| Mechanical sweeps, file inventories, single-fact lookups across many paths | fast                                        | low    |
| Codebase exploration, tracing behavior, web research, comparing call sites | standard                                    | medium |
| Running a verify lane and distilling the failures                          | standard                                    | low    |
| Implementing a slice that is already specified                             | standard, or deep when the seam is delicate | high   |
| Adversarial review, architectural judgment, root-cause dead ends           | deep                                        | xhigh  |
| Language semantics, decisions that are expensive to reverse                | frontier                                    | xhigh  |

| Tier     | Claude Code `model` | Codex CLI `model` | Cursor `model`     | Relative token cost |
| -------- | ------------------- | ----------------- | ------------------ | ------------------- |
| fast     | `haiku`             | `gpt-5.6-luna`    | `composer-2.5`     | 1                   |
| standard | `sonnet`            | `gpt-5.6-terra`   | `claude-sonnet-5`  | 2                   |
| deep     | `opus`              | `gpt-5.6-sol`     | `claude-opus-5`    | 5                   |
| frontier | `fable`             | `gpt-6-astra`     | `claude-fable-5-1` | 10                  |

Cost is the Claude family's per-token ratio, and it is the reason the default is not the top tier.
Claude Code and Codex accept `low`, `medium`, `high`, and `xhigh` for effort, spelled `effort` in a
Claude subagent profile and `model_reasoning_effort` in the Codex one. Cursor carries effort inside
the model string instead, as `claude-opus-5[effort=high]`.

This table is not only documentation. `repo-lint` rejects a profile naming a model no row offers,
and the Codex `[agents]` defaults are generated from the standard row, so a model release is an edit
here and a regeneration.

Two directions, both normal:

- **Downward.** The usual case. A deep or frontier orchestrator almost never lets a subagent inherit
  its model; inheritance is the expensive default, not the safe one. Say the tier explicitly.
- **Upward.** A standard or deep orchestrator escalates a single hard question to `oracle`: a root
  cause that has survived two attempts, a design fork with costly branches, a diagnosis you keep
  circling. One question, read-only, no mandate to fix. `oracle` defaults to deep, so name the
  frontier tier on the call when you are already there — a profile's model is its default, not its
  ceiling, and naming one on the call overrides it.

Effort is separate from tier. A stronger model at low effort beats a weaker one at high effort for
judgment, and loses for breadth.

## Choosing the tier

The table decides. When a task matches a row, take it and say which tier you chose in one line; do
not ask. Ask Ro only when the choice is genuinely uncertain and the cost of being wrong is real:

- The work fits no row, and your confidence between two tiers is low.
- You are about to spend the frontier tier, or expect the agent to run more than about ten minutes.
- The log shows the pattern already: a task like this one was re-run at a higher tier, came back
  inadequate, or was obvious overkill.

Ask as a single question with your recommendation marked, then write the answer into the routing
table above in the same task so the question does not recur. That edit is the point of asking; an
answer that only lives in one conversation was wasted.

`Docs/Roadmap/Subagent delegation/Plan - Subagent delegation.md` records what has been asked and
settled, and holds the criteria that end the calibration period and delete this clause.

## The brief

The agent sees the brief and nothing else. Every brief carries:

1. **Goal**, and why it matters to the larger task.
2. **What is already known** — paths, findings, and the things you have ruled out. This is what stops
   the agent rediscovering your last twenty minutes.
3. **Decisions already made**, so it does not silently re-decide them.
4. **Boundaries**: paths it owns, paths it must not touch, and whether it may write at all.
5. **Return format** and the length you want.
6. **Stop condition** — what "done" is, and what to do when the answer is not there.

Repository boilerplate, in every brief that touches this worktree: run from the worktree root
without `cd`; search with `rg`; do not stage, unstage, reset, or stash; do not edit
`Docs/Roadmap/Developer environment upgrades.md`, and return developer-environment findings to the
caller instead. Root `AGENTS.md` binds subagents too, including the rule against naming any agent
identity in work products.

## The return contract

Ask for, and hold agents to, a report of one to two thousand tokens:

- Conclusion first.
- Evidence as `file:line`, commands, or output, not description of evidence.
- Decisions taken and the reasoning that is not obvious from them.
- Open questions, and what it did not check.

Agent-to-agent text is exempt from the response shape Ro reads; `AGENTS.md` says so. Ask for dense,
not polite.

## What you do with the report

Completion is not correctness, and a confident summary is not evidence. Before you build on a
report, check one thing in it that the agent could not have produced without doing the work: open a
cited `file:line`, re-run the one command, look at the diff. A report that cites nothing checkable
is a prompt to redo the work, not a result.

Two failures to watch for, because they are quiet: an agent that stopped early and reported as
though it finished, and a summary that dropped the decision or the open question that mattered. Both
read as success.
