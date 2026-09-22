# Slice 3 - Tao Lens and diagnostics

Status: implemented in `feat/studio-companion-slice-3` with focused tests and the repository check;
real browser selection of a slow WordFlower render and physical-device evidence remain outstanding.
This is the implementation record for [the Slice 3 plan](./Plan%20-%20Tao%20Studio%20companion%20app.md).

## What the Lens measures

- Studio-only compiled render occurrences carry the same source path and range as canvas and device
  selection. A React Profiler around each occurrence records commit duration and phase. A selected
  source revision joins only exact path, range, and source-version matches; older samples cannot
  explain new source.
- View-local state commits and data-query subscription invalidations mark the nearest profiled
  occurrence. Descendant render samples inherit the marked cause, so a selected leaf can explain a
  parent view's invalidation. Data fills record an observed wait between filling and completion;
  no state value, provider row, credential, or request body enters a Lens sample.
- The browser preview reads a bounded list of final CSS values through `getComputedStyle` after a
  commit. If instances of a repeated source render have different values, it reports the resolved
  style as unmeasured rather than assigning one row's style to all of them. A device reports React
  Profiler time and causes through its authenticated control channel; React Native does not expose
  equivalent computed styles through the public API, so the device has no resolved-style claim.
- The Lens panel shows a bounded recent timeline, render count, latest and slowest duration, a
  source-revision rank for browser nodes, invalidating state or data, provider wait, declared style
  source, resolved browser style, and native observations when paired. The existing inspector
  retains design, data, and action editing beside this causal account.

## Journey evidence

`tao test --journey-observations <path>` compiles test-only render identities, observes the mounted
React tree after each check step, and collects one record per Jest worker. The CLI aggregates a
versioned JSON artifact; Studio's test runner attaches it to that run. The Lens calls a passed
journey "covering" only when that check actually mounted the selected source path, range, and exact
source version. The panel names the check and offers **Open covering journey** for an in-project
test file. A failed check, textual selector resemblance, or older revision is not coverage.

## Evidence and limits

Focused compiler, runtime, protocol, Studio client, CLI, test-runner, and device-gateway tests
exercise identity emission, worker aggregation, exact revision joins, bounded messages, stale
device rejection, browser style ambiguity, and the panel projection. `./agent check` passed after
integration. The test data proves those seams; it is not a measured WordFlower slow-render story.

Before calling the plan's acceptance complete, select a slow WordFlower render in a live browser
cell, run a journey that reaches that exact render, and inspect the source, cause, resolved style,
provider wait, and covering check together. Then repeat device timing and source selection on a
paired phone. Profiler duration is React render time, not a full JS-thread or displayed-frame
duration; provider wait is the query's filling interval, not a full network waterfall.
