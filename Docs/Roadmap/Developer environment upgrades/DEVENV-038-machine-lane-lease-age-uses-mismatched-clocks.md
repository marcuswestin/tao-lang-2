# DEVENV-038 — Machine-lane lease age uses mismatched clocks

- **Status:** Candidate
- **Area:** Verification coordination
- **Impact:** The six-hour age branch for CPU-lane records never activates, so a reused PID could keep
  a stale registration alive and under-allocate later verification work.
- **Evidence:** `MachineLanes.isLive` subtracts an epoch timestamp from monotonic `Time.nowMs()`, whose
  value is process-relative rather than wall-clock time.
- **Workaround:** Dead owners are still pruned by PID liveness; remove the registry record manually
  only after proving the recorded owner is gone.
- **Proposed change:** Replace age-only liveness with the process-start identity policy now used by
  named host resources, or compare timestamps in one clock domain while still protecting live owners.
- **Dependencies:** Keep separate from native-host leasing so no live long-running lane is pruned by
  age merely to fix the arithmetic.
- **Acceptance:** Tests cover dead owners, PID reuse, unknown identity, and a live owner older than six
  hours without relying on mixed wall and monotonic clocks.
- **Source:** 2026-09-04 native-host lease mutation review.
