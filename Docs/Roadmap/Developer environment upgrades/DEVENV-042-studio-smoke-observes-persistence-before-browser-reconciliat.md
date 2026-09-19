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
- **Workaround:** The full-verification graph reports `studio-smoke-simulated-user` as explicitly skipped;
  `just studio-smoke packages/dev/studio-smoke/studio-simulated-user.test.ts` reproduces it, and the deterministic catalog tests
  in the same file plus the native and canary lanes remain active.
- **Proposed change:** Run the complete journey ten consecutive times from a normal Terminal, retain
  its hit-tested preconditions and single-shot mutations, investigate any remaining nondeterminism,
  then remove the quarantine only when that acceptance is green.
- **Dependencies:** Product fixes and lane diagnostics landed with the Figma-at-home strides plan.
- **Acceptance:** `studio-smoke-simulated-user` completes the Draw, Snap, Unsnap, overlap-confirmation, and
  Undo sequence in ten consecutive normal-terminal runs before it rejoins automatic full verification.
- **Source:** 2026-09-04 normal-terminal merge verification, the explicit quarantine decision, and the
  2026-09-04 lane diagnostics from the Figma-at-home strides work.
