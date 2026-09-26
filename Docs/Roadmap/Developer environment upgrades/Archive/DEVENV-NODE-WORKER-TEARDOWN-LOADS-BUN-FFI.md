# DEVENV-NODE-WORKER-TEARDOWN-LOADS-BUN-FFI — Node worker teardown loads Bun-only process inspection

- **Status:** Resolved
- **Section:** External
- **Area:** Test compiler process cleanup
- **Impact:** A Jest suite can finish its assertions but fail teardown when a compiler worker does not exit before the graceful-stop bound.
- **Evidence:** On 2026-09-26, repetition five of `feat/git-test-timeout` failed `interaction-outline-e2e.jest-test.tsx` with `Cannot find module 'bun:ffi'`. The stack runs through `Worker.ts:285`, `CLI.stopProcessTree`, and `ProcessTree.descendantProcesses`, which chooses the Darwin FFI implementation solely by OS even under Node. The run recorded load 70.4 on 18 CPUs and two active lanes. Log: `.artifacts/logs/verify-changed/2026-09-26T04-33-43-937Z-72369-9b6b4ed9/runtime-jest.log`. This path was unchanged by the promise-assertion fix; earlier and later broad repetitions passed, but repetition ten reproduced the same teardown failure at load 53.6.
- **Workaround:** None needed for the repaired path; all 12 interaction-outline tests are enabled again.
- **Proposed change:** Run the fixed Darwin libproc inspector in Bun when the caller is Node, preserving descendant cleanup, start identities and explicit inspection failures.
- **Dependencies:** Preserve the sandbox-safe process inspection contract in [DEVENV-068](../DEVENV-068-a-child-process-cannot-execute-ps-inside-the-bash-sandbox.md). Do not silently downgrade to direct-child-only cleanup or treat denied process inspection as an empty process tree.
- **Acceptance:** A Node-hosted compiler worker that deliberately ignores graceful EOF is stopped with its owned descendants, without importing `bun:ffi` into Node and without affecting a sibling process.
- **Source:** Git-test timeout investigation and repeated full-scope verification on `feat/git-test-timeout`.

- **Repair (2026-09-26, feat/repair-verification-flakes):** One fixed libproc inspector runs directly under Bun and through a bounded Bun subprocess under Node. The request is JSON data, not source; response validation and explicit host errors prevent failed inspection from becoming an empty tree. Microsecond start identity, deepest-first signaling and escaped descendants remain covered. `worker-node-teardown.jest-test.ts` deliberately ignores EOF and TERM, forces Worker.stopCommand escalation under Node, proves the escaped descendant is reaped, and leaves a sibling (including a stale-identity signal attempt) alive. Restoring the original ProcessTree implementation reproduces `Cannot find module 'bun:ffi'` through Worker.ts:285; the repair passes. All 12 interaction-outline tests are restored. Node requires Bun on inherited PATH, already a compiler-worker requirement. Evidence: `.artifacts/investigation/node-teardown-original-mutation.log`.

- **Acceptance evidence (2026-09-26):** Ten consecutive uncached `./agent verify-changed --no-cache` runs passed on the repair branch, selecting both verification and developer CLI suites. No original 120-second subprocess timeout recurred; the repaired suites passed their initial attempts. Run one separately recorded a 30-second runtime-journey timeout that passed its isolated retry; that observation has its own open entry. Repetitions are recorded in `.artifacts/investigation/repair-acceptance.json`.
- **Archived:** 2026-09-26
