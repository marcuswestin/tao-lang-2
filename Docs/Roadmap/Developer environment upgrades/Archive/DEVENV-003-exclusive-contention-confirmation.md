# DEVENV-003 — Exclusive contention confirmation

- **Status:** Resolved
- **Area:** Parallel verification
- **Impact:** `jobs: 1` serializes only the retry batch; sibling worktrees can keep contending, so the
  result cannot establish whether load caused the original timeout.
- **Evidence:** The current retry leaves the caller's machine lease and every peer lane active.
- **Workaround:** Stop other worktrees and rerun the named gate manually.
- **Proposed change:** Acquire a bounded machine-wide exclusive confirmation lease that pauses new
  admissions and drains peer reservations before retrying.
- **Dependencies:** DEVENV-001; implemented by `feat/verification-lanes` commit `5512f785`.
- **Acceptance:** A multi-process test proves the retry waits for peer work and blocks new admissions;
  failure to obtain exclusivity is reported as unconfirmed contention.
- **Source:** 2026-09-03 parallel-workflow review.
- **Archived:** 2026-09-19
