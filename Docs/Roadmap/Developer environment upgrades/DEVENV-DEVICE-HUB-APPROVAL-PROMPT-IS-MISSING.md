# DEVENV-DEVICE-HUB-APPROVAL-PROMPT-IS-MISSING — Device Hub approval prompt is missing

- **Status:** Candidate
- **Section:** External
- **Area:** Desktop computer use, effective session permissions, native acceptance
- **Impact:** Device Hub inspection remains unproven through computer use. A fresh task can obtain an approval prompt, but app selection times out after approval, leaving visual navigation acceptance dependent on manual review.
- **Evidence:** On 2026-09-26, requesting `com.apple.dt.Devices` through the computer-use app selector immediately returned `Computer Use was not approved to use Device Hub`. The Developer's screenshot showed Any App enabled and an empty Always-allowed apps list. The active task reported approval policy `never`, while the generated repository configuration and the system configuration both specified `on-request` with automatic review. The repository generator emits those same values. No computer-use policy override appeared in the inspected repository, user or system configuration; the two inspected local requirements-file locations were absent. These observations identify a session/configuration mismatch, not its source or a proven cause of the missing prompt. Managed remote policy and desktop session overrides remain unexamined.
- **Workaround:** Use the existing named device install/launch workflows and manual visual review. Installation and successful launch are not UI acceptance.
- **Proposed change:** First establish whether Device Hub has a responsive visible window, then make one supported inspection attempt after that state change. If the timeout persists, inspect the desktop computer-use diagnostics and the existing macOS Screen Recording and Accessibility grants read-only before proposing a targeted intervention. Separately investigate which layer selected `never` in the earlier task; it did not recur in this fresh task. No repository configuration change is supported by these results. Do not change the sandbox, forge saved approvals, or hand-edit generated configuration. The [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) distinguishes app access policy from normal approval and persistence; an `allow` rule alone grants neither. [Computer-use guidance](https://learn.chatgpt.com/docs/computer-use#permissions-and-approvals) distinguishes application approval from macOS permissions.
- **Dependencies:** Desktop session permission controls and user approval; inspect applicable managed policy if the mismatch persists. No configuration changes authorized by this research-only follow-up.
- **Acceptance:** Establish which layer selected `never`; reproduce an actual app approval prompt with interactive approval enabled; confirm approved Device Hub inspection succeeds; verify a future task can reuse saved approval when selected. Document the smallest required change and its owner, preserving repository sandbox protections.
- **Source:** Native navigation physical-review follow-up on `feat/native-navigation-implementation`, 2026-09-26.

## Fresh-task verification — 2026-09-26

Branch `feat/device-hub-approval-verification` was created with `./agent start-branch` from fetched
`origin/main` at `1f2710f22184`. Task `01a0df1f-5f0f-7862-b2f7-ceadc1c67fd5` inspected its own
live `turn_context` record before requesting app access: at `2026-09-26T19:09:32.235Z`, the effective
policy was `on-request`, the reviewer was `auto_review`, and the sandbox was `workspace-write`.
This is runtime evidence, not an inference from configuration files. A filtered copy is saved locally
at `.artifacts/investigation/device-hub-effective-policy.json`.

1. The supported Computer Use call `await cua.getApp("com.apple.dt.Devices")` returned the exact
   error below after 13.844 seconds. No app binding, accessibility state, or screenshot was returned.
2. The Developer confirmed: “A prompt appeared and I approved it.” This establishes that the
   original missing-prompt symptom did not recur in this task.
3. One attempt after that confirmed approval returned the same error after 9.220 seconds. This was
   a changed approval state, not a retry of an unchanged denial. Neither attempt returned the earlier
   `Computer Use was not approved to use Device Hub` error.
4. `await cua.listApps()` succeeded and reported `com.apple.dt.Devices` as `isRunning: true`.
   Inventory visibility is not evidence of access to the app's window or its contents.
5. On the Developer's explicit request to try again, a further `getApp` attempt returned the same
   timeout after 9.676 seconds, with no accessibility state or screenshot. The next proposed check
   is System Settings → Privacy & Security → Accessibility and Screen Recording for the desktop
   computer-use helper named in the official guidance. If either permission is disabled, the
   Developer can enable that specific grant through the normal UI; if both are enabled, leave them
   unchanged and investigate the timeout. Their current state and the cause remain unverified.

```text
Computer Use server error -10005: timeoutReached
```

| Layer                      | Measured result and limit                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task/session override      | Effective `on-request` / `auto_review`; the prior `never` mismatch is absent here. The source of that earlier override remains unknown.                                                                                                                                   |
| Repository configuration   | `.codex/config.toml:19-21` selects `tao-workspace`, `on-request`, and `auto_review`; `packages/cli/agent-cli/agent-cli-src/agent-config/CodexConfigGenerator.ts:130-132` emits those values. No computer-use override was found in the generated configuration.           |
| Machine/user configuration | `/etc/codex/config.toml:6-8` selects `:workspace`, `on-request`, and `auto_review`. Neither it nor the inspected user configuration contains computer-use policy keys; the user configuration contains no approval-policy or reviewer override.                           |
| Managed policy             | `/etc/codex/requirements.toml`, `~/.codex/requirements.toml`, and `/etc/codex/managed_config.toml` were absent. Cloud requirements and macOS MDM were not inspected; absence of local files does not exclude them. No managed-policy denial was reported by this attempt. |
| Saved app approval         | The Developer confirmed approval through the normal prompt. Whether Always allow was selected and whether a later task can reuse approval were not established. Consent records were not edited.                                                                          |
| macOS permissions          | Screen Recording and Accessibility grants were not independently inspected. The timeout does not identify either as its cause, and successful app inventory does not prove either grant.                                                                                  |

The [configuration layering documentation](https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence)
explains why file defaults alone cannot establish the active task policy. The
[managed configuration documentation](https://learn.chatgpt.com/docs/enterprise/managed-configuration)
also identifies cloud requirements and macOS managed preferences as distinct policy sources.

Verdict: **blocked for actual inspection; approval prompting works in this task**. No device
apps were installed, removed, launched, or modified by the investigation. No sandbox, permission
setting, saved consent record, or generated configuration was changed. Persistence remains an
explicit separate fresh-task check, to be started only by the Developer.
