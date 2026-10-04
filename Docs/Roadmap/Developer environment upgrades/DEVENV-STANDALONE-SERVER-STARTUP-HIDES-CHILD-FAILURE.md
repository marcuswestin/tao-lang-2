# DEVENV-STANDALONE-SERVER-STARTUP-HIDES-CHILD-FAILURE — Standalone server startup hides child failure

- **Status:** Candidate
- **Section:** Deferred
- **Area:** Standalone CLI test diagnostics
- **Impact:** A failed server startup becomes a 30-second port-announcement timeout without the captured child output, making environment failures hard to distinguish from product failures.
- **Evidence:** On 2026-10-04, `./agent verify-changed` reported sandbox socket-binding restrictions in two suites and a port-announcement timeout in `build-clean-cli.test.ts`. The standalone suite timed out again when run alone in the sandbox, but the identical `./agent test-file packages/cli/tao-cli/cli-tests/build-clean-cli.test.ts` passed all three tests with host access. The fixture captures child output at lines 112–113, but its initial readiness wait at lines 116–120 omits that output and does not report early child exit. The exact child failure in the sandbox remains unconfirmed. Logs: `.artifacts/logs/agent/verify-changed/2026-10-04T19-33-54-446Z-50677.log`, `.artifacts/logs/agent/test/2026-10-04T19-36-04-859Z-72321.log`, and `.artifacts/logs/agent/test-file/2026-10-04T19-38-37-265Z-87775.log`.
- **Workaround:** Run the existing test through an approved host-capable workflow; authorized landing performs full host verification.
- **Proposed change:** Detect early child exit during the initial port-announcement wait and include bounded captured output in startup failures. Keep genuine startup errors distinct from sandbox restrictions; do not widen permission policy.
- **Dependencies:** None
- **Acceptance:** A deliberately failing child reports its exit and original diagnostic promptly; a live child that never announces a port retains bounded timeout diagnostics; the valid standalone host server still passes containment checks.
- **Source:** Install timing and unchanged-file preservation verification on `feat/install-timing-cache`.
