# DEVENV-114 — The guidance invites agents to force-release a lock the design reserves for a person

- **Status:** Candidate
- **Section:** External
- **Area:** Landing and merge workflow
- **Impact:** `LandingLock.ts` is explicit that the lock is never reclaimed automatically, that a
  dead PID does not mean a released lock because the acquiring process is _expected_ to exit while
  the lock is still held, and that "a stuck lock is therefore a person's problem on purpose". The
  instructions an agent actually reads say something weaker. Root `AGENTS.md` ends its lock
  paragraph with "`./agent land-unlock --force` is the deliberate way past one", and the waiter's own
  warning repeats "if that landing is no longer running, release it with `./dev land-unlock --force`"
  every five minutes. Neither says the judgment belongs to a person. An agent that reads them does
  what they suggest: check whether the named PID exists, find it gone, and force. That is the one
  act the design forbids, because handing one agent a lock another still believes it holds is the
  failure that can corrupt `main`.
- **Evidence:** On 2026-09-19, landing `feat/publication-audit-report-d93f40`, an agent force-released
  the lock twice on exactly that reasoning — `align-tao-apps-dialect-243197` (PID 86672) and
  `wordflower-revolution-rewrite-deaf54` (PID 96689) — after confirming neither PID existed. Both
  releases followed the printed remedy and the `AGENTS.md` sentence, and both were unsound: the PID
  check proves nothing about a worktree-held lock, and each holder may have been an agent whose
  session still held a durable claim across commands. Nothing visibly broke, which is the problem —
  the same reasoning corrupts `main` the first time the other agent is mid-landing rather than
  between commands.
- **Workaround:** Treat a held lock as a live landing and wait; `./agent board` names the holder.
  Ask the Developer before forcing.
- **Proposed change:** Make the two pieces of guidance say what the code says. In `AGENTS.md`, state
  that a wedged lock is a person's call and that an agent asks rather than forces. In the waiter's
  warning, name `./agent board` and the person, rather than handing out the `--force` command as the
  next step. Optionally make `--force` refuse without a terminal, the way `--skip-all` already does,
  so the safe path is the reachable one non-interactively.
- **Dependencies:** None. This is a documentation and affordance defect, not a lock defect — the lock
  behaves as designed.
- **Acceptance:** An agent following `AGENTS.md` and the printed warning waits or escalates, and
  nothing in either text presents force-releasing as the agent's own next step.
- **Source:** Observed while landing `feat/publication-audit-report-d93f40` on 2026-09-19, and
  corrected on 2026-09-20 after reading `packages/dev/dev-src/repository-tests/LandingLock.ts`.
