# DEVENV-066 — Browser-harness gestures silently miss an occluded target

- **Status:** Candidate
- **Section:** External
- **Area:** Studio browser harness
- **Impact:** `StudioCdp` dispatches real mouse input at a computed viewport point. When something
  else is painted there — a floating panel, a sticky gutter, a divider's overhanging grab area — the
  gesture reaches that instead, the step quietly does nothing, and the run fails many steps later at
  an unrelated `waitFor`. Four separate journey failures diagnosed on the September follow-up branch
  were this, each costing a full browser round trip to localise.
- **Evidence:** The simulated-user journey's left-divider drag landed on the floating agent panel;
  its folded-line click landed first on `.studio-divider-right`'s `::after` grab area and then on
  `.cm-gutterElement`; the keyboard journey's pending-surface click landed on nothing because the
  whole overlay inherited `pointer-events: none`. Every one presented as a timeout elsewhere.
  On 2026-10-04, the simulated-user component drag reproduced this failure: the editor-content
  rectangle extended beyond its clipping ancestors, and the correct palette payload reached the
  preview activation shield at (1186, 545). The drag-only fix intersects clipping ancestors and checks
  the actual hit target; its evaluated-DOM regression failed on the old geometry, then passed with
  the fix. The unchanged browser journey passed 3/3 with 101 assertions after the correction.
- **Workaround:** None needed for offset gestures or HTML5 `drag`: `clickAtOffset` and `dragBy(..., { offset })` now
  scroll `nearest` rather than `center` and refuse a point that does not hit the target, naming what
  covers it. `drag` selects the center of the portion visible through clipping ancestors and refuses
  an occluded endpoint before starting the gesture.
- **Proposed change:** Extend the same hit check to centre-based `click` and `wheel`. These remaining
  call sites have not been re-proved; this entry stays open for those gestures.
- **Dependencies:** None.
- **Acceptance:** Any harness gesture whose point lands outside its target fails immediately, naming
  the covering element, instead of being absorbed by the page.
- **Source:** 2026-09-17 September remediation follow-up.
