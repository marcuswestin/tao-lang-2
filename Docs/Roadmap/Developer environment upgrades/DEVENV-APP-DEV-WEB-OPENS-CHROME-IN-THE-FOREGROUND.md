# DEVENV-APP-DEV-WEB-OPENS-CHROME-IN-THE-FOREGROUND — `app-dev --web` opens Chrome in the foreground

- **Status:** In progress
- **Section:** External
- **Area:** `./agent unsandboxed app-dev --web`, quiet UI workflows.
- **Impact:** An agent following the documented web loop takes over the Developer's desktop, against the quiet-UI rule.
- **Evidence:** On 2026-09-27 `./agent unsandboxed app-dev --web` opened the web app in the Developer's Chrome and raised it. Omitting `--web` and opening the served URL in the browser pane kept the desktop undisturbed.
  On 2026-09-30 the shared `dev/ro` changes select installed Google Chrome with an owned profile,
  `--headless=new`, and a random DevTools port for the agent loop. The focused Chrome tests prove
  separate profiles, visibility opt-in, normal teardown, and waiting for exit after startup failure.
  Earlier host smoke reached the debug endpoint and exited. Full app-dev focus observation and
  CDP click/screenshot acceptance remain separate checks; this entry is not yet resolved.
- **Workaround:** Omit `--web` and open the served URL in the in-app browser pane.
- **Proposed change:** Use owned headless Chrome for the agent web runner, with `--show-browser`
  only for a requested window. Prefer the served URL in the in-app browser for interactive review,
  and explicitly attach a CDP client when checking the runner's exact Chrome session.
- **Dependencies:** None.
- **Acceptance:** `app-dev --web` from an agent shell never raises a desktop window.
- **Source:** Provider pairing and InstantDB auth, `feat/provider-bridges`, 2026-09-27.
