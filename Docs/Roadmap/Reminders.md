# Reminders

Dated things worth raising with Ro when their day comes. `./agent board` prints every reminder whose
date has arrived, so one reaches a person through a command they already run rather than through
memory. Some work can only be judged after time has passed, and a note left in a plan is read by
whoever opens that plan, which is nobody on the day it matters.

One line each, as `- YYYY-MM-DD — what to do, and what it depends on`. The date is when it becomes
worth raising, not a deadline. Nothing expires on its own: a reminder is due every day until someone
deletes its line, because a reminder that stops asking has failed at its only job. Delete the line in
the change that acts on it.

- 2026-09-27 — Re-measure agent context usage and compare against the 2026-09-20 baseline, to find
  out whether the subagent tool allowlists and the output-discipline hook actually moved anything.
  The baseline to beat, measured over 2026-09-13 to 09-20 across 46 main and 229 subagent sessions:
  main request context 294k median and 615k p90, subagent 135k median, session start 64k for a main
  agent and 52k for a subagent, `cat`/`sed -n`/`git show`/`git diff` at 42% of all Bash output
  characters, and 16% of Bash calls opening with a `cd` or assignment prefix. Read the same fields
  from the transcripts under `~/.claude/projects/-Users-ro-code-tao-lang-2*`: per assistant message,
  `message.usage` summed over `input_tokens`, `cache_creation_input_tokens` and
  `cache_read_input_tokens` is the context of that request, and `/subagents/` in the path separates
  the two populations. A week is the shortest span that holds enough sessions to compare. Read
  `.artifacts/logs/hook-overrides.jsonl` in the same pass: every `# hook-ok:` line is a refusal rule
  an agent judged wrong, and a rule that collects overrides should be narrowed or dropped rather
  than defended.
