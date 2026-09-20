# DEVENV-060 — One denied host probe crashes the capabilities report

- **Status:** Resolved
- **Area:** Agent diagnostics
- **Impact:** `./agent capabilities` can crash before reporting CoreSimulator because a different
  probe is denied, hiding the distinction the command exists to make.
- **Evidence:** In the managed shell, the command stopped at `posix_spawn '/bin/ps': EPERM` even
  though the authorized command shape is `ps -o pid=,ppid=,lstart=,command= -p <pid>`.
- **Workaround:** Run the needed capability command directly and inspect its output.
- **Proposed change:** Use the authorized `ps` executable spelling and classify a thrown probe as
  denied or unavailable without abandoning the remaining probes.
- **Dependencies:** Resolved by the per-probe isolation implementation on current `main`.
- **Acceptance:** A simulated spawn failure appears as one failed capability while every other
  probe is still reported; `./agent capabilities` completes in the managed shell.
- **Resolution (2026-09-20):** Reverified at `7b7dc0bc`: the focused capability suite passed 7/7.
  Live `./agent capabilities` then completed in the managed shell, reporting denied process-table and
  Watchman probes while continuing through available liveness and port probes, unavailable
  CoreSimulator, and unavailable Docker.
- **Source:** 2026-09-15 HNReader simulator recovery.
- **Archived:** 2026-09-20
