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
  `_ide-extension-build`. The cold `tao-cli` tail therefore did not survive the requested repeat.
- **Workaround:** Preserve and reuse the complete lane's recorded green tree for unchanged work.
- **Proposed change:** None. Measure a second uncached run on a quiet machine before changing the
  graph or suite process model, and optimize only if the same tail survives.
- **Dependencies:** DEVENV-046 tracks WordFlower as the Tao-app shard tail; this observation is
  different because the complete-lane serial floor ended in `tao-cli`. DEVENV-086 owns any future
  correctness proof for narrowing the compiled-output fingerprint.
- **Acceptance:** Two uncontended uncached complete runs identify the same stable tail, with the
  schedule and contention blocks recorded, before an optimization is proposed.
- **Source:** 2026-09-20 requested complete-lane cold/warm measurement.
