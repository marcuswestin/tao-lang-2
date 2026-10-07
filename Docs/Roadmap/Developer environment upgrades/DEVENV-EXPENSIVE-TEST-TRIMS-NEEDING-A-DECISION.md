# DEVENV-EXPENSIVE-TEST-TRIMS-NEEDING-A-DECISION — Expensive test trims that need a decision

- **Status:** Candidate
- **Section:** External
- **Area:** `studio-real-app.test.ts`, `studio-simulated-user.test.ts`,
  `runtime-keyboard-navigation.test.ts`, the per-partition prepare nodes in hosted Verify, and the
  Jest transform caches there.
- **Impact:** These trims would each save a measured cost, but each changes what a gate proves or
  how Verify is built. They wait for the Developer's decision rather than landing as routine trims.
- **Evidence:** Audit of 2026-10-06, from Verify run 37503086586 (`c8a997842`), local complement
  summaries of the same day, and hosted Linux runs of the browser gates.
  - **A. Shrink `studio-real-app.test.ts`, after the Metro-claims branch lands.** Cost:
    `studio-proof-real-app` takes 161–222 s in the local complement (333 s on hosted Linux with
    `CI=false`) and starts Studio and Metro four times. The HNReader session test (`:55`) starts no Metro
    and could move to `studio-preview-session.test.ts`. The canvas and pointer assertions (`:138–248`,
    `:294–315`, helpers `:753–866`) are covered by `studio-canvas-viewport.test.ts`,
    `studio-preview-activation.test.ts`, `TR-studio-preview.test.ts` and
    `studio-canvas-viewport-store.test.ts`. The computed-CSS checks (`:143–176`) are covered nowhere
    else and need Chrome but not Metro. Publication-off repeats fast-refresh's drag. Saves about half
    the file. Trade: the real app stops proving canvas and pointer behaviour end to end. The journey's
    second Metro start (`studio-hnreader-feed-journey.ts:201`) exists only for "a reopened preview
    renders the kept view" (`:206`), which would be dropped or kept by decision.
  - **B. Cut the sketch segment of `studio-simulated-user.test.ts`** to one draw, one snap and one undo.
    Cost: 91–123 s locally, 132 s on hosted Linux; the segment (`:519–861`) is about 40% of the one
    850-line test, and the test reloads the page twice (`:584`, `:659`). Saves 25–30%. Trade: the
    session tests (`studio-sketch-session.test.ts`, `studio-sketch-snap.test.ts`) would carry overlap
    cancel and apply alone, and the audit did not confirm that they cover it.
  - **C. Run the two keyboard-navigation tests on one export.** Cost: 36–55 s locally, 65 s on hosted
    Linux; each test runs a full `expo export --platform web` and Chrome on fixed port 42008 (`:383`).
    The WordFlower test (`:204`) repeats narrowing and hints; only its nested-action and navigation
    claims are its own. Trade: one fixture app has to hold both cases, and WordFlower stops proving
    narrowing and hints on a real app.
  - **D. Build WordFlower and the IDE extension once per Verify run** instead of in each of 20
    partitions. Cost: `_compile-word-flower-app` 607 node-seconds (30–36 s each, on 15 of the 20
    partitions' critical paths) and `_ide-extension-build` 568 node-seconds. Trade: earlier
    measurement (the verification-lanes hosted-verification notes) found that running prepare once in
    `plan` adds more serial time than it saves, and each partition must still fail on unformatted or
    stale generated files, so this is CI plumbing that needs a design, not a test trim.
  - **E. Jest transform cache for runtime-jest and the tao-apps shards.** In hosted Verify both Jest
    caches live under the lane's `TAO_HOME`, `.artifacts/testing/tao-home/cache/` (`jest-standalone-v2`
    for runtime-jest, `jest-transform-cache-v2` for `./tao test`), not under `~/.tao`. The workflow
    forbids caching `.artifacts`, so a cache would have to restore outside it and move the directory
    in before the lane and out before saving. Proving the hoped-for 20 s on runtime-jest also costs
    two extra full Verify runs on the shared pool, cold then warm, through a `workflow_dispatch` save
    path, because a pull request restores only what `main` saved. Dropped on 2026-10-06: once runtime-jest
    runs as three shards of about 78 s, the saving spreads to about 7 s a shard, off every partition's
    critical path, and the tao-cli trims' measured −52.7 s against a ledger estimate several times
    larger says per-file estimates overstate what CI walls return. Revisit when a runtime-jest shard
    is again the longest node of its partition.
- **Workaround:** None; the gates pass as they are.
- **Proposed change:** Decide each of A–D separately; E waits for its revisit condition. Before landing A, the Metro-claims branch must
  carry the three Metro-unique claims; before B, confirm the session tests' overlap coverage.
- **Dependencies:** A's dependency landed on 2026-10-06 as the hosted `studio-metro-refresh` gate
  (PR 64, `45dd730e9`), which carries the three Metro-unique claims, so A is decidable now; the
  others depend on none.
- **Acceptance:** Each decided item lands with its before and after measurement from a complement
  receipt or a Verify run, or is closed here with the reason.
- **Source:** Expensive-test audit and trims, `feat/trim-project-tooling-tests`, 2026-10-06.
