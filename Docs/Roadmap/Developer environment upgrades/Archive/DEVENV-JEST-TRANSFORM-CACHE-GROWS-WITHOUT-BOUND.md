# DEVENV-JEST-TRANSFORM-CACHE-GROWS-WITHOUT-BOUND — Jest's transform cache grows without bound

- **Status:** Resolved
- **Area:** Test infrastructure
- **Impact:** Jest keeps every transform it has ever cached and never evicts one. No Jest config in
  this repository names a `cacheDirectory`, so the cache lands in Jest's default under the temp
  directory (`$TMPDIR/jest_dx`), outside every worktree, where nothing of ours prunes it either. On
  this machine it held 3,491,320 files when measured. Every file is small, so the cost is inodes and
  directory operations rather than bytes: counting the directory took about ten seconds, and
  anything that walks or cleans the temp directory pays for all of it.
- **Evidence:** Counted 2026-09-21 with `find "$TMPDIR/jest_dx" -type f` around single `tao test`
  runs of WordFlower. Each run that compiled a new run root added exactly 2,135 files, the whole
  module graph the run loads, because the run root's path was part of Jest's configuration and Jest
  hashes its configuration into every cache key. The change that added this entry moved the
  entrypoints out of the run root, which cut the growth to 650 files per compile, and the change
  after it stored the compiled apps by their contents, which cut it to 116 after an edit and none
  without one. The growth is now proportional to distinct compiled output rather than to runs, and
  still unbounded: entries written under a configuration or path that no longer exists can never be
  hit again. On 2026-09-23, the old shared directory still had 154,815 files before a focused
  run. The final `~/.cache/tao` checkout cache held 1,526 files after the first run and both
  unchanged repeats. An earlier temporary prototype reached 1,528 files after a source edit and
  stayed there on the next repeat; those task-owned prototype files were removed. The old shared
  directory did not grow during the unchanged repeats. Other concurrent activity brought its
  observed count to 160,319.
- **Workaround:** A reviewed one-time removal of the old shared directory after confirming no
  active Jest processes use it; the next run of each older checkout re-transforms its modules once.
- **Change made:** `jest.shared.config.cjs` now names a checkout-scoped cache instead of Jest's
  machine-wide default. `tao test` places it under `~/.cache/tao`, outside macOS temporary-file
  cleanup, using `TestRunRoot`'s checkout identity, and
  evicts old transforms after the last concurrent test process exits, with limits of 25,000 files
  and 256 MiB per checkout. A process lease and filesystem lock keep active Jest readers out of
  pruning; a later run reclaims an interrupted process's lease after an hour of grace for any
  surviving Jest child. Pruning also removes empty Jest
  hash buckets. A count and byte cap were chosen over age alone: Jest does not refresh a transform
  file's modification time on cache hits, so age would also retire frequently reused transforms.
- **Dependencies:** None. Compiling what test variants share once per run, in
  [`Tao tooling performance.md`](<../../Tao tooling performance.md>), shrinks what each compile adds but
  does not bound the total.
- **Acceptance:** The cache lifecycle suite proves file and byte bounds, cross-worktree isolation,
  concurrent reader safety, failed-run cleanup, and interrupted-process recovery. The concurrency
  assertion failed when the reader guard was deliberately removed. Repeated real `tao test` runs
  showed a stable file count on unchanged input, including after a source edit. Longer-lived use remains
  observable after landing; it is not needed to establish the enforced limits.
- **Source:** Tao tooling performance work, 2026-09-21.
- **Archived:** 2026-09-23
