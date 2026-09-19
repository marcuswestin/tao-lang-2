# DEVENV-070 — This ledger no longer fits one agent read

- **Status:** Candidate
- **Area:** Repository documentation
- **Impact:** The entry rules require searching this document by ID before adding an entry, but at about
  1,240 lines and roughly 31k tokens it exceeds an agent harness's per-read limit, so every task that
  touches it pays two paged reads and that context.
- **Evidence:** A 2026-09-17 read of this file was truncated at its per-read cap and had to be continued
  by offset; the file is the largest document under `Docs/Roadmap/`.
- **Workaround:** Read it in pages, or grep for the one relevant ID and read the highest heading to find
  the next free number.
- **Proposed change:** Add an ID-to-title index at the top, or move `Resolved` and `Closed` entries into a
  companion file, so an agent can find the next free ID and the one relevant entry without paging the
  whole backlog.
- **Dependencies:** None; the entry rules and section headings are part of the same change.
- **Acceptance:** An agent can determine the next free ID and read any single entry without exceeding one
  read.
- **Source:** 2026-09-17 branch-wide agent findings.
