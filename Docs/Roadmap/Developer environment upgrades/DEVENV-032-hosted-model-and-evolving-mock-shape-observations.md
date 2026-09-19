# DEVENV-032 — Hosted model and evolving mock-shape observations

- **Status:** Closed
- **Area:** Optional development services
- **Impact:** A hosted model was unavailable during one proof, and AI SDK v7 required updated mock shapes.
- **Evidence:** The semantic-agent briefing records both conditions; neither blocks local deterministic
  repository tests.
- **Workaround:** Use deterministic local doubles and current SDK contracts.
- **Proposed change:** Reopen only for a reproducible repository-owned setup or diagnostic gap.
- **Dependencies:** External service availability and third-party SDK versions.
- **Acceptance:** Core tests remain independent of hosted-model availability and mocks compile against the
  installed SDK.
- **Source:** 2026-09-03 semantic-agent implementation briefing.
