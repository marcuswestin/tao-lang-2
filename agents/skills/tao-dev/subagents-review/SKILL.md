---
name: subagents-review
description: >-
  Request adversarial independent multi-agent or extra-model review of changes with Codex, Claude, Cursor, Gemini, and Antigravity reviewers, then verify/consider which changes to make (if any).
---

# Subagents review

Request adversarial independent review over the requested changes, then fix only confirmed and relevant issues. Use your judgment to decide whether a suggestion should be incorporated or improved upon. Do not stage, unstage, or otherwise change the Git index.

## Process

- If there are no scoped changes, stop.
- Run `codexbar usage --provider all --format json --pretty` once at the start to read remaining per-provider budget for this session. Weight provider, model, effort, and pass-count choices to that budget: for any provider running short, be conservative — drop it from the wave, choose a cheaper model, lower effort, or skip its rerun — and lean on providers with ample budget for the heavier passes.
- Request adversarial Claude, Codex, Cursor, Gemini, and Antigravity reviews explicitly through their CLI or native tool surface (except Codex, see next item), using read-only/plan mode where supported. `codex`, `claude`, `cursor`, `gemini`, and `agy` are allowed through `./agent` for this purpose.
  - Write substantial reviewer prompts to `.artifacts/skills/subagents-review/<run>/prompt-<reviewer>.md` and pass them from the file instead of embedding long prompts in shell command arguments. This avoids recurring shell quoting issues with backticks, quotes, `$`, and leading CLI flags. Keep the prompt artifact concise enough to inspect.
  - For Claude, prefer streaming output so progress is visible while deciding whether to keep waiting. Use `./agent claude -p --verbose --effort high --permission-mode plan --no-session-persistence --output-format stream-json --include-partial-messages --include-hook-events --debug-file .artifacts/skills/subagents-review/<run>/claude-debug.log "$(./agent cat .artifacts/skills/subagents-review/<run>/prompt-claude.md)" > .artifacts/skills/subagents-review/<run>/claude.jsonl`. `--verbose` is required for `--output-format stream-json`. This streams Claude Code events and partial assistant text; it does not expose hidden model thinking. If stdout is redirected to an artifact JSONL file, inspect the file while the process runs before deciding whether it is hung.
  - For Cursor, use headless print mode in read-only planning mode with Composer 2.5: `./agent cursor agent --print --mode=plan --sandbox enabled --trust --model composer-2.5 --output-format text "$(./agent cat .artifacts/skills/subagents-review/<run>/prompt-cursor.md)" > .artifacts/skills/subagents-review/<run>/cursor.md`. Use `--output-format stream-json --stream-partial-output` instead of text when progress events are useful. Keep `--mode=plan`; `--print` can otherwise access write and shell tools.
  - For Gemini CLI, use plan approval mode and the repo-approved model: `./agent gemini --skip-trust --approval-mode plan --model gemini-3.1-pro-preview --prompt "$(./agent cat .artifacts/skills/subagents-review/<run>/prompt-gemini.md)" > .artifacts/skills/subagents-review/<run>/gemini.md`. Keep Gemini prompts focused to one lens and include the same no-edit/index-safety requirements.
  - For Antigravity, use Google Gemini models only. Keep the prompt narrower than the Codex/Claude prompts and ask for only high-confidence findings in one assigned lens. Prefer `Gemini 3.5 Flash (High)` for normal review speed: `./agent agy --sandbox --model "Gemini 3.5 Flash (High)" --print-timeout 8m -p "$(./agent cat .artifacts/skills/subagents-review/<run>/prompt-agy.md)" > .artifacts/skills/subagents-review/<run>/agy.md`. Put `agy` flags before `-p`; otherwise the CLI can treat the next flag as prompt text. Use a slower Google model such as `Gemini 3.1 Pro (High)` only when Ro asks for an exhaustive sweep or when a previous pass shows Antigravity needs deeper reasoning on a narrow issue.
- Prefer native Codex subagents for Codex review when available. Use the project `reviewer` custom agent from `agents/agent-types/reviewer.toml` symlinked into `.codex/agents/reviewer.toml`, or a built-in read-only reviewer/explorer.
  - Give Codex reviewers the relevant content of this `subagents-review/SKILL.md` in the prompt, especially the process constraints, bounded adversarial prompt, reporting requirements, and read-only/index-safety rules. Do not assume a native subagent has loaded this skill.
  - Ask for xhigh-effort adversarial review. For substantial changes, run at least two Codex passes in parallel with different angles, such as one correctness/API-boundary reviewer and one stale-code/test-coverage reviewer. If native Codex finishes much earlier than slower reviewers or returns shallow output, run one deeper Codex pass with a stricter prompt, a second native reviewer, or `./agent codex exec -m gpt-5.5 -C . --sandbox read-only --ephemeral - < .artifacts/skills/subagents-review/<run>/prompt-codex.md` when that model is available. Compensate with explicit checklists and required evidence of inspected files/searches when model selection is unavailable.
- Use a bounded shared prompt:
  - Adversarially review these changes for bugs, regressions, missed requirements, missing tests, unused exported code/APIs, stale instructions/docs, and unclear code.
  - Look for ways the change can be wrong, incomplete, stale, over-broad, under-tested, or inconsistent with Tao repo instructions.
  - Inspect changed files, direct callers, package exports, tests, and at least one plausible negative path or edge case for each major subsystem touched.
  - Include the concrete files/searches that support a "no findings" conclusion.
  - Do not edit files, stage changes, run validation, or perform destructive operations.
  - Lead with findings ordered by severity and include file:line references.
  - Say directly when there are none and briefly name the main areas checked.
- Keep reviewer output available in the thread or save concise stdout artifacts under `.artifacts/skills/subagents-review/...` when the review is substantial. Avoid saving or reading verbose stderr unless stdout is empty, the reviewer failed, or stderr appears to contain the actual review.
- Reconcile findings in your working context. Verify each finding before acting; reviewer output is evidence, not truth. Do not create a separate reconciliation file unless Ro explicitly asks for one.
- Apply only minimal warranted fixes. Preserve unrelated changes and ask before expanding scope.
- Run `./agent just prep` unless a broader requested workflow applies.
- Run up to two additional reviewer passes only when the previous pass found meaningful issues, accepted fixes were applied, and one more pass is worth the cost. Never run more than three total passes. When you do re-run, re-launch only the reviewer(s) that produced the most meaningful findings in the prior pass, not the whole set, and respect remaining provider budget when choosing which to re-run.
- Report reviewers used, fixes, skipped findings, validation, rerun rationale, and remaining risks in the final response.
- Stop for Ro review before staging or committing any fixes. Do not hand off to a commit workflow until Ro explicitly approves the changes.
