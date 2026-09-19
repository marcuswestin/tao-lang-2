# DEVENV-012 — Companion endpoint and harness correctness

- **Status:** Incoming
- **Area:** Companion development
- **Impact:** Endpoint preference, generated instruction ownership, and fixture source setup previously
  made device development and tests misleading.
- **Evidence:** The companion branch fixes endpoint preference/diagnostics, keeps generated instruction
  includes bare, and permits project source in the gateway harness; relevant reviewed fixes include
  `29304e7e` and `55e845f6`.
- **Workaround:** Use the branch's explicit endpoint and fixture setup.
- **Proposed change:** Re-verify the incoming behavior after merge; preserve it during shared-file
  reconciliation.
- **Dependencies:** `feat/companion-app-implementation-85b689` must land.
- **Acceptance:** Device selection tests and generated-agent checks pass on merged `main`.
- **Source:** 2026-09-03 companion implementation briefing.
