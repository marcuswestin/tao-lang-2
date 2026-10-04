# DEVENV-BROWSER-LANES-MISS-A-PLAYWRIGHT-CHROMIUM — Browser lanes miss a Playwright Chromium

- **Status:** Resolved
- **Section:** Deferred
- **Area:** Studio browser smoke lanes
- **Impact:** Every `verify-full` browser smoke failed in hosted Linux containers after a 20-minute run, aborting the land, although Chromium was installed.
- **Evidence:** On 2026-10-04, the land of `feat/closed-stdin-epipe-race` failed `studio-proof-real-app`, `studio-smoke-simulated-user` and `keyboard-navigation-smoke` with "Studio smoke requires Chrome or Chromium; set TAO_STUDIO_CHROME_PATH." The container ships Chromium under `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` and runs as root, where Chrome also refuses to start without `--no-sandbox`.
- **Workaround:** Set `TAO_STUDIO_CHROME_PATH` and run as a non-root user.
- **Proposed change:** One `ChromeDiscovery` shared by `StudioCdp` and Studio doctor ends at the Playwright install, and Chrome gets `--no-sandbox` only on Linux as root.
- **Dependencies:** Settled on `feat/closed-stdin-epipe-race` (308b570a).
- **Acceptance:** `chrome-discovery.test.ts` pins the Playwright lookup; all six browser smokes passed in the container through `./agent studio-smoke`.
- **Source:** Closed-stdin EPIPE fix landing, `feat/closed-stdin-epipe-race`, 2026-10-04.
- **Archived:** 2026-10-04
