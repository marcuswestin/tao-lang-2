# DEVENV-050 — `tao test` under a Git-ignored path says "No Tao tests found" without the reason

- **Status:** Candidate
- **Area:** Diagnostics
- **Impact:** A project under an ignored directory looks test-less, and the person reads it as a
  discovery bug in their project rather than an ignore rule.
- **Evidence:** `tao create "…" --ai none --yes` run from `.artifacts/tmp/create-smoke` printed
  `No Tao tests found under a-reading-list` although `a-reading-list/AReadingList.test.tao` existed;
  the same command from a temp directory outside the repository found and ran the test. `findTaoFiles`
  goes through `Repo.filesUnder`, which applies Git ignore rules inside a worktree.
- **Workaround:** Run from a path Git does not ignore, or from outside the repository.
- **Proposed change:** When discovery finds nothing but the directory holds `.tao` files, say that
  Git-ignored paths are skipped and name the matching rule.
- **Dependencies:** None.
- **Acceptance:** `tao test` on an ignored directory that holds a `.test.tao` file prints a message
  naming the ignore rule.
- **Source:** 2026-09-04 `tao create` work.
