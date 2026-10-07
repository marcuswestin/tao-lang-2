# DEVENV-077 — A busy machine could admit no lane at all

- **Status:** Resolved
- **Section:** External
- **Area:** Parallel verification
- **Impact:** Every lane on the machine could sit at zero running nodes while the CPUs were mostly
  idle. A lane that joined while the machine was fully reserved never started its first node, so an
  agent watching `0/9 done, 0 running, 9 pending` had no way to tell a stalled run from a slow one,
  and the natural response — start another verification — made the reservation total worse.
- **Evidence:** On an 18-CPU host, `~/.cache/tao/machine-lanes` held eleven live lanes reserving
  exactly 18 of 18 slots while CPU sat near a quarter busy; a run started under that condition
  produced no output for 19 minutes against 89 seconds on its own. Admission gated on
  `globallyAvailable = cpuCount - Σ slots`, which is zero in that state, so `tryAcquire` returned
  nothing to anyone and the one-slot floor `fairAllocations` documents never applied. A freed slot
  went to whichever lane polled first, with backoff to 500ms and no queue, so a newly started lane
  could lose repeatedly to lanes already running.
- **Workaround:** Was to wait for other worktrees to finish, or to delete lane records by hand.
- **Proposed change:** Honour the one-slot floor at admission: a lane running nothing is admitted
  one slot whatever the machine-wide total says, and the total still governs above that floor. The
  bound becomes `cpuCount` plus at most one slot per idle lane. Deleting the machine-wide check
  outright was tried first and is worse: a lane's share shrinks as lanes join while its reservations
  do not, so each new lane could stack a full share on top of reservations taken under wider ones,
  and the total could reach several times `cpuCount`. The check is a fairness bound rather than a
  CPU one either way — lanes reserving 4-6 slots drove load past 21 on 18 CPUs, because one slot may
  run a whole test file's parallel children. Measured further apart the two barely relate at all: with
  five lanes registered and exactly one slot reserved machine-wide, the load average ran from 86 down
  to 20 over fifty seconds. Nothing admission does to the slot total governs that number.
- **Dependencies:** Revises DEVENV-001, which introduced the global check together with the fair
  shares and the one-slot floor those shares still provide. Fixed on `feat/lane-admission-share`.
- **Acceptance:** A lane that registers against a registry whose slots are all reserved admits its
  first node immediately, and a declined admission says what it is waiting for.
- **Source:** 2026-09-18 repository-deduplication branch.
- **Resolution:** Rechecked 2026-10-07: the fix landed from `feat/lane-admission-share`, and
  arrival-order admission has since replaced fair shares. `MachineLanes.laneQueue` admits whole
  lanes in order and gives every queued lane its position (`machine-lanes.test.ts:45`), so lanes can
  no longer all hold slots while running nothing.
- **Archived:** 2026-10-07
