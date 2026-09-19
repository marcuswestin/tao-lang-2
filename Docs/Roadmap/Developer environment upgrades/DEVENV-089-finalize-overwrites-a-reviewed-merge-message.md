# DEVENV-089 — `finalize` overwrites a reviewed merge message with a concatenation of commit subjects

- **Status:** Candidate
- **Area:** Verification and landing
- **Impact:** `./agent finalize` redrafts `.artifacts/merge/<branch>.msg` even when the file already
  holds a message an agent wrote and Ro may have read, and the draft it writes is a mechanical
  concatenation of every commit subject and body line on the branch, each line prefixed with `- `.
  The result is not a valid merge message in substance — it has a `DRAFT:` summary, repeats
  superseded commit subjects as bullets, and states the branch's history rather than what lands — so
  the reviewed message has to be rewritten from memory. A branch whose message was prepared before
  finalize ran loses it silently: the command reports `Drafted the merge message ... review it before
  landing` and nothing says it replaced anything.
- **Evidence:** On `feat/september-backlog-triage`, `.artifacts/merge/feat/september-backlog-triage.msg`
  held a reviewed 7-bullet message. `./agent finalize` replaced it with a 44-line file beginning
  `DRAFT: Realign the raw-Error allowlist after the merge shifted a line` — the subject of the
  branch's most recent and least significant commit — followed by every line of all four commit
  messages as separate bullets, including the three earlier commit subjects. `--fresh` is documented
  as the flag that redrafts the message, which implies the default does not.
- **Workaround:** Write the merge message *after* running `finalize`, not before; or copy it aside
  first. Neither is discoverable from the command's help.
- **Proposed change:** Draft only when no message file exists, and otherwise leave the existing one
  alone and report that it was kept, reserving replacement for `--fresh`. If the default must keep
  drafting, write the draft to a separate path and have the report name both files, so nothing a
  person or an agent composed is overwritten without being asked.
- **Dependencies:** `packages/dev/dev-src/repository-tests/Finalize.ts` owns the draft.
  `verification-lanes` owns the merge-message format the draft should be held to.
- **Acceptance:** Running `./agent finalize` twice, with a hand-written message in place before the
  first run, leaves that message byte-identical; `--fresh` still replaces it.
- **Source:** 2026-09-19 landing of `feat/september-backlog-triage`.
