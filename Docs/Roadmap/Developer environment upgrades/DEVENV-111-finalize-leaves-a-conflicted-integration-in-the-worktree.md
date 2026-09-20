# DEVENV-111 — `finalize` leaves a conflicted integration in the worktree and names no conflicting path

- **Status:** Candidate
- **Area:** Merge workflow
- **Impact:** When integrating `main` conflicts, `finalize` tells the author to resolve it by hand and
  names nothing to resolve, then leaves `main`'s tree in the worktree as uncommitted modifications
  and untracked files with no merge in progress. The author meets a worktree holding a change they
  did not make — here 38 deletions, 23 modifications, and 5 untracked files across `Docs/` — and no
  `MERGE_HEAD` to explain it. The safe reading is that a concurrent session wrote them, which root
  `AGENTS.md` says to preserve, so the instinct the repository teaches is the one that blocks
  recovery. Discarding them is what the state actually needs, and an author who cannot prove they are
  discardable is stuck between two rules.
- **Evidence:** 2026-09-20, `feat/agent-context-optimization-421aa5` at `9de97b90`, two commits ahead
  and two behind `main`. `./agent finalize` printed, in full:

  ```
  Integrating main conflicted; resolve it by hand and finalize again. Conflicting paths:

  error: Recipe `finalize` failed on line 226 with exit code 1
  ```

  The path list after the colon was empty. `git status --short` then reported 61 dirty tracked paths
  and 5 untracked ones, while `git rev-parse --git-dir` held no `MERGE_HEAD`. Comparing each dirty
  path against `main` showed 60 of the 61 byte-identical to it and all 5 untracked paths present in
  it; only `AGENTS.md`, the one real conflict, differed. A plain `git merge main` afterwards
  conflicted on `AGENTS.md` alone and reported it by name.
- **Workaround:** Prove the residue is `main`'s before discarding it —
  `git diff main --name-only -- <dirty tracked paths>` should name only the genuinely conflicting
  files, and `git cat-file -e main:<path>` should succeed for each untracked one. Then
  `git restore --worktree .`, move the untracked paths aside rather than deleting them, and run
  `git merge main` by hand, which names the conflicts properly.
- **Proposed change:** Leave the merge in progress so `MERGE_HEAD` and the index say what happened,
  or abort it completely so the worktree is clean; the current half state is the one reading an
  author cannot act on. Print the conflicting paths the merge reported — the message already promises
  them — and say which state the worktree was left in.
- **Dependencies:** None.
- **Acceptance:** A conflicted `./agent finalize` names every conflicting path, and afterwards
  `git status` describes either a merge in progress or a clean worktree, never uncommitted content
  the author did not write.
- **Source:** Observed while landing the subagent tool allowlists and the Bash guard hook.
