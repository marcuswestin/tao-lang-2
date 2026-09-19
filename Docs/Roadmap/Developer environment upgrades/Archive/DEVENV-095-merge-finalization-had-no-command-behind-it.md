# DEVENV-095 — Merge finalization is a prose protocol with no command behind it

- **Status:** Resolved
- **Area:** Agent harness performance
- **Impact:** "Finalize and prepare the merge" is a deterministic sequence — land commits, refresh
  the affected roadmap documents, integrate `main`, verify, write `.artifacts/merge/<branch>.msg`,
  report — but it exists only as prose in `AGENTS.md` and the `verification-lanes` skill, so an
  agent interprets it one model turn at a time at the point in a session where its context, and
  therefore its per-turn latency, is largest.
- **Evidence:** Finalization is not a terminal step but a loop: across 16 worktrees the same branch
  re-enters it a median of 5 and a mean of 7.4 times, driven by Ro's corrections, by retries after a
  red lane, and by the agent's own re-entry after a background job reports — and every round replays
  the whole protocol, because nothing persists what the previous round established. 119 such
  stretches across this repository's Claude Code transcripts,
  17.0h wall: 58.6% is model generation and 41.4% is command execution; a stretch that reaches
  `merge-with-main` averages 39 assistant turns and 22 tool calls, and 45% of all turns issue no
  tool call at all. Those 45 stretches ran 50 `full-verify` and 46 `verify` invocations on top of
  the `full-verify` that `merge-with-main` runs itself, about three full passes each, with one
  stretch running six. Median cached context re-read per turn is 357k tokens; in the top quartile
  (630k) mean per-turn model time is 11.0s against 4.0–5.4s in the lower three. Waiting on
  backgrounded gates with `until [ -s … ]; do sleep 15; done` accounted for 6.0% of the total,
  and commands blocked in permission review for 11.3%, still 37% of finalization Bash calls
  carrying the `cd`/`export`/`VAR=` prefixes DEVENV-045 asked agents to drop.
- **Workaround:** Run the superset lane once and let `merge-with-main`'s own `full-verify` be the
  evidence; edit tracked documents before verifying, never after, so the green-tree record survives.
- **Proposed change:** Add `./agent finalize`, which asserts the branch and clean worktree,
  integrates `origin/main`, runs one verification lane, drafts `.artifacts/merge/<branch>.msg` from
  `git log <base>..HEAD` for the agent to edit, and prints the short list of judgments that remain
  (which roadmap documents to refresh, what the message should say). Point `AGENTS.md` and the
  `verification-lanes` skill at the command instead of restating the sequence.
- **Dependencies:** `MergeWithMain.ts` already owns the landing half; this is the preparation half.
  The green-tree records in `GreenTree.ts` already make a repeated lane free when the tree is
  unchanged, so the redundant passes come from ordering, not from missing caching.
- **Acceptance:** A finalization from a clean feature branch completes in under ten model turns and
  one verification lane, and the written merge message passes `merge-with-main`'s own validation
  unedited.
- **Note:** Carried an earlier `DEVENV-077` number that another branch reused while this entry
  existed only as a body in the index; renumbered rather than renumbering the merged file.
- **Source:** 2026-09-17 merge-finalization performance investigation.
- **Archived:** 2026-09-19
