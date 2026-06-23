---
name: subagents-review
description: >-
  Request adversarial independent multi-agent or extra-model review of changes with Codex, Claude, Cursor, Gemini, and Antigravity reviewers, then verify/consider which changes to make (if any).
---

# Subagents review

Request adversarial independent review over the requested changes, then fix only confirmed and relevant issues. Use your judgment to decide whether a suggestion should be incorporated or improved upon. Do not stage, unstage, or otherwise change the Git index.

## Process

- If there are no scoped changes, stop.
- Run `./agent ai-usage --provider all --json` once at the start when budget matters. Plain Codex Bar text output hides Spark windows; the JSON summary exposes normal Codex, Spark, and any non-Codex provider windows Codex Bar can read.
- Prefer repo-owned orchestration for substantial reviews:
  1. `./agent review new --slug <short-name>`
  2. `./agent review plan --run <run-dir> --profile standard`
  3. `./agent review fanout --run <run-dir> --manifest <run-dir>/manifest.recommended.json`
  4. `./agent review collect --run <run-dir>`
     Use `--scope-file <path>` on `review plan` when Ro gives a specific artifact or frozen scope instead of the current working-tree diff.
- Treat each reviewer subdirectory's `review.md` as the authoritative extracted review. Inspect `status.json`, `events.jsonl`, `stdout.*`, and `stderr.log` for progress, stalls, failed extraction, or debugging.
- When changing provider command guidance, first verify it locally with `./agent review smoke-providers --provider <provider>`; use `codex-spark` to verify `GPT-5.3-Codex-Spark` and `codexbar` to verify Spark budget parsing.
- Let `./agent review plan` choose provider, model, effort, timeout, and pass count from the captured budget. It prefers `gpt-5.3-codex-spark` when normal Codex session budget is low and Spark has room, treats unknown provider budget as "unknown" rather than blocked, and records selected/skipped reasons in `review-plan.json`.
- Do not hand-roll raw provider CLI commands for normal review runs. Use raw `codex`, `claude`, `cursor`, `gemini`, or `agy` commands only to debug or update the orchestration itself, after verifying the invocation with `review smoke-providers`.
- Runtime balancing is observation-only for now: use `metrics/reviewer-runtimes.jsonl`, `durationMs`, and `firstOutputMs` to inform human judgment, but do not invent automatic prompt/model/effort tuning.
- Use a bounded shared prompt:
  - Adversarially review these changes for bugs, regressions, missed requirements, missing tests, unused exported code/APIs, stale instructions/docs, and unclear code.
  - Look for ways the change can be wrong, incomplete, stale, over-broad, under-tested, or inconsistent with Tao repo instructions.
  - Inspect changed files, direct callers, package exports, tests, and at least one plausible negative path or edge case for each major subsystem touched.
  - Include the concrete files/searches that support a "no findings" conclusion.
  - Do not edit files, stage changes, run validation, or perform destructive operations.
  - Lead with findings ordered by severity and include file:line references.
  - Say directly when there are none and briefly name the main areas checked.
- Keep reviewer output available in the thread or in `.artifacts/skills/subagents-review/...` when the review is substantial. Read `review.md` first; use verbose stdout/stderr only when extraction failed, output is empty, or debugging requires it.
- Reconcile findings in your working context. Verify each finding before acting; reviewer output is evidence, not truth. Do not create a separate reconciliation file unless Ro explicitly asks for one.
- Apply only minimal warranted fixes. Preserve unrelated changes and ask before expanding scope.
- Run `./agent just verify` unless a broader requested workflow applies.
- Run up to two additional reviewer passes only when the previous pass found meaningful issues, accepted fixes were applied, and one more pass is worth the cost. Never run more than three total passes. When you do re-run, re-launch only the reviewer(s) that produced the most meaningful findings in the prior pass, not the whole set, and respect remaining provider budget when choosing which to re-run.
- Report reviewers used, fixes, skipped findings, validation, rerun rationale, and remaining risks in the final response.
- Stop for Ro review before staging or committing any fixes. Do not hand off to a commit workflow until Ro explicitly approves the changes.
