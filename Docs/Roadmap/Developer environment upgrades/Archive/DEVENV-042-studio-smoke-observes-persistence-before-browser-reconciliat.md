# DEVENV-042 — Studio smoke observes persistence before browser reconciliation

- **Status:** Resolved
- **Area:** Test reliability
- **Impact:** The simulated Studio journey blocked otherwise green merge verification at synthetic
  sketch interactions, so it could not serve as reliable merge evidence. Once it rejoined both
  full-verification lanes, the same nondeterminism redded those lanes rather than being skipped.
- **Evidence:** Hit-test diagnostics added to the lane on 2026-09-04 exposed real toolbar, gesture,
  rerender, interleaved-Snap, editor-ownership, source-identity, geometry, and transaction defects.
  Those product fixes have focused coverage, including a real pointer-release drag-one-in target.
  The last instance of this entry's own pattern was found and fixed on 2026-09-19, after the lane
  rejoined the graph and failed the first `verify-repo` it was part of: the Unsnap step selected a
  snapped rectangle, then waited for the board to settle before pressing. An authoritative render
  inside that wait rebuilds the whole frame including the selector, and Unsnap with nothing selected
  unsnaps the entire flow — so the lane observed a fully unsnapped sketch where it had asked for one
  rectangle back. The selection is now made inside the settled moment that presses the button, and
  reports whether it held, so a render across that moment retries rather than pressing blind.
- **Resolution:** 2026-09-20, ten consecutive green normal-terminal runs of
  `just studio-smoke packages/dev/studio-smoke/studio-simulated-user.test.ts`, 10 passed and 0 failed,
  on the tree that carries the Unsnap fix. Eight further green runs preceded them, four standalone
  and four inside `verify-full`, with no failure since the fix. The lane's `VERIFY_FULL_SKIPPED`
  entry was already gone, so nothing remained to remove.
- **Workaround:** None needed. `just studio-smoke packages/dev/studio-smoke/studio-simulated-user.test.ts`
  still runs the lane alone.
- **Proposed change:** Done as proposed — the complete journey was run ten consecutive times from a
  normal Terminal, its hit-tested preconditions and single-shot mutations retained, and the one
  remaining source of nondeterminism found and fixed.
- **Dependencies:** Product fixes and lane diagnostics landed with the Figma-at-home strides plan.
- **Acceptance:** `studio-smoke-simulated-user` completes the Draw, Snap, Unsnap, overlap-confirmation, and
  Undo sequence in ten consecutive normal-terminal runs. Met on 2026-09-20.
- **Source:** 2026-09-04 normal-terminal merge verification, the explicit quarantine decision, and the
  2026-09-04 lane diagnostics from the Figma-at-home strides work.
