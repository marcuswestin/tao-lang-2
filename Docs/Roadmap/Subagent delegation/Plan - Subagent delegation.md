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

The hooks and the ask-Ro clause exist to make the first months of this workflow self-correcting. They
are temporary by design.

`./agent delegation-report` answers four questions: which profiles are actually used, whether callers
name a tier or inherit one, what effort the subagents ran at, and how long they took. An inherited
model is the signal worth watching, because the guidance asks for an explicit tier and inheritance is
how the expensive default returns.

The report reconciles events rather than trusting any one of them. Only the spawning call knows the
model and the brief; only the subagent's own start and stop carry the id that bounds a duration; and
`effort` means different things on the two — the caller's on a spawn, since the subagent has not
started, and the subagent's on a stop. Where a field never arrives the report says so instead of
inferring it.

Ask Ro when the routing table has no row for the work and confidence between two tiers is low, when
the frontier tier or a long run is at stake, or when the log already shows the pattern — a task like
this one re-run at a higher tier, a result that came back inadequate, or evident overkill. Every
answer is written into the routing table in the same task, and recorded below.

Calibration ends when the evidence says the table is right: roughly twenty logged delegations across
several tasks, with no correction from Ro and no routing-table edit forced by a miss. At that point
delete the ask-Ro clause from the skill, remove the three delegation hooks from
`.rulesync/hooks.jsonc`, and keep `./agent delegation-report` only if the log still earns its cost.

### Record

Nothing asked yet. Each entry: the date, the choice, what Ro decided, and the table edit it produced.

## Remaining slices

| Slice | Outcome                                                                                                                                                                      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B     | Saved workflow scripts for the recurring fan-outs: tranche review and squash-merge audit.                                                                                    |
| C     | Cross-vendor second opinion, Claude calling `codex exec` and the reverse, opt-in per request and off by default.                                                             |
| D     | A benchmark of three or four representative tasks timed with and without delegation, used to tune the thresholds the skill now states from research rather than measurement. |

Slice A landed: Codex takes `[agents]` defaults generated from the standard row of the routing
table, and Cursor takes the profiles through rulesync into `.cursor/agents/`, so all three harnesses
read one source. Cursor's own permission and worktree files stay hand-maintained.

Two of the Cursor model identifiers are inferred rather than quoted. Cursor's subagent documentation
spells ids as `claude-opus-5`, `gpt-5.6-sol`, and `composer-2.5`, and its model list offers Claude
Sonnet 5 and Claude Fable 5.1 without giving their config spellings; `claude-sonnet-5` and
`claude-fable-5-1` follow that convention. If Cursor rejects one, the fix is the routing table.

Slice C touches the rule in `AGENTS.md` against sending repository contents to a third party. Ro
approved it for vendors already used on this repository, which is narrower than the general
permission and must be written that way.

## Sources

Anthropic's multi-agent research system and context-engineering posts; OpenAI's practical guide to
building agents and the Codex configuration reference; Cursor's subagents documentation; Google's
ADK multi-agent patterns; Cognition's argument against multi-agent systems and its later reversal
toward parallel reads with serialized writes; practitioner accounts of research-plan-implement
phasing, oracle escalation, and the failure modes the skill's last section names.
