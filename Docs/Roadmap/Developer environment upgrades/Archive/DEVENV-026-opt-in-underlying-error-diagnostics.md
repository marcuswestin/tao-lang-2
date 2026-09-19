# DEVENV-026 — Opt-in underlying error diagnostics

- **Status:** Resolved
- **Area:** CLI diagnostics
- **Impact:** `Something went wrong.` previously hid permission and subprocess causes during workflow
  diagnosis.
- **Evidence:** Main commit `1ac7edd8` adds `TAO_DEBUG_ERRORS=1`, rendering name, details, cause, and stack.
- **Workaround:** Run the failing command with `TAO_DEBUG_ERRORS=1`.
- **Proposed change:** Preserve concise default errors and the opt-in diagnostic path.
- **Dependencies:** None.
- **Acceptance:** Existing shared error tests pin both renderings.
- **Source:** 2026-09-03 main history and freehand review notes.
- **Archived:** 2026-09-19
