# DEVENV-HOST-EFFECT-LINT-BASELINE-FINDINGS — Host effect lint has baseline findings

- **Status:** Candidate
- **Section:** External
- **Area:** Host-testing effect enforcement
- **Impact:** The opt-in effect-boundary lane fails on existing participating files, leaving the
  repository without a green baseline for assessing new host effects.
- **Evidence:** `test-host lint` on 2026-10-06 reported 19 findings: 11 `@shared/test` imports in
  Bun test files, four calendar reads in `ManagedMobileDiagnostics.test.ts`, and four raw timer
  calls in `AppiumMobileClients.ts` and `ManagedMobileGrant.ts`. Re-running the pure linter on
  these files from main `c8a997842` reproduced the same file/message multiset; removing an unused
  import shifted the two mobile-client line numbers by one. Report:
  `.artifacts/host-testing/6636d331-b6c8-4ee2-99c3-0e2de11fb9a7/effect-boundary.json`.
- **Workaround:** Compare findings against the starting commit and report the existing baseline;
  do not treat this comparison as a passing lint lane.
- **Proposed change:** Clarify the participating test boundary and migrate existing effects to
  named adapters where they belong. Keep the enforcement contract and its self-tests intact.
- **Dependencies:** Coordinate timer changes with the active process-lifecycle work.
- **Acceptance:** The intended participating sources pass the lane, while deliberate forbidden
  effects still fail its enforcement tests.
- **Source:** 2026-10-06 UI interaction driver review and baseline diagnostic.
