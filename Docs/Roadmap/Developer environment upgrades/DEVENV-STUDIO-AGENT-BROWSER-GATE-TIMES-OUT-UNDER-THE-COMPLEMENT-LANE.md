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
