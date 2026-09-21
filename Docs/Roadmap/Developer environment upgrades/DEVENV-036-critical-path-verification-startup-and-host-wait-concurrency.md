# DEVENV-036 — Critical-path verification startup and host-wait concurrency

- **Status:** In progress
- **Section:** External
- **Area:** Verification performance
- **Impact:** The package critical path dominates `verify`, while `verify-full` can delay that same
  25–35 second work behind shorter Studio gates and leave an 18-CPU host underused.
- **Evidence:** On 2026-09-04, `_test` and `_typecheck` measured 33.1 and 26.3 seconds while the full
  lane peaked at load 11.4 on 18 CPUs. A clean baseline `verify` took 33.5 seconds. Giving the nested
  test runner 12 slots completed in 25.8 seconds; reducing it to 9 slots regressed to 32.8 seconds.
- **Workaround:** None required; the lane remains correct, only slower than necessary.
- **Proposed change:** Preserve `_test`'s 12-worker budget, launch `_test` and `_typecheck` before
  auxiliary readers, remove the obsolete Studio-first priority, and account each mostly-waiting
  Studio smoke as one slot while retaining native `gui` exclusion and machine-wide admission.
- **Dependencies:** Implemented on `feat/verification-lanes`; the six browser and native UI lanes still require an
  unsandboxed terminal for final timing evidence.
- **Acceptance:** Focused scheduler tests prove package-first admission and three concurrent Studio
  waits beside package work; `./agent verify` remains green; an uncontended normal-terminal
  `just verify-full` is green and improves or matches the 44.6-second baseline.
- **Source:** 2026-09-04 verification timing review on `feat/verification-lanes`.
