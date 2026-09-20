# DEVENV-104 — `finalize` overwrites a hand-written merge message with its own draft

- **Status:** Candidate
- **Area:** Merge workflow
- **Impact:** The message a branch lands with is the one artifact `finalize` cannot regenerate, and it
  is the one it overwrites. An author who writes the message and then re-runs `finalize` — which the
  instructions tell them to do after every round of corrections, and which the landing convoy forces
  on them each time `main` moves — lands a summary reading `DRAFT: <last commit subject>` unless they
  notice and restore their own file. Nothing in the run says the file was replaced rather than
  created.
- **Evidence:** 2026-09-19, landing `feat/verify-repo-plan-ed6f1a`. `finalize` reported
  `Drafted the merge message from 3 commit(s)` on each of four runs, each time replacing a written
  message with `DRAFT: Keep the repo's own two line-keyed ledgers in step with these ed…` followed by
  every commit body flattened into bullets. The message survived only because it had been copied
  aside first. `finalize --check` reports `Merge message is current for <sha>` for a hand-written
  file, so the state it reads is not the state the full run preserves.
- **Workaround:** Copy the message aside before running `finalize`, and restore it afterwards; or run
  `finalize --check`, which drafts nothing.
- **Proposed change:** Draft only when no message exists for this HEAD, and otherwise leave the file
  alone and say so. When the branch has gained commits since the message was written, say that too,
  rather than replacing it — the author is the only one who can tell whether the new commits changed
  what the branch is for. A `--redraft` flag can ask for the mechanical draft explicitly.
- **Dependencies:** None.
- **Acceptance:** `finalize` run twice over a hand-written `.artifacts/merge/<branch>.msg` leaves the
  file byte-identical and reports that it kept it, and a test covers both that and the redraft path.
- **Source:** 2026-09-19 landing of `feat/verify-repo-plan-ed6f1a`, across four `finalize` runs
  forced by `main` moving under the branch.
