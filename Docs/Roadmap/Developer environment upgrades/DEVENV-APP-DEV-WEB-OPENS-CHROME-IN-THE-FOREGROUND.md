# DEVENV-APP-DEV-WEB-OPENS-CHROME-IN-THE-FOREGROUND — `app-dev --web` opens Chrome in the foreground

- **Status:** In progress
- **Section:** External
- **Area:** `./agent unsandboxed app-dev --web`, quiet UI workflows.
- **Impact:** An agent following the documented web loop takes over the Developer's desktop, against the quiet-UI rule.
- **Evidence:** On 2026-09-27 `./agent unsandboxed app-dev --web` opened the web app in the Developer's Chrome and raised it. Omitting `--web` and opening the served URL in the browser pane kept the desktop undisturbed.
  On 2026-09-30 the shared `dev/ro` changes select installed Google Chrome with an owned profile,
  `--headless=new`, and a random DevTools port for the agent loop. The focused Chrome tests prove
  separate profiles, visibility opt-in, normal teardown, and waiting for exit after startup failure.
  On 2026-10-01 a real headless installed Chrome session served HNReaderStub. The existing CDP
  driver clicked Reading, confirmed its changed content, captured before/after screenshots, and
  found no console errors. After cancellation the debug endpoint on port 58493 was unreachable.
  Focus preservation was not directly observed. Abrupt cancellation left the owned profile at
  `Apps/HNReader/.tao/dev/chrome/5ff1a105-8cf2-486d-8e6e-4e796a323613`; process-table inspection was
  unavailable, so it was preserved. A responding Metro endpoint on port 8081 was not attributed
  to this session and was also preserved.
  On 2026-10-02 standalone named process inspection succeeded. No process referenced that owned
  profile, so its inactive directory was removed. Repeating HNReader app-dev correctly refused to
  take over the Developer's live Studio project lease. A separate fixture reached app selection,
  but the harness refused terminal input and Ctrl-C under its never-approval policy; direct
  sandbox signaling also failed. The Developer chose managed `dev-loop` lifecycle controls with
  no default timer, so normal cleanup can be requested through a finite named command.
  The finite `test-host browser --app clockwork` route passed three real installed-Chrome
  journeys, including concurrent realm isolation. Its task browser process exited. This is
  browser-driver evidence; it does not prove app-dev's full dev-loop teardown.
  The managed command's public argument and canonical permission checks pass focused tests.
  Its new host prefix still needs the running task to load the regenerated permission rule before
  real background loop acceptance can begin. The old task-owned selector is absent in later inventory.
- **Workaround:** Omit `--web` and open the served URL in the in-app browser pane.
- **Proposed change:** Use owned headless Chrome for the managed agent web runner, with `--show-browser`
  only for a requested window. Prefer the served URL in the in-app browser for interactive review,
  and explicitly attach a CDP client when checking the runner's exact Chrome session.
- **Dependencies:** None.
- **Acceptance:** Chrome screenshot and click acceptance is proved. Still open: observe foreground
  focus during quiet and explicitly visible launch; verify graceful full dev-loop and profile
  teardown; and prove complete cleanup
  without stopping unrelated Metro processes. `app-dev --web` must never raise a desktop window
  unless explicitly requested with `--show-browser`.
- **Source:** Provider pairing and InstantDB auth, `feat/provider-bridges`, 2026-09-27.
