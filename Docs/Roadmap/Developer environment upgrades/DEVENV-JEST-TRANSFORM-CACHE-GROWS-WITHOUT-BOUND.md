# DEVENV-JEST-TRANSFORM-CACHE-GROWS-WITHOUT-BOUND — Jest's transform cache grows without bound

- **Status:** Candidate
- **Section:** External
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
  hit again.
- **Workaround:** Delete the directory by hand; the next run of each suite re-transforms everything
  once.
- **Proposed change:** Name a `cacheDirectory` in `packages/apps/expo-host/jest.shared.config.cjs`
  that this repository owns, per checkout or under the user cache directory, and retire entries by
  age where `TestRunRoot.prune` already retires run roots, since a transform nothing has read in a
  week belongs to a compile nothing will ask for again.
- **Dependencies:** None. Compiling what test variants share once per run, in
  [`Tao tooling performance.md`](<../Tao tooling performance.md>), shrinks what each compile adds but
  does not bound the total.
- **Acceptance:** After a week of ordinary use the Jest cache directory holds a bounded number of
  files, stated in the config beside the retention rule, and a test in the run-root suite proves an
  old entry is retired and a recent one is kept.
- **Source:** Tao tooling performance work, 2026-09-21.
