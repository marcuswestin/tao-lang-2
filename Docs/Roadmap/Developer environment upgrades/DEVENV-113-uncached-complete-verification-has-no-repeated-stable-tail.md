# DEVENV-113 — Uncached complete verification has no repeated stable tail

- **Status:** Candidate
- **Section:** External
- **Area:** Test performance
- **Impact:** One uncached complete lane can spend more than a minute on a single suite, but optimizing
  the first observed tail would trade correctness and maintenance for a bottleneck that may disappear
  under the normal warm workflow.
- **Evidence:** On 2026-09-20, `./agent verify --no-cache` ran uncontended on
  `feat/devenv-parser-cache-followups` (`peakLanes: 1`, 18 CPUs) and passed 32 nodes in 95.4s. Its
  95.1s serial floor was `_fix-just-fmt -> _fix-dprint -> _parser-gen -> _fix-tao ->
  _compile-word-flower-app -> tao-cli`; `tao-cli` took 72.5s, while `tao-apps` took 42.8s and
  `studio` 36.6s. The immediate warm `./agent verify` passed in 721ms with 30 recorded-green skips;
  its 461ms schedule reran only `_parser-gen`, `_compile-word-flower-app`, and
  `_ide-extension-build`. That repeat skipped the CLI suite, so it did not establish whether its
  executed tail persisted.
  - On 2026-09-26 the Developer reported a recurring first-checkout CLI tail, 10–30 seconds
    behind the next suite. Two quiet directory runs executed the CLI suite in 24.5s and 20.9s
    with eight shards. The indivisible `test-command-cli.test.ts` and `bridge-metadata.test.ts`
    files each approached 20s. Their 43 test bodies are now partitioned across smaller files,
    preserving the assertions and sequential execution within each process.
  - With scheduling history temporarily absent, the split alone took 24.0s at eight shards;
    twelve initial shards took 21.2s, sixteen took 21.3s, and thirty-two took 22.3s. Keep twelve:
    it reduced the measured first-schedule wall time by about 13% from the original 24.5s,
    with less aggregate process time than the wider alternatives. CPU admission remains bounded
    by the existing scheduler. Parser/compiler/runtime caches were retained: these are fresh
    scheduling-history measurements, not entirely cold checkout or full-lane comparisons.
    All runs reported no lane contention on 16 CPUs. Logs are under
    `.artifacts/logs/dev-test/2026-09-26T19-20-41-785Z-45050-54073b66` (before) and
    `.artifacts/logs/dev-test/2026-09-26T20-09-22-748Z-76502-af2e8cfb` (twelve shards).
- **Workaround:** Preserve and reuse the complete lane's recorded green tree for unchanged work.
- **Proposed change:** The requested file partition and initial scheduling adjustment are implemented.
  Keep this observation open until fresh-checkout complete-lane measurements establish how much
  end-to-end tail remains; a cached skip is not a repeat measurement.
- **Dependencies:** DEVENV-046 tracks WordFlower as the Tao-app shard tail; this observation is
  different because the complete-lane serial floor ended in `tao-cli`. DEVENV-086 owns any future
  correctness proof for narrowing the compiled-output fingerprint.
- **Acceptance:** Two uncontended uncached complete runs identify the same stable tail, with the
  schedule and contention blocks recorded, before an optimization is proposed.
- **Source:** 2026-09-20 requested complete-lane cold/warm measurement; 2026-09-26 request to reduce
  the recurring first-checkout CLI tail.
