---
name: subagents-review-stringent
description: >-
  Run a deeper, broader adversarial multi-agent review gauntlet for Tao changes when Ro asks for stringent review, deep review, broad review, hard-mode review, many agents, more coverage, or to heavily check substantial work before merge; use instead of ordinary subagents-review when one pass is not enough.
---

# Subagents Review - Stringent

Use this as a stricter wrapper around `subagents-review` when Ro wants more ground covered or more depth. Before running, read `../subagents-review/SKILL.md` if it is not already loaded; its read-only reviewer rules, CLI patterns, index safety, and validation defaults still apply. This skill adds parallel lens coverage, evidence, and reconciliation requirements.

## Boundaries

- Do not use for a small ordinary review unless Ro explicitly asks for stringent, deep, broad, many-agent, or hard-mode review.
- Do not proceed if there is no scoped diff, staged set, branch comparison, or artifact to review.
- Keep reviewers read-only. Do not let reviewers edit files, stage, unstage, stash, reset, commit, run destructive commands, or run final validation.
- The main agent owns every edit, every validation run, and every decision to accept or reject reviewer feedback.
- Save reviewer prompts and meaningful outputs under `.artifacts/skills/subagents-review-stringent/<run>/`.
- Prefer the repo-owned orchestration command: `./agent review new --stringent --slug <short-name>`, then `./agent review fanout --run <run-dir> --manifest <manifest.json>`, then `./agent review collect --run <run-dir>`.

## Scope

- Establish the scope from the live working tree with `git status --short`, `git diff`, and `git diff --cached`. Reviewers launched through `./agent review` default to this working-tree scope; pass a `scopeFile` only when Ro gives a different artifact to review.
- If staged and unstaged changes coexist, say so in reviewer prompts and in the final report. Review both unless Ro explicitly scopes only one side.
- Identify the touched subsystems before launching reviewers: parser, formatter, validator, compiler, runtime, apps/fixtures, docs/roadmap, automation, instructions, or tests.
- Name direct callers, exports, generated surfaces, and fixtures that appear affected even if they are not changed.

## Review Matrix

Before building the wave, run `codexbar usage --provider all --format json --pretty` once and size the matrix to remaining per-provider budget: for providers running short this session, use fewer reviewers, cheaper models, or lower effort, and shift the heavier passes (Codex `max`, slower Google models) onto providers with ample budget. Drop a provider entirely rather than exhausting it.

Default to a first wave of four independent reviews for substantial diffs:

- `codex-correctness`: Codex reviewer with `correctness` or `api-boundary` lens for logic, data model, generated-code contracts, and package ownership.
- `codex-coverage`: Codex reviewer with `tests` or `stale` lens for negative paths, fixture drift, stale code/docs, and missed integration coverage.
- `claude-semantics`: Claude reviewer with `requirements` or `architecture` lens for semantic regressions, missing validation, and plan/spec mismatch.
- `agy-focused`: Antigravity reviewer with `regressions` or `consistency` lens, limited to the top high-confidence cross-package risks that another reviewer is unlikely to catch.
- Cursor or Gemini reviewer: optional independent `api-boundary`, `architecture`, or `consistency` lens when another read-only model would add coverage or when Claude/Antigravity is unavailable. Use Gemini CLI through `./agent gemini --skip-trust --approval-mode plan --model gemini-3.1-pro-preview --prompt "<prompt>"`.

Add focused reviewers when the diff is broad or high risk. Keep prompts distinct so agents do not all inspect the same path:

- Parser/formatter/validator grammar and diagnostic reviewer.
- Compiler/runtime/generated-TS reviewer.
- Runtime app/e2e/platform behavior reviewer.
- Test quality and fixture realism reviewer.
- Stale-reference/docs/roadmap/instruction reviewer.
- Old-repo/spec consistency reviewer when porting precedent or spec drift is relevant.

Use more reviewers for coverage, not repetition. A normal stringent run should use four to seven reviewers; go beyond that only when Ro asks for an exhaustive sweep or the diff is unusually risky.

Create the manifest as JSON with unique filename-safe labels and one reviewer per lens; leave scope to the default working-tree diff unless Ro supplies a `scopeFile`. Use `effort: "max"` for Codex on hard review passes, Claude `effort: "high"` unless the CLI supports more, Cursor through `cursor agent --print --mode=plan --sandbox enabled --trust --model composer-2.5`, Gemini through `./agent gemini --skip-trust --approval-mode plan --model gemini-3.1-pro-preview --prompt "<prompt>"`, and Antigravity with a Google Gemini model only, usually `Gemini 3.5 Flash (High)`, a narrower scope, and no more than three to five requested findings. Reserve a slower Google model such as `Gemini 3.1 Pro (High)` for explicit exhaustive sweeps or narrow follow-up questions where earlier reviewers disagree.

## Prompt Contract

Every reviewer prompt must include the scoped diff summary, changed files, relevant instructions, and a narrow review angle. Require the reviewer to:

- Inspect changed files, direct callers, exports, fixtures, and at least one negative path or edge case for every subsystem in their angle.
- Provide evidence of files, commands, or searches used to support both findings and any "no findings" conclusion.
- Lead with findings ordered by severity.
- For each finding, include severity, confidence, file:line, why it matters, a minimal fix direction, and the test or validation that would catch it.
- Avoid pure style preferences unless they hide a maintainability, safety, or correctness risk.
- Say "no findings" directly when appropriate and name the specific areas checked.
- Do no edits and no index/stash/destructive operations.

## Reconcile

- Treat reviewer output as leads, not truth.
- Verify every actionable finding locally before editing. Use file reads, searches, tests, or reasoning from current code.
- Keep a working reconciliation table in your notes or final context: reviewer, finding, accepted/rejected/deferred, and rationale. Do not create a repo file unless Ro asks.
- Accept only minimal confirmed fixes that fit the requested scope.
- Reject or defer findings that are speculative, already covered, out of scope, conflict with Ro's plan, or cost more than the risk justifies. Explain those decisions briefly.

## Rerun

- If meaningful fixes are applied, run one targeted re-review over the changed files and accepted fixes. Re-run only the reviewer(s) whose prior findings were most meaningful, not the full matrix, and respect remaining provider budget when choosing which to re-run.
- Run a second targeted re-review only if the first rerun finds a new meaningful issue.
- Do not exceed three total review rounds unless Ro explicitly asks to keep going.
- If reviewers stall, inspect whether their output artifact is growing, time-box the stalled process, stop or ignore hung reviewers when needed, and continue with completed reviewers plus local verification. Report the stall plainly.

## Validate And Report

- Run focused tests first when a confirmed finding touches a narrow subsystem.
- Run `./agent just prep` as the final validation unless Ro requested a broader workflow.
- Final response must report reviewers used, artifact directory, accepted fixes, rejected or deferred findings with rationale, validation result, rerun rationale/result, index-safety status, and remaining risks.
- Stop before staging or committing. Do not hand off to any commit workflow until Ro explicitly approves.
