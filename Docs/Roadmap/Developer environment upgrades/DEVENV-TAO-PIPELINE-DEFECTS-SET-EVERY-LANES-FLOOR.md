# DEVENV-TAO-PIPELINE-DEFECTS-SET-EVERY-LANES-FLOOR — Tao pipeline defects set every lane's floor

- **Status:** Candidate
- **Section:** External
- **Area:** Verification performance
- **Impact:** The slowest gates in every lane — `tao-cli`, `tao-apps`, `studio`, `_tao-check`,
  `runtime-toolchain`, `validator`, `_fix-tao`, `compiler` — spend their time in the product
  pipeline, opening a workspace and parsing, linking, validating, and compiling, many times per
  suite. That pipeline is 10-30x slower than its own floor for reasons that are product defects, so
  sharding, caching, and lane scheduling are all working around a cost that should not exist. An
  uncached `tao check` of WordFlower's 13 files takes 20-27s while Langium parses that app and the
  standard library in 14ms.
- **Evidence:** Measured 2026-09-21, recorded with method and profiles in
  [`Tao tooling performance.md`](<../Tao tooling performance.md>) sections 4 and 5. In short: 88.6%
  of a `tao check` profile is `realpathSync` from
  `packages/language/ast-utils/ast-utils-src/Packages.ts:620-629`; scope resolution recomputes every
  import per reference (`packages/language/parser/parser-src/value-scope.ts:645-708`); every entry
  file rebuilds the whole graph from disk (`packages/language/parser/parser-src/parser.ts:266-291`,
  `packages/compiler/compiler-src/workspace/Workspace.ts:99-111`); each `tao test` compile lands in
  fresh paths and misses Babel's cache. A ten-line experimental memo took check from 22s to 2.3s,
  fix from 9s to 1.2s, and compile from 3.2s to 0.8s.
- **Workaround:** The check memo hides the cost on an unchanged tree inside this repository; nothing
  hides it after an edit, under `tao fix`, or inside a test that opens its own workspace.
- **Proposed change:** Phase 0 of the linked report: a per-build physical-boundary table, a cached
  per-document import table, one build for the union of a workspace's entries, and stable
  content-addressed test output paths. Then give `./agent bench` a budget it asserts, since it
  reports today and fails nothing.
- **Dependencies:** The CLI and package restructure moves some of the named files; the defects move
  with them.
- **Acceptance:** Uncached `tao check "Apps/WordFlower/1 - Current"` under 1s and `tao fix` of the
  same under 1s on a quiet machine; `_fix-tao` and `_tao-check` under 5s for the whole repository;
  the `tao-apps` suite's WordFlower case under 10s; `./agent bench` fails when `Workspace.parse` of
  the WordFlower entry exceeds a stated budget.
- **Source:** Tao tooling performance research, 2026-09-21.
