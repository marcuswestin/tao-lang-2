# DEVENV-FAILING-UNTIL-WAIT-STALLS-TEST-FILE — A failing `until` wait stalls `test-file` for minutes

- **Status:** Candidate
- **Section:** External
- **Area:** Bun tests, `./agent test-file`, polling helpers.
- **Impact:** One wrong assertion inside a polling wait costs minutes instead of seconds, repeated on every iteration of the fix.
- **Evidence:** Reported by a runtime-proofs agent on 2026-09-27: a Bun test whose `until` wait never became true stalled `./agent test-file` for minutes, while `bun test --timeout 5000` on the same file failed in seconds. `packages/apps/providers/instantdb` `instantdb-live.test.ts` "owner rules keep each account to its own rows" also hung to its 120 s timeout intermittently (3 reversals in 4 recorded runs).
- **Workaround:** Run the file with `bun test --timeout 5000` while iterating.
- **Proposed change:** Give focused runs a short default per-test timeout, and have `until` fail with the last observed value when it expires.
- **Dependencies:** None.
- **Acceptance:** A test whose wait cannot succeed fails within seconds under `test-file`, naming what it was waiting for.
- **Source:** Provider pairing and InstantDB auth, `feat/provider-bridges`, 2026-09-27.
