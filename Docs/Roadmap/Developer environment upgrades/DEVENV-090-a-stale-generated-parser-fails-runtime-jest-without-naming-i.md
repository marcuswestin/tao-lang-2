# DEVENV-090 — A stale generated parser fails `runtime-jest` without naming itself

- **Status:** Candidate
- **Section:** External
- **Area:** Repository tests, generated trees
- **Impact:** Running the `runtime-jest` suite outside a verification lane on a worktree whose
  generated parser is missing or stale fails most of the suite with an error that names neither the
  generated tree nor the recipe that builds it. The reader's first hypothesis is a broken branch.
- **Evidence:** On 2026-09-19, in a worktree fast-forwarded across several commits without a lane
  having run since, invoking the suite the way the gate does —
  `node node_modules/jest/bin/jest.js <30 files> --no-watchman --maxWorkers=3 --silent` from
  `packages/runtime-toolchain` — reported `Test Suites: 20 failed, 10 passed, 30 total`. Every
  failure was the same:

  ```
  UnexpectedBehaviorError: Something went wrong while compiling Tao tests.
      at Object.errorFromFailure (runtime-toolchain-src/testing/test-compiler/Protocol.ts:35:12)
  ```

  `just verify` on the same tree then passed the identical suite, and the hand-run suite passed
  afterwards too. The only thing that changed was that the lane had run `_parser-gen`. The message
  comes from `errorFromFailure` mapping a `category === 'unexpected'` worker failure, so the
  compiler's own reason never reaches the reader.
- **Workaround:** Run `just verify` (or `just _parser-gen`) once in a worktree before timing or
  running `runtime-jest` by hand. Prefer `just test-file <path>`, which goes through the lane.
- **Proposed change:** Have the test compiler distinguish "the generated parser is absent or older
  than the grammar" from a genuine unexpected failure, and say so with the recipe that fixes it.
  Failing that, have the worker forward the underlying compiler diagnostic instead of collapsing
  every unexpected category to one sentence.
- **Dependencies:** None.
- **Acceptance:** A `runtime-jest` run against a missing generated parser names the generated tree
  and the recipe that builds it, and a reader who has never seen this failure can act on the first
  line.
- **Source:** 2026-09-19 verification-scheduling acceptance-measurement attempt.
