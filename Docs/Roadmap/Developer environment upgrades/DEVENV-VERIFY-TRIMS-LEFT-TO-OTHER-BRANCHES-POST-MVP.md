# DEVENV-VERIFY-TRIMS-LEFT-TO-OTHER-BRANCHES-POST-MVP — Verification trims left to other branches, checked after MVP

- **Status:** Planned
- **Section:** Deferred
- **Area:** Hosted Verify (`.github/workflows/verify.yml`), the local `verify-complement` lane, the
  Studio browser gates, `studio-proof-real-app`, and the `tao-apps` journey shards.
- **Impact:** The 2026-10-06 expensive-test audit found four savings that other branches already
  own. Each is left to that branch rather than reimplemented, so nothing here confirms that each one
  landed and paid off.
- **Evidence:** Audit of Verify run 37503086586 on `main` (`c8a997842`, 376 s wall, 20 partitions)
  and the local complement summaries of the same day (170–233 s). The four items, and what to verify
  once their owners land:
  1. **Browser gates ported to hosted Linux** (the `feat/verify-linux-*` branches). Measured on hosted
     Linux: dialog 11 s, smoke 15, agent 28, network 44, keyboard navigation 65, simulated user 132.
     Locally: smoke 19–35, agent 25–38, network 32–55, keyboard 36–55, simulated user 91–123. Check
     that each ported gate has left the complement, that its hosted wall is recorded in
     `.github/verify/durations.json`, and that no partition's floor grew past Verify's wall because
     of it.
  2. **The three Metro-unique claims of `studio-real-app.test.ts`** (a later Metro-claims branch).
     The claims are new-file discovery, Fast Refresh keeping state with zero iframe reloads (`:372–398`),
     and re-bootstrap with the saved source version after a Code save (`:967–980`). Only these claims
     move into Verify; `studio-proof-real-app` itself stays in the local complement (161–222 s
     locally, 333 s on hosted Linux with `CI=false`). Check that each claim has an assertion in the
     Metro gate and that the gate's hosted wall is recorded.
  3. **Metro under CI on Linux** (`feat/studio-ci-env-and-changeset`). Check that the Studio gates run
     Metro on a hosted runner with `CI=true` and no environment override.
  4. **`tao-apps` nested journeys running in overlapping shards** (`feat/unique-journey-shards`,
     DEVENV-NESTED-TAO-JOURNEYS-RUN-IN-OVERLAPPING-SHARDS). `tao-apps` cost 965 node-seconds over 39
     shards (about 25 s each). Check that each journey runs in exactly one shard and compare the
     suite's node-seconds with that figure.
- **Workaround:** None needed; each owning branch carries its own change.
- **Proposed change:** After MVP, check the four items against `main` and a green Verify run's
  partition summaries. Archive this entry when all four hold. For any that did not land or did not
  pay off, open a Candidate entry with the measurement.
- **Dependencies:** The four owning branches; MVP completion.
- **Acceptance:** One Verify run's summaries and the complement's receipt show each item as described
  above, with the before and after figures recorded here.
- **Source:** Expensive-test audit and trims, `feat/trim-project-tooling-tests`, 2026-10-06.
