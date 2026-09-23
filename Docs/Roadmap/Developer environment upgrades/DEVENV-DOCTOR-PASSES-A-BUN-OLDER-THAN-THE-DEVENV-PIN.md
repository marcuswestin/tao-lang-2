# DEVENV-DOCTOR-PASSES-A-BUN-OLDER-THAN-THE-DEVENV-PIN — `./agent doctor` passes a Bun older than the one devenv pins

- **Status:** In progress
- **Update:** This review branch raises doctor's minimum to Bun 1.4.2 and adds a regression for
  1.3.13, so the observed stale profile now fails with a reload instruction. The check still does
  not derive the version from the Nix pin, so a later pin bump could reopen the mismatch.
- **Section:** External
- **Area:** Host tooling
- **Impact:** A worktree whose devenv profile was built before a Bun bump keeps running the old Bun
  under every `./agent` command, and doctor reports it healthy. Most suites still pass on the old
  Bun, so nothing points at the profile; the first sign is a behaviour the bump existed to fix. For
  the standalone binary that sign is a binary macOS kills on launch, because Bun before 1.4.2
  appends its payload after the code signature.
- **Evidence:** 2026-09-22, this worktree at `530f4844`, which includes `6d16ca7b` pinning Bun 1.4.2
  in `devenv.nix`. `.devenv/profile/bin/bun` still links `bun-1.3.13`, and `./agent doctor` printed
  `PASS  bun: 1.3.13` and `this checkout is usable`. A 1.4.2 Bun was already in the Nix store.
- **Workaround:** Reload the profile (`direnv reload`, unsandboxed), or run the one command that
  needs the newer Bun with the store path directly. `standalone-build.ts` refuses a Bun older than
  1.4.2 on macOS and names the stale profile as the likely cause.
- **Proposed change:** Have doctor compare the profile's Bun against the version `devenv.nix` pins
  and report a mismatch as a failure that names the reload, rather than passing whatever Bun is on
  `PATH`.
- **Dependencies:** None.
