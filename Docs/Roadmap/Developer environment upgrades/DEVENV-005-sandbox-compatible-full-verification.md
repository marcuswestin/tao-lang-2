# DEVENV-005 — Sandbox-compatible full verification

- **Status:** Resolved
- **Area:** Verification lanes
- **Impact:** A managed shell cannot run the six browser and native UI host lanes, but duplicating gate lists would
  drift and could overstate coverage.
- **Evidence:** Browser/native Studio gates require host capabilities denied by the managed sandbox;
  all other full-verification gates were measured as compatible.
- **Workaround:** Run `just verify-full` from a normal terminal.
- **Proposed change:** Add gate-owned unsandboxed metadata and one shared full-verification membership
  used by both `verify-full` and `verify-full-sandbox`.
- **Dependencies:** Implemented by `feat/verification-lanes` commit `f5705e9f`.
- **Acceptance:** The sandbox lane passes, names exactly six skips, omits dependency installation, and
  never claims full verification passed.
- **Source:** 2026-09-03 verification-lanes brief.
