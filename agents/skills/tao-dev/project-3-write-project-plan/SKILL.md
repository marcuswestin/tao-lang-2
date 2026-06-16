---
name: project-3-write-project-plan
description: >-
  Writes an implementation-ready Tao project plan from completed task research and updates the roadmap task folder.
---

# Project 3: Write Project Plan

Convert settled research into implementation slices.

## Rules

- Read `Roadmap.md`, the task folder, research notes, linked local docs, and relevant source.
- Use the `old-repo-porting` skill when planning from comparable behavior under `~/code/tao-lang`.
- Keep the top-level task in `Roadmap.md`, and move or delete other captured details into `Roadmap/<Task>/Plan - <Task>.md`.
- Include goals, non-goals, assumptions, numbered implementation steps, validation, and deferrals.
- Make each numbered step a meaningful implementation slice, not a tiny checklist item and not the whole project.
- For each step, include concrete work, likely commit units, validation, and exit criteria.
- Express intended syntax and functionality changes in the plan and related test app purpose docs when useful.
- Plan when each implemented slice should be added to `Apps/Kitchen Sink/Kitchen Sink.tao` for executable testing.
- When a plan changes generated Tao TS, include how generated code stays minimal and uses default `TR` from `@runtime/TR` instead of emitted reusable helpers.
- Plan updates to each touched `Apps/Test Apps/<App Name>/Purpose.md`, including what functionality belongs in that app and what behavior-test metadata may be needed later.
- Do not implement the plan in this step.

## Output

- Plan doc path.
- Roadmap updates.
