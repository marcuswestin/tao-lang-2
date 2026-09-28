---
name: progress-report
description: >-
  Plan and report progress on multi-step work. Use when the Developer asks for a progress report, status
  update, percentage done or remaining, ETA, or how much longer — and when a lengthy task is ready
  for execution, to record its step weights and report progress during the work.
---

# Progress Report

The Developer asks this to decide whether to wait, redirect, or walk away, so the first answer has to arrive
immediately and be roughly right. Accuracy comes second, and arrives second. Reporting never pauses
the work: resume the task in the same turn unless the Developer says to stop.

## The ledger

One file per task, `.artifacts/progress/<branch>.md` with `/` replaced by `-`, matching the
checkpoint convention; name it after the task when HEAD is detached. It is the only thing that
survives a compaction, so after one, trust the file over recollection.

```markdown
# Progress — narrow the tao check cache key

Started: 2026-09-21T14:02Z
Last report: 2026-09-21T15:40Z at 45%
Recalculated: 2026-09-21T15:41Z — held at 45%

| # | Step                 | Weight | Status       | Evidence |
| - | -------------------- | ------ | ------------ | -------- |
| 1 | Narrow the cache key | 25     | done         | 3f91ac2  |
| 2 | Per-app compile cost | 40     | doing, ~half |          |
| 3 | Instructions         | 20     | todo         |          |
| 4 | Land                 | 15     | todo         |          |

Basis: 1-3 are code and tests; 4 is one landing, ~6 min of machine time, measured.
```

## Write the plan when execution is ready

When a lengthy task is ready for execution and its required information and decisions are settled,
write the initial ledger before the first execution step, rather than waiting for the Developer to ask.
Use this for work expected to take more than about three steps or to run long enough for interim
reports to matter. Weights are rough on purpose: multiples of five, summing to 100, decided in under
a minute.

- **Weight by expected wall clock**, not by step count, difficulty, or how interesting the step is.
  The Developer is asking how long, not how much.
- **Look machine time up rather than guessing it.** A lane, a landing, a host gate are measured
  quantities: `.artifacts/timings/durations.json` holds per-node EMAs and
  `.artifacts/logs/<lane>/latest/summary.json` holds the last real run.
- Give the unknown step a weight and mark it unknown rather than leaving it out. A plan that omits
  the risky part reports 90% and then runs for another hour.

## Report during the work

If the Developer has not requested a progress report recently, give a brief report whenever the
ledger shows roughly another 20 percentage points completed. Include percent complete, estimated
time remaining, and what is in flight; then continue the work. Count from the last report, whether
requested or unsolicited, and avoid repeating a milestone. Update the ledger before reporting, using
the evidence already available; do not start a gate or interrupt a running one merely to report.

## When the Developer asks

Three phases, in this order, in one turn.

1. **Answer from the ledger alone.** Read that one file and nothing else — no `git`, no gates, no
   searching, no subagents. Four lines at most: percent complete, percent gained since the last
   report, time remaining, what is in flight. If the ledger is already in context, answer without
   reading anything at all.
2. **Then recalculate.** With the answer already on screen, check each step against evidence —
   commits, green lanes, files that exist — re-weight anything whose scope turned out different,
   refresh the in-flight step's fraction, and write the ledger back with `Last report` and
   `Recalculated` set. Cheap evidence only: never start a lane to answer a progress question.
3. **Speak again only if the number moved.** Report the correction when completion moved by ten
   points or more, when the time estimate changed by half or by more than ten minutes, or when the
   recalculation found a step that cannot be done at all. Otherwise say nothing — the ledger is
   updated, and the next report starts from the better number.

## What the numbers have to mean

- **Done means evidence, not belief.** A step is done when something outside your own account says
  so: a commit, a passing gate, a file on disk. Work reported complete that a real run then
  contradicted is this repository's most expensive recurring error, and a progress report is where
  it compounds fastest.
- **Separate machine time from your own.** "About 20 minutes, 12 of it a landing" tells the Developer they can
  leave the desk. "About 20 minutes" does not.
- **Widen to a range when the remaining work is unlike the finished work.** Pace measured over four
  small edits does not predict a verification lane, a host gate, or a debugging step with no bottom
  to it. Name the assumption the range rests on in a clause, not a paragraph.
- Percentages are of the effort remaining to the stopping point the Developer asked about, usually the landing.
  Name the stopping point when it is anything else.

## Edge cases

- **No ledger when the Developer asks.** Answer from context immediately, then write the ledger retroactively.
  Never make the Developer wait while you build one.
- **No multi-step work running.** Say so in a line. Do not invent a plan to have something to report.
- **Scope changed underneath you.** Re-weight in phase 2 and let the divergence rule decide whether
  it is worth saying. A plan that silently grows is how 80% stays 80% for an hour.
