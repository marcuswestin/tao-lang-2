---
name: architectural-review
description: >-
  Run Tao architectural review, architecture review, design partner, tradeoff review, or conformance review workflows for plans, proposals, or implemented diffs; use when Ro wants architectural judgment rather than ordinary bug review.
---

# Architectural review

Use this for Tao architecture review before implementation or after implementation. Act as a constructive design partner: challenge assumptions, compare alternatives, name tradeoffs, and recommend a path without becoming a gatekeeper by default.

## Boundaries

- Use for architecture-significant work: package ownership, language surface, compiler/runtime boundaries, roadmap sequencing, long-term maintainability, or broad design tradeoffs.
- Do not use as a substitute for ordinary bug, test, or stale-code review; use `subagents-review` or `subagents-review-stringent` for that.
- Keep reviewers read-only. Reviewers do not edit, validate, stage, unstage, stash, reset, commit, or perform destructive operations.
- Report in-thread by default. Suggest ADRs, task-doc updates, or roadmap notes only when the review uncovers a durable decision worth preserving; do not create files unless Ro asks.

## Grounding

- Read the supplied plan, proposal, diff, or artifact, then inspect live repo truth: root/nested instructions, relevant source, nearby patterns, package boundaries, tests/fixtures, and `Roadmap.md` or `Spec/` docs when they bear on the decision.
- For commit-range reviews, freeze the exact range in the prompt, such as `HEAD~2..HEAD`, and include commit summaries, changed files, touched architecture levels, and the key diff commands used. Do not let reviewers fall back to the current working-tree diff unless that is the requested scope.
- Use `old-repo-porting` only when comparable previous-repo behavior or migration precedent matters.
- Identify the architecture level being reviewed: language semantics, package/pipeline slice, runtime/codegen contract, app/test fixture shape, dev automation, roadmap sequencing, or documentation/decision record.
- Prefer Tao-specific criteria over generic cloud or enterprise architecture checklists unless those criteria map directly to the repo risk.

## Modes

- Design review: use before implementation to evaluate whether the proposed architecture fits Tao's language model, ownership boundaries, sequencing, and future evolution.
- Conformance review: use after implementation to evaluate whether the diff still matches the intended architecture, avoids parallel abstractions, and preserves package/runtime boundaries.

## Review Axes

- Layering and ownership: package responsibilities, validator-vs-compiler ownership, runtime reuse vs generated helpers, exported APIs, feature-sliced files, and avoidance of parallel abstractions.
- Language coherence: syntax, semantics, diagnostics, formatter/compiler/runtime behavior, Kitchen Sink target flow, and whether the design fits Tao as a UI-app language.
- Evolution path: roadmap ordering, migration cost, future slices, fitness checks that could become tests or audits, and whether future agents will understand and safely extend the design.

## Multi-Agent Workflow

- Try `./agent ai-usage --provider all --json` once before launching reviewers when budget matters. If repo command policy rejects the command, do not bypass `./agent`; note the skipped budget check and size the reviewer wave conservatively.
- Prefer progress-aware orchestration for multi-agent runs: `./agent review new --slug <short-name>`, then `./agent review plan --run <run-dir> --profile architecture`, then `./agent review fanout --run <run-dir> --manifest <run-dir>/manifest.recommended.json`, then `./agent review collect --run <run-dir>`. Inspect each reviewer subdirectory's `review.md`, `status.json`, `events.jsonl`, `stdout.*`, and `stderr.log` before deciding a reviewer is stalled.
- Run at least two independent read-only reviews by default. The architecture profile should include:
  - Architecture/design-partner review of tradeoffs, alternatives, quality attributes, and recommendation.
  - Boundary/conformance review focused on package ownership, instruction drift, generated/runtime boundaries, and implementation fit.
- For broad or high-risk work, add focused reviewers for language semantics, runtime/codegen, roadmap sequencing, docs/ADRs, or old-repo precedent by editing the generated manifest or running a targeted follow-up. Let `./agent review plan` choose Codex Spark for narrow focused lenses when normal Codex session budget is low and Spark windows have room.
- Give each reviewer a narrow prompt with the mode, scope, relevant instructions, current architecture summary, and the specific review axis.
- For Gemini in plan mode, assume it may not run shell commands and may not read ignored `.artifacts` paths. Pass the scope and key diff excerpts inline in the prompt instead of asking Gemini to inspect an artifact path or run `git diff` itself.
- Count only substantive reviewer artifacts. A command that exits successfully but writes an empty or near-empty review is not a completed review; keep the artifact as evidence and launch a replacement reviewer.
- Do not leave reviewer sessions running after enough substantive reviews have completed. Collect usable outputs, interrupt or otherwise close stalled extras, and mention failed, empty, or interrupted reviewers separately from reviewers used for conclusions.
- Treat reviewer output as evidence, not truth. The main agent reconciles findings and decides which risks, alternatives, and recommendations are valid.

## Review Runner Gotchas

- `codexbar usage` can exit nonzero while still printing useful provider JSON mixed with unavailable-provider errors. Use the usable provider entries instead of treating the command as fatal.
- The repo-owned `./agent review` runner is useful for architecture passes: create a run with `./agent review new --slug <slug>`, then use lenses such as `architecture` and `api-boundary`.
- Count only substantive reviewer output as coverage. Empty files, one-byte files, or metadata with `status: empty` are failed coverage even if the wrapper exits successfully.
- Time-box reviewers that stall without artifacts. Stop long-running wrappers before final handoff so no review command is left running.
- If external reviewers return empty or stall, fall back to available read-only subagents and report that limitation clearly; still reconcile findings yourself.

## Output

- Start with the current architecture summary and the important assumptions.
- Then report tradeoffs, alternatives considered, risks, recommendation, action items, deferrals, and open questions.
- Use code-review severity only for concrete conformance risks in implemented diffs.
- State when the current architecture is defensible, and explain why; do not invent objections just to be adversarial.
- Include reviewers used, artifact paths if any, and whether any durable record should be written.

## Acting On Findings

- Reviewers stay read-only, but the orchestrating agent does not stop at reporting. After presenting the summary, recommendation, and action items, go ahead and act on the findings as you see fit: implement the ones you judge correct and in-scope, defer or skip the rest, and say which you did and why.
- Acting on findings never relaxes the reviewer contract: reviewers remain strictly read-only; only the orchestrating agent edits after local verification.
- Do not act blindly. Verify each finding against live repo truth (root/nested instructions, existing patterns, tests, the actual diff) before changing anything; a confident reviewer is evidence, not proof. Drop or downgrade findings the code, docs, or established conventions refute, and note when repo truth resolves an earlier open question.
- When acting, follow the usual edit, validation, and Git-safety rules: make minimal coherent edits, run `./agent just prep` or the relevant targeted checks, and never touch Git index or stash state without Ro's go-ahead.
- Escalate to Ro instead of acting when a finding implies a language-design decision, roadmap reprioritization, destructive operation, or any choice that cannot be derived safely from the repo.
