# DEVENV-033 — Conflicting color-mode warning noise

- **Status:** Candidate
- **Area:** Verification diagnostics
- **Impact:** The sandbox full-verification summary repeated more than twenty Node warnings, obscuring
  meaningful gate warnings even though the bundle proof passed.
- **Evidence:** `_ship-bundle-proof` reported that `NO_COLOR` was ignored because `FORCE_COLOR` was set
  for each of its bundle subprocesses during the 2026-09-03 acceptance run.
- **Workaround:** Read the gate status and full log past the repeated warnings.
- **Proposed change:** Trace which workflow layer supplies both variables, then set one coherent color
  policy for spawned bundle processes or deduplicate this known warning in the summary.
- **Dependencies:** Re-check after the active runtime and Studio branches land; do not change bundle
  scheduling in this slice.
- **Acceptance:** The bundle proof keeps intentional color behavior without repeating the conflict
  warning, and unrelated warnings still surface.
- **Source:** 2026-09-03 `verify-full-sandbox` acceptance run on `feat/verification-lanes`.
