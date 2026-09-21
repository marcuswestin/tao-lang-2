# DEVENV-ADMITTED-SEAT-HELD-BY-REGISTRATION-NOT-DEMAND — An admitted seat is held by registration, not by demand

- **Status:** Candidate
- **Section:** External
- **Area:** Parallel verification
- **Impact:** A broad lane takes one of the machine's admitted seats the moment it registers, before
  it has asked to run anything. A lane that registers and then blocks — most commonly on the
  per-checkout prepare lock — holds that seat while running nothing, and under whole-lane admission
  that is half the machine's broad-lane capacity rather than a share of it. The cost of this grew
  when fair share was replaced: a wasted share used to be a fraction, a wasted seat is now a half.
- **Evidence:** `MachineLanes.acquire` registers the lane and `laneQueue`
  (`packages/dev/dev-src/repository-tests/MachineLanes.ts:281`) ranks it by `startedAt` alone;
  nothing in the ranking consults whether the lane holds any reservation. `GateRunner.ts` acquires
  the prepare lease after `MachineLanes.acquire` returns, so the window between registration and
  first admission is real and is as long as another checkout holds the prepare lock.
- **Workaround:** None. The seat is released when the lane ends.
- **Proposed change:** Let a seat lapse when its lane has held no reservation for some interval, and
  reclaim it for the next queued lane, restoring it when the lane asks again. The liveness rule is
  the hard part and is the reason this is not folded into the admission change itself: a lane that
  is briefly between nodes must not lose its place, so the interval has to be well above normal
  inter-node latency and the restoration has to be ordered against the queue rather than appended to
  it.
- **Dependencies:** Builds on the whole-lane admission in `laneQueue`; independent of the narrow-lane
  exemption.
- **Acceptance:** A lane blocked on the prepare lock for longer than the lapse interval does not
  prevent a queued lane from being admitted, and a lane that resumes within the interval keeps its
  position.
- **Source:** 2026-09-21 landing-lock performance branch, found while replacing fair-share admission.
