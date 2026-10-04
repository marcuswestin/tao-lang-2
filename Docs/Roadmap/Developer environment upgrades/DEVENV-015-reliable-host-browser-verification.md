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
  On 2026-09-21, a fresh managed checkout at `f8e5d195` recorded its context before either app
  launch: Python -> codex -> ChatGPT, all in resource coalition 34940 (`com.openai.codex`),
  `CODEX_SANDBOX=seatbelt`, no `TERM_PROGRAM` or `SSH_TTY`, workspace-write permissions with no
  approval escalation, and `launchctl managername=Aqua`.
  The approved `ps` shape was denied; libproc supplied the ancestry, and `launchctl print pid/...`
  supplied the coalition. A pre-existing Chrome report from 21:25 (PID 97621, parent bun) again
  shows `SIGABRT` in `_RegisterApplication -> TransformProcessType` in the Codex coalition.
  This session did not relaunch either app: it had no new hypothesis that would distinguish another
  managed abort. The same-coalition full-access success and this sandboxed ancestry narrow the
  likely boundary to the managed launch context, but do not prove the exact macOS denial;
  `log show` is unavailable in the sandbox.
  On 2026-10-03, the serial test reduction pass invoked the listed host command
  `./agent unsandboxed studio-smoke packages/ides/studio-tooling/studio-smoke/studio-agent-browser.test.ts`.
  It was refused before dispatch: `FAIL  ./agent unsandboxed is still running inside a sandbox; the host command was not started.`
  No browser or native process started, and this attempt provides no host acceptance. This is a
  command-reach limitation, separate from the earlier GUI registration abort. The current task
  cannot escalate its managed shell and does not change permission reach or bypass the wrapper.
- **Workaround:** From an independent desktop terminal, run `./agent parser-gen` if generated
  parser artifacts are missing, then `./agent studio-smoke
  packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts <unique-run-id>`.
  Record the terminal's parent chain, selected non-secret environment, permissions, and coalition
  before launch. `StudioCdp.launchChrome` owns a fresh browser profile and closes it. For a
  separate bounded DevTools startup proof, use the pinned `@react-native/debugger-shell` 0.86.3
  API with `frontendUrl` and `windowKey`; the Electron entry point accepts those two arguments,
  and its Node API accepts `mode: 'syncThenExit'` so an owned launcher can forward termination.
  Do not pass Chrome's CDP flag to that API. Record the app's parent, coalition, exit, check-in,
  and crash report when observable. A successful shell check-in proves neither frontend rendering
  nor attachment to a live Hermes target.

  From that independent terminal, after confirming no other React Native DevTools instance is
  running, the shell-only invocation below uses the installed package reached through this repo's
  pinned React Native dependency. It serves `about:blank`, so it deliberately tests registration
  and window lifetime only. The Python parent owns and bounds the launcher process group; an early
  exit needs its stderr and crash report, while a 12-second lifetime still needs a LaunchServices
  check-in before counting as shell startup.

  ```bash
  python3 - <<'PY'
  import os, signal, subprocess
  javascript = r'''
  const {createRequire} = require('node:module');
  const reactNative = require.resolve('react-native/package.json', {paths: ['./packages/apps/expo-host']});
  const {unstable_spawnDebuggerShellWithArgs} = createRequire(reactNative)('@react-native/debugger-shell');
  unstable_spawnDebuggerShellWithArgs(
    ['--frontendUrl=about:blank', `--windowKey=devenv015-${process.pid}`],
    {mode: 'syncThenExit', silent: false},
  ).catch(error => { console.error(error); process.exitCode = 1; });
  '''
  launcher = subprocess.Popen(['node', '-e', javascript], start_new_session=True)
  print(f'debugger launcher PID {launcher.pid}', flush=True)
  try:
      code = launcher.wait(timeout=12)
      print(f'debugger launcher exited early: {code}')
  except subprocess.TimeoutExpired:
      print('debugger launcher remained alive for 12 seconds')
  finally:
      if launcher.poll() is None:
          os.killpg(launcher.pid, signal.SIGTERM)
          try:
              launcher.wait(timeout=3)
          except subprocess.TimeoutExpired:
              os.killpg(launcher.pid, signal.SIGKILL)
              launcher.wait()
  PY
  ```
- **Proposed change:** Establish a repeatable host-only lane for the Studio journey and supported
  React Native DevTools startup. The existing `./agent studio-smoke` command is the smallest proven
  Studio lane; there is not yet a first-class `./agent` command for the DevTools shell proof.
  Keep this as an explicit desktop-terminal operator step until a supported, owned, bounded
  DevTools command can be added and repeated. Diagnose the managed GUI registration boundary
  before changing repository sandbox rules. Record ancestry, selected non-secret environment,
  permissions, coalition, launch method, exit, crash stack, and CDP reachability. Use one bounded
  launch per app in each new host context.
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
