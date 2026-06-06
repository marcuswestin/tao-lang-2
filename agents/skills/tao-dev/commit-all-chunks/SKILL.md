---
name: commit-all-chunks
description: >-
  Commit all uncommitted changes in small, self-contained pieces with an appropriate message each. Commits only (no code edits without approval).
---

# Commit all chunks

Commit all uncommitted changes in small, self-contained pieces, with an appropriate commit message for each piece.

Make no further changes to the codebase—only commits. If you need a code change, ask first.

Prefer the smallest self-contained commits first.
Commit message bullet lists must use one bullet per line with no blank lines between bullets.

## Process:

First run `./agent just prep`, then:

1. Determine the smallest next chunk to commit
2. Stage it
3. Commit it
4. Repeat until done

Do not run `./agent just prep` again between chunk commits when no files have changed since the initial validation. If any command or workflow step changes files before the next commit, run `./agent just prep` again before committing those changed files.
