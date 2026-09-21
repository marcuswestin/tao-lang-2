# DEVENV-023 — React Native test renderer convention

- **Status:** Closed
- **Area:** Companion tests
- **Impact:** Direct react-test-renderer use lacks local typings and tends to produce brittle interaction
  tests.
- **Evidence:** The original companion review found no `@types/react-test-renderer`; the repository
  already favored React Native Testing Library. Reassessment on 2026-09-20 found no source or test
  import of `react-test-renderer`. Its only repository uses are the runtime-toolchain version pin and
  the dependency compatibility check; React Native Testing Library legitimately supplies the peer
  dependency. No ambient typing gap or direct-renderer migration remains.
- **Workaround:** Use React Native Testing Library for new tests.
- **Proposed change:** None; close the obsolete candidate.
- **Dependencies:** None.
- **Acceptance:** Tests compile without ambient gaps and assert through user-visible behavior where
  possible.
- **Source:** 2026-09-03 companion implementation briefing.
- **Archived:** 2026-09-20
