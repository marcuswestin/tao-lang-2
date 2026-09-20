# DEVENV-089 — `finalize` overwrites a reviewed merge message with a concatenation of commit subjects

- **Status:** Resolved
- **Area:** Verification and landing
- **Impact:** `./agent finalize` redrafted `.artifacts/merge/<branch>.msg` even when the file already
  held a message an agent wrote and Ro may have read, and the draft it wrote was a mechanical
  concatenation of every commit subject and body line on the branch, each line prefixed with `- `.
  The result was not a valid merge message in substance — a `DRAFT:` summary, superseded commit
  subjects repeated as bullets, the branch's history rather than what lands — so the reviewed message
  had to be rewritten from memory. The message is the one artifact `finalize` cannot regenerate, and
  it was the one it destroyed: nothing in the run said the file had been replaced rather than
  created. Authors paid this repeatedly, because the instructions tell them to re-run `finalize`
  after every round of corrections and the landing convoy forces a re-run each time `main` moves.
- **Evidence:** Two independent landings, filed separately as this entry and DEVENV-108 and merged
  here.
  - 2026-09-19, `feat/september-backlog-triage`: `.artifacts/merge/feat/september-backlog-triage.msg`
    held a reviewed 7-bullet message. `./agent finalize` replaced it with a 44-line file beginning
    `DRAFT: Realign the raw-Error allowlist after the merge shifted a line` — the subject of the
    branch's most recent and least significant commit — followed by every line of all four commit
    messages as separate bullets, including the three earlier commit subjects. `--fresh` is documented
    as the flag that redrafts the message, which implies the default does not.
  - 2026-09-19, `feat/verify-repo-plan-ed6f1a`: `finalize` reported
    `Drafted the merge message from 3 commit(s)` on each of four runs forced by `main` moving under
    the branch, each time replacing a written message with
    `DRAFT: Keep the repo's own two line-keyed ledgers in step with these ed…` followed by every
    commit body flattened into bullets. The message survived only because it had been copied aside
    first. `finalize --check` reported `Merge message is current for <sha>` for the same hand-written
    file, so the state `--check` read was not the state the full run preserved.
  - Cause: `draftOrKeepMessage` kept the file only when `priorState.messageHeadSha === headSha`, so a
    message written by hand, or written before the branch gained a commit, had no such record and was
    overwritten. `--fresh` discarded the prior state outright, which guaranteed the overwrite.
  - Settled on `feat/finalize-message-overwrite-851275`: an existing message is now never replaced
    except on an explicit `--redraft`; `--fresh` keeps its meaning (ignore the recorded state) and no
    longer destroys anything; every run states which of kept / drafted / redrafted happened; a kept
    message the record cannot prove covers this HEAD is reported as such and left to the author to
    confirm; and `--check` reaches that decision from the same inputs as the run, so the two agree.
    `packages/dev/dev-tests/finalize.test.ts` covers the twice-run hand-written message, the
    `--redraft` replacement, the branch-gained-commits report, and `--fresh` keeping the file.
- **Workaround:** Was: write the merge message _after_ running `finalize`, or copy it aside and
  restore it afterwards; or run `finalize --check`, which drafted nothing. Neither was discoverable
  from the command's help. No longer needed.
- **Proposed change:** Draft only when no message file exists; otherwise leave the existing one alone
  and report that it was kept. Reserve replacement for an explicit `--redraft` flag rather than for
  `--fresh`, whose own meaning is about the verification record. When the branch has gained commits
  since the message was recorded, say that in the report rather than acting on it — the author is the
  only one who can tell whether the new commits changed what the branch is for. Hold `--check` to the
  same decision as the run.
- **Dependencies:** `packages/dev/dev-src/repository-tests/Finalize.ts` owns the draft.
  `verification-lanes` owns the merge-message format the draft is held to, and its `./agent finalize`
  description and the `finalize` command help still say the message is drafted from the branch's
  commits without naming `--redraft`; both are outside this change's paths.
- **Acceptance:** Running `./agent finalize` twice, with a hand-written message in place before the
  first run, leaves that message byte-identical and reports that it kept it; `--redraft` replaces it;
  `--fresh` alone does not.
- **Source:** 2026-09-19 landings of `feat/september-backlog-triage` and `feat/verify-repo-plan-ed6f1a`
  (the latter across four `finalize` runs forced by `main` moving under the branch). DEVENV-108 filed
  the same defect from the second branch and is closed as its duplicate.
- **Archived:** 2026-09-20
