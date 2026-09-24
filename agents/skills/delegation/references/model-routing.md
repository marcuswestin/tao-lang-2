# Model routing and measurement

The routing table in `../SKILL.md` owns tier names. The repository sets Claude Code's
`CLAUDE_CODE_SUBAGENT_MODEL` to its standard tier and maps the `opus` alias with
`ANTHROPIC_DEFAULT_OPUS_MODEL`. [Claude Code's documented order](https://code.claude.com/docs/en/sub-agents)
is an explicit spawn model, the subagent definition's model, the subagent default, then the
parent's model. Do not set `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`: it overrides profile pins, including
deep reviewers. The alias mapping only affects uses of `opus`. Claude Code 2.1.280 or later is
[required for Opus 5.5](https://code.claude.com/docs/en/model-config); an older installed version
cannot establish live resolution, regardless of what the generated settings say.
Claude Code and Codex accept `low`/`medium`/`high`/`xhigh` effort in `effort` and
`model_reasoning_effort` profile fields respectively; Cursor puts effort in the model string.

[Codex subagent precedence](https://developers.openai.com/codex/subagents) gives an explicit spawn
model priority over `agents.default_subagent_model`; a custom agent file can pin its own model.
The repository generates `[agents]` from the standard row. Cursor documents
[`claude-opus-5-5`](https://cursor.com/docs/models/claude-opus-5-5) and
[`[effort=high]`](https://cursor.com/docs/subagents), but the exact combination remains a live
harness check on each installed version. Model catalog entries alone do not establish account access.

Measure cost **per successfully completed task**, including retries and reviewers. For each
subagent, record uncached input, cache writes, cached reads, and output separately; apply current
official [Anthropic](https://platform.claude.com/docs/en/models/overview) or
[OpenAI](https://developers.openai.com/api/docs/models) API prices to those quantities only as an
API-equivalent estimate. Record plan or subscription usage separately: an API-equivalent estimate
is not a bill. Compare completion and defect escape rates, review findings accepted after checking,
elapsed task time, and rework against a baseline of the same task types. A faster or cheaper spawn
does not establish a cheaper completed task. Missing usage data stays unknown.

The 2026-09-23 sample of 19 Claude subagent transcripts established an old `opus` alias
resolution and that cache reads and writes dominated its API-equivalent estimate. It did not
measure a denominator of successfully completed tasks, elapsed task time, review defects,
re-reads, or plan usage. The tier changes here have expected savings only; none are measured yet.

`./agent delegation-report` displays recent resolved models when supported hook fields or bounded
transcript metadata provide them. Spawn hooks do not share an agent ID with start hooks, so a
transcript observation cannot establish which explicit selection produced it. The startup drift
check uses fresh local catalog metadata and installed harness version; transcript mismatch warnings
are deferred until the events can be correlated without guessing.
