# DEVENV-FIREBASE-GUARD-TESTS-REQUIRE-LOCAL-CONNECTION — Firebase guard tests require a local connection

- **Status:** Resolved
- **Area:** Portable verification; Firebase managed acceptance source regressions
- **Impact:** A clean CI checkout cannot run ten source guard regressions because their fixture reads an ignored project-local connection file.
- **Evidence:** PR30 Verify run37425780549 partition16 failed with a missing reviewed public connection and the fixed-subject refusal. The nine subject/dispatch/attachment regressions and 64 controller tests pass with synthetic settings and isolated authored source fixtures.
- **Workaround:** None; publishing the real local connection is inappropriate for portable source tests.
- **Proposed change:** Inject the shared subject guard with a pinned synthetic connection fingerprint through existing source-test dependencies, retaining the fixed live wrapper and its rejection of synthetic settings.
- **Dependencies:** feat/firebase-hosted-flow-landing; existing managed acceptance evidence labels injected operations as source regression.
- **Acceptance:** Subject, dispatch and attached-CDP mutations still reject before input; startup rejects durable simulator/runtime/controller/selection drift; the production wrapper refuses the synthetic connection. Focused managed-firebase-acceptance.test.ts (9) and dev-loop-controller.test.ts (64) passed on 2026-10-06. Hosted Verify remains the merge gate.
- **Source:** Hosted landing integration failure and focused reproduction in this branch.
- **Archived:** 2026-10-06
