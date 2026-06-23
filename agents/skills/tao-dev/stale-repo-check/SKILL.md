---
name: stale-repo-check
description: >-
  Checks the Tao repo for stale references after renames, removals, workflow changes, roadmap updates, or instruction edits, then fixes or reports active stale code/docs.
---

# Stale Repo Check

Find stale code, docs, instructions, and workflow references after a change.

## Process

1. Identify the current scope from the user request, current diff, recent commits, and changed files. Build a short list of old terms and current terms, such as removed commands, renamed functions, deleted files, key bindings, recipe names, branch names, or validation commands.
2. Run targeted searches with `./agent rg` over active code, docs, and skills first. Use `./agent git diff --name-status` and `./agent git status --short` to orient the search. Search archives separately when useful, but treat archive/research hits as historical unless they still instruct current work.
3. Check for stale imports, exports, deleted-file references, renamed helper names, stale roadmap key lists, obsolete Just recipes, old validation commands, stale branch/worktree workflow text, generated artifact references, and current instructions that contradict the implementation.
4. Fix active stale references directly when the intended current wording or behavior is clear. Leave historical archive text unchanged unless it is currently used as an instruction or Ro explicitly asks to rewrite history.
5. Report ignored archive/reference hits separately from fixed active stale references. If no active stale references are found, say that clearly.
6. Run `./agent just verify` after fixes that touch code, instructions, or workflow docs unless a broader workflow already provides validation.
