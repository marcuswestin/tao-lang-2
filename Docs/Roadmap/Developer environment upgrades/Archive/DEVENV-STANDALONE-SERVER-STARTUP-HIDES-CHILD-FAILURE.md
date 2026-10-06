# DEVENV-STANDALONE-SERVER-STARTUP-HIDES-CHILD-FAILURE — Standalone server startup hides child failure

- **Status:** Resolved
- **Section:** Deferred
- **Area:** Standalone CLI test diagnostics
- **Impact:** A failed server startup becomes a 30-second port-announcement timeout without the captured child output, making environment failures hard to distinguish from product failures.
- **Evidence:** On 2026-10-04, `./agent verify-changed` reported sandbox socket-binding restrictions in two suites and a port-announcement timeout in `build-clean-cli.test.ts`. The standalone suite timed out again when run alone in the sandbox, but the identical `./agent test-file packages/cli/tao-cli/cli-tests/build-clean-cli.test.ts` passed all three tests with host access. The fixture captures child output at lines 112–113, but its initial readiness wait at lines 116–120 omits that output and does not report early child exit. The exact child failure in the sandbox remains unconfirmed. Logs: `.artifacts/logs/agent/verify-changed/2026-10-04T19-33-54-446Z-50677.log`, `.artifacts/logs/agent/test/2026-10-04T19-36-04-859Z-72321.log`, and `.artifacts/logs/agent/test-file/2026-10-04T19-38-37-265Z-87775.log`.
- **Workaround:** Run the existing test through an approved host-capable workflow; authorized landing performs full host verification.
- **Proposed change:** Shared standalone readiness waits check spawn errors, signals, and every exit code before and after readiness reads. Early failures report the original child verdict with bounded captured output; live children retain a deadline and startup diagnostics. Apply this to static-server port/response waits and installed-CLI watch/Metro acceptance. Permission policy is unchanged.
- **Dependencies:** None. Implemented on `feat/test-process-termination`, 2026-10-06.
- **Acceptance:** On `feat/test-process-termination` on 2026-10-06, six deterministic startup fixtures passed: early exit 0, failure 19 despite a ready marker, missing executable, signal despite a ready marker, healthy readiness, and a live no-port deadline with captured output. Each fixture cleans its child in finally. The real `build-clean-cli.test.ts` passed all three tests, including static-server containment. Installed-CLI acceptance in a fresh host remains separate from this local source proof; the historical sandbox failure cause remains unconfirmed.
- **Source:** Install timing and unchanged-file preservation verification on `feat/install-timing-cache`.
- **Archived:** 2026-10-06
