# DEVENV-041 — Nested gate-runner tests inherit the live machine registry

- **Status:** Resolved
- **Area:** Test reliability
- **Impact:** `./agent verify` could time out two otherwise millisecond-scale gate-runner tests, including
  on its isolated retry, because the nested runner waited for capacity held by its enclosing lane.
- **Evidence:** The JSON-summary and artifact-trail tests each hit their 15-second test timeout during a
  three-lane, 32.9-load verify run, then both passed as part of the focused 221-millisecond suite when
  no outer lane owned the shared registry.
- **Workaround:** Run the gate-runner test file outside a repository verification lane.
- **Proposed change:** Give every nested `runGates` fixture its own temporary machine-registry root so a
  unit test cannot discover or wait on real repository lanes.
- **Dependencies:** Resolved on `feat/freehand-ui-sketching-implementation`.
- **Acceptance:** The focused gate-runner suite and `./agent verify` pass while another registered lane
  is present; the tests that intentionally model contention continue to use their explicit fixtures.
- **Source:** 2026-09-04 verification of the verify-full reliability fixes.
- **Archived:** 2026-09-19
