# DEVENV-APP-DEV-WEB-OPENS-CHROME-IN-THE-FOREGROUND — `app-dev --web` opens Chrome in the foreground

- **Status:** Candidate
- **Section:** External
- **Area:** `./agent unsandboxed app-dev --web`, quiet UI workflows.
- **Impact:** An agent following the documented web loop takes over the Developer's desktop, against the quiet-UI rule.
- **Evidence:** On 2026-09-27 `./agent unsandboxed app-dev --web` opened the web app in the Developer's Chrome and raised it. Omitting `--web` and opening the served URL in the browser pane kept the desktop undisturbed.
- **Workaround:** Omit `--web` and open the served URL in the in-app browser pane.
- **Proposed change:** Have `--web` serve without opening a browser, or open in the background, when run from an agent shell.
- **Dependencies:** None.
- **Acceptance:** `app-dev --web` from an agent shell never raises a desktop window.
- **Source:** Provider pairing and InstantDB auth, `feat/provider-bridges`, 2026-09-27.
