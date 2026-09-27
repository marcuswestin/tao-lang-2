---
name: maintain-task-title
description: Keep the current task's sidebar title aligned with its evolving work. Use when starting or resuming a task, reaching a major milestone, or moving into a new scope. Update automatic titles directly; preserve manually edited titles and propose changes for approval.
---

# Maintain the task title

- Reassess the title when the task starts or resumes and when its main objective changes. Rename when the existing title would mislead someone scanning the sidebar. Routine steps, test runs, and small follow-ups do not need new titles.
- Name the current outcome in a short, concrete phrase, preserving useful project context. Put the distinguishing words early. Do not claim work is complete before it is, or rename a task around a brief tangent while its main objective remains active.
- Change only the current task. In the Codex app, read its title through `list_threads` or `read_thread` and rename through `set_thread_title`, omitting `threadId` to target the calling task. In Claude or another host, use its supported title tools when available; otherwise suggest the title. Do not edit app databases or rename another task to maintain this one.

## Preserve manually chosen titles

- If the user has manually edited the title, keep approval required for subsequent renames. Propose one relevant replacement and apply it only after agreement. Approval of that title does not restore automatic renaming; only an explicit request to resume automatic updates does.
- Use title-origin metadata only if it specifically distinguishes user edits from generated or agent-applied titles. A title's wording, age, or similarity to the first prompt does not prove its origin. The currently available Codex listing and reading tools may expose no title-origin field.
- Preserve a small per-task record in the existing task checkpoint or ignored task-local state: task ID, mode (`automatic`, `approval-required`, or `unknown`), last successfully applied title, last observed title, and any pending or declined proposal. Carry it through compaction and handoff. Keep different tasks' records separate.
- When a title is known to be generated or agent-maintained, update it automatically at a meaningful scope change. Read the current title again immediately before changing it. If it differs from the recorded title without a known agent rename, treat it as a possible manual edit and require approval. Never overwrite that change to restore your own title.
- On first use, or after losing the record, recover provenance from reliable metadata or known title changes in this conversation. If provenance remains unknown and the title needs changing, propose the new title once and ask whether automatic updates are welcome. Approval of just that replacement keeps future renames approval-required. If the current title is still accurate, leave it alone without asking. Continue the substantive work while waiting; absence of a reply is not agreement.
- After a successful rename, record the applied title. If the result is uncertain, read the title before retrying. If the app reports a conflicting edit, preserve it and switch to approval-required mode. Without revision-aware rename tools, a read followed by a write cannot guarantee protection against a simultaneous edit; do not claim otherwise.
- Do not repeat a declined proposal unless the scope changes materially. Keep title suggestions brief and separate from permission to do the underlying work. If title tools are unavailable, suggest the title without claiming it was changed.
