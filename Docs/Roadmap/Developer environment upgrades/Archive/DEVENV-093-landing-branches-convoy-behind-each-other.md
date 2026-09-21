# DEVENV-093 — Ready branches convoy behind each other, each re-verifying the whole tree

- **Status:** Closed
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
- **Evidence, the refusals themselves:** landing `feat/september-cleanups` the same day was refused
  six times over roughly ninety minutes on a branch that was green throughout, and each refusal
  named a different precondition: a peer's staged squash in a main worktree (which the archived
  DEVENV-092 has since removed), `verify-full needs this machine to itself` naming five running
  lanes, and `Local main is not at origin/main (21905bc44c86); refresh it before merging.` That last
  one is worth separating from the convoy: it is not another branch landing ahead, it is the window
  between a peer committing its squash and pushing it, during which every other agent's preflight
  fails for a reason that will resolve itself in seconds. No waiter can tell it apart from an
  abandoned local `main` except by watching whether the ref moves. Each refusal is computed from
  state a waiter could subscribe to — the lane registry already records who holds the machine — so
  every one of them could be a wait instead.
  The lease has since landed without the queue half, and the starvation that predicts is now
  observed: on 2026-09-19 one `finalize` in `align-tao-apps-dialect-243197` waited through three
  successive holders — `publication-audit-report-d93f40`, then `wizardly-shamir-d3f33d`, then
  `wordflower-revolution-rewrite-deaf54` — without ever acquiring it, because a released lock is
  taken by whoever asks next rather than by whoever has waited longest. Its own warning says
  `Nothing will take it away on a timer`, which is true and is not the problem: the problem is that
  waiting confers no position. A waiter cannot tell a long queue from being skipped.
- **Workaround:** Land one branch at a time. Other ready branches wait for the machine-wide landing
  lock, merge the resulting `main`, and verify their new tree before landing in turn.
- **Proposed change:** None. Serial landing is the chosen correctness model. Do not add a
  multi-branch integrator, per-branch evidence reuse across different whole trees, or an ordered
  landing queue. Keep the existing pool-shaped lock, immediate holder explanation, and full proof of
  each branch's final integration tree.
- **Dependencies:** None.
- **Acceptance:** The repository describes and implements serial landing, with no open proposal to
  combine several ready branches into one integration or verification operation.
- **Progress (2026-09-19):** The serialization half landed as `LandingLock.ts`: one machine-wide
  lock, claimed by worktree rather than by process so it spans an agent's several commands, taken by
  the broad lanes and reused by the landing. It is a **pool, not a queue** — there is no position,
  because the only decision anyone makes is whether they hold the lock, and having no order is what
  removes head-of-line blocking when a holder-to-be is still resolving conflicts. `land-lock` blocks
  and `land-unlock` releases, so no agent writes a sleep-poll loop. Nothing reclaims on a timer,
  because expiry is indistinguishable from handing two agents the same lock.
  Two of this entry's proposals were decided against rather than deferred: the **memo key scoped to
  declared gate inputs** is rejected outright, because a stale declaration produces a green that is
  wrong and `GreenTree.ts` deliberately keys on the whole tree for that reason; and a **documentation
  fast path** was considered and dropped.
- **Progress (2026-09-20):** A blocked broad lane now names the landing-lock holder on its first
  unsuccessful acquisition instead of remaining silent until the five-minute reminder. Periodic
  warnings and the no-expiry safety rule remain unchanged.
- **Decision (2026-09-20):** Multi-branch integration was rejected. Continue landing and proving
  branches serially through the current machine-wide lock. Recorded by
  `feat/serial-verification-followups`.
- **Source:** 2026-09-19 landing convoy, reported by Ro.
- **Archived:** 2026-09-20
