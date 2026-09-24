# Plan - Subagent delegation

Agents working in this repository should delegate to subagents by default wherever delegation wins,
choose the model tier deliberately in both directions, and reach that judgment without asking. This
document holds the program: what has landed, what the calibration period is for, and what remains.

The operative guidance lives in the `delegation` skill and the `Delegation` section of root
`AGENTS.md`. Nothing here restates it. When this document and the skill disagree, the skill wins.

## Why

Delegation was undocumented, so it happened by instinct. Three things were consistently missed: that
the strongest reason to delegate is keeping a large input out of the caller's context rather than
running work in parallel; that a subagent inherits the caller's model unless told otherwise, which
makes the most expensive model the accidental default for mechanical work; and that a subagent's
report is a claim about work, not evidence of it.

The research behind the decision rule is summarised in the sources below. The two findings that
shaped it most: coding parallelises less than research does, so reads fan out and writes stay
single-threaded; and useful concurrency is bounded by the orchestrator's own reading speed, not by
how many agents can be spawned.

## Landed

- `agents/skills/delegation/SKILL.md` — the decision rule, the routing table and its per-harness
  model mapping, the brief, the return contract, and what the caller does with a report.
- `agents/subagents/` — `scout`, `web-researcher`, `verifier`, `oracle`, and `implementer` join the
  two reviewers, each naming its model rather than inheriting one.
- Root `AGENTS.md` gained a `Delegation` section carrying the always-on triggers, and gave up the
  duplicate ledger rule that used to live under developer-environment feedback.
- `parallel-implementation` now owns only concurrent writes and points at the skill for the rest.
- Three hooks in `.rulesync/hooks.jsonc` write one file per event under
  `.artifacts/delegation/events/`; `./agent delegation-report` summarises them. One file per event
  rather than appended lines because concurrent agents are the designed case, and concurrent appends
  of kilobyte payloads interleave and destroy both records.
- `repo-lint` checks the profiles, the skills, and the routing table against each other.

## Calibration

The hooks and the "ask the Developer" clause exist to make the first months of this workflow self-correcting. They
are temporary by design.

`./agent delegation-report` answers four questions: which profiles are actually used, whether callers
name a model or leave selection to a profile, harness default, or inheritance, what effort the
subagents ran at, and how long they took. It shows resolved models only when a hook or bounded
transcript metadata establishes one. An omitted spawn model is not itself evidence of inheritance.

The report reconciles events rather than trusting any one of them. Only the spawning call knows the
model and the brief; only the subagent's own start and stop carry the id that bounds a duration; and
`effort` means different things on the two — the caller's on a spawn, since the subagent has not
started, and the subagent's on a stop. Where a field never arrives the report says so instead of
inferring it. Spawn and start events have no shared agent ID, so the report cannot attribute a
resolved model to one spawn; startup drift warnings use local model metadata and installed harness
version until that seam has supported correlation.

Ask the Developer when the routing table has no row for the work and confidence between two tiers is low, when
the frontier tier or a long run is at stake, or when the log already shows the pattern — a task like
this one re-run at a higher tier, a result that came back inadequate, or evident overkill. Every
answer is written into the routing table in the same task, and recorded below.

Calibration ends when the evidence says the table is right: roughly twenty logged delegations across
several tasks, with no correction from the Developer and no routing-table edit forced by a miss. At that point
delete the "ask the Developer" clause from the skill, remove the three delegation hooks from
`.rulesync/hooks.jsonc`, and keep `./agent delegation-report` only if the log still earns its cost.

### Compaction threshold experiment (deferred)

Claude Code [supports](https://code.claude.com/docs/en/model-config) `autoCompactWindow` values from
100,000 to 1,000,000 tokens. A local Rulesync generation check confirmed that
`claudecode.autoCompactWindow: 272000` reaches `.claude/settings.json`. The setting is currently
unset; 272,000 is a proposed experiment, not an established cost improvement. On a native
one-million-token model, it could compact substantially earlier than the documented default near
967,000 tokens.

The 2026-09-23 sample of 19 Claude subagent transcripts supplies a cost-category observation, but
no usable baseline for compaction count or `preTokens`, completed-task cost, post-compaction
re-reads, or quality. Before enabling 272,000, record those values for comparable completed tasks,
including retries and reviewer work. For each task, separate cached reads, cache writes, uncached
input, and output in an API-equivalent estimate, and record plan usage separately. Then compare
the same task types with the threshold enabled, along with elapsed time, rework, and accepted review
findings. Revert the threshold if cost per successfully completed task rises, re-reads or
compactions rise without a quality gain, or quality falls. Keep it only if completed-task evidence
shows a gain without weaker review.

### Record

Nothing asked yet. Each entry: the date, the choice, what the Developer decided, and the table edit it produced.

## What the later slices did

Slice A landed: Codex takes `[agents]` defaults generated from the standard row of the routing
table, and Cursor takes the profiles through rulesync into `.cursor/agents/`, so all three harnesses
read one source. Cursor's own permission and worktree files stay hand-maintained.

Two of the Cursor model identifiers are inferred rather than quoted. Cursor's subagent documentation
spells ids as `claude-opus-5`, `gpt-5.6-sol`, and `composer-2.5`, and its model list offers Claude
Sonnet 5 and Claude Fable 5.1 without giving their config spellings; `claude-sonnet-5` and
`claude-fable-5-1` follow that convention. If Cursor rejects one, the fix is the routing table.

Slice B landed as the `review-fanout` skill: the unit of review for a squash-merge audit and for a
tranche, the two-pass rule that September's audit earned, and the reconciliation that follows. It
stopped short of the saved workflow scripts it was scoped to include — see the open question below.

Slice C landed as the `second-opinion` skill, with the carve-out written into `AGENTS.md` narrowly:
The Developer asks for it in the current request, the vendor is one already configured here, and secrets never
go. The invocation is proved as far as this machine allows — `codex exec` authenticates, resolves
`gpt-5.6-sol` at high effort, and honours `-s read-only`, then stops at an account usage limit that
resets 2026-09-19. It also needs an unsandboxed shell, because the Bash sandbox denies
`ab.chatgpt.com:443`.

Slice D is deferred, and the reason is evidence rather than time. It would time representative tasks
with and without delegation, but `Docs/Roadmap/Parallel agents on one machine.md` measured one
unchanged `verify --complete` at 89s and at 207s depending only on what else the machine was doing.
A delegation speedup of the size worth measuring is smaller than that variance, so the benchmark
would produce noise and dress it as a threshold. Run it once load-aware admission lands, on a quiet
machine.

## Open question for the Developer

Slice B was scoped to include saved `Workflow` scripts for the two fan-outs, and they are not here.
Three things argued against shipping them unasked, and none is decisive alone:

- The `Workflow` tool is Claude Code's. This repository just spent slice A making the three harnesses
  read one source, and a script only one of them can run cuts against that.
- An agent cannot run one without the Developer's opt-in, so it would land unproven in a repository where
  nothing else does.
- A squash-merge audit at September's scale is forty-four review agents and roughly two hundred
  verification agents. `Parallel agents on one machine.md` measures this machine at twice
  oversubscription with twelve lanes; that fan-out is the contention problem, not a use of it.

The `review-fanout` skill already carries the procedure, and any harness can execute it with ordinary
subagents at the three-to-five concurrency the `delegation` skill sets. A script would buy repeatability
on top of that. Worth having once load-aware admission lands, and worth one supervised run before it
is trusted.

## Sources

Anthropic's multi-agent research system and context-engineering posts; OpenAI's practical guide to
building agents and the Codex configuration reference; Cursor's subagents documentation; Google's
ADK multi-agent patterns; Cognition's argument against multi-agent systems and its later reversal
toward parallel reads with serialized writes; practitioner accounts of research-plan-implement
phasing, oracle escalation, and the failure modes the skill's last section names.
