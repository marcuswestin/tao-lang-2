---
name: project-4-review-project-plan
description: >-
  Reviews a Tao project plan with read-only subagents, then incorporates only useful planning feedback before implementation.
---

# Project 4: Review Project Plan

Review the plan before implementation starts.

## Rules

- Read the plan, research notes, `Roadmap.md`, linked local docs, and relevant source before launching reviewers.
- Use `subagents-review` skill with appropriate instructions.
- Ask reviewers to focus on invalid assumptions, poor decisions, stale docs, bad sequencing, unclear acceptance criteria, scope creep, and missing details.
- When target syntax/functionality changes, verify the plan uses `Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao` for intended code and schedules implemented slices to move into `Apps/Kitchen Sink/Kitchen Sink.tao` for tests.
- Treat reviewer output as evidence, not truth. Verify findings locally before editing.
- Incorporate feedback that improves clarity, sequencing, scope, validation, implementation safety.
- Record valid future work as deferrals; ignore weak, duplicate, speculative, or otherwise inappropriate feedback.

## Output

- Review artifact path.
- Findings incorporated, deferred, and ignored.
- Plan doc path.
