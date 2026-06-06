---
name: subagents-review
description: >-
  Request focused multi-agent or extra-model review of Tao changes with Codex or Claude reviewers, then verify only confirmed findings.
---

# Subagents review

Request independent review over the requested changes, then fix only confirmed issues. Do not commit.

## Process

1. If there are no scoped changes, stop.
2. Prefer native Codex subagents for Codex review when available. Use the project `reviewer` custom agent from `agents/agent-types/reviewer.toml` symlinked into `.codex/agents/reviewer.toml`, or a built-in read-only reviewer/explorer, and give it only the scoped diff, requirements, and files it needs.
3. When Ro asks for additional models, request Claude reviews explicitly through its CLI or UI, using read-only/plan mode where supported. `codex`, `claude`, and `agy-ide` are allowed through `./agent` for this purpose.
4. Use a bounded shared prompt:
   - Review these changes for bugs, regressions, missed requirements, missing tests, stale instructions/docs, and unclear code.
   - Do not edit files, stage changes, run validation, or perform destructive operations.
   - Lead with findings ordered by severity and include file:line references.
   - Return at most 5 high-confidence findings; say directly when there are none.
5. Keep reviewer output available in the thread or save concise stdout artifacts under `.artifacts/skills/subagents-review/...` when the review is substantial. Avoid saving or reading verbose stderr unless stdout is empty, the reviewer failed, or stderr appears to contain the actual review.
6. Reconcile findings in your working context. Verify each finding before acting; reviewer output is evidence, not truth. Do not create a separate reconciliation file unless Ro explicitly asks for one.
7. Apply only minimal warranted fixes. Preserve unrelated changes and ask before expanding scope.
8. Run `./agent just prep` unless a broader requested workflow applies.
9. Run up to two additional reviewer passes only when the previous pass found meaningful issues, accepted fixes were applied, and one more pass is worth the cost. Never run more than three total passes.
10. Report reviewers used, fixes, skipped findings, validation, rerun rationale, and remaining risks in the final response.
11. Stop for Ro review before staging or committing any fixes. Do not hand off to a commit workflow until Ro explicitly approves the changes.
