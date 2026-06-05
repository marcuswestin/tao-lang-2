---
name: project-6-review-implementation
description: >-
  Reviews implemented Tao project changes against the plan, fixes confirmed issues, validates, and prepares the branch for merge.
---

# Project 6: Review Implementation

Review implemented work before merge preparation.

## Rules

- Read the plan, research notes, task docs, `Roadmap.md`, linked local docs, and current git state.
- Use the `old-repo-porting` skill when reviewing comparable behavior under `~/code/tao-lang`.
- Use `subagents-review` for the implemented changes with the plan, task docs named in the review scope, and initial parent commit hash.
- Ask reviewers to focus on bugs, regressions, missed requirements, missing tests, stale docs, and unclear generated/runtime behavior.
- Verify generated Tao TS stayed minimal and uses default `TR` from `@runtime/TR` for reusable runtime functionality where practical.
- For Kitchen Sink changes, verify target-only code stayed in `Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao` until implemented, and implemented target slices were copied into `Apps/Kitchen Sink/Kitchen Sink.tao` with validation.
- For test-app changes, verify each touched app has `Apps/Test Apps/<App Name>/Purpose.md` and that new Tao code fits that purpose or the purpose file was updated.
- Treat reviewer output as evidence, not truth. Verify findings before editing.
- Fix only confirmed issues. Preserve unrelated work and ask before expanding scope.
- Record valid deferred work in the task doc and `Roadmap.md`.
- Ignore weak, duplicate, out-of-scope, or speculative findings.
- Run relevant validation after fixes, then `./agent just prep-commit` before final handoff or review-fix commits.
- Run another review pass only when accepted fixes have been applied and only if the previous pass found meaningful issues.

## Output

- Review artifact path.
- Findings incorporated, deferred, and ignored.
- Commits created, if any.
- Validation run.
