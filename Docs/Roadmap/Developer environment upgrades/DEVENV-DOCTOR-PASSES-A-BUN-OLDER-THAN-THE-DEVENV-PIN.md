# DEVENV-DOCTOR-PASSES-A-BUN-OLDER-THAN-THE-DEVENV-PIN — `./agent doctor` passes a Bun older than the one devenv pins

- **Status:** Candidate
- **Section:** External
- **Area:** Host tooling
- **Impact:** A linked worktree reuses the primary checkout's devenv profile, and that profile is
  built from whatever `devenv.nix` the primary checkout has checked out. A toolchain pin that lands
  on `main` therefore reaches no worktree, and no landing lane, until the primary checkout itself
  moves past it and reloads — and doctor reports the old toolchain healthy. Most suites still pass
  on the old Bun, so nothing points at the profile; the first sign is a behaviour the bump existed
  to fix. For the standalone binary that sign is a binary macOS kills on launch, because Bun before
  1.4.2 appends its payload after the code signature, which is why its acceptance cannot yet run
  in the ordinary suite.
- **Evidence:** 2026-09-22, this worktree at `530f4844`, which includes `6d16ca7b` pinning Bun 1.4.2
  in `devenv.nix`. `.devenv/profile` links `/Users/ro/code/tao-lang-2/.devenv/profile`, the primary
  checkout's, built on 2026-09-22 from `dev/ro` at `071101d1` (2026-09-21), which predates the pin;
  its `bin/bun` is 1.3.13. `./agent doctor` printed `PASS  bun: 1.3.13` and `this checkout is
  usable`, and the slice-2 landing's `verify-full` ran on that Bun. A 1.4.2 Bun was already in the
  Nix store.
- **Workaround:** Bring the primary checkout past the pin and reload its profile (`direnv reload`,
  unsandboxed), or run the one command that needs the newer Bun with the store path directly.
  `standalone-build.ts` refuses a Bun older than 1.4.2 on macOS and names the stale profile.
- **Proposed change:** Have doctor compare the profile's Bun against the version the worktree's own
  `devenv.nix` pins and report a mismatch as a failure naming whose profile is stale, rather than
  passing whatever Bun is on `PATH`. Separately, decide whether a linked worktree should keep
  borrowing a profile built from another branch's `devenv.nix` at all.
- **Dependencies:** None.
