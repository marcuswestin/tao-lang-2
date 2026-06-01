---
name: subagents-review
description: >-
  Review uncommitted repo changes with the codex and claude CLIs, reconcile their findings, apply warranted fixes, and run tests. Use when the user asks to review current changes with subagents/reviewers before commit or PR.
---

# Subagents review

Run two independent reviewers (`codex` + `claude`) over the current changes, act on their findings, and verify. Run the reviewers at most twice.

## Process

1. Confirm there are changes: `git status --short`. If clean, stop and say so.
2. Run both reviewers in parallel (same prompt, independent passes):

```bash
codex review --uncommitted
```

The current Codex CLI rejects a custom prompt when `--uncommitted` is used. If that changes in a future CLI, use: `Review all uncommitted changes for bugs, regressions, missing tests, and unclear code. Lead with findings, ordered by severity, with file:line references.`

```bash
claude -p --permission-mode plan "Review all uncommitted changes in this repo (git diff HEAD plus untracked files) for bugs, regressions, missing tests, and unclear code. Do not edit files. Lead with findings, ordered by severity, with file:line references."
```

3. Reconcile findings into: confirmed issues, false positives, and open questions. Treat reviewer output as evidence, not truth — verify each finding against the code before acting.
4. Apply only warranted fixes. Keep them scoped and minimal; preserve unrelated changes. Add/update tests when behavior changes. Ask before scope-expanding or destructive edits.
5. Run `just test` (or the narrowest relevant check, then broader if risk warrants).
6. Re-run the reviewers a second time only if the fixes were substantial or risky enough to need fresh eyes. This is the final pass — never run them more than twice.
7. Summarize: confirmed issues fixed, findings intentionally skipped (and why), validation results, remaining risks.

## Notes

- If a CLI is missing or unauthenticated, note it and continue with the other reviewer.
- Make no commits; this skill reviews and fixes only.
