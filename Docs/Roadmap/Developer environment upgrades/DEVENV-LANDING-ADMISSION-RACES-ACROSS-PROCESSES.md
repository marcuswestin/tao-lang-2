# DEVENV-LANDING-ADMISSION-RACES-ACROSS-PROCESSES — Landing admission races across processes

- **Status:** Candidate
- **Section:** External
- **Area:** `open-pr` admission, `packages/cli/dev-cli/dev-cli-src/pr/`
- **Impact:** `open-pr` admits at most two hosted `Verify` runs, but each process checks the count
  on its own before pushing, so landings started within seconds of each other all pass the check
  and the pool runs three or more at once. The partition planner then sizes every run as shared,
  and the admission cap the Developer decided on is not what runs.
- **Evidence:** 2026-10-06, 18:19:41–43Z: pull requests 58, 59 and 60 were opened within two
  seconds from three processes on one machine. All three `Verify` runs started; none waited. PR 60
  took 12 min 27 s from push to merge beside the other two; a lone landing that day took 6–10 min.
- **Workaround:** A coordinator releases landings a minute apart when several branches are ready
  (recorded in the `agent-coordinator` skill).
- **Proposed change:** Hold a short machine-wide lock around the admission check and the push (the
  landing lock already exists for `land`; a separate short-lived lock avoids waiting behind a full
  local landing), or re-check the count right after the push and, when it is over the cap, cancel
  the run just started and re-enter the wait. Either changes what `open-pr` does and needs the
  Developer's approval.
- **Dependencies:** None.
- **Acceptance:** Three `open-pr --auto-merge` processes started within two seconds on one machine
  produce at most two in-flight `Verify` runs, shown by their admission output and the run list.
- **Source:** CI completion coordination, 2026-10-06.
