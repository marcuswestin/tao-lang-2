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
   - `claude-prompt.md`: use the shared prompt plus: "Keep high effort, with Codex's current review pace as the timing yardstick. Inspect the full scoped change set, especially changed tests, validation, generated-code paths, and automation, but stop once the top findings are covered. Return at most 5 highest-impact findings that would materially change implementation, tests, merge safety, or scope. Prefer contrast with Codex: invalid assumptions, missing sequencing, ambiguous acceptance criteria, scope creep, and previous-repo behavior the plan missed. Print the review response to standard output only; do not create, write, or choose a separate output file. Do not write a comprehensive memo, restate the scope, include praise, or list low-confidence/future-work items. If there are no high-impact findings, say so directly."
4. Run both reviewers against their prompt files and save stdout/stderr under `pass-1/`:
   - `codex exec -C "$PWD" --sandbox read-only --ephemeral - < "$CODEX_PROMPT_FILE"`
   - `claude -p --effort high --permission-mode plan < "$CLAUDE_PROMPT_FILE"`
   - Keep review findings on stdout for both reviewers. Do not add Claude debug/verbose flags just to create stderr noise; the current Claude CLI has no confirmed option for printing reasoning/thinking to stderr. If the CLI later exposes a real stderr reasoning stream, enable it while keeping final findings on stdout.
5. Read saved stdout files before reconciling. Do not read saved stderr by default; stderr may contain verbose reasoning/debug streams and should be treated as diagnostic output. Read stderr only when stdout is empty, a reviewer command fails or hangs, or you need to determine whether review text was redirected there. If a reviewer produced empty stdout, report that explicitly; do not count silence as a clean review.
6. Reconcile findings in your working context. Verify each finding before acting; reviewer output is evidence, not truth. Do not create a separate reconciliation file unless Ro explicitly asks for one.
7. Apply only minimal warranted fixes. Preserve unrelated changes and ask before expanding scope.
8. Run `./agent just prep-commit` unless a broader requested workflow applies.
9. Run up to two additional reviewer passes only when the previous pass found meaningful issues, accepted fixes were applied, and you have made a deliberate, explicitly considered choice that one more pass is worth running. Never run more than three total passes.
10. Report the artifact path, fixes, skipped findings, validation, reviewer rerun rationale, and remaining risks in the final response. Do not create a separate summary file unless Ro explicitly asks for one.
11. Stop for Ro review before staging or committing any fixes. Do not hand off to a commit workflow until Ro explicitly approves the changes.
