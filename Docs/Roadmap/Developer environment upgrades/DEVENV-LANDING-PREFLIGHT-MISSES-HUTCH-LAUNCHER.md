# DEVENV-LANDING-PREFLIGHT-MISSES-HUTCH-LAUNCHER — Landing preflight misses the native Hutch launcher

- **Status:** Candidate
- **Section:** External
- **Area:** Landing, native Studio verification, host prerequisites
- **Impact:** Landing acquires the machine-wide lock and runs its initial checks before discovering
  that native Studio cannot start because the required Hutch launcher is absent.
- **Evidence:** On 2026-09-26, landing `feat/watchman-management` passed host preflight and check,
  then `studio-smoke-native` failed with `Hutch is not installed or is not available on PATH`.
  The gate classified this as `optional-tooling`, but the landing requires it and stopped after
  46.7s. Neither the primary pinned profile nor `~/.hutch/bin/hutch` contained the launcher.
  The diagnostic names the generated project's Hutch CLI pin as 0.24.3. Evidence:
  `.artifacts/logs/verify-full/2026-09-26T20-13-41-660Z-89910-ac1f2497/studio-smoke-native.log`.
- **Workaround:** Install the required pinned launcher with the Developer's dependency approval,
  then retry the authorized landing. Do not skip the native gate.
- **Proposed change:** Check the native launcher's availability and required version in landing's
  preflight before acquiring the lock; expose an approved, pinned setup operation through the
  repository command front door.
- **Dependencies:** None.
- **Acceptance:** A host missing Hutch receives the exact setup prerequisite before joining the
  landing queue; an available supported launcher reaches native verification normally.
- **Source:** 2026-09-26 authorized hook metadata, Watchman, setup, and CLI-tail landing.
