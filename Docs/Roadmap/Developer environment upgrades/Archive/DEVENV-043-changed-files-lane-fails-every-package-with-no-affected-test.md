# DEVENV-043 — Changed-files lane fails every package with no affected tests

- **Status:** Resolved
- **Area:** Verification lanes
- **Impact:** `just test-changed`, the documented ordinary iteration lane, reports red whenever a change
  touches a subset of packages, so its summary cannot be read at a glance and the real failures hide
  among sixteen spurious ones.
- **Evidence:** With 19 changed files in `parser`, `code-editor`, and `studio`, every other bun suite
  printed `--changed: 19 changed files, but no test files are affected` and `Ran 0 tests`, exited 0
  under `--pass-with-no-tests`, wrote no junit file, and the runner then recorded `test result report
  unavailable` and turned the pass into a failure (`.artifacts/logs/dev-test/2026-09-05T01-34-12-827Z-*`).
  `./agent test-retry` after a contended `_test` timeout took the same path: the dev suite ran with
  `--changed`, found no affected test files, ran 0 tests, and reported the retry as failed, so it could
  not confirm the timeout; `./agent test-file packages/dev/dev-tests/gate-runner.test.ts` passed 19 of 19.
  On a clean branch (2026-09-05, `.artifacts/logs/dev-test/2026-09-05T15-54-44-702Z-*`) the lane spawned
  all 19 bun suites, failed 18 of them the same way, and still took 21s: `runtime-jest` ran all 27 files
  and 156 tests because Jest ignores `--changedSince` when explicit test paths are also passed, so the
  changed lane never narrows its most expensive package suite. Across every recorded checkout 372 of 425
  `dev-test` runs executed 19 or more suites and 53 executed exactly one; no run selected a subset.
- **Workaround:** Run `just test-file <path>` per touched suite, and `./agent verify` for the full run.
- **Proposed change:** Treat a zero-test run under `--changed` as passed with no observations when the
  process exited 0, or drop suites whose packages have no changed files before spawning them. For the
  retry path the narrower cause is that `TestRunner.runSuites` passes `changedReference:
  prepared.changed?.reference` for every kind, while a `retry` run populates `prepared.changed` only to
  compute its advisory line; passing it solely when `prepared.kind === 'changed'` keeps a retry on the
  ledger's own file list. For `runtime-jest`, omit the positional file list in changed mode (or run
  `jest --listTests --changedSince` first and spawn nothing when it is empty) so `--changedSince` is
  honoured.
- **Dependencies:** Implemented on `feat/granular-test-selection-dfed54`: the changed lane no longer
  uses Bun's `--changed` or Jest's `--changedSince` at all. A probe showed Bun's selection also stops at
  the package boundary (a change to `packages/shared/shared-src/shared.ts` selected no `compiler`
  test), so `TestSelection.planChangedSuites` selects whole suites from `PackageGraph`, the workspace
  import graph read from each package's `@alias` imports; `package.json` was not usable because seven
  packages import a workspace package their manifest omits. `just verify` now requires `--changed` or
  `--complete`, and every lane records the tree it proved green so an identical tree is not re-run.
- **Acceptance:** A change confined to one package leaves `just test-changed` green with only that
  package's suites reported, and a clean branch reports nothing selected in well under five seconds.
- **Source:** 2026-09-04 Studio syntax lens work.
- **Archived:** 2026-09-19
