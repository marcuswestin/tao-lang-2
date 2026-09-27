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
