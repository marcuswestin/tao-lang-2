# DEVENV-JEST-CACHE-SCAN-RACES-TRANSFORM-PUBLICATION — Jest cache scan races transform publication

- **Status:** Resolved
- **Area:** `packages/apps/expo-host/jest-direct-cache.cjs`
- **Impact:** A parallel Jest shard can fail global setup while another worker publishes a transform.
- **Evidence:** Authorized local landing at `3ee9d8775` failed in `runtime-jest#2`: the cache scanner
  enumerated a temporary `.map.<random>` file that disappeared before `statSync`. The failure log is
  `.artifacts/logs/verify-full/2026-10-07T17-24-08-617Z-9475-3f2ba14c/runtime-jest_2.log`.
  An isolated worker regression renames a real transform between directory enumeration and metadata
  inspection, reproducing the failed boundary. The restored focused lifecycle suite passes all eight
  tests; reverting missing-file tolerance makes the new regression fail.
- **Workaround:** None required after the fix; retain shared cache contents and active leases.
- **Proposed change:** Use `statSync` with `throwIfNoEntry: false` when inspecting enumerated cache
  files. Skip vanished entries only; propagate other filesystem errors and preserve pruning limits.
- **Dependencies:** None. The coordination lock serializes lifecycle operations, while active Jest
  workers continue publishing transforms outside it.
- **Acceptance:** The injected publication occurs, startup and teardown succeed, the published
  transform and unrelated keeper remain intact, final size accounts for both files, and leases are
  empty. These assertions pass in `cache-process-lifecycle.test.ts` and fail under the mutation.
- **Source:** iOS runtime follow-up landing diagnosis, 2026-10-07, `dev/ro`.
- **Archived:** 2026-10-07
