# DEVENV-085 — Jest crawled the compile cache, so the better the cache worked the slower every run got

- **Status:** Resolved
- **Area:** Verification performance
- **Impact:** Jest builds the file map it discovers tests from by crawling `roots`, which defaults to
  `rootDir` — the whole `packages/runtime-toolchain` package. That package also holds
  `_gen_tao-app-test`, the cache of compiled run roots introduced alongside it, and that cache exists
  in order to grow: retaining a passing run root is what spares the next run its compile. Every
  `tao test` therefore paid a crawl that got longer the more the cache succeeded, whether or not the
  run reused anything. The package's own unit-test config had the same uncorrected default and paid
  the same cost.
- **Evidence:** `jest --listTests` — no transform, no execution — took 1.18–1.24s cold-cache at
  34,337 cached files against 0.21–0.22s with `roots` named, and 0.63–0.69s against 0.14–0.15s warm.
  Cold-cache `sys` time dropped from 4.9–5.3s to 0.29s, which is filesystem syscalls over the cached
  tree. End to end, `tao test "Apps/Test Apps/Time"` went 1.64s to 1.11s and `tao test Apps` 5.1s to
  4.6s, with Jest's own clock **identical** in both columns — the whole saving sits outside it. The
  cache tree grew from 19,228 to 54,753 files during one session, so the cost was still climbing.
- **Workaround:** `just clean`, which deletes the cache and gives back the crawl until it refills.
- **Change made:** `jest.shared.config.cjs` names `roots` — the package's test and source
  directories — so both configs inherit it, and the `tao test` config adds the one directory holding
  the entrypoints it generates. This is safe because Jest resolves a path against the filesystem
  rather than against the crawled map: the compiled apps are required by absolute path, and the
  mapped `@runtime/*` and `@shared/*` modules already live outside `rootDir` and resolve.
  `modulePathIgnorePatterns` was rejected on evidence — it makes matching modules unresolvable, and
  the journeys import the compiled apps from under the same run root.
- **Side effect worth knowing:** the haste-map cache file per run drops from 11.8 MB rewritten every
  run to ~12 KB. The entrypoint directory is part of the cache key, so each run root gets its own
  small file; these accumulate unpruned in Jest's cache directory, which is negligible beside the
  transform cache already there.
- **Dependencies:** DEVENV-081 introduced the retained run roots this crawl was paying for.
- **Acceptance:** `jest --listTests` stays flat as `_gen_tao-app-test` grows, and `tao test Apps`
  wall time does not track the cached file count.
- **Source:** 2026-09-19 Jest sharding measurement, which found this while profiling something else.
