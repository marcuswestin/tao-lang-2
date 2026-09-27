# DEVENV-COMPANION-CAPTURE-REGISTRATION-FAILS-AFTER-LIVE-EDIT — Companion capture registration fails after live edit

- **Status:** Candidate
- **Section:** External
- **Area:** Companion development reload, runtime capture registration
- **Impact:** Editing runtime code during a phone review can require reopening Companion before review can continue.
- **Evidence:** During Auth Review on 2026-09-26, Studio device status recorded `UnexpectedBehaviorError: Expected: runtime capture domain ... is registered exactly once` after runtime/stdlib live edits. It also recorded a React render-time update warning involving InteractionLayersHost and TaoApp_AuthReviewClerk. The relationship between these errors and the precise reload trigger is not established. The domain name and full payload were omitted to avoid collecting form data.
- **Workaround:** Reopen Companion with the existing development-client URL and terminate its previous process; preserve the Studio session and gateway.
- **Proposed change:** Reproduce a runtime-module edit on a connected phone and trace capture-domain registration ownership across reload before changing singleton lifecycle behavior.
- **Dependencies:** A connected development Companion and an active Studio scenario.
- **Acceptance:** Runtime edits can reload the scenario without duplicate capture registration, and ordinary duplicate registration still fails as an invariant violation.
- **Source:** Physical Clerk and InstantDB review, feat/clerk-follow-through, 2026-09-26.
