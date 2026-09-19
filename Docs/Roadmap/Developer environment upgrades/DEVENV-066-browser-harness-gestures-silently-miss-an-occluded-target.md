# DEVENV-066 — Browser-harness gestures silently miss an occluded target

- **Status:** Mitigated for offset gestures
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
- **Workaround:** None needed for offset gestures: `clickAtOffset` and `dragBy(..., { offset })` now
  scroll `nearest` rather than `center` and refuse a point that does not hit the target, naming what
  covers it.
- **Proposed change:** Extend the same hit check to centre-based `click`, `drag` and `wheel`. It was
  left off there only because those have many more call sites than could be re-proved in one branch.
- **Dependencies:** None.
- **Acceptance:** Any harness gesture whose point lands outside its target fails immediately, naming
  the covering element, instead of being absorbed by the page.
- **Source:** 2026-09-17 September remediation follow-up.
