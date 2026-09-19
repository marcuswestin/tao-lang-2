# DEVENV-092 — A blocked landing has nothing to wait on, so agents busy-wait or lose the race

- **Status:** Candidate
- **Area:** Verification and landing
- **Impact:** `merge-with-main` has two preconditions an agent cannot influence and cannot wait on:
  a peer's staged squash sitting in a main worktree, and `verify-full`'s requirement that no other
  Tao lane is registered. Both are refusals, not queues. On a machine running many agents this turns
  landing into a race that the agent checking least often wins, and every loser either polls — which
  costs a model turn per check — or gives up and hands the landing back to Ro although the branch is
  ready. Observed cost here: four refused attempts across about ninety minutes on a branch that was
  green the whole time.
- **Evidence:** Landing `feat/september-cleanups`, in order:
  `The main worktree is not clean: .../mvp-feedback-intake-doctor-134afd/.artifacts/merge/main-worktree`
  (twice, with different staged contents each time — a peer landing back to back), then
  `verify-full needs this machine to itself: verify in untitled-session-3c4023, verify in
  agent-merge-finalization-perf-99c35b, verify in hungry-shtern-cf1fdd, verify in
  simplify-repo-dedup-908830, verify in tao-lang-2 are already running.`
  The lane registry at `~/.cache/tao/machine-lanes/*.lane.json` already records exactly who holds
  the machine, and a created main worktree is already discoverable, so both refusals are computed
  from state a waiter could subscribe to. DEVENV-001 admits lanes machine-wide; this is the same
  problem one level up, at the landing rather than the lane.
- **Workaround:** Wrap the landing in a shell loop that watches the lane registry and the peer
  worktree and fires `merge-with-main` in the same process the moment both clear. That is what was
  done here, and it works, but every agent inventing its own loop is the reason to fix it centrally:
  a loop that polls too slowly loses the window to a peer, and one that polls quickly burns the
  machine it is waiting for.
- **Proposed change:** Give the landing an opt-in wait — `merge-with-main --wait[=<duration>]` —
  that blocks on the same conditions the preflight already computes and then proceeds, reporting
  what it is waiting for and who holds it. Failing that, expose one `./dev await-machine` primitive
  both this and `verify-full` can share, so no agent writes the loop itself.
- **Dependencies:** `MachineLanes` owns the lane registry and already answers "who is running";
  `Finalize.ts` and the merge command own the preflight. DEVENV-001 (machine-wide lane admission)
  is the same idea for lanes and is the natural place for the shared wait primitive.
- **Acceptance:** An agent with a green, message-complete branch can issue one landing command on a
  busy machine and have it land when the machine frees, without polling and without a human
  deciding when to retry.
- **Source:** 2026-09-19 landing of `feat/september-cleanups`.
