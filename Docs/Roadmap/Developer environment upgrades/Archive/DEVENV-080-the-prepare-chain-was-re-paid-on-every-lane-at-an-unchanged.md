# DEVENV-080 — The prepare chain was re-paid on every lane at an unchanged tree

- **Status:** Resolved
- **Area:** Verification performance
- **Impact:** Green records skipped test suites but never the fixers, so every lane re-ran the whole
  prepare chain before any suite could start — including on branches that changed no `.tao` file at
  all. That chain is the serial floor of every lane, so the cost was paid in full on every run.
- **Evidence:** On 2026-09-19 a `verify --complete` measured a 74.7s makespan against a 74.5s serial
  floor at 52% idle on 18 CPUs; the floor was
  `_fix-just-fmt -> _fix-dprint -> _parser-gen -> _fix-tao -> _compile-word-flower-app -> tao-apps#2`.
  `_fix-tao` alone measured 15.8-29.5s in lanes and 28.7s standalone on a quiet machine, reporting
  `0 fixed, 124 unchanged` every time. `isRecordable` excluded every node with a non-empty `writes`,
  which is what kept the fixers out of the records.
- **Workaround:** None; the cost was unconditional.
- **Change made:** `isRecordable` now excludes only nodes that write a _generated_ class
  (`gen-app`, `gen-parser`). A fixer's output is the tracked tree, which the hash does describe, and
  a record is keyed by the verified tree the prepare phase left behind, so at that hash the fixer has
  already reached its fixpoint. A generator's output is Git-ignored and outside the hash, so a
  matching hash cannot attest it is present — a fresh checkout hashes identically to one that has it.
- **Measured:** two back-to-back `verify-changed` lanes at one tree, load 5.2 on 18 CPUs: first run
  68.1s, second **17.8s**. The serial floor became `_parser-gen -> _compile-word-flower-app ->
  tao-cli#1`; all three fixers skipped and both generators correctly still ran.
- **Dependencies:** Relies on the existing guard in `GateRunner` that refuses to call a run green
  evidence when nodes were skipped and the prepare phase then changed the tree.
- **Acceptance:** A fixer is recorded and skipped at an identical tree, is re-run at a different
  tree, and a generator is never recorded — asserted in `green-record-policy.test.ts` and
  `gate-catalog.test.ts`.
- **Source:** 2026-09-19 verification-performance work.
- **Archived:** 2026-09-19
