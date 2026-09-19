# DEVENV-023 — React Native test renderer convention

- **Status:** Planned
- **Area:** Companion tests
- **Impact:** Direct react-test-renderer use lacks local typings and tends to produce brittle interaction
  tests.
- **Evidence:** The companion review found no `@types/react-test-renderer`; the repository already favors
  React Native Testing Library.
- **Workaround:** Use React Native Testing Library for new tests.
- **Proposed change:** Re-check merged tests, migrate direct renderer usage where valuable, and add typings
  only if a justified low-level renderer test remains.
- **Dependencies:** Companion branch must land first.
- **Acceptance:** Tests compile without ambient gaps and assert through user-visible behavior where
  possible.
- **Source:** 2026-09-03 companion implementation briefing.
