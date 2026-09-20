# DEVENV-015 — Reliable host-browser verification

- **Status:** Planned
- **Area:** Studio browser smoke
- **Impact:** The complete simulated-user journey cannot run in the managed host when Chrome aborts with
  `SIGABRT` before exposing DevTools; ordinary `verify` intentionally omits this proof.
- **Evidence:** The smoke's non-browser checks pass, but every exact and reduced Chrome launch aborts
  before DevTools dispatch. The macOS crash stack ends in
  `TransformProcessType -> _RegisterApplication -> abort`, and LaunchServices cannot resolve the
  otherwise valid signed Chrome application from this task namespace. Repository CDP tests remain green.
  On 2026-09-17 the same branch's headless browser journeys launched Chrome normally from an
  ordinary unsandboxed desktop shell, so the abort is specific to that managed task namespace.
  On 2026-09-16 the host wrote 25 Chrome crash reports, one at 12:23 and 24 between 19:02 and 19:42.
  Every one was launched inside the Codex app's coalition (`com.openai.codex`, responsible process
  ChatGPT) and every one aborted at startup in `TransformProcessType -> _RegisterApplication`: macOS
  refusing to register Chrome as an app from that process context, before any repository Chrome code
  runs. Sandbox escalation did not help, and direct `--no-sandbox` launches aborted the same way; two
  React Native DevTools crashes that evening are the same failure. No fix is known.
- **Workaround:** From a normal terminal run
  `just studio-smoke packages/dev/studio-smoke/studio-simulated-user.test.ts review-cycle` or
  `just verify-full`; when selecting another supported browser explicitly, set
  `TAO_STUDIO_CHROME_PATH` in that terminal.
- **Proposed change:** After Studio branches land, evaluate headless Chromium and attach-to-existing-browser
  modes, then add a reliable CI or pre-merge host lane without slowing ordinary `verify`.
- **Candidate mitigations:** None implemented yet. (a) Fail fast in `StudioCdp.launchChrome` using the
  `hasWindowServerSession()` probe already in `StudioDoctor.ts` (`launchctl managername == Aqua`) plus a
  single-abort latch, so one clear error replaces about twenty crash dialogs. (b) Probe
  `chrome-headless-shell` through the existing `TAO_STUDIO_CHROME_PATH`: it has no `.app` bundle and
  should never reach that registration step (unverified, roughly fifteen minutes to test). (c) Probe an
  `open -na` or `launchctl asuser` handoff. (d) If those fail, run one persistent browser in the GUI
  session and use the existing `StudioCdp.attach()` with a fresh browser context per run instead of
  launching per run — noting that (d) turns per-run launches into shared state that no single lane owns,
  which interacts with parallelization and with the rule that a lane may only stop processes it started.
- **Dependencies:** Semantic-agent, companion, and freehand Studio changes must land first.
- **Acceptance:** The full browser journey runs repeatably in its supported host and is required for
  Studio-heavy landing evidence.
- **Source:** 2026-09-03 freehand implementation summary; 2026-09-16 September remediation acceptance;
  2026-09-16 runaway-process investigation.
