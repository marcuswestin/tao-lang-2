# DEVENV-015 — Reliable host-browser verification

- **Status:** Planned
- **Section:** Deferred
- **Area:** Studio browser smoke
- **Impact:** Studio's simulated-user browser journey and React Native DevTools startup work from an
  independent desktop terminal, but GUI application startup in a managed task can abort before CDP
  becomes available. Ordinary `verify` intentionally omits this host proof.
- **Evidence:** On 2026-09-21, the unlanded diagnostic commit `2f55493d` recorded one managed-task
  Chrome launch and one React Native DevTools launch exiting with `SIGABRT` in
  `_RegisterApplication`. The React Native DevTools crash report identified Python as parent and
  `com.openai.codex` as resource coalition. `launchctl managername` returned `Aqua`, so that check
  cannot identify the failing context. `open -na` and `launchctl asuser` could not resolve the
  signed apps. No standalone `chrome-headless-shell` binary was available, and the pinned download
  was blocked. These are findings from that commit, not changes incorporated here.
  A separate full-access task in the same `com.openai.codex` coalition reached Chrome CDP, passed
  the Studio simulated-user journey, and launched the pinned React Native DevTools shell through
  `@react-native/debugger-shell` 0.86.3. Coalition membership alone therefore does not explain
  the managed-task abort. The earlier direct Electron CDP probe passed an unsupported
  `--remote-debugging-port` option, which the app rejected; that probe does not establish frontend
  load.
  On 2026-09-21, an independent iTerm2 session was recorded before either app launch. Its shell
  and CLI inherited iTerm2 resource coalition 46131; `TERM_PROGRAM=iTerm.app` and
  `CODEX_SANDBOX` was absent. One `./agent studio-smoke
  packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts terminal-session-proof`
  run passed after `./agent parser-gen`: Chrome PID 34719, parent 34648, a fresh profile, CDP
  `/json/version` reachable on port 56432, and an empty browser-console artifact. One bounded
  launch through the pinned debugger-shell package API returned 0. macOS logs identified React
  Native DevTools PID 36854, iTerm2 as responsible application, LaunchServices check-in,
  foreground activation, an Electron window, and exit when its 12-second launcher ended. No new
  `.ips` crash report appeared. The live monitor missed the DevTools process, so its direct parent
  and resource coalition were not captured; the ProcessManager check-in named iTerm2's jetsam
  coalition 46132. The supported API exposed no CDP port. Rendered frontend content and attachment
  to a live Hermes target remain unverified. This proves an ordinary iTerm2 desktop host, not
  Terminal.app specifically or reliable managed-task startup.
- **Workaround:** From an independent desktop terminal, run `./agent parser-gen` if generated
  parser artifacts are missing, then `./agent studio-smoke
  packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts <unique-run-id>`.
  `StudioCdp.launchChrome` owns a fresh browser profile and closes it. Use the pinned
  `@react-native/debugger-shell` API with `frontendUrl` and `windowKey` for a bounded DevTools
  startup proof; do not pass Chrome's CDP flag to that API.
- **Proposed change:** Establish a repeatable host-only lane for the Studio journey and supported
  React Native DevTools startup. Diagnose the managed session's GUI registration boundary before
  changing repository sandbox rules. Record the launcher's ancestry, selected non-secret
  environment, launch method, app parent and coalition when observable, exit status, crash stack,
  and CDP reachability. Use one bounded launch per app in each new host context. Keep frontend
  and Hermes attachment claims separate from shell registration.
- **Candidate mitigations:** A standalone pinned headless shell remains untested and would cover
  Chrome only. LaunchServices handoffs failed in the managed task. `StudioCdp.attach()` selects an
  existing page without creating an isolated browser context or owning the process, so a shared
  browser is not yet safe for parallel lanes. A fast-fail based only on `launchctl managername` is
  invalid on the failing host because it also reports `Aqua`.
- **Dependencies:** Semantic-agent, companion, and freehand Studio changes must land first.
- **Acceptance:** The full Studio browser journey and the supported React Native DevTools launch
  run repeatably in their declared host context; failures yield one bounded, actionable report.
  Studio-heavy landing evidence requires the browser proof. DevTools frontend load and live Hermes
  attachment require separate evidence if claimed.
- **Source:** 2026-09-03 freehand implementation summary; 2026-09-16 September remediation
  acceptance and runaway-process investigation; 2026-09-21 unlanded diagnostic `2f55493d` and
  independent iTerm2 host proof.
