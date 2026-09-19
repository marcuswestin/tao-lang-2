# DEVENV-057 — `git hash-object --stdin-paths` cannot hash a directory symlink

- **Status:** Candidate
- **Area:** Verification
- **Impact:** `./agent verify` dies in `GreenTree.hashTree` before any gate runs when the working
  tree contains an untracked directory symlink.
- **Evidence:** 2026-09-07, an untracked `packages/tao-cli/modules/@tao/runtime` symlink to
  `packages/runtime` made `git hash-object --stdin-paths` exit 128 with
  `fatal: Unable to hash packages/tao-cli/modules/@tao/runtime`.
- **Workaround:** Ship a real directory and a TypeScript re-export instead of a directory symlink.
- **Proposed change:** Hash a directory symlink by its link text (or skip it after recording the
  target) so `GreenTree` can identify the working tree.
- **Dependencies:** None.
- **Acceptance:** An untracked directory symlink in the worktree does not prevent `verify-changed`
  from hashing and starting gates.
- **Source:** 2026-09-07 `@tao/runtime` CLI module wiring.
