---
name: reasoning-effort-advisor
description: >-
  Review the current Tao task against the active reasoning effort at the beginning of a new task or after a meaningful focus shift, and tell Ro only when changing effort would likely improve correctness or efficiency.
---

# Reasoning Effort Advisor

Use this skill at the beginning of a new task, or when the task shifts enough that the previous effort choice may no longer fit.

## Classify the task

- `minimal`: exact mechanical edits, formatting, file moves, search/replace with no design choice.
- `low`: localized obvious edits with known implementation shape.
- `medium`: normal feature work, moderate tests, or routine repo workflow decisions.
- `high`: compiler, parser, validator, runtime, cross-package refactors, nontrivial debugging, or behavior-sensitive automation.
- `xhigh`: language design, roadmap strategy, architecture direction, complex ambiguity, or decisions with high correctness risk.

## Advise

- Compare the recommended effort with the current effort if it is visible in the session.
- If current effort is not visible, say that only when the recommendation matters: `I cannot see the current effort. If it is below high, consider switching to high for this compiler task.`
- Briefly tell Ro when a change seems useful. Do not mention effort when the current setting appears adequate or the mismatch is minor.
- Do not block work waiting for effort changes unless Ro explicitly asks.
- Re-evaluate after a scope change from implementation to language design, from small edit to cross-package work, or from routine validation to complex debugging.
