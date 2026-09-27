# DEVENV-DEVICE-HUB-APPROVAL-PROMPT-IS-MISSING — Device Hub approval prompt is missing

- **Status:** Candidate
- **Section:** External
- **Area:** Desktop computer use, effective session permissions, native acceptance
- **Impact:** Device Hub inspection remains unproven through computer use. A fresh task can obtain an approval prompt, but app selection times out after approval, leaving visual navigation acceptance dependent on manual review.
- **Evidence:** On 2026-09-26, requesting `com.apple.dt.Devices` through the computer-use app selector immediately returned `Computer Use was not approved to use Device Hub`. The Developer's screenshot showed Any App enabled and an empty Always-allowed apps list. The active task reported approval policy `never`, while the generated repository configuration and the system configuration both specified `on-request` with automatic review. The repository generator emits those same values. No computer-use policy override appeared in the inspected repository, user or system configuration; the two inspected local requirements-file locations were absent. These observations identify a session/configuration mismatch, not its source or a proven cause of the missing prompt. Managed remote policy and desktop session overrides remain unexamined.
- **Workaround:** Use the existing named device install/launch workflows and manual visual review. Installation and successful launch are not UI acceptance.
- **Proposed change:** First establish whether Device Hub has a responsive visible window, then make one supported inspection attempt after that state change. If the timeout persists, inspect the desktop computer-use diagnostics and the remaining macOS Device Control and Data Access grant read-only (the former Accessibility permission) before proposing a targeted intervention. Separately investigate which layer selects `never`: it was absent in the September 26 follow-up but recurred in the September 27 continuation. No repository configuration change is supported by these results. Do not change the sandbox, forge saved approvals, or hand-edit generated configuration. The [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) distinguishes app access policy from normal approval and persistence; an `allow` rule alone grants neither. [Computer-use guidance](https://learn.chatgpt.com/docs/computer-use#permissions-and-approvals) distinguishes application approval from macOS permissions.
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
   was to inspect the two macOS permissions for the desktop computer-use helper. The follow-up
   screenshot confirms Screen & System Audio Recording is enabled. The remaining check is
   System Settings → Privacy & Security → Device Control and Data Access. If that grant is disabled,
   the Developer can enable it through the normal UI; otherwise leave it unchanged and investigate
   the timeout. The cause remains unverified.
6. The Developer’s screenshot at 15:24:21 on 2026-09-26 shows the computer-use helper’s screen
   recording switch enabled. The prior screenshot shows Device Control and Data Access in Privacy
   & Security; [current macOS 27 guidance](https://learn.microsoft.com/en-us/purview/endpoint-dlp-macos-27-changes#permission-changes-in-macos-27)
   confirms this replaces the former Accessibility privacy entry. Its grant was not shown.
   Restarting the desktop app was proposed as the smallest restart experiment, followed by Device
   Hub if needed; no restart or post-restart access result was observed in this investigation.

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
| macOS permissions          | The Developer’s screenshot shows Screen & System Audio Recording enabled for the computer-use helper. Device Control and Data Access remains unverified. A visible enabled switch does not prove successful capture or identify the timeout’s cause.                      |

The [configuration layering documentation](https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence)
explains why file defaults alone cannot establish the active task policy. The
[managed configuration documentation](https://learn.chatgpt.com/docs/enterprise/managed-configuration)
also identifies cloud requirements and macOS managed preferences as distinct policy sources.

Verdict: **blocked for actual inspection; approval prompting works in this task**. No device
apps were installed, removed, launched, or modified by the investigation. No sandbox or generated
configuration was changed; no permission settings or saved consent records were manually edited. Persistence remains an
explicit separate fresh-task check, to be started only by the Developer.

## Continuation verification — 2026-09-27 UTC

Task `01a0e10b-5bde-7ae0-9d0d-6a00f248fa08` started in its own worktree at
`413809789db4decd83dc29f5f96d5acd2d5f0d8e` and created
`feat/device-hub-approval-continuation` from that commit, preserving the investigation changes.

1. Its live `turn_context` at `2026-09-27T04:06:57.027Z` reports approval policy `never`,
   reviewer `user`, and sandbox `workspace-write`, with network access enabled. The repository
   and system configuration still specify `on-request` and `auto_review`. The fresh task therefore
   did not establish that configuration defaults became its effective policy. The selecting layer
   and its relationship to the app inspection timeout remain unknown. A filtered runtime record
   is retained locally at `.artifacts/investigation/effective-policy.json`.
2. `./agent unsandboxed capabilities` reported no sandbox detected for that named host operation
   and available Hutch, Watchman, Nix, CoreSimulator, Docker, and process inspection. This is
   evidence about the approved host command, not a change to the task's shell policy. The earlier
   missing-Hutch blocker was not reproduced; no environment rebuild was needed. `./agent board`
   reported no registered lane, no named resource lease, and a free landing lock at this check.
3. One supported `await cua.getApp("com.apple.dt.Devices")` attempt returned
   `Computer Use server error -10005: timeoutReached` in 5.989 seconds, with no accessibility
   state or screenshot. It did not return the earlier app-approval denial, but the tool result
   does not establish whether a prompt appeared or whether saved approval was reused. No further
   app-access attempt was made in this continuation.

Verdict: **actual inspection, saved-approval persistence, and the source of the effective policy
remain unproven**. The September 26 approval and screenshot evidence remain valid within their
stated limits. Device Control and Data Access is still unverified. Documentation landing is
independent of Computer Use acceptance. No device app or configuration was changed by this
continuation; no permission settings or saved consent records were manually edited.

## Duo acceptance continuation — 2026-09-27 UTC

The independent `feat/iphone-duo-acceptance` checkout started at `c21b2226eeba`. Its effective
session instructions specify `workspace-write` and approval policy `never`. One supported
app-selection attempt using `/Applications/Xcode-27.1.app/Contents/Applications/DeviceHub.app`
returned `Computer Use was not approved to use Device Hub`. No app binding, accessibility tree,
or screenshot was returned. The task did not retry through another control or capture route.
Its named `./agent unsandboxed capabilities` command also refused before host dispatch because
it detected the sandbox; that shell result is separate from the application-access denial.

Neither HNReaderStub nor Native Navigation was visually accepted. The requested fold, rotation,
Split View, keyboard, and active-presentation matrix remains unrun, with no manual results
supplied. Evidence and resource ownership are retained in the task checkout's
`.artifacts/duo-acceptance/disposition.md`. The source of the effective policy remains unknown;
no saved permission, generated configuration, or global Xcode selection was changed.

## Independent Duo completion check — 2026-09-27 UTC

The clean `feat/iphone-duo-completion` checkout branched from the requested
`a66fd77290f8ccb98706cdcb915e470304bba732`, leaving `feat/iphone-duo-acceptance` unchanged.
Its effective session instructions again specify `workspace-write` and approval policy `never`.
One supported app-selection request for
`/Applications/Xcode-27.1.app/Contents/Applications/DeviceHub.app` returned exactly:

```text
Computer Use was not approved to use Device Hub
```

UI acceptance stopped at that denial; no alternate control or capture route was attempted.
Neither HNReaderStub nor Native Navigation was observed rendering. Closed outer display, open
inner portrait/landscape, book/tabletop folds, both Split View sides, keyboard, and active
sheet/dialog continuity all remain unverified. No demonstrated visual defect justified a
compatibility change.

The separate named `./agent unsandboxed capabilities` operation succeeded and reported no
sandbox detected, unlike the prior task. `setup-ios --xcode-version 27.1 --runtime-version 27.1`
reported ready, and simulator inventory found Duo shutdown with its expected UDID. These shell
results do not grant access to Device Hub. A later JSON setup probe with output redirection was
refused before host dispatch as still sandboxed; it was not retried with another spelling.
Current evidence and cleanup ownership live in this checkout's
`.artifacts/duo-acceptance/disposition.md`.

The merged Companion was rebuilt successfully in this checkout using scoped Xcode 27.1
(`27A9269`) and `iphonesimulator27.1` (`24A94403`), for arm64 and x86_64. Its manifest and
binary hashes are retained in `.artifacts/duo-acceptance/build-receipt.json`; the host is at
`.artifacts/hosts/1.0.0-f05fbf78600c/ios-simulator`. It was not installed or visually accepted.
The global developer selection remains `/Applications/Xcode.app/Contents/Developer`.
No older host was found in the inspected local caches, and a release API request returned 404;
an older compatible published host and old-SDK comparison remain unestablished.

## Fresh Duo finish check — 2026-09-27 UTC

`feat/iphone-duo-finish` started in its own clean checkout at
`b2be40fe3584cc8481bff71dd7535e1354074f38`, preserving both preceding branches. Its effective
session instructions specify `workspace-write` and approval policy `never`. One supported
app-selection request for `/Applications/Xcode-27.1.app/Contents/Applications/DeviceHub.app`
again returned `Computer Use was not approved to use Device Hub`, without an app binding,
accessibility state, or screenshot. UI acceptance stopped; no alternate route or further
fresh-task retry was attempted. Resuming requires approval for Device Hub through the desktop
application's supported controls and a successful supported inspection. The layer causing the
denial remains unknown; another checkout alone has not resolved it.

The named host capability check succeeded and found Hutch. Inspection-only
`setup-ios --xcode-version 27.1 --runtime-version 27.1 --json` reported ready, Xcode build
`27A9269`, SDK `27.1`, and a healthy available runtime. Global developer selection remained
`/Applications/Xcode.app/Contents/Developer`; Duo `E8F814CE-F94E-4035-97A9-359EA8CA2230` was
shutdown. No new host was built, installed, or launched while UI acceptance was blocked.
The earlier binary receipt remains historical and does not describe an installed binary in
this checkout. Neither app nor any part of the display/fold/presentation matrix was accepted.
Old-host/new-SDK comparison and broad verification remain outstanding; landing is held.

Before resuming, account for `app-dev --ios` selecting the first booted iOS simulator.
The documented Studio selected-simulator action provides explicit targeting for an installed
Companion; booting Duo alone does not make the generic launch safe when another device is
already booted. Current disposition and ownership are retained at
`.artifacts/duo-acceptance/disposition.md` in the finish checkout.
