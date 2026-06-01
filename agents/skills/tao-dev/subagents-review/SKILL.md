---
name: subagents-review
description: >-
  Review current changes with codex and claude, fix confirmed issues, and verify.
---

# Subagents review

Run independent `codex` and `claude` reviews over the requested changes, then fix only confirmed issues. Do not commit.

## Process

1. If there are no scoped changes, stop.
2. Create `.artifacts/skills/subagents-review/<slug>/prompt.md` with the scope, status, stats, name-status, and full relevant diff. Tell reviewers: "Review these changes for bugs, regressions, missing tests, and unclear code. Do not edit files. Lead with findings, ordered by severity, with file:line references."
3. Run both reviewers against that prompt and save stdout/stderr under `pass-1/`:
   - `codex exec -C "$PWD" --sandbox read-only --ephemeral - < "$PROMPT_FILE"`
   - `claude -p --permission-mode plan < "$PROMPT_FILE"`
4. Reconcile findings into `reconciliation.md`. Verify each finding before acting; reviewer output is evidence, not truth.
5. Apply only minimal warranted fixes. Preserve unrelated changes and ask before expanding scope.
6. Run `./agent just check` and `./agent just test` unless a broader requested workflow applies.
7. Run one second reviewer pass only if fixes were substantial. Never run more than two passes.
8. Write `summary.md` and report the artifact path, fixes, skipped findings, validation, and remaining risks.
