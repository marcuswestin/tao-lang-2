# DEVENV-007 — Per-test retry ledger and reports

- **Status:** Resolved
- **Area:** Test iteration
- **Impact:** Developers must rerun the full suite after a red run and have no durable per-test flake or
  duration evidence.
- **Evidence:** Existing timing history is per suite and Bun has no last-failed selector.
- **Workaround:** Rerun a remembered file or the complete test lane.
- **Proposed change:** Record Bun JUnit, Jest JSON, and a synthetic Tao Apps unit in a per-checkout
  ledger; add changed, retry, flake, and slow-test reports; never write an interrupted run; and bound
  retained JSONL history without losing recent reversal evidence.
- **Dependencies:** Implemented by `feat/verification-lanes` commit `f5705e9f`.
- **Acceptance:** Red/full/green fixture runs select the specified files, cold state runs everything,
  missing reports fall back honestly to process summaries, interrupted runs add no durable outcomes,
  and history compaction retains recent flake evidence.
- **Source:** 2026-09-03 verification-lanes brief.
