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

- Run `codexbar usage --provider all --format json --pretty` once before launching reviewers; for any provider running short this session, prefer a cheaper model, lower effort, or fewer reviewers.
- Run at least two independent read-only reviews by default:
  - `architectural-reviewer`: design-partner review of tradeoffs, alternatives, quality attributes, and recommendation.
  - Boundary/conformance reviewer: repo-pattern review focused on package ownership, instruction drift, generated/runtime boundaries, and implementation fit. Cursor is a good choice here via `cursor agent --print --mode=plan --sandbox enabled --trust --model composer-2.5` when an independent read-only model would add coverage.
- For broad or high-risk work, add focused reviewers for language semantics, runtime/codegen, roadmap sequencing, docs/ADRs, or old-repo precedent.
- Give each reviewer a narrow prompt with the mode, scope, relevant instructions, current architecture summary, and the specific review axis.
- Treat reviewer output as evidence, not truth. The main agent reconciles findings and decides which risks, alternatives, and recommendations are valid.

## Output

- Start with the current architecture summary and the important assumptions.
- Then report tradeoffs, alternatives considered, risks, recommendation, action items, deferrals, and open questions.
- Use code-review severity only for concrete conformance risks in implemented diffs.
- State when the current architecture is defensible, and explain why; do not invent objections just to be adversarial.
- Include reviewers used, artifact paths if any, and whether any durable record should be written.
