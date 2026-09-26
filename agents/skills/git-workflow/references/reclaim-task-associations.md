# Reclaiming a worktree attached to an agent task

`./agent reclaim` reports the Git branch, preservation ref, and task records it can read locally.
It rechecks known task links before `--execute`, but an absent local record does not prove that no
Codex, Claude Code, or Cursor task can still use the checkout. Do this agent check before proposing
removal or running `--execute`:

1. Match the exact canonical worktree path to tasks in the Codex app, including archived tasks.
   Use `list_threads` for title, app summary, sidebar section, and path; use `read_thread` for
   creation time and recent turns. Distinguish the task's `updatedAt` metadata timestamp from its
   last conversation turn and explain the latest turn's subject. A paused task remains attached;
   do not send it a message to test liveness.
2. Inspect Claude Code's task/session list for the same path, including sessions unavailable in
   local project history. Inspect Cursor's task list for workspaces using the path. A workspace
   record alone does not establish a Cursor task's ownership or release it.
3. Report each match with path, Git branch or detached commit, provider, task ID, exact app title,
   app summary or initial request, sidebar label when available, creation time, latest conversation
   time and subject, and whether it is paused or archived. Mark fields the app cannot expose as
   unknown. Preserve the worktree while any task is attached or any provider cannot be checked.

The command's description is a bounded first-message excerpt from local history. An app summary
may be different, and a session file's modification time is not a conversation timestamp.
