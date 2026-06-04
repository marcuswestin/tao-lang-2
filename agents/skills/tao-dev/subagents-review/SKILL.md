---
name: subagents-review
description: >-
  Review current changes with codex and claude, fix confirmed issues, and verify.
---

# Subagents review

Run independent `codex` and `claude` reviews over the requested changes, then fix only confirmed issues. Do not commit.

## Process

1. If there are no scoped changes, stop.
2. Create `.artifacts/skills/subagents-review/<YYYYMMDD-HHMMSS>-<slug>/prompt.md` with only the scope and reviewer instructions. Use the compact sortable local timestamp prefix so review folders appear in chronological order. Do not embed status, stats, name-status, or diffs; reviewers should inspect repo state themselves. Tell reviewers: "Review these changes for bugs, regressions, missing tests, and unclear code. Do not edit files. Do not run `./agent just prep-commit`, tests, checks, formatters, or validation commands; only inspect and report findings. Lead with findings, ordered by severity, with file:line references. When searching for text containing backticks, single-quote the shell argument or escape the backticks."
3. Run both reviewers against that prompt and save stdout/stderr under `pass-1/`:
   - `codex exec -C "$PWD" --sandbox read-only --ephemeral - < "$PROMPT_FILE"`
   - `claude -p --effort high --permission-mode plan < "$PROMPT_FILE"`
4. Reconcile findings into `reconciliation.md`. Verify each finding before acting; reviewer output is evidence, not truth.
5. Apply only minimal warranted fixes. Preserve unrelated changes and ask before expanding scope.
6. Run `./agent just prep-commit` unless a broader requested workflow applies.
7. Run one second reviewer pass only if fixes were substantial. Never run more than two passes.
8. Write `summary.md` and report the artifact path, fixes, skipped findings, validation, and remaining risks.
9. Stop for Ro review before staging or committing any fixes. Do not hand off to a commit workflow until Ro explicitly approves the changes.
