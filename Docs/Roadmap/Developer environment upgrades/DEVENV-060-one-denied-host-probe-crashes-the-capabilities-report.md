# DEVENV-060 — One denied host probe crashes the capabilities report

- **Status:** Incoming
- **Area:** Agent diagnostics
- **Impact:** `./agent capabilities` can crash before reporting CoreSimulator because a different
  probe is denied, hiding the distinction the command exists to make.
- **Evidence:** In the managed shell, the command stopped at `posix_spawn '/bin/ps': EPERM` even
  though the authorized command shape is `ps -o pid=,ppid=,lstart=,command= -p <pid>`.
- **Workaround:** Run the needed capability command directly and inspect its output.
- **Proposed change:** Use the authorized `ps` executable spelling and classify a thrown probe as
  denied or unavailable without abandoning the remaining probes.
- **Dependencies:** Owned by unmerged branch `feat/macos-27-device-hub`.
- **Acceptance:** A simulated spawn failure appears as one failed capability while every other
  probe is still reported; `./agent capabilities` completes in the managed shell.
- **Source:** 2026-09-15 HNReader simulator recovery.
