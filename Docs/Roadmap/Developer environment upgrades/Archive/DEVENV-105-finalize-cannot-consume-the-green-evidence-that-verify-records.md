# DEVENV-105 — `finalize` cannot consume the green evidence that `verify` records

- **Status:** Resolved
- **Area:** Verification, landing workflow
- **Impact:** A complete green `verify` run cannot satisfy `finalize`, so finalization always invokes
  `just verify --complete` again. That needlessly repeats the lane and makes an unrelated dependency
  bootstrap failure capable of blocking a tree that was just proved green.
- **Evidence:** On 2026-09-19, `verify` passed 32 of 32 gates for
  `feat/merge-preflight-env-isolation`. `finalize --check` immediately reported
  `PLAN Run just verify --complete; no record already covers this tree`, and `finalize` then failed
  in the `deps` preamble before reaching a gate. `GateRunner` deliberately writes no whole-lane
  record when a lane contains a non-recordable generated-tree writer; every verification lane
  contains `_parser-gen` and `_compile-word-flower-app`. `Finalize.verifyTree` only searches
  whole-lane records, so the producer and consumer contracts could not meet.
- **Resolution:** Whole-lane evidence now carries a versioned identity for every ignored writer in
  `verify`: parser output and generator inputs, compiled-app output and declared stdlib, and both IDE
  output roots plus the installed dprint WASM. Generators still run on ordinary verification, but a
  completed lane is reusable by `finalize` only while the visible tree, toolchain, generated inputs,
  and generated outputs all match. Missing, edited, added, or deleted generated output fails closed.
- **Workaround:** None needed.
- **Proposed change:** Done as proposed without treating a Git-tree hash as generated-output proof.
- **Dependencies:** DEVENV-104 covers the separate missing `./agent` install stamp; archived
  DEVENV-100 fixed the narrower mismatch in accepted `verify-full` lane names. This entry covers
  verification evidence that `finalize` cannot consume even when the dependency tree is healthy.
- **Acceptance:** Focused GreenTree, gate-runner, catalog, and finalize tests prove unchanged evidence
  is consumed and relevant source, toolchain, installed-input, or generated-output drift invalidates it.
  Immediately after a complete green lane, `finalize --check` consumes that record rather than
  planning another `just verify --complete`.
- **Source:** 2026-09-19 merge-preflight and concurrent-dev-test remediation.
