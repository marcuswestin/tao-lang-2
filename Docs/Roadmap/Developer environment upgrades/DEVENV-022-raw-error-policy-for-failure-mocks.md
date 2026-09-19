# DEVENV-022 — Raw Error policy for failure mocks

- **Status:** Planned
- **Area:** Repository lint and tests
- **Impact:** The raw-`Error` ratchet treats realistic third-party rejection mocks like production errors,
  encouraging less faithful tests or unexplained allowlist entries.
- **Evidence:** Semantic-agent tests need to model third-party failures that genuinely reject with raw
  JavaScript errors.
- **Workaround:** Keep a narrow allowlist entry with a site-specific explanation.
- **Proposed change:** Decide between an explicit test-only exemption and a typed helper that documents
  third-party failure simulation; do not weaken production scanning.
- **Dependencies:** Semantic-agent tests must land first.
- **Acceptance:** Representative failure mocks remain faithful while a mutation introducing a production
  raw error still fails repo lint.
- **Source:** 2026-09-03 semantic-agent implementation briefing.
