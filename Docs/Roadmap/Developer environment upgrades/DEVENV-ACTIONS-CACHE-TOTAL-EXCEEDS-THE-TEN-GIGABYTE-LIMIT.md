# DEVENV-ACTIONS-CACHE-TOTAL-EXCEEDS-THE-TEN-GIGABYTE-LIMIT — Actions cache total exceeds the ten-gigabyte limit

- **Status:** Candidate
- **Section:** External
- **Area:** Hosted verification caches.
- **Impact:** GitHub evicts the least recently used caches once a repository holds more than 10 GB. The two Nix store caches of the macOS workflows (`tao-devenv-nix-Linux-X64` 6.8 GB, `tao-devenv-nix-macOS-ARM64` 6.0 GB, from `cache-nix-action`) alone exceed the limit, so every `Verify` cache (`node_modules` 874 MB, Nix 326 MB, green records, generated parser, compiled WordFlower app) is a candidate for eviction between runs, and an evicted one costs a partition 60–90 s of reinstall or regeneration.
- **Evidence:** `gh cache list` on 2026-10-06 reported 15.84 GB in total across 31 caches; `ci-macos.yml` and `companion-hosts.yml` already set `gc-max-store-size-*: 6G`, which is the ceiling they reach, not a trim. The Linux devenv store duplicates what `Verify` restores as `tao-nix-Linux-X64` at 326 MB.
- **Workaround:** None needed yet; the `Verify` caches have hit on every measured run.
- **Proposed change:** Decide what the two macOS-workflow Nix stores are worth: lower `gc-max-store-size-linux` toward what `Verify` proves sufficient (326 MB plus the built profile), or drop the Linux store from `companion-hosts.yml` in favour of `Verify`'s `tao-nix-*` key; keep the macOS store, which `Verify` has no equivalent for. Re-measure with `gh cache list` after a week.
- **Dependencies:** `ci-macos.yml` and `companion-hosts.yml` owners' agreement on the gc ceilings.
- **Acceptance:** The repository's cache total stays under 10 GB for a week of landings, and no `Verify` partition reports a `node_modules` or Nix restore miss on an unchanged lock.
- **Source:** Setup-speed analysis of `Verify` after the CI completion project, 2026-10-06; `.github/workflows/verify.yml` cache steps.
