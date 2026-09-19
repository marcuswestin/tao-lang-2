# DEVENV-093 — Ready branches convoy behind each other, each re-verifying the whole tree

- **Status:** Candidate
- **Area:** Landing and merge workflow
- **Impact:** A landing requires `main` to be an ancestor of the branch, so when several agents
  finish at once only the first lands. Every other branch must merge the new `main`, which changes
  its tree, which invalidates every green-tree record it held, so each one re-runs full verification
  — on a machine the other lanes are still loading. With `n` ready branches the work is quadratic in
  `n` and the last one can wait through several rounds of it.
- **Evidence:** On 2026-09-19 six branches were ready within the same hour. `verify` measured 89s
  alone and 865s under ten lanes on this 18-CPU host, and a landing that lost the race paid a fresh
  merge plus a fresh `verify` before it could try again. Nothing about the losing branch had
  changed: in the observed cases the branches touched disjoint packages.
- **Evidence, earlier round:** `main`'s own history shows the convoy: of 92 inter-merge gaps under
  six hours, 25% are under five minutes and 43% under fifteen, against a landing's verified window
  of two to five minutes uncontended and far longer under load. That round also recorded the shared
  `main` checkout the landing staged into, which DEVENV-092 has since removed, and noted that
  `stabilizeAndVerify` restarts the whole lane when `origin/main` moves and gives up after three
  passes. This entry carried an earlier `DEVENV-078` number that another branch reused while it
  existed only as a body in the index.
- **Workaround:** Land one branch at a time, and tell the others to wait rather than start the
  merge-and-verify cycle they will have to repeat.
- **Proposed change:** Two halves, in either order. The earlier round proposed the same lease, and
  additionally: verify the integration tree — `main` plus the branch — once inside it, treating the
  branch-side lane as iteration evidence rather than the gate. Make re-verification proportional to what
  actually changed — a memo key scoped to the inputs a gate declares, so a landing in another
  package does not invalidate this branch's evidence. And serialize the landings themselves: a
  machine-wide landing lease with a queue, so branches take turns in a visible order instead of
  racing, and consider an integrator mode that lands several ready branches in one process and
  verifies once at the end.
- **Dependencies:** DEVENV-086 records the same over-broad-key pathology for the compiled-app
  fingerprint. The landing lease already exists in `~/.cache/tao/machine-lanes` but only guards the
  push.
- **Acceptance:** With three ready branches touching disjoint packages, landing all three costs one
  full verification plus the gates each branch's own inputs reach, and the order they land in is
  visible before they start rather than decided by a race.
- **Source:** 2026-09-19 landing convoy, reported by Ro.
