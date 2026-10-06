# DEVENV-DEV-SESSION-OWNERSHIP-TESTS-FAIL-IN-AGENT-SANDBOX — Dev-session ownership tests fail in the agent sandbox

- **Status:** Open
- **Section:** Deferred
- **Area:** `packages/shared/shared-tests/project-dev-session.test.ts` and the sandboxed local lanes.
- **Impact:** `./agent verify-changed` stops at `shared` in a sandboxed agent shell on any branch
  that selects the shared suite, though nothing is wrong with the code; the agent must rerun
  unsandboxed to get past it.
- **Evidence:** On 2026-10-06, five orphan-cleanup tests failed sandboxed with `Expected: 2,
  Received: 1` at `project-dev-session.test.ts:268`, and the same file passed unsandboxed seconds
  later. `ProjectDevSession.ts:58` writes owner version 2 only when `ProcessTree.identities`
  returns both the owner's and the parent's identity, so inside the macOS sandbox at least one
  identity read comes back empty (likely the parent's, which runs outside the sandbox; unconfirmed).
- **Workaround:** Run the affected lane or file unsandboxed.
- **Proposed change:** Confirm which identity read the sandbox denies. Then have the tests either
  establish their own parent inside the sandbox or skip the version-2 paths with a stated reason
  when identities are unavailable, rather than failing an unrelated branch's gate.
- **Dependencies:** None.
- **Acceptance:** `./agent test-file packages/shared/shared-tests/project-dev-session.test.ts`
  passes, or skips with a stated reason, in a sandboxed agent shell, and still exercises the
  version-2 paths unsandboxed and in hosted `Verify`.
