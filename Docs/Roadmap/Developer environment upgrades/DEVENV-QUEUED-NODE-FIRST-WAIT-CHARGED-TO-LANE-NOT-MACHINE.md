# DEVENV-QUEUED-NODE-FIRST-WAIT-CHARGED-TO-LANE-NOT-MACHINE — A queued node's first wait is charged to the lane, not the machine

- **Status:** Candidate
- **Section:** External
- **Area:** Verification reporting
- **Impact:** A lane held back by machine-wide admission shows its queue position live, but the wait
  it accumulated before its first node was admitted is attributed to the lane's own capacity rather
  than to the machine. `summary.json` therefore under-reports machine contention for exactly the runs
  most affected by it, which is the file anyone reads to decide whether a slow lane was a regression
  or a busy host. The live display and the recorded artifact disagree, and the artifact is the one
  that survives.
- **Evidence:** `WorkGraph` charges a node's first wait slice to capacity; `MachineLanes`
  `describeQueuePosition` (`packages/dev/dev-src/repository-tests/MachineLanes.ts:308`) is what
  renders the position, and it is a print path, not an accounting one. Reported by the workstream
  that replaced fair-share admission, which could not reach the accounting from inside its own
  module.
- **Workaround:** Read the printed queue position while the lane runs, rather than reconstructing the
  wait from `summary.json` afterwards.
- **Proposed change:** Attribute a wait caused by machine-wide admission to the contention block, and
  a wait caused by this lane's own ceiling to capacity, so the two questions a reader has — was the
  machine busy, was my lane too narrow — are answered separately.
- **Dependencies:** Touches the `WorkGraph` reservation path and the `contention` block `MachineLanes`
  produces.
- **Acceptance:** A lane queued behind two broad lanes records that wait as machine contention in
  `summary.json`, and a lane that waited only on its own ceiling does not.
- **Source:** 2026-09-21 landing-lock performance branch.
