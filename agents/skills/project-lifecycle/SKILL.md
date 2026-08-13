---
name: project-lifecycle
description: >-
  Run a Tao roadmap project phase: select or decide the next project, research a project, write or review a project plan, implement a plan, review an implementation, or merge a feature branch into main.
---

# Project Lifecycle

Use only the phase Ro requested. Do not advance to another phase without clear authorization.

## Shared Context

- Read `Roadmap.md`, the active task folder, current Git state, and relevant source before acting.
- Use `old-repo-porting` when comparable behavior exists in `~/code/tao-lang` and `runtime-codegen` when generated TypeScript or `TR` changes.
- Keep `Roadmap.md` current and task details in `Roadmap/<Task>/`. Archive whole completed task folders only during merge.
- Treat reviewer output as evidence. Verify findings locally and apply only confirmed, in-scope improvements.

## Phases

### Decide

Rank next-project candidates by Tao value, dependency order, risk, implementation readiness, and Ro's stated priorities. Recommend one and wait for Ro to choose before changing roadmap files.

### Research

Resolve decisions that repository evidence cannot settle and record conclusions in the task folder. Ask one focused question at a time. Define intended syntax, behavior, and test-app scope; intended syntax belongs in `Apps/WordFlower/2 - Next/` sketches (see `Apps/WordFlower/README.md`), never in executable apps.

### Plan

Write an implementation-ready plan with goals, non-goals, assumptions, numbered vertical slices, validation, exit criteria, and deferrals. Include intended syntax and the executable coverage each implemented slice will add.

### Review Plan

Review assumptions, decisions, sequencing, scope, acceptance criteria, and missing details with read-only reviewers when useful. Incorporate verified improvements and record real future work as deferrals.

### Implement

Use a `feat/<task>` branch for new project work. Implement one numbered slice at a time with focused tests and intended Tao examples. Keep task docs and app scope current. Add only implemented behavior to `Apps/WordFlower/1 - Current` or test apps; reconcile `Apps/WordFlower/3 - MVP` and `4 - Revolution` once, as the final step of an absorbed tranche. Validate each slice; stage or commit only when Ro explicitly requests it.

### Review Implementation

Compare the branch with its plan and research. Check changed paths, callers, tests, exports, generated/runtime behavior, app scope, and stale references. Fix confirmed issues, record deferrals, run focused validation, then `./agent verify`.

### Merge

Run `./agent merge-feature-preflight` and require a clean completed feature branch. Validate and push it, refresh `main`, merge current `main` back into the feature branch, validate and push again, then squash onto freshly refreshed `main`. Archive completed roadmap task folders before the squash commit. Preserve Git's squash appendix, validate before and after the commit, and push `main` before renaming the remote feature branch to `merged/...`. Finish on clean `main` with temporary worktrees and local feature branches removed.
