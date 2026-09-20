# DEVENV-105 — `finalize` cannot consume the green evidence that `verify` records

- **Status:** Candidate
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
  whole-lane records, so the producer and consumer contracts cannot meet.
- **Workaround:** Preserve the complete verification summary and hand the ready branch to a person
  who can finish from an unsandboxed, dependency-healthy shell; rerunning `finalize` does not reuse
  the gate-level proof.
- **Proposed change:** Give `finalize` a sound way to consume a completed `verify` run that includes
  generated-tree writers, without treating generated output as a fact described only by the Git
  tree hash.
- **Dependencies:** DEVENV-104 covers the separate missing `./agent` install stamp; archived
  DEVENV-100 fixed the narrower mismatch in accepted `verify-full` lane names. This entry covers
  verification evidence that `finalize` cannot consume even when the dependency tree is healthy.
- **Acceptance:** Immediately after `verify` passes on an unchanged tree, `finalize --check` reports
  that verification is already covered and `finalize` does not invoke `just verify --complete`.
- **Source:** 2026-09-19 merge-preflight and concurrent-dev-test remediation.
