# DEVENV-THE-ANDROID-EMULATOR-CANNOT-START-IN-THE-SANDBOX — The Android emulator cannot start in the sandbox

- **Status:** Candidate
- **Section:** External
- **Area:** Android emulator, dev loop, agent sandbox
- **Impact:** `./dev android-emulator`, and `tao dev --android` when no emulator is running, wait the
  full 180-second boot timeout inside the agent sandbox and then report only
  `Android emulator did not finish booting. Check /tmp/claude-501/tao-android-emulator.log.` The
  emulator had exited within a second of starting; the reason is in that log and nowhere in the
  output, so an agent reads a slow boot and waits again.
- **Evidence:** 2026-09-22, `Tao_Pixel_API_36` on this Mac. Sandboxed, the log's last lines were
  `Incompatible processor. This Qt build requires the following features: neon`: the sandbox hides
  the CPU-feature query, so Qt concludes an Apple silicon CPU lacks NEON. The same command outside
  the sandbox booted `emulator-5554` in seconds. `android.ts`'s `waitForBootedEmulator` polls
  `adb devices` until its deadline and never looks at the emulator process or its log. Measured:
  both runs and the log lines.
- **Workaround:** Start the emulator from an unsandboxed shell (`./dev android-emulator`), then run
  everything else sandboxed; `adb` itself works from the sandbox once the emulator is up.
- **Proposed change:** Have `waitForBootedEmulator` stop polling once the emulator process has
  exited, and report the last non-empty line of its log with the remedy — for the Qt processor line,
  that the emulator needs an unsandboxed shell.
- **Dependencies:** None.
- **Acceptance:** A sandboxed `./dev android-emulator` fails within seconds, naming the emulator's own
  reason, and a dev-loop test pins that an exited emulator ends the wait.
- **Source:** 2026-09-22, proving the prebuilt Android host (`just companion-host-build`) for `A9`.
