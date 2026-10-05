---
name: pipeline-performance
description: >-
  Change or review Tao parsing, validation, compilation, project-tooling refresh, Studio publication,
  or runtime design delivery hot paths. Use when diagnosing edit-to-preview slowdowns, adding work
  to a save or watch callback, or protecting incremental pipeline performance.
---

# Pipeline Performance

- Identify the unit of change and its work owners before adding a refresh, check, or traversal. A
  saved input may reach both an explicit request and a filesystem event; those callers must share
  computation when the owning API can prove input equivalence. Keep caller acknowledgements and
  publication deltas separate from that shared computation.
- Bound pending work. A burst needs a current run and a following run that reads the newer inputs,
  rather than one full pipeline execution per notification. Never give a caller an earlier result
  merely because work is already running.
- Reuse only under an explicit invalidation contract owned by the API's JSDoc. Watch events are
  scheduling hints, not proof of unchanged disk inputs. Cache identities must describe the inputs
  actually consumed; matching outer snapshots cannot prove that an intermediate edit and revert
  was never read. Unknown inputs take the authoritative cold path.
- Preserve entry-sensitive validation, resolution, generated-output repair, error recovery, and
  publication ordering when removing duplicate work. A cache hit must not conceal a new package,
  missing source, changed ownership boundary, or changed host configuration. Sharing mutable ASTs
  across overlapping builds needs a compiler-owned lifetime contract.
- Keep batch validation reuse within its documented input boundary. Type inference can share
  completed results for identical linked AST inputs within one unmodified build; its memo is active
  only during synchronous validation. Entry ordering, structural reports, and filesystem checks
  remain authoritative. A new inference dependency must extend its key or take the cold path.
- App declaration classification can share exact file identities within that same batch. An app
  identity index must also match its package context and ordered file identities, including stable
  ordering for files with equal paths. Discard these indexes before any document build or relink.
- Descendant lists can share exact AST identities within a completed, unmodified validation batch.
  Keep their arrays read-only and discard them before the next build; every validator and diagnostic
  position still runs. This is traversal reuse, not permission to replay structural validation.
- Reuse validation across builds only through the owning validator API and parser-owned semantic
  dependency snapshots. Retained AST identity does not prove retained links. Keep unknown handlers
  and incomplete dependency snapshots cold; preserve diagnostics at their original positions and
  keep workspace, release, ownership, and disk checks authoritative. Prove invalidation and fresh
  result parity before attributing a latency gain.
- Keep host module mapping reuse owned by the watched session. Rediscover package names, ownership,
  roots, and exclusions on each call, then audit every filesystem result consumed by the resolver,
  including missing paths and manifest text. A changed or inconsistent observation takes the cold
  path. Forced refresh and final watch disposal release the mapping; standalone calls stay cold.
- Compare diagnostics from the same owner. A native TypeScript replay must compare its native
  diagnostics with the saved native diagnostics while preserving the complete published Tao and
  TypeScript result, including warnings and hints.
- Follow `test-quality` for deterministic work-count, identity, invalidation, and cold-result parity
  proofs. Cover a rapid-save burst and stale-to-repaired recovery when changing a resident pipeline;
  mutation-test those lifecycle assertions before trusting them.
- Measure the actual edit the Developer feels through its actual save path. For a layout or design
  edit, observe computed layout/style and subsequent paint; changing text alone does not prove that
  the style arrived. Keep data/fixture reseeding and ordinary view edits distinguishable.
- Attribute source-to-publication, publication-to-HMR, and HMR-to-paint separately. A compiler gain
  is not evidence of an equal paint gain. Compare the same authored fixture and edit when attributing
  a change; label a different fixture, integrated main, or loaded host as a different comparison.
- Use `TAO_STUDIO_PREVIEW_PROFILE=true` with the real Studio latency smoke to diagnose phase cost
  and the first rejected tooling replay. Profiling is opt-in diagnostic evidence; calibrate the
  normal pipeline with the periodic performance command.
- Numerical budgets and admission policy live in executable performance automation. Follow
  `verification-lanes` for running and interpreting the periodic performance proof; do not tune a
  ceiling to make a regressed run pass or claim speed from a busy-host correctness smoke.
- Refresh the owning roadmap with tested commits, warm sample definitions, phase results, host
  conditions, and remaining costs. Preserve settled product decisions while optimizing their
  implementation.
