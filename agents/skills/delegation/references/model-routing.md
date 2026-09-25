# Model routing and measurement

The routing table in `../SKILL.md` owns tier names. The repository sets Claude Code's
`CLAUDE_CODE_SUBAGENT_MODEL` to its standard tier and leaves the `opus` alias unpinned, so each
install resolves it to the newest Opus that install knows. [Claude Code's documented order](https://code.claude.com/docs/en/sub-agents)
is an explicit spawn model, the subagent definition's model, the subagent default, then the
parent's model. Do not set `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`: it overrides profile pins, including
deep reviewers. Claude Code 2.1.280 or later is
[required for Opus 5.5](https://code.claude.com/docs/en/model-config); an older install resolves
`opus` to an older model, and `./agent model-audit` names the install that did.
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

`./agent delegation-report` displays recent resolved models when supported hook fields or bounded
transcript metadata provide them. Spawn hooks do not share an agent ID with start hooks, so a
transcript observation cannot establish which explicit selection produced it.

`./agent model-audit` compares the table with what this machine ran instead: a Codex id the
installed catalog supersedes; a full Claude id behind a newer model of its family; and a Claude
Code install whose latest request under an alias ran an older model than another install ran,
unless its version also ran the newer one, which makes the older model a session's own choice.
Every Codex install on the machine rewrites the one catalog with the models offered to its own
version, so an id missing from it is only a note naming the version that fetched it. The audit
reads every project's transcripts, since an alias resolves per install, and also measures the
context and compactions of this checkout's sessions; `--until` ends the window early, to measure
the period before a change. Session start runs its one-day form and prints one line only when
there is a finding, which `./agent doctor` also shows. A finding is the Developer's to act on,
never a reason to edit the table unasked.
