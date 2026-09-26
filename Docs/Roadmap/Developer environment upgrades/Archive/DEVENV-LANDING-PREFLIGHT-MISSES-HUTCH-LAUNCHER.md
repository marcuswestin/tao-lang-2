# DEVENV-LANDING-PREFLIGHT-MISSES-HUTCH-LAUNCHER — Landing preflight misses the native Hutch launcher

- **Status:** Resolved
- **Area:** Landing, native Studio verification, host prerequisites
- **Impact:** Landing acquires the machine-wide lock and runs its initial checks before discovering
  that native Studio cannot start because the required Hutch launcher is absent.
- **Evidence:** On 2026-09-26, landing `feat/watchman-management` passed host preflight and check,
  then `studio-smoke-native` failed with `Hutch is not installed or is not available on PATH`.
  The gate classified this as `optional-tooling`, but the landing requires it and stopped after
  46.7s. Neither the primary pinned profile nor `~/.hutch/bin/hutch` contained the launcher.
  The diagnostic names the generated project's Hutch CLI pin as 0.24.3. Evidence:
  `.artifacts/logs/verify-full/2026-09-26T20-13-41-660Z-89910-ac1f2497/studio-smoke-native.log`.
  - Implemented on `feat/watchman-management`: `devenv.nix` packages the upstream launcher and
    engine using the release manifest's exact archive checksum; `./agent setup --environment`
    provisions the checkout without opening a shell. The command built Hutch 0.24.3 successfully
    through the configured Nix daemon, and `./agent unsandboxed capabilities` reported it available.
  - Landing now requires the pinned Hutch version before its queue. Focused tests prove missing,
    mismatched, and unidentified versions fail and the pinned version passes. The native cache
    initializes without a prior global installation and preserves downloaded assets on reuse.
  - Canonical network policy now permits `hutch.blackboard.sh` and
    `electrobun-artifacts.blackboard.sh`, rendered into both supported harness configurations.
    Existing sessions may retain their earlier policy; restart them to load the new domains.
- **Workaround:** Run `./agent setup --environment` after toolchain changes. If protected generated
  configuration is stale, run the existing `./agent unsandboxed fix-agent-config` operation.
- **Proposed change:** Implemented: Nix owns the immutable launcher and engine; native assets
  stay in writable worktree caches, and landing preflight rejects missing or drifted tooling.
- **Dependencies:** None.
- **Acceptance:** A host missing Hutch receives the exact setup prerequisite before joining the
  landing queue; an available supported launcher reaches native verification normally.
- **Source:** 2026-09-26 authorized hook metadata, Watchman, setup, and CLI-tail landing.
- **Archived:** 2026-09-26
