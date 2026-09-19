# DEVENV-004 — Studio smoke port-block ownership

- **Status:** Resolved
- **Area:** Studio verification
- **Impact:** Worktrees whose hashes collide can both pass the free-port probe and then race to bind the
  same server/preview pair.
- **Evidence:** Socket reservations are released before the smoke child starts.
- **Workaround:** Supply distinct shards manually or serialize Studio smoke runs.
- **Proposed change:** Hold an atomic, stale-owner-aware cross-worktree block lease for the full smoke
  process, including explicit shards, and fail closed when either the lease or port probe is unavailable.
- **Dependencies:** Implemented by `feat/verification-lanes` commit `5512f785`; no Studio product
  changes.
- **Acceptance:** Two processes cannot own the same shard/worker block concurrently and the lease is
  released after success, failure, or interruption.
- **Source:** 2026-09-03 parallel-workflow review.
