# DEVENV-022 — Raw Error policy for failure mocks

- **Status:** Resolved
- **Area:** Repository lint and tests
- **Impact:** The raw-`Error` ratchet treats realistic third-party rejection mocks like production errors,
  encouraging less faithful tests or unexplained allowlist entries.
- **Evidence:** Semantic-agent tests need to model third-party failures that genuinely reject with raw
  JavaScript errors. The landed repo lint uses exact-site `RAW_ERROR_ALLOWLIST` entries with required
  explanations for those faithful test mocks while continuing to scan production and test sources.
  On 2026-09-20 the focused repo-lint suite passed all 59 tests, including mutations that prove an
  unallowlisted production or test raw error still fails and an overbroad allowlist does not pass.
- **Workaround:** Keep a narrow allowlist entry with a site-specific explanation.
- **Proposed change:** Implemented as narrow, explained, exact-site allowlist entries; production
  scanning remains unchanged.
- **Dependencies:** None; the policy landed in `3fcfb39d`.
- **Acceptance:** Representative failure mocks remain faithful while a mutation introducing a production
  raw error still fails repo lint.
- **Source:** 2026-09-03 semantic-agent implementation briefing.
- **Archived:** 2026-09-20
