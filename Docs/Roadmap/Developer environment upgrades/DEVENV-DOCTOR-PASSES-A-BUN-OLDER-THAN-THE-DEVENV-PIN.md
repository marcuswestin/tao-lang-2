# DEVENV-DOCTOR-PASSES-A-BUN-OLDER-THAN-THE-DEVENV-PIN — `./agent doctor` passes a Bun older than the one devenv pins

- **Status:** In progress
- **Update:** This review branch raises doctor's minimum to Bun 1.4.2 and adds a regression for
  1.3.13, so the observed stale profile now fails with a reload instruction. The check still does
  not derive the version from the Nix pin, so a later pin bump could reopen the mismatch.
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
  Nix store. On 2026-09-25, after the branch's doctor repair, `./agent doctor` measured the same
  1.3.13 profile and correctly failed with a `direnv reload` instruction. The profile prerequisite
  remains external to this review branch.
- **Workaround:** Bring the primary checkout past the pin and reload its profile (`direnv reload`,
  unsandboxed), or give one worktree its own profile by running `direnv allow && direnv exec .
  ./agent setup` in it from an ordinary terminal. `standalone-build.ts` refuses a Bun older than
  1.4.2 on macOS and names the stale profile.
- **Proposed change:** Tie each worktree's toolchain to its own devenv inputs, discussed with the
  Developer on 2026-09-23:
  - A profile is keyed by the hash of the worktree's `devenv.nix`, `devenv.lock`, and `devenv.yaml`
    rather than borrowed from whichever branch the primary checkout holds. Worktrees with identical
    inputs link one shared profile, as fast as today's link; the first worktree with new inputs
    builds it. A Bun-only pin reuses everything else already in the store; a `devenv.lock` bump that
    moves nixpkgs can fetch the Android SDK and NDK the profile carries, so it may take minutes.
  - The session-start hook builds or links that profile. It already runs outside the Bash sandbox
    (`.rulesync/hooks.jsonc`), where the Nix daemon is reachable; the sandbox cannot connect to it.
  - Setup asserts, on every run, that the Bun on the profile's `PATH` is the one the worktree's own
    `devenv.nix` pins, and fails naming whose profile is stale. Doctor reports the same check.
  - **Mid-session gap.** A branch that merges a toolchain change mid-session keeps its old profile
    until something outside the sandbox rebuilds it; setup's assertion is what makes that visible.
    No new session is needed to repair it: `./agent` resolves `.devenv/profile` on every call, and
    the `PATH` the session-start hook exports names that link rather than a store path, so a person
    running `./agent setup` in the worktree from an ordinary terminal hands the running agent the
    new toolchain on its next command. Processes already running, such as a dev server or a watch,
    keep the old Bun until restarted.
- **Dependencies:** None.
