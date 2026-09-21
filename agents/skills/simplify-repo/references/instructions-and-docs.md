# Instructions and documentation focus

## Budgets, enforced by `repo-lint`

- Root `AGENTS.md` at most 11,500 characters, `packages/AGENTS.md` 6,000, each `SKILL.md` 12,000,
  with detail in reference files loaded on demand. Each pass aims to cut total instruction size,
  never to grow it.
- The budget counts characters, not lines, because these files are long paragraph bullets: a line
  budget caps how many bullets there are and says nothing about how much each one carries. At the
  old 80-line budget `delegation/SKILL.md` held 11,594 characters and `verification-lanes/SKILL.md`
  5,894 — both compliant, one twice the size of the other. Folding two bullets together no longer
  clears a budget.

## Removing

- Delete prose that restates what `repo-lint`, a hook, or `./agent` output already enforces or says.
- Cut anecdotes, incident history, and calibration-period framing. A rule keeps at most a
  one-clause reason.

## Placing

`agent-instructions` owns where a rule goes. Workflows that share a verb become reference files of
one skill (`git-workflow` holds committing in chunks and merging progress; `delegation` holds
parallel implementation and review fan-out); a thin skill merges into its nearest owner only when a
trigger no other skill covers survives the merge.

## Rules into code

For each mechanical rule pick the enforcement point and delete the sentence:

| Rule kind                                        | Enforcement point                          |
| ------------------------------------------------ | ------------------------------------------ |
| Commit message content, branch state             | git hooks installed by `./agent setup`     |
| Source conventions, doc structure, budgets       | `repo-lint` convention table               |
| Generated harness files stale                    | `repo-lint` against `./agent setup` output |
| Shell habits (`grep -r`, `cd` prefix, pipe exit) | PreToolUse hook in `.rulesync/hooks.jsonc` |
| Subagent brief boilerplate                       | subagent-start hook                        |
| Recovery steps                                   | the failing command's own output           |

New hooks warn. Promoting one to blocking is Ro's decision.

## Documentation

- One archive, `Docs/Archive/`, grouped as `Plans/`, `Explorations/`, `Reports/`, with a README of
  at most 15 lines on how to add to it. Archived documents are kept, never deleted, and frozen.
- Archive a roadmap document when its work has landed or it reads as a closed report.
- Overlapping live explorations merge into one document per topic. Ro signs off the merge list
  before any merge.
- The developer-environment ledger moves only together with the `repo-lint` rule that checks it.
