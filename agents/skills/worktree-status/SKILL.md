---
name: worktree-status
description: >-
  Report Tao worktrees, reclaim verdicts, and matching harness task metadata. Use when asked for
  a worktree inventory or before considering reclaim; distinguish missing ownership evidence from
  an unused checkout.
---

# Worktree status

- Run `./agent worktree-status` from the Tao worktree root. Read its full report in the named `.artifacts/logs/agent/worktree-status/` log if the agent wrapper truncates the display.
- Show each worktree once with its verdict and latest attached task: app, title, description, creation time, and last activity time. The report states how many other tasks match; use `./agent reclaim --report-json` for every task's full metadata in its named log.
- Treat `reclaimable` as what `./agent unsandboxed reclaim --execute` would **attempt**, not a promise that Git will remove the directory. The status command never removes anything. An unreadable installed task index makes an unmatched worktree unclassified.
- Match remote or cloud tasks to a local worktree only when the local Codex task index records that exact checkout; a remote-only task has no local worktree path to match. Say when a provider's task index is unavailable instead of inferring no task exists.
