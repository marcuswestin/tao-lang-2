# DEVENV-056 — Visual review can lose its renderer context during preview reload

- **Status:** Resolved
- **Area:** Visual review
- **Impact:** `tao review` could read the rendered review surface successfully and then fail before
  writing the bundle with `Execution context was destroyed.`
- **Evidence:** `./tao review Apps/HNReader --app HNReaderStub --output <fresh-path>` reproduced the
  failure in `StudioCdp.rendererFingerprint` when the live preview iframe reloaded between its page
  and child-frame probes.
- **Workaround:** None required after the fix; before it, retrying the whole immutable capture into a
  fresh output path could avoid the reload race.
- **Proposed change:** Retry only Chrome's transient destroyed/missing-context failures while reading
  the renderer fingerprint, with a short bound; preserve every other failure immediately.
- **Dependencies:** None.
- **Acceptance:** A focused CDP test replaces the child-frame execution context mid-fingerprint and
  observes a successful retry; the real two-cell HNReaderStub review capture completes.
- **Source:** 2026-09-06 two-week walkthrough verification.
