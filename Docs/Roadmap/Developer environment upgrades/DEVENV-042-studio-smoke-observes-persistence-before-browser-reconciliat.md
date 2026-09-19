# DEVENV-042 — Studio smoke observes persistence before browser reconciliation

- **Status:** In progress
- **Area:** Test reliability
- **Impact:** The simulated Studio journey blocks otherwise green merge verification at synthetic
  sketch interactions, so it cannot yet serve as reliable merge evidence.
- **Evidence:** Hit-test diagnostics added to the lane on 2026-09-04 exposed real toolbar, gesture,
  rerender, interleaved-Snap, editor-ownership, source-identity, geometry, and transaction defects.
  Those product fixes now have focused coverage, including a real pointer-release drag-one-in target.
  The lane has not yet supplied the required ten consecutive complete normal-terminal runs, so it
  remains reliability evidence in progress rather than a green merge gate.
- **Follow-up evidence (2026-09-19):** The real-host prototype branch runs this gate in full
  verification. Run `2026-09-19T21-12-44-724Z-65256-5362fda1` timed out waiting for a sketch catalog
  transition after 62 seconds, with two lanes overlapping and peak load 96 on 18 CPUs. An immediate
  isolated `./agent studio-smoke packages/dev/studio-smoke/studio-simulated-user.test.ts` passed all
  four tests in 15.77 seconds. This is further reliability evidence, not proof of a shared root cause
  or that contention caused this failure; the original log remains under `.artifacts/logs/verify-full/`.
  A second full run, `2026-09-19T21-20-15-827Z-7571-cea3f64a`, passed 41 gates and failed this same
  unsnap transition at test line 658: the catalog showed all five rectangles unsnapped instead of
  the selected rectangle with three remaining snapped. No other lane was registered; load peaked
  at 92.9. Both full receipts remain failed evidence; the standalone pass did not settle the cause.
  Inspection found that the test selected an option before its settle helper waited through board
  replacement. The new select could lose that selection, and the product correctly interprets empty
  selection as unsnap-all. The test now prepares its selection in the same browser turn as the
  successful board-generation check, before the existing single real click. Assertions are unchanged.
  The corrected focused journey passed all four tests in 14.38 seconds.
  The final `.artifacts/logs/verify-full/latest/summary.json` records validation of this narrow fix;
  this does not establish the broader ten-run reliability acceptance below.
  Full run `2026-09-19T21-27-48-281Z-47873-ffe742c3` passed this journey in 46.1 seconds and all other
  host/test gates. Its sole failure was stale raw-error allowlist lines, subsequently refreshed and
  validated by the complete commit gate recorded at `.artifacts/logs/verify/latest/summary.json`.
- **Workaround:** Retain the failed run and retry this journey alone with
  `./agent studio-smoke packages/dev/studio-smoke/studio-simulated-user.test.ts` before deciding
  whether it is a persistent product regression. A passing retry does not erase the original failure.
- **Proposed change:** Run the complete journey ten consecutive times from a normal Terminal, retain
  its hit-tested preconditions and single-shot mutations, investigate any remaining nondeterminism,
  then remove the quarantine only when that acceptance is green.
- **Dependencies:** Product fixes and lane diagnostics landed with the Figma-at-home strides plan.
- **Acceptance:** `studio-smoke-simulated-user` completes the Draw, Snap, Unsnap, overlap-confirmation, and
  Undo sequence in ten consecutive normal-terminal runs before it rejoins automatic full verification.
- **Source:** 2026-09-04 normal-terminal merge verification, the explicit quarantine decision, and the
  2026-09-04 lane diagnostics from the Figma-at-home strides work.
