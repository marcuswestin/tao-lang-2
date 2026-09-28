# DEVENV-STUDIO-REAL-APP-PROOF-FAILS-INTERMITTENTLY-UNDER-LOAD — The Studio real-app proof fails intermittently under load

- **Status:** Candidate
- **Section:** External
- **Area:** `studio-proof-real-app`, `studio-hnreader-feed-journey.ts`, `verify-full`, landing.
- **Impact:** `verify-full` runs the HNReader Feed journey, and the journey fails at a different step from run to run, so a landing can stop on a failure the branch did not cause and retries are a coin toss.
- **Evidence:** On 2026-09-27, with main's Studio sources, `./agent unsandboxed studio-proof-real-app` failed 3 of 7 runs, at `journey.ts:57` (the second drawn rectangle never reaches the catalog, 30-second `until`) and `journey.ts:81` (Snap moved the free rectangle instead of the selected one). Load averaged 10–24 on 18 CPUs, with another agent's typecheck at around 500% CPU. `feat/draw-live-previews` failed at those steps and also at `journey.ts:118`/`342` (the Title dropped into View1's running cell never renders), which main did not show in its 7 runs.
- **Workaround:** Re-run the lane alone on a quiet machine; it passes more often than not.
- **Proposed change:** Replace the journey's fixed 30-second waits on catalog writes with waits on Studio's own settled state (compiled equals applied, no gesture in flight), and have the lane save a screenshot and the catalog on failure so a failing step can be told apart from a slow one.
- **Dependencies:** None.
- **Acceptance:** Ten consecutive runs pass under a concurrent `verify` lane, and a forced failure leaves a screenshot beside the lane log.
- **Source:** Draw live previews, `feat/draw-live-previews`, 2026-09-27.
