# DEVENV-PORT-REUSE-ASSERTION-FAILS-DURING-CONCURRENT-VERIFICATION — Port reuse assertion fails during concurrent verification

- **Status:** Candidate
- **Section:** External
- **Area:** Expo dev-loop tests, TCP port reservation
- **Impact:** A broad verification run can fail an unchanged port reuse assertion after the listener is released.
- **Evidence:** On 2026-09-26, `expo-dev-loop.test.ts:463` expected released port53213 but received53216 in `feat/clerk-follow-through`. The run reported six concurrent lanes and peak load120.6 on18CPUs. The exact test file passed unchanged in isolation afterward. Concurrent acquisition is a plausible cause, not a demonstrated one; listener cleanup has not been ruled out.
- **Workaround:** Rerun the exact file in isolation and keep that evidence distinct from a green broad gate.
- **Proposed change:** Capture listener ownership around release/reacquisition and distinguish a leaked reservation from an external process acquiring the port before changing the assertion.
- **Dependencies:** None.
- **Acceptance:** Reproduce the failing condition with owner evidence and retain coverage that every partial reservation is released.
- **Source:** Clerk iPhone review verification, 2026-09-26.
