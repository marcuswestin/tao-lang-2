# DEVENV-VISUAL-REVIEW-SCENARIO-READINESS-TIMEOUTS — Visual review scenario readiness timeouts

- **Status:** Candidate
- **Section:** External
- **Area:** Studio visual-review capture and QA evidence
- **Impact:** An on-demand visual QA run can produce no review manifest, or a partial bundle missing
  a requested scenario. That leaves visual coverage blocked for the affected cell; successful
  screenshots from sibling cells cannot fill the gap.
- **Evidence:** On 2026-09-26, the QA pilot based on `d5bdeaefd037` used the newly authorized
  `./agent unsandboxed qa-capture` host path. The first HNReaderStub run stopped before publishing
  its review surface: `.artifacts/logs/agent/qa-capture/2026-09-26T22-49-50-084Z-31600.log` reports
  `Timed out waiting for browser expression: document.querySelector('.studio-preview-grid[data-tao-review-manifest]') instanceof HTMLElement; last=false`.
  The retry bundle `.artifacts/qa/pilot/hnreader-review-diagnostics/review.json`
  (`2026-09-26T22-53-18Z-7953073e`) contains three captured cells and one failed `rows / wrapping`
  cell. Notebook's `.artifacts/qa/pilot/notebook-review/review.json`
  (`2026-09-26T22-51-38Z-70f2b5f1`) also contains three captured cells and one failed
  `devices / tabletDark` cell. Both failed-cell errors show the keyed cell never satisfied the
  `ready` or `failed` status predicate before the existing 60-second wait expired (`last=false`).
  That observation does not distinguish an absent cell, a changed key, or a cell stuck pending.
  Both partial-bundle commands exited zero and reported their failed-cell count. This is consistent
  with `captureReviewCell` preserving errors in the manifest and `runStudioReview` writing the
  remaining bundle; it is not evidence of an exit-code bug or successful complete coverage.
  The compact Notebook evidence is retained in [the pilot captures](../../QA/evidence/pilot/captures.json),
  with the run context in [the pilot report](../../QA/pilot.md). Root cause and repeatability
  remain unproved; the top-level and per-cell timeouts may have different causes.
  On 2026-09-29 a recheck at `0aa8ebcf` did not reproduce either timeout: one isolated capture each
  of Notebook and HNReaderStub (the latter after QA capture learned to stage project packages in
  `e3ed6940`) completed every cell, including `devices / tabletDark` and `rows / wrapping`, with the
  snapshots under `Docs/QA/evidence/recheck-0aa8ebcf/`. One clean run each on a lightly loaded host
  shows the failure is intermittent at most; it does not show the cause is gone.
  On 2026-10-06, automatic scenario discovery on `feat/scenario-qa-discovery` found 14 apps and
  35 cells with no discovery failures. A 90-second-per-app batch retained every expected cell and
  recorded four app deadline failures before it was interrupted during Notebook. A separate
  Pantry capture reached Studio, Metro and headless Chrome, then failed all six cells at the
  existing 60-second ready/failed predicate (`last=false`). It completed in 381.2 seconds with a
  `partial` source snapshot and exit 1, with no screenshots. The preceding package test run was
  contended, and host load during capture was still elevated; neither observation establishes a
  cause. Logs and manifests: `.artifacts/qa/scenario-round-marked/coverage.json`,
  `.artifacts/qa/pantry-discovery-smoke/review.json`, its `logs/studio.log`, and
  `.artifacts/logs/agent/qa-capture/2026-10-06T17-31-46-222Z-90049.log`.
  Discovery and bounded failure reporting are verified separately from successful browser capture.
  The 2026-10-06 Pantry failure was traced to inactive cells: fresh staged projects have no saved
  activated previews, but the review runner only scrolled cells and waited for readiness. The
  runner now activates each inactive cell through Studio's existing control before waiting. With
  that repair, `.artifacts/qa/pantry-activated-smoke/review.json` captured all six cells in 53.4
  seconds with exit 0 and a complete source snapshot; its phone screenshot was inspected.
  An expression-executing regression covers inactive and already active previews, and removing
  the activation click makes the inactive case fail. This explains the fresh-session failure;
  it does not establish the cause of the older missing-manifest or intermittent-cell failures.
  The final automatic batch, `.artifacts/qa/scenario-discovery-final/coverage.json`, discovered
  14 apps and 37 cells, including unimported HNReader sketch scenarios. In 268.7 seconds it
  captured 21 cells across six apps, retained three failed Auth Review previews and 13 missing
  WordFlower cells blocked by source-isolation checks, and exited 1. There were no discovery
  failures or unexpected cells. The partial verdict preserved the actual gaps; sibling captures
  did not turn them into complete coverage.
- **Workaround:** Inspect every manifest cell status and keep the affected visual dimension blocked.
  A fresh HNReader capture reached the manifest but still missed one cell, so retry is not a proven
  recovery. Preserve the original failure and any partial bundle when conducting a bounded recheck.
- **Proposed change:** Reproduce the missing review surface and each failed scenario independently.
  Retain DOM cell keys/statuses, manifest revisions, renderer events and Studio/Metro logs at the
  failing wait to distinguish publication, identity, mount and scenario-readiness failures. Use the
  demonstrated cause to choose a focused repair and regression; do not extend the timeout to hide
  the missing proof. Keep partial-bundle failure reporting explicit for QA consumers.
- **Dependencies:** No implementation fix is selected. Related DEVENV-056 is archived for a
  destroyed renderer context during fingerprinting, a different observed failure; these logs do
  not justify reopening it. DEVENV-015 concerns host GUI startup, while these runs reached browser
  evaluation. DEVENV-011/013 cover preview diagnostics and early process exit, neither established
  here. Existing DEVENV-048/090 cover generated-parser setup/diagnostics; the parser was generated
  before these host captures. Expected sandbox Watchman restrictions are outside this finding.
- **Acceptance:** With a frozen candidate and isolated owned capture sessions, reproduce and explain
  the demonstrated readiness failure; add focused coverage that fails without its repair. Repeat
  complete HNReaderStub and Notebook captures under the existing bounds and inspect all requested
  cell outcomes. Preserve failed-run evidence and distinguish any separate top-level publication
  failure from per-cell readiness. If reproduction identifies a product defect, link its product
  issue rather than attributing it to host setup without evidence.
- **Source:** 2026-09-26 staged-release QA pilot, two host review manifests and the initial HNReader
  capture log; read-only inspection of `StudioReview.ts`'s manifest and cell wait paths.
