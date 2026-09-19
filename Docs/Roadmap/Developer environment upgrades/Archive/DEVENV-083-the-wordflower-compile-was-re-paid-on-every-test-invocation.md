# DEVENV-083 — The WordFlower compile was re-paid on every test invocation

- **Status:** Resolved
- **Area:** Verification performance
- **Impact:** `just test`, `just test-file`, `just test-changed`, and `just test-retry` all declared
  `_compile-word-flower-app` as a recipe dependency, and it recompiled unconditionally. Running one
  dev test that never reads the generated app still waited ~3s before a single test started, and both
  verify lanes carried the same cost on the serial floor behind `_fix-tao`.
- **Evidence:** `just test-file packages/dev/dev-tests/run-timings.test.ts` measured 3.11s and 5.18s
  wall at load 5.0 on 18 CPUs while the test itself ran in 128-200ms. The gate alone measured 3.35s
  and 3.57s back to back, recompiling both times; `_parser-gen`, which is stamped, reported
  `parser generate: up to date` in 44ms beside it.
- **Workaround:** None; the cost was unconditional.
- **Change made:** `_compile-word-flower-app` now runs `packages/dev/dev-src/repository-tests/CompileApp.ts`, which applies the content
  stamp `ParserGenerate.ts` established — a versioned stamp under `.artifacts` holding an input
  content hash, an up-to-date check that also verifies the generated tree's own content, and a file
  mutation lock with a re-check inside it — and delegates to `./tao compile` only on a miss. The
  stamp lives in `packages/dev` rather than the CLI because `./tao compile` is the product surface a
  user runs against their own project.
- **Measured:** gate 3.35s cold to **0.21s** warm; `just test-file` on a dev test 3.11s to **0.46s**;
  in-lane `_compile-word-flower-app` 2930ms cold to **216ms** warm across two `verify-changed`
  runs at load 10.8-17.4 on 18 CPUs. The generated tree is byte-identical across forced rebuilds
  (`c5f4bbc4…`, 62 files, before the change and after three rebuilds).
- **Dependencies:** Adds `Platform.sha256Hex`, the digest seam `repo-lint`'s node-import rule names,
  rather than taking a sixteenth `node:crypto` allowlist entry. The existing direct callers can close
  onto it as each is swept.
- **Acceptance:** A warm run skips, an app-source, sidecar, stdlib, compiler-source, lockfile,
  ancestor-`Project.tao`, or app-name change rebuilds, and a deleted, corrupted, reclaimed, or
  foreign-app output tree rebuilds — asserted in `compile-app.test.ts` and reproduced end to end
  against the real repository.
- **Not done:** `./dev`'s own startup costs ~130ms against ~27ms for the bare `bun run` that backs
  `_parser-gen`, which is now most of the warm gate. Moving the recipe to `bun run` would close it at
  the cost of the discoverable `./dev` command.
- **Source:** 2026-09-19 test-gate incrementality work.
- **Archived:** 2026-09-19
