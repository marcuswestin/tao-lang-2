# DEVENV-PORT-REUSE-ASSERTION-FAILS-DURING-CONCURRENT-VERIFICATION — Port reuse assertion fails during concurrent verification

- **Status:** Resolved
- **Area:** Expo dev-loop tests, TCP port reservation
- **Impact:** A broad verification run can fail an unchanged port reuse assertion after the listener is released.
- **Evidence:** On 2026-09-26, `expo-dev-loop.test.ts:463` expected released port53213 but received53216 in `feat/clerk-follow-through`. The run reported six concurrent lanes and peak load120.6 on18CPUs. On 2026-09-28, `feat/studio-feed-proof` finalize expected released port56448 but received56451 in the `::1` case, with peak load56.8 on18CPUs. The exact test file passed unchanged in isolation afterward. In `feat/port-reuse-flake`, a controlled TCP test kept a second listener bound to `127.0.0.1` at the preferred port after the `::1` blocker closed; Expo then correctly chose a different port. The old exact-port assertion would fail in that owned case. Probe-backed tests recorded release of every partial reservation on both collision and error; removing either cleanup path made its test fail. Ten consecutive focused runs and two uncached concurrent `verify-changed` runs passed; the latter summaries are `.artifacts/logs/verify-changed/2026-09-28T14-40-32-819Z-36949-26cca195/summary.json` and `.artifacts/logs/verify-changed/2026-09-28T14-43-54-697Z-55962-fbf4c30c/summary.json`. The owners of the two earlier broad-run ports were not captured, so their exact cause remains unproven.
- **Workaround:** None needed after the port test no longer assumes a released OS port stays unowned.
- **Proposed change:** Replace exact-port reuse assertions with probe-backed release checks for every partial reservation; retain real TCP collision and dropped-client coverage, and reproduce competing ownership with two live listeners.
- **Dependencies:** None.
- **Acceptance:** Reproduce the failing condition with owner evidence and retain coverage that every partial reservation is released.
- **Source:** Clerk iPhone review verification, 2026-09-26.
- **Archived:** 2026-09-28
