# DEVENV-001 — Machine-wide lane admission

- **Status:** Resolved
- **Area:** Parallel verification
- **Impact:** Independently computed lane widths can oversubscribe one machine and turn timing-sensitive
  tests red.
- **Evidence:** On an 18-CPU host, simultaneous lane acquisition can let both processes initially
  reserve 18 slots; later sampling changes reporting but not capacity.
- **Workaround:** Avoid overlapping repository lanes.
- **Proposed change:** Use atomic, dynamic machine-wide slot admission with fair per-lane ceilings,
  a one-slot logical floor, bounded polling backoff, and a mutex that never evicts a live owner.
- **Dependencies:** `feat/parallel-workflow-test-compat-6fb06b`; implemented by
  `feat/verification-lanes` commit `5512f785`.
- **Acceptance:** A real two-process test observes at least two lanes while aggregate admitted slots
  never exceed the injected CPU count; malformed records cannot poison accounting and an overfull
  lane set remains able to make progress.
- **Source:** 2026-09-03 parallel-workflow review.
- **Archived:** 2026-09-19
