# DEVENV-NODE-WORKER-TEARDOWN-LOADS-BUN-FFI — Node worker teardown loads Bun-only process inspection

- **Status:** Candidate
- **Section:** External
- **Area:** Test compiler process cleanup
- **Impact:** A Jest suite can finish its assertions but fail teardown when a compiler worker does not exit before the graceful-stop bound.
- **Evidence:** On 2026-09-26, repetition five of `feat/git-test-timeout` failed `interaction-outline-e2e.jest-test.tsx` with `Cannot find module 'bun:ffi'`. The stack runs through `Worker.ts:285`, `CLI.stopProcessTree`, and `ProcessTree.descendantProcesses`, which chooses the Darwin FFI implementation solely by OS even under Node. The run recorded load 70.4 on 18 CPUs and two active lanes. Log: `.artifacts/logs/verify-changed/2026-09-26T04-33-43-937Z-72369-9b6b4ed9/runtime-jest.log`. This path was unchanged by the promise-assertion fix; earlier and later broad repetitions passed, but repetition ten reproduced the same teardown failure at load 53.6.
- **Workaround:** Temporarily skip the 12-test `interaction outline runtime` group in `interaction-outline-e2e.jest-test.tsx`, with its compiler lifecycle scoped inside that group, on `feat/quarantine-verification-flakes` at the Developer's request. This suspends its keyboard, selection, accessibility-label and outline integration coverage. Shared cleanup remains active for other suites, which can still reach the defect; restore this group after repairing the shared Node escalation path.
- **Proposed change:** Provide a Node-compatible process-tree inspection and signaling path on Darwin while retaining descendant cleanup and PID-reuse protection; test the escalation path directly under Node, rather than relying on host contention to reach it.
- **Dependencies:** Preserve the sandbox-safe process inspection contract in [DEVENV-068](DEVENV-068-a-child-process-cannot-execute-ps-inside-the-bash-sandbox.md). Do not silently downgrade to direct-child-only cleanup or treat denied process inspection as an empty process tree.
- **Acceptance:** A Node-hosted compiler worker that deliberately ignores graceful EOF is stopped with its owned descendants, without importing `bun:ffi` into Node and without affecting a sibling process.
- **Source:** Git-test timeout investigation and repeated full-scope verification on `feat/git-test-timeout`.
