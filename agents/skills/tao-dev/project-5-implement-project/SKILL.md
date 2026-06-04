---
name: project-5-implement-project
description: >-
  Implements a reviewed Tao project plan one numbered step at a time with tests, demo code, validation, and coherent commits.
---

# Project 5: Implement Project

Implement the reviewed plan in controlled slices.

## Rules

- Read `AGENTS.md`, `Roadmap.md`, the task folder, plan, research notes, and current git state.
- Read relevant previous repo code and docs under `~/code/tao-lang` before implementing comparable behavior; use it to understand proven approaches, then adapt only the parts that fit this repo.
- Do not copy previous repo code wholesale unless it is already perfectly written for this repo's current design.
- Work on a `feat/<Task>` branch when starting a new project branch.
- Use `Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao` only when implementation discovers the target syntax or functionality should change.
- As each target slice becomes implemented, copy the relevant Tao code into `Apps/Kitchen Sink/Kitchen Sink.tao`; keep only implemented, testable functionality in the executable app.
- Validate copied Kitchen Sink functionality through the relevant package tests and runtime/app checks.
- Implement one numbered plan step at a time.
- Split large steps into coherent commit units while preserving the plan's validation boundary.
- Keep changes scoped to the current step, and update stale docs or instructions encountered in scope.
- Run the step's validation before marking the step complete; intermediate commits may defer step-specific validation when appropriate.
- Run `./agent just prep-commit` before every commit unless Ro explicitly opts out.
- Stop on discovery that an implementation step had invalid assumptions and should be reconsidered.
- Update the task doc and `Roadmap.md` with completed or deferred discoveries.

## Output

- Branch used.
- Plan steps completed.
- Commits created.
- Validation run.
- Deferred work recorded.
