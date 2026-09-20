# DEVENV-110 — Concurrent writers in one worktree fail the pre-test app compile

- **Status:** Candidate
- **Area:** Test runner, parallel implementation
- **Impact:** `./agent test-file` fails for an agent whose own change is sound whenever another agent
  in the same worktree saves a file during the prerequisite WordFlower compile. The failure reads
  like a broken build, costs a full re-run, and recurs for every agent in a fan-out. Under the same
  load a suite can also be reported `failed` after its timed-out shards each passed on an isolated
  retry, so the exit status contradicts the retry result.
- **Evidence:** 2026-09-20, five implementers with exclusive paths in one worktree. Three of them
  reported, from `packages/dev/dev-src/repository-tests/CompileApp.ts:190`:
  `UnexpectedBehaviorError: App compilation inputs changed while the compile ran; refusing stale metadata.`
  Each passed on a plain re-run. One `./agent test-file packages/studio/studio-tests` run timed out
  three of four shards at 120s, printed `tests 547; pass 547; fail 0` with each shard noted as passed
  on an isolated retry, and still exited non-zero.
- **Workaround:** Re-run. Batch test invocations so fewer compiles overlap other agents' edits.
- **Proposed change:** A focused run whose target cannot reach the compiled app skips that
  prerequisite, or hashes only the inputs the app reads. Where the compile is needed, retry once
  when the only failure is changed inputs, and say that a concurrent writer caused it. Separately,
  let a shard that passed its isolated retry count as passed in the exit status.
- **Dependencies:** `delegation`'s parallel-implementation reference, which puts several writers in
  one worktree by design.
- **Acceptance:** Five agents editing disjoint packages in one worktree each run `test-file` on
  their own package twenty times with no failure attributable to another agent's edit.
- **Source:** 2026-09-20 repository simplification, reduction slices.
