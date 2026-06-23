---
name: simple-subagents-review
description: >-
  Review uncommitted Tao repo changes with exactly two simple independent reviewers, Codex and Claude, then verify findings, apply warranted fixes, and run validation. Use when Ro asks for a lightweight subagents review, two-agent review, Codex plus Claude review, or reviewer pass before commit/PR without the full review fanout/orchestration workflow.
---

# Simple Subagents Review

Run one Codex reviewer and one Claude reviewer over the current uncommitted changes, reconcile their findings, apply only warranted fixes, and validate. Do not stage, unstage, stash, commit, or otherwise change the Git index.

## Process

1. Confirm there are changes with `./agent git status --short`. If the worktree is clean, stop and say so.
2. Create a review artifact directory, then run both reviewers independently through the repo-owned review launcher. Parallel execution is fine when available, but do not use fanout, manifest planning, or extra providers.

   Review run:

   ```bash
   ./agent review new --slug simple-subagents-review
   ```

   Copy the printed directory path into `<run>`.

   Codex:

   ```bash
   ./agent review run --run <run> --reviewer codex --label codex --effort high
   ```

   Claude:

   ```bash
   ./agent review run --run <run> --reviewer claude --label claude --effort high
   ```

   The launcher writes each review to `<run>/<label>/review.md`, captures stdout/stderr/debug artifacts, emits heartbeats for long-running processes, applies timeouts, and keeps reviewer output out of the terminal. It also invokes Codex through the repo-owned read-only `codex exec` path with the known-good `service_tier="fast"` override, avoiding the direct `codex review --uncommitted` config failure.

   After both commands finish, optionally collect a compact digest:

   ```bash
   ./agent review collect --run <run>
   ```

3. Reconcile reviewer output into confirmed issues, false positives, and open questions. Treat reviewer output as evidence, not truth; verify each finding against the code before acting.
4. Apply only warranted fixes. Keep fixes scoped and minimal, preserve unrelated changes, and ask before expanding scope or doing anything destructive.
5. Run `./agent just test` unless the task or repo instructions require `./agent just verify`. If risk is narrow and a focused check is clearly enough, run the focused check first, then broaden if warranted.
6. Re-run the two reviewers once only if the accepted fixes were substantial or risky enough to need fresh eyes. This is the final pass; never run reviewers more than twice.
7. Summarize confirmed issues fixed, findings intentionally skipped and why, validation results, and remaining risks.

## Failure Handling

- If `codex` or `claude` is missing, unauthenticated, times out, or fails before producing useful review output, note the status and artifact path, then continue with the other reviewer.
- If both reviewers fail, stop after reporting the failure modes and run no speculative fixes unless Ro explicitly asks.
- Do not fall back to direct `codex review --uncommitted`; it has failed in this repo when global Codex config used an unsupported service tier and can flood the terminal with very large diffs.
