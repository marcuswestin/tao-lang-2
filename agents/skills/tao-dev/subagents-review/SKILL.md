---
name: subagents-review
description: >-
  Review current changes with codex and claude, fix confirmed issues, and verify.
---

# Subagents review

Run independent `codex` and `claude` reviews over the requested changes, then fix only confirmed issues. Do not commit.

## Process

1. If there are no scoped changes, stop.
2. Create `.artifacts/skills/subagents-review/<YYYYMMDD-HHMMSS>-<slug>/prompt.md` with only the scope and shared reviewer instructions. Use the compact sortable local timestamp prefix so review folders appear in chronological order. Do not embed status, stats, name-status, or diffs; reviewers should inspect repo state themselves. Include: "Review these changes for bugs, regressions, missing tests, and unclear code. Do not edit files. Do not run `./agent just prep-commit`, tests, checks, formatters, or validation commands; only inspect and report findings. Lead with findings, ordered by severity, with file:line references. When searching for text containing backticks, single-quote the shell argument or escape the backticks."
3. Create per-agent prompt files from that scope:
   - `codex-prompt.md`: use the shared prompt as-is.
   - `claude-prompt.md`: use the shared prompt plus: "Keep high effort, but be selective. Return at most 5 highest-impact findings that would materially change implementation, tests, merge safety, or scope. Prefer contrast with Codex: invalid assumptions, missing sequencing, ambiguous acceptance criteria, scope creep, and previous-repo behavior the plan missed. Do not write a comprehensive memo, restate the scope, include praise, or list low-confidence/future-work items. Stop once the top findings are covered. If there are no high-impact findings, say so directly."
4. Run both reviewers against their prompt files and save stdout/stderr under `pass-1/`:
   - `codex exec -C "$PWD" --sandbox read-only --ephemeral - < "$CODEX_PROMPT_FILE"`
   - `claude -p --effort high --permission-mode plan < "$CLAUDE_PROMPT_FILE"`
5. Reconcile findings in your working context. Verify each finding before acting; reviewer output is evidence, not truth. Do not create a separate reconciliation file unless Ro explicitly asks for one.
6. Apply only minimal warranted fixes. Preserve unrelated changes and ask before expanding scope.
7. Run `./agent just prep-commit` unless a broader requested workflow applies.
8. Run one second reviewer pass only if fixes were substantial. Never run more than two passes.
9. Report the artifact path, fixes, skipped findings, validation, and remaining risks in the final response. Do not create a separate summary file unless Ro explicitly asks for one.
10. Stop for Ro review before staging or committing any fixes. Do not hand off to a commit workflow until Ro explicitly approves the changes.
