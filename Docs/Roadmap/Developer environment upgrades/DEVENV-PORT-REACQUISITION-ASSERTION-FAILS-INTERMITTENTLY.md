# DEVENV-PORT-REACQUISITION-ASSERTION-FAILS-INTERMITTENTLY — Port reacquisition assertion fails intermittently

- **Status:** Candidate
- **Section:** External
- **Area:** Expo port reservation tests
- **Impact:** An unchanged port-reuse assertion can fail broad verification and require a retry.
- **Evidence:** On 2026-09-26, `reserves a different port when :: already owns the preferred port` failed its final reacquisition assertion: expected 63098, received 63101. Log: `.artifacts/logs/verify-changed/2026-09-26T21-40-07-869Z-75787-97e539fe/apps_expo-host_4.log`. Two lanes overlapped. The exact unchanged file passed in isolation (`.artifacts/logs/agent/test-file/2026-09-26T21-42-24-099Z-87943.log`), then broad verification passed (`.artifacts/logs/verify-changed/2026-09-26T21-42-38-388Z-88084-9738bc0d/summary.json`). The cause is not established; this is not evidence of a leaked reservation or a recurrence of the archived client-close defect.
  It recurred for the `::1` variant during readiness-fix verification, expecting 50325 and
  receiving 50328, with four overlapping lanes:
  `.artifacts/logs/verify-changed/2026-09-26T22-26-03-832Z-71916-24952f8b/apps_expo-host_3.log`.
  No port-reservation implementation changed in the intervening shell/readiness follow-ups.
  The unchanged exact file passed again at
  `.artifacts/logs/agent/test-file/2026-09-26T22-30-53-186Z-52045.log`.
- **Workaround:** Retry the exact file unchanged and retain both outcomes; a focused pass does not replace the broad gate.
- **Proposed change:** Capture bind failures and listener ownership around release/reacquisition; determine whether another process acquires the released port or the reservation fails to release. Preserve the cleanup assertion rather than simply accepting any new port.
- **Dependencies:** Related to [the resolved address-coverage/client-close repair](Archive/DEVENV-RESERVED-PORT-CLIENT-CLOSE-TIMES-OUT.md), but the observed assertion and failure differ.
- **Acceptance:** Reproduce with ownership evidence, then prove the appropriate repair under concurrent runs and a mutation that leaves a partial reservation open.
- **Source:** Shell-entry simplification and native-binding coverage audit on `feat/native-binding-poc`.
