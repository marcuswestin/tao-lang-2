# DEVENV-095 — Verification in a freshly created worktree can never hit a green record

- **Status:** Candidate
- **Area:** Verification lanes
- **Impact:** A green record is stored per checkout and keyed on the resolved `.devenv/profile`
  alongside the tree hash. A worktree created on the fly has neither: an empty store, and a toolchain
  that resolves to the value documented as never matching. So any command that verifies inside a
  scratch worktree runs stone cold by construction — no whole-lane record, no per-gate reuse — and
  additionally pays a full `bun install`, because every `verify*` recipe depends on `deps`. The cost
  is invisible at the call site: the command looks like it is reusing the caching the repository just
  built, and is not.
- **Evidence:** `GreenTree.ts` stores records under the per-checkout `.artifacts/verify/green` and
  keys them on `toolchain` beside `treeHash`, with `NO_TOOLCHAIN` described in its own comment as a
  distinct value that never matches one; `Justfile`'s `verify-full` and its siblings all declare
  `: deps`. Found while landing the serialized-landing work: an implementation that verified the
  squash inside its disposable integration worktree was correct and would have silently defeated the
  green-record reuse, so the lane was moved back to the invoking worktree instead.
- **Workaround:** Verify in the invoking worktree and prove the scratch tree equals it, which is what
  `merge-with-main` now does — its preflight already requires `origin/main` to be an ancestor of the
  feature branch, so the squash tree is the feature tree by construction and the tree-equality
  assertion re-proves it from Git.
- **Proposed change:** If more commands come to need verification in scratch worktrees, the green
  store needs either a machine-wide location keyed as it already is, or a toolchain resolution a bare
  worktree can satisfy. Neither is worth doing for one caller; this entry exists so the next caller
  finds the constraint before paying for it.
- **Dependencies:** `GreenTree.ts` owns the store and its key; DEVENV-092 owns the contention this
  interacts with.
- **Acceptance:** Either no repository command verifies in a worktree it created, or a record proved
  in one checkout is reusable from another at the same tree and toolchain.
- **Source:** 2026-09-19 serialized-landing implementation.
