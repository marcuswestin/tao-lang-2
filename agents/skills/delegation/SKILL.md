---
name: delegation
description: >-
  Delegate work, select subagent models and effort, write briefs, and assess returns. Use for
  broad searches, codebase exploration, web research, long outputs, independent reviews,
  background work, parallel implementation, or review fan-outs; also before first delegation or
  preparing another agent's prompt.
---

# Delegation

Optimize wall-clock time to finish the whole task. A subagent pays a startup cost and needs a self-contained brief; delegate when it saves more than it costs. This skill owns delegation, tier selection, briefs, and return checks. `references/parallel-implementation.md` owns concurrent writers; `references/review-fanout.md` owns dividing a large review.

## Delegate when

- **The work compresses**: large input, small conclusion — sweeping many files for a pattern, reading a long log down to the failures, a page of vendor docs for one fact. Holds even when you could do it quickly yourself, because what you'd carry afterwards is worse than what you'd carry now.
- **It is big enough to amortize**: roughly ten or more tool calls, or 15k+ tokens pulled through context for a conclusion you could state in a paragraph. That threshold is only recognisable once crossed, so apply it forward: before opening the third file to answer one question, hand the question over. Delegating raises total tokens, since the agent re-reads what you already know, and lowers what you carry for the rest of the session — the second is what the session is paid on.
- **It can run while you work**: anything your next two or three steps do not depend on goes to a background agent, launched before your own step rather than after.
- **Its model or effort should differ from yours**: apply the harness-specific routing below.
- **It should not be able to write**: review, audit, and second opinions are more trustworthy from an agent that cannot quietly fix what it finds and report success.

## Do not delegate when

You know the file and line (read it); the brief would take longer to write than the work takes to do, or needs "as we discussed" to make sense; the edits are coupled, so two agents on one seam cost more than one agent on both sides; the judgment is the point and the context is the input — naming, product semantics, what the Developer meant (delegate the evidence-gathering, keep the decision); or you are already at the answer and delegating is procrastination.

## Parallelism

Three to five concurrent agents is the working range; beyond that you become the bottleneck, since you still read and check every report. Launch, then continue, then collect each report as it lands rather than waiting for the whole fan-out. Hand a finished agent the next piece only when that piece needs what the agent already read: a resumed agent re-reads its whole history on every request, so an unrelated piece goes to a fresh one. Readers and a writer do not mix — a reader that opens a file while something else rewrites it reports a defect that was never there. Either the fan-out is read-only, or every agent owns its paths exclusively under `references/parallel-implementation.md`; never both over the same seam.

## Messaging another agent

A subagent you spawned is yours to talk to: its return, and continuing it with `SendMessage` to correct it, extend its task, or reuse its context, never need approval. Every other exchange waits for the Developer's approval in the current request: writing to another agent session on this machine or in the cloud, to a teammate's agent, and any relay that reaches an agent they did not point you at. `SendMessage` reaches those too and the harness cannot tell them apart, so the rule holds where no gate exists — a brief that tells a subagent to go message a third agent is the same message sent one remove away.

For those, ask when the exchange buys something a subagent of your own would not: name the recipient, what you would send, and what it unblocks, as one question the Developer can answer yes or no. An approval covers that message, not the exchange it opens; the next one asks again. Between asking and hearing back, do the rest of the task — a pending message is not a reason to idle.

## Model and effort routing

For every GPT task and tier, use the newest GPT-6 Sol available in the harness. Only routine execution with settled inputs and steps, requiring no exploration, judgment, or diagnosis, uses the newest GPT-6 Luna instead. This overrides broader fast/frontier task labels below for GPT. For Claude Code and Cursor, use the newest available release within the table's selected Claude family; preserve each tier's family. Table IDs are concrete generated defaults, not a version ceiling. Keep supported rolling aliases where offered; never invent a latest alias.

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
| frontier | `fable`             | `gpt-6.1-sol`     | `claude-fable-5-1` |
