# DEVENV-012 — Companion endpoint and harness correctness

- **Status:** Resolved
- **Area:** Companion development
- **Impact:** Endpoint preference, generated instruction ownership, and fixture source setup previously
  made device development and tests misleading.
- **Evidence:** The companion branch fixes endpoint preference/diagnostics, keeps generated instruction
  includes bare, and permits project source in the gateway harness; relevant reviewed fixes include
  `29304e7e` and `55e845f6`.
- **Workaround:** Use the branch's explicit endpoint and fixture setup.
- **Proposed change:** Re-verify the incoming behavior after merge; preserve it during shared-file
  reconciliation.
- **Dependencies:** Resolved by the current endpoint-selection and generated-adapter implementation.
- **Acceptance:** Device selection tests and generated-agent checks pass on merged `main`.
- **Resolution (2026-09-20):** Reverified at `7b7dc0bc`: the companion-device suite passed 52/52,
  including preferred `/open` and fallback behavior, and fresh `./agent setup` regenerated the harness
  adapters without a tracked diff.
- **Source:** 2026-09-03 companion implementation briefing.
- **Archived:** 2026-09-20
