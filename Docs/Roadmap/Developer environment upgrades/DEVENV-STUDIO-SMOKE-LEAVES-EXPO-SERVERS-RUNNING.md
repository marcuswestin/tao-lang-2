# DEVENV-STUDIO-SMOKE-LEAVES-EXPO-SERVERS-RUNNING — Studio smoke leaves Expo servers running

- **Status:** Candidate
- **Section:** External
- **Area:** Browser Studio smokes that launch a Metro preview through `startStudioSmokeLaunch`.
- **Impact:** A smoke that ends abnormally leaves its `bunx expo start` preview server and Node child
  running, reparented to PID 1. Each holds Metro file watchers, so the next Studio launch on a Linux
  host can fail with `Error: ENOSPC: System limit for number of file watchers reached` (Metro
  `FallbackWatcher`) and report a failure that is not its own.
- **Evidence:** On 2026-10-04, in a Linux cloud container with 4 CPUs and
  `fs.inotify.max_user_watches = 130057`, two isolated `./agent studio-proof-real-app` runs ended
  abnormally: one hit bun's 300-second per-test limit
  (`packages/ides/studio-tooling/studio-smoke/studio-real-app.test.ts:14`), and the other failed when
  Studio restarted. Both left a `bunx expo start --host lan --port <port> --scheme taostudiocompanion`
  process and its `node .../runtime-*/node_modules/.bin/expo start` child behind, with PPID 1, 766
  and 352 seconds after their runs. The second run hit `ENOSPC` while the first run's servers were
  still alive. Stopping the four exact PIDs cleared them.
- **Proposed change:** Give the preview server process-group or recorded-ownership cleanup that
  still runs when the test body is cut off by a timeout. Also have the smoke harness stop leftover
  servers from its own earlier runs before it launches.
- **Dependencies:** None.
- **Acceptance:** A smoke cut off by its per-test timeout leaves no `expo start` process behind, and
  a following Studio launch on Linux starts without `ENOSPC`.
- **Source:** Cloud developer workflow verification, `feat/cloud-workflow-verify`, 2026-10-04.
