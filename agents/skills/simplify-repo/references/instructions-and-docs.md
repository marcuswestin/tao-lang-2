# Instructions and documentation focus

## Budgets, enforced by `repo-lint`

- Root `AGENTS.md` at most 60 lines. Each `SKILL.md` at most 80 lines, with detail in reference
  files loaded on demand. Each pass aims to cut total instruction lines, never to grow them.

## Removing

- One owner per rule. A rule found in two files keeps the copy in its owner and loses the rest,
  pointer sentences included when the skill description already routes there.
- Delete prose that restates what `repo-lint`, a hook, or `./agent` output already enforces or says.
- Cut anecdotes, incident history, and calibration-period framing. A rule keeps at most a
  one-clause reason.

## Placing

- Universal constraints and routing: root `AGENTS.md`.
- Knowledge about a body of code: a nested `AGENTS.md` beside that code, so it loads by path.
  Domain skills belong there, not in `agents/skills/`.
- Conditional workflows: a skill. Workflows that share a verb become reference files of one skill
  (`git-workflow` holds committing in chunks and merging progress; `delegation` holds parallel
  implementation and review fan-out).
- Thin skills merge into their nearest owner; a skill earns its folder by having a trigger no other
  skill covers.

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
