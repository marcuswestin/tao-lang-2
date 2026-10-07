# DEVENV-STUDIO-AGENT-BROWSER-GATE-TIMES-OUT-UNDER-THE-COMPLEMENT-LANE — Studio agent browser gate times out under the complement lane

- **Status:** Candidate
- **Section:** External
- **Area:** Browser gates that click inside the Studio agent panel right after expanding it, starting with `studio-agent-browser` (`packages/ides/studio-tooling/studio-smoke/studio-agent-browser.test.ts`) under `verify-complement`.
- **Impact:** A landing whose complement hits this failure cancels its hosted `Verify` run and turns auto-merge off, as the route says it must, and then needs a fresh push to run again. The gate passed alone and beside seven other Studio gates started by hand; it failed twice in a row only under the lane.
- **Evidence:** `.artifacts/logs/verify-complement/2026-10-06T04-06-21-426Z-71237-ddbe82e1/studio-agent-browser.log` and `…04-10-02-613Z-11105-b427d08b/studio-agent-browser.log` on `feat/landing-route-tooling` at `fb32fc5e` and `7cb8f0e7`: `Timed out waiting for browser expression: document.querySelector('.chat-status')?.getAttribute('data-state') === 'on'; last=false` after about 28 s, one lane on the machine, peak load average 9 to 12 on 18 CPUs. The cause is a hit-test race, not the agent: `.studio-agent-panel` animates `width` and `height` for 150 ms when it leaves its minimized state (`packages/ides/studio/studio-src/StudioClientStylesheet.ts:923`), the gate waited only for the cloud switch to be hit-testable, and `StudioCdp.click` resolves the element's centre in one round trip and presses in another, so a slow process pressed where the 26 × 15 px switch had been a frame earlier. The toggle never fired and the status stayed `off` until the 15 s wait ran out. The fix in the gate waits for the switch to report the same box on two consecutive polls before clicking; the earlier passing complement run `2026-10-06T03-46-01-273Z-72825-54bb53b9` and every by-hand run simply won the race.
- **Workaround:** None needed for this gate after the fix. For another gate that clicks inside the agent panel right after `.studio-agent-collapse`, wait for the target's box to settle before clicking; `studio-simulated-user.test.ts:198` clicks the collapse control itself and does not click into the expanded body.
- **Proposed change:** Move the settle wait into `StudioCdp.click`, so every browser gate resolves a point only once the element's box has stopped moving, and keep the diagnostic the agent-browser gate now prints on this timeout (switch state, status text, console errors) as the shape for other silent click misses. A `--retry-failed` on the complement command that reruns only the failed gates alone, with the same receipt and status, would also keep a one-gate flake from cancelling a hosted run.
- **Dependencies:** None known. DEVENV-WATCHOS-SWIFT-PROBE-FAILS-UNDER-BROAD-LANES records a sibling probe-under-load failure.
- **Acceptance:** `StudioCdp.click` waits for a settled box, or ten consecutive complement lanes pass the agent-browser gate after the gate-local fix.
- **Related editor evidence (2026-10-06):** PR #29 host complements at 09:05 and 09:11
  failed waiting for Outline glyphs while the preset stayed `all`, `aria-pressed` stayed false and
  console errors were empty. The unchanged isolated editor journey passed all three tests and
  102 assertions; an intervening parallel complement also passed. A gate-local readiness check
  now scrolls the Outline button into view and checks its stable box and center hit target before
  dispatching the single physical click. Keep the existing fold assertions and retain failed-run
  evidence; this does not establish a shared click-helper fix or ten consecutive green complements.
- **Source:** Second and third landings of `feat/landing-route-tooling` (#25), 2026-10-06.
- **Related tutorial readiness evidence (2026-10-06):** On `feat/tutorial-first-hour`, all eight
  host gates passed in complement `2026-10-06T17-39-44-872Z-12983-62f979ab`; its overall receipt
  failed because preparation formatted three generated QA reports. After committing only that
  formatting as `d3bad8c8a`, complement `2026-10-06T17-47-10-621Z-66961-57078d7d` failed the final
  stale-undo wait at `studio-agent-browser.test.ts:263`: input re-enabled plus refusal text did not
  appear. Bun also reported a request idle timeout after 10 seconds; four lanes overlapped and load
  peaked at 88.1 on 18 CPUs. The unchanged isolated command passed one test and 21 assertions in
  42.7 seconds, with its receipt at
  `.artifacts/logs/agent/studio-smoke/2026-10-06T17-48-52-063Z-46943.log`. This establishes an
  intermittent failure, not its cause or ten consecutive passing complements. A stalled request
  and a missed approval click remain distinguishable hypotheses; capture approval controls, chat
  input state, chat-log tail and model-call count on recurrence. No assertions, timeouts or
  ownership checks were weakened.
- **Separate request-lifetime evidence (2026-10-06):** PR #59 merged before its complement
  failed at initial chat readiness (`2026-10-06T18-52-53-172Z-55524-86256e74`); an unchanged
  retry failed later waiting for the stale-undo refusal (`2026-10-06T18-57-56-270Z-45344-fcd47cac`).
  Both `studio-agent-browser.log` files report Bun's ten-second request idle timeout, without
  identifying the request. The streamed approval response can wait quietly for the turn to finish;
  the lazy browser bundle also awaits a build before responding. Studio now exempts these exact
  GET bundle and POST stream routes, alongside beta shipping, from the request idle timeout.
  Ordinary requests retain their default timeout. This closes an HTTP lifetime gap; it does not
  prove which request timed out in either retained failure or settle the shared click-helper work.
- **Startup boundary follow-up (2026-10-06):** The recovery complement
  `2026-10-06T19-07-03-229Z-70886-3846e816` still failed with a blank initial page, but no Bun
  timeout warning. The direct-server fixture now awaits the real browser client bundle before
  opening Chrome, matching `StudioDev`'s existing readiness boundary. Its UI wait and overall
  journey deadline are unchanged. Initial-readiness failures now include the document URL and
  ready state as well as text and browser failures, so a remaining navigation failure can be
  distinguished from client startup. The retained failures remain separate evidence.
- **Approval follow-up (2026-10-06):** Complement
  `2026-10-06T19-14-19-314Z-41579-3a25a34c` reached edits and failed at the final stale-undo
  approval, without a Bun timeout warning. That click now waits for the approval button's
  settled box and center hit target, following the earlier cloud-switch fix, rather than only
  checking the panel's animation list. A failure now records approval state, input busy state,
  chat text, scripted model calls and browser failures. The refusal and unchanged-source
  assertions remain intact; the shared click-helper acceptance is still open.
- **Ownership-poll follow-up (2026-10-06):** Isolated first-approval waits reproduced with two
  scripted model calls, an unchanged URL, a busy input and no browser failures. Proposal staging
  took about 33 seconds while Chrome was supervised. Ignoring Chrome output did not change it;
  temporarily disabling ownership polling reduced staging to 105 milliseconds. Polls now avoid
  duplicate attached-subtree walks and synchronous retries once `ESRCH` proves a retained PID
  absent. With supervision retained, staging measured 112 milliseconds. The normal journey then
  passed all 22 assertions and cleanup in 39.7 seconds
  (`.artifacts/logs/agent/studio-smoke/2026-10-06T21-17-05-637Z-2215.log`); direct kernel inspection
  found its Chrome PID and group absent. Temporary pipeline profiling produced separate 180-second
  cleanup timeouts and was removed; those are not proof of a normal cleanup defect. Approval waits
  retain their last healthy DOM state and original cause, without an extra CDP request after failure.
  A disconnected response no longer changes a server-owned turn's verdict through a closed
  controller error, and run logs retain bounded failure messages. This is focused source and host
  evidence; the shared click-helper acceptance and complete complement proof remain separate.
- **Post-journey hang (2026-10-07):** PR #77's complement
  `2026-10-07T18-09-29-210Z-2811-1cda99d3` at `55aa0f5f` recorded all 22 assertions and then hit
  the test's 180-second deadline with no further output, so the journey finished and something after
  it, most likely cleanup, never returned. The lane ran alone (peak load 11.2 on 18 CPUs, not
  contended). The same gate passed in about 58 seconds on that branch's two previous complements.
  On recurrence, record which cleanup step was pending; DEVENV-068 records a separate cleanup
  inspection failure on setuid-root children.
