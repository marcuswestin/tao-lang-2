# DEVENV-002 — Structured timeout and retry outcomes

- **Status:** Resolved
- **Area:** Verification diagnostics
- **Impact:** Graph-enforced timeouts can miss retry selection, while a deterministic retry failure can
  retain the original machine-contention label.
- **Evidence:** Graph timeouts are stored in `state.reason`, retry selection inspects only output, and
  retry output is appended to the original attempt before classification.
- **Workaround:** Inspect the original and retry logs manually.
- **Proposed change:** Record structured failure causes and a separate retry attempt; classify the final
  attempt rather than concatenated output.
- **Dependencies:** `feat/parallel-workflow-test-compat-6fb06b`; implemented by
  `feat/verification-lanes` commit `5512f785`.
- **Acceptance:** A graph timeout is selected for confirmation, and an assertion failure on retry is
  reported as a repository failure. A successful exclusive retry is accepted as green but remains
  visibly retried, while a failed retry appears once with no stale manual-retry advice.
- **Source:** 2026-09-03 parallel-workflow review.
