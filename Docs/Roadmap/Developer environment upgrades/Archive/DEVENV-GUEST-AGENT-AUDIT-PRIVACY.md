# DEVENV-GUEST-AGENT-AUDIT-PRIVACY — Guest agent audit privacy

- **Status:** Resolved
- **Area:** Standalone CLI clean-machine VM transport and filesystem audit.
- **Impact:** Moving from remote login to the Tart guest agent made the whole-volume guest scan wait for a Desktop privacy prompt. Product acceptance could not begin unattended.
- **Evidence:** Run `tao-acceptance-1790403436-61968` reached `tart exec` in 20 seconds. Its `logs/guest-processes.log` shows the filesystem auditor running; `logs/guest-privacy.log:6050` records `AUTHREQ_PROMPTING` for `kTCCServiceSystemPolicyDesktopFolder`, attributed to the guest agent. In run `tao-acceptance-1790403967-31484`, host scans of the stopped disk completed before and after a passing CLI/browser acceptance. Replaying those snapshots with the explicit boot-activity policy produced zero violations while retaining the incomplete-observation flag.
- **Workaround:** Do not edit privacy databases or disable system protections. The gate now scans the stopped clone through ordinary host filesystem access.
- **Proposed change:** Provision a pinned guest agent and fixtures on the stopped vanilla clone; run guest commands only through `tart exec`; stop and mount the clone to collect logs and compare metadata snapshots. Select its APFS Data volume, normalize device numbers across mounts, and retain the clone when disk detachment or evidence collection fails. Reject extra host-operation arguments before invoking the recipe runner.
- **Dependencies:** Tart 2.32.1 or newer, guest agent 0.10.0 with a pinned archive digest, a raw macOS clone, matching guest/host ownership, and the host's installed browser fixture. No guest developer toolchain or remote-login transport is required.
- **Acceptance:** Fresh run `tao-acceptance-1790404661-65809` passed in 148 seconds: installed CLI workflows and browser interaction through `tart exec`, retained guest logs, zero disallowed metadata changes, and disposable VM cleanup. Recovery can stop a guest even when RPC is unavailable. The 165/164 inaccessible OS paths remain reported, and transient writes and file contents remain outside metadata-snapshot evidence.
- **Source:** Guest process/privacy logs, stopped-disk snapshots, transport tests, and host argument-validation tests, 2026-09-26.
- **Archived:** 2026-09-26
