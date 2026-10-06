# DEVENV-STUDIO-REAL-APP-PROOF-FAILS-INTERMITTENTLY-UNDER-LOAD — The Studio real-app proof fails intermittently under load

- **Status:** In progress
- **Section:** External
- **Area:** `studio-proof-real-app`, `studio-hnreader-feed-journey.ts`, `verify-full`, landing.
- **Impact:** `verify-full` runs the HNReader Feed journey. Its Draw and Design failures were repaired, but browser startup under a concurrent full verification remains to be proven.
- **Evidence:** On 2026-09-27, with main's Studio sources, `./agent unsandboxed studio-proof-real-app` failed 3 of 7 runs, at `journey.ts:57` (the second drawn rectangle never reaches the catalog, 30-second `until`) and `journey.ts:81` (Snap moved the free rectangle instead of the selected one). Load averaged 10–24 on 18 CPUs, with another agent's typecheck at around 500% CPU. `feat/draw-live-previews` failed at those steps and also at `journey.ts:118`/`342` (the Title dropped into View1's running cell never renders), which main did not show in its 7 runs.
- **2026-09-28 diagnosis:** Browser request traces showed Snap sometimes sent the first rectangle even while the second was visibly selected. Its click handler used the frame's older sketch snapshot instead of the board's current rectangles. Another run recorded `pointerdown` on Snap without a `click` or request: an incoming Draw render replaced the toolbar during the press. A persisted Snap could also leave View1 on the preceding Expo publication (`compiled 3 · applied 2`), with the iframe recording no publication for revision 3. The retained preview now retries that missing acknowledgement with a bounded reload. The journey waits for Studio's applied revision between Draw steps and saves a screenshot, catalog, manifest, and preview diagnostics on failure.
- **2026-09-28 acceptance:** A browser trace showed a physical Undo Keep press landing on Discard after the Feed sidebar shifted between coordinate lookup and input; Keep, Discard, and Undo Keep now sit above the dynamic Feed content, and the journey still uses physical clicks. The journey waits for Draw's board to enter the viewport before dragging. A concurrent `check --no-cache` run then captured a blank Studio page before Feed began. Studio had advertised its URL before lazily building `/studio.js`; it now prepares that bundle before reporting readiness. After merging current `main`, one edit/undo smoke failed before its initial compile status was checked; an early diagnostic now reports that status and its compiler messages. Ten consecutive real-app proofs passed from 07:23 through 07:35 UTC on the merged tree, each paired with a passing `check --no-cache` lane. An earlier concurrent full `verify` run also captured a blank Studio page; the stricter full-verify acceptance remains open.
- **2026-10-06 evidence:** A new symptom in the landing complement under load above 50:
  `studio-proof-real-app` failed three landings (PRs 51, 65 and 71) with Metro's
  `UnableToResolveError ./modules/@/studio/View1.tao`; each rerun alone passed (170 s). On a hosted
  Linux runner (`ubuntu-24.04`, four vCPUs) the gate passes in 333 s once `CI` is unset for the
  preview's Metro (run 37502914480) and fails 3 of 4 tests with `CI=true`, which put Metro in CI
  mode. It was not ported: it would be the longest node of any partition. Its three Metro-unique
  claims moved to the hosted `studio-metro-refresh` gate (PR 64), so trimming this file is now a
  product decision (DEVENV-EXPENSIVE-TEST-TRIMS-NEEDING-A-DECISION, item A).
- **Workaround:** Re-run the lane alone on a quiet machine; it passes more often than not.
- **Proposed change:** Prove browser startup under the stricter concurrent full-`verify` condition. Investigate any recurrence with the captured page resource timings and browser events.
- **Dependencies:** None.
- **Acceptance:** Ten consecutive runs pass under a concurrent `verify` lane, and a forced failure leaves a screenshot beside the lane log.
- **Source:** Draw live previews, `feat/draw-live-previews`, 2026-09-27.
