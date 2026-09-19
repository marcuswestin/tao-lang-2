# DEVENV-070 — This ledger no longer fits one agent read

- **Status:** Resolved
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
- **Dependencies:** None. Settled in two steps: one file per entry with a `_repo-lint`-enforced index,
  then this archive.
- **Acceptance:** An agent can determine the next free ID and read any single entry without exceeding one
  read. Met: each entry is its own file, the index states the next free ID, and the index lists only open
  work because addressed entries move to `Developer environment upgrades/Archive/`.
- **Source:** 2026-09-17 branch-wide agent findings.
- **Archived:** 2026-09-19
