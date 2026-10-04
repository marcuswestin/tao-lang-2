# DEVENV-TEST-FILE-REFUSES-STANDALONE-APP-TESTS — Focused test-file refuses standalone app tests

- **Status:** Candidate
- **Section:** External
- **Area:** `./agent test-file`, standalone Expo apps, Hosted CRUD.
- **Impact:** The focused front door rejects tests in a standalone app even though both verification lanes run that app's test script, requiring a separate documented Bun command during iteration.
- **Evidence:** On 2026-10-03, `./agent test-file 'Apps/Hosted CRUD/scripts/hostile-probe.test.ts'` returned `Unsupported test file`. `packages/testing/verification/verification-src/TestRunner.ts` routes only registered package suites. `Justfile` includes `_hosted-crud-test` in both `verify-changed` and `verify`; its app script runs `bun test src`, so a test in `scripts/` is also outside those gates. The probe test was moved to `src/acceptance/` and the documented app test lane passed. The related Tao-file/name-filter entry addresses different input types.
- **Workaround:** Put app tests under the existing app test root, then run `bun test --cwd 'Apps/Hosted CRUD' src` from the repository root as documented in the hosted-provider continuation handoff.
- **Proposed change:** Route focused TypeScript test files in supported standalone apps through their existing test runner, without silently changing which files full verification collects.
- **Dependencies:** None; coordinate the front-door API with `DEVENV-TEST-FILE-TAKES-NO-TAO-FILE-OR-TEST-NAME`.
- **Acceptance:** `./agent test-file 'Apps/Hosted CRUD/src/acceptance/hostile-probe.test.ts'` runs only that file; an app test outside the full-lane collection root is identified clearly rather than implying gate coverage.
- **Source:** Hosted-provider acceptance evidence, `feat/hosted-provider-acceptance-evidence`, 2026-10-03.
