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
  of a `tao check` profile was `realpathSync` from the symlink guard in `Packages.targetMatches`,
  **fixed in the change that added this entry** (check 22s to about 2.3s, fix 9s to 1.2s, compile
  3.2s to 0.8s). Fixed since: the scope provider remembers what each `use` statement resolves to; a
  workspace's entries are built once rather than once per entry, and `check` and `fix` read that
  build (WordFlower check 1.22s, fix 0.80s); `tao test` writes its Jest entrypoints beside the run
  roots and stores each compiled app by the hash of its contents, so nothing Jest hashes into a
  cache key moves unless the output did — counted on WordFlower, a run after an edit re-transformed
  all 2,135 modules it loads, then 650, and now 120, the one module tree the edit changed; an
  unchanged run re-transforms nothing. Still open: validation runs once per entry over that entry's
  whole graph, and opening a workspace costs 0.10-0.15s in `Packages.createContext`.
- **Workaround:** The check memo hides the cost on an unchanged tree inside this repository; nothing
  hides it after an edit, under `tao fix`, or inside a test that opens its own workspace.
- **Proposed change:** Phase 0 of the linked report is done bar its dropped item (a cache for a
  packaged CLI, which Ro dropped until one exists). What remains here is past Phase 0: one
  discovery per process in `Packages.createContext`, and validating a file once per batch.
- **Dependencies:** The CLI and package restructure moves some of the named files; the defects move
  with them.
- **Acceptance:** Uncached `tao check "Apps/WordFlower/1 - Current"` under 1s and `tao fix` of the
  same under 1s on a quiet machine; `_fix-tao` and `_tao-check` under 5s for the whole repository;
  the `tao-apps` suite's WordFlower case under 10s; `./agent bench` fails when `Workspace.parse` of
  the WordFlower entry exceeds a stated budget.
- **Source:** Tao tooling performance research, 2026-09-21.
