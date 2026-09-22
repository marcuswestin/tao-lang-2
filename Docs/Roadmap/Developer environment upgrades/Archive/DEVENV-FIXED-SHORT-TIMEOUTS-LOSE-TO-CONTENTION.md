# DEVENV-FIXED-SHORT-TIMEOUTS-LOSE-TO-CONTENTION — A fixed short `timeoutMs` around real work loses to contention

- **Status:** Resolved — the `until` helper's default budget is 30s, the runners' deadlines nest
  strictly (a Jest journey under Bun's per-test bound under the node's idle and wall bounds) so the
  nearest bound names what hung, and `repo-lint` refuses a test's `timeoutMs` under 10,000ms, a
  `toBeLessThan` on a duration, or a `Promise.race` against a sleep unless a comment-only line
  carries `budget-ok: <reason>` (`TestBudgetConventions.ts`; landed 2026-09-22).
- **Section:** External
- **Area:** Verification diagnostics
- **Impact:** A test that bounds real, contention-sensitive work with a short fixed `timeoutMs` (or a
  fixed turn count such as `settle(20)`) passes on an idle machine and fails a landing or a `verify`
  at load averages the repository runs at routinely, reading as the branch's own defect when it is
  the test's budget.
- **Evidence:** Two instances found in one run, both at load averages near 20 on an otherwise idle
  measurement: the shared-machine `gate-runner` test removed a neighbour's lane record after
  `settle(20)`, which under load ran before the lane had registered, so the lane was admitted at once
  and recorded no wait — fixed by giving `runGates` callers an `onEvent` hook and waiting on the
  broker's `waiting` event instead of a turn count
  (`packages/testing/verification/verification-src/GateRunner.ts`,
  `packages/testing/verification/verification-tests/gate-runner.test.ts`, `5e352643`). Separately,
  `Workspace.test.ts`'s `opens one root concurrently with independent contexts that settle` timed out
  opening two workspaces for the same root concurrently — both opens finish in well under a second
  alone — and was fixed by raising the budget to 10 seconds rather than by removing the wait
  (`packages/compiler/compiler-tests/workspace/workspace.test.ts:208-224`).
- **Workaround:** Re-run the failing test alone on an idle machine to confirm it is sound, then treat
  a fixed short `timeoutMs` around otherwise-real work as a contention artifact rather than a defect
  in the branch under test.
- **Proposed change:** Where the work has an observable milestone (an event, a state change), wait on
  that instead of a clock, as the `gate-runner` fix does. Where it genuinely has none, size the
  budget for a busy host rather than a quiet one, as the workspace fix does, and say why in a comment
  next to the number so a later reader does not tighten it back down. A lint that flags a bare
  `timeoutMs` literal under some threshold with no such comment is one way to make the second case
  self-documenting; not built in this run.
- **Dependencies:** DEVENV-073 and DEVENV-077 are the same class of load-sensitive test assumption
  found earlier; this entry is about the general pattern rather than a specific suite.
- **Acceptance:** No further instance of a fixed short `timeoutMs` or turn count around real,
  contention-sensitive work fails a landing at a load average the repository runs at routinely.
- **Source:** 2026-09-21 repository-simplification wrap-up, `5e352643` and the workspace-open budget
  change.
