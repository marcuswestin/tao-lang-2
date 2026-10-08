# DEVENV-WORDFLOWER-CHECK-EXCEEDS-QUIET-PERFORMANCE-BUDGET — WordFlower check exceeds its quiet performance budget

- **Status:** Candidate
- **Section:** External
- **Area:** Compiler validation, periodic performance qualification
- **Impact:** The earlier whole-app session-check failure is repaired in the candidate/common
  compiler baseline. Complete Studio qualification still fails unchanged full-processing ceilings.
- **Evidence:** On 2026-10-07, candidate `ae0dbf4c6` integrating main `5a2ba4b6c` failed the
  standalone run `performance-8c6a878c-d57c-4236-9772-bb0ecdf5329c`: session-check median
  1.4 seconds against 1.3 seconds, no active peers, load 4.0166–4.6284 on 18 CPUs. Current-main
  control `5a2ba4b6c` also failed a focused ten-iteration benchmark: one-shot check 1.9 seconds
  against 1.7 seconds and session check 1.4 seconds against 1.3 seconds. This does not establish
  a regression caused by the Studio branch; its Workspace, parser and validator source match
  main. The fixture has 732 lines, 51,927 bytes and thirteen entry files. Separate one-iteration
  profiling attributed about 620 milliseconds per thirteen-entry batch to effect-analysis
  construction, 420 milliseconds to structural checks, 110 milliseconds to foreign checks and
  65 milliseconds to package-workspace checks. These are diagnostic observations, not qualified
  medians. Sixty diagnostic entry invocations had zero repeated exact ordered effect inputs.
  Trials of existing inference reuse and local correspondence result reuse demonstrated no
  useful reduction; all temporary source changes were removed. Reports, logs and the
  investigation patch remain in the Studio speed worktree checkpoint artifacts.
- **Workaround:** None that preserves the complete performance verdict and unchanged ceilings.
  Loaded correctness smoke results cannot replace numerical qualification.
- **Proposed change:** The separately approved compiler slice now has a narrower implementation
  in `29004402d`: share completed immutable projected inventories only within one exact canonical
  snapshot. Each owner keeps independent source-root context, fact discovery and analysis;
  changed evidence and new linked builds stay cold. The owning 359 tests and disabled-retention /
  cross-snapshot mutation checks pass. An isolated ten-iteration diagnostic reports session check
  983 milliseconds, within the unchanged ceiling. Prepared indexes and immediate native-attempt
  carry retain owner-specific analysis and an independent final audit. Complete quiet candidate
  run `performance-ef25343b-6854-4629-a41a-784efd3dcf02` passes language budgets (session check
  922ms), all six computed-paint journeys and cleanup; the matching control run
  `performance-080112d6-6e7d-4243-a200-fc0f90255600` also passes language/correctness/cleanup.
  Both fail remaining Studio ceilings under full processing. This entry stays open against its
  original complete acceptance bar; no failed verdict is converted to a pass. Cross-entry
  dependency reuse and worker/admission isolation remain separate future work.
- **Dependencies:** The Studio preview speed continuation roadmap owns the affected production
  slice and the separate follow-up scope decision.
- **Acceptance:** Complete quiet standalone qualification passes all unchanged language and
  Studio ceilings. Any effect reuse has deterministic work-count, changed-input, ordered-entry
  and cold-result parity proofs, without weakening diagnostics or native freshness.
- **Source:** 2026-10-07 Studio preview speed landing preparation and focused failure diagnosis.
