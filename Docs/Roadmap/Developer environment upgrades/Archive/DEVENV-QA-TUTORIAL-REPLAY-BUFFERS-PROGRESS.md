# DEVENV-QA-TUTORIAL-REPLAY-BUFFERS-PROGRESS — QA tutorial replay buffers progress

- **Status:** Resolved
- **Area:** QA source replay and nested workflow output
- **Impact:** The automatic tutorial replay's parent watches for output while its child front door normally buffers progress until completion, so useful work can appear idle.
- **Evidence:** On 2026-10-06, candidate `4bfb13da4`, QA run `20261006184353212-6ed0d745-db74-45e2-959d-3a1da3549bc1` terminated the source child after 120.1 seconds without output. The failed receipt and log are retained under `Docs/QA/evidence/tutorial-first-hour/integrated/qa-source-timeout.*`. The prior tutorial packet also retains an automatic idle timeout. This identifies a buffering/watchdog mismatch, not the cause of the separately observed per-test deadline failure.
- **Workaround:** A focused source replay remains available through the normal test-file command.
- **Proposed change:** QA invokes `test-file --verbose` so the front door streams progress into the parent's captured log. The command receipt reflects those exact arguments. Total and idle limits remain 600 and 120 seconds.
- **Dependencies:** None.
- **Acceptance:** The QA register fixture verifies command-first argument order, immutable resume and successful/failed source receipts. All nine register tests pass. Repaired automatic QA run `20261006184846632-53c0f402-4771-4f29-ae67-92872a4e03ad` passes all three real tutorial tests in 91.5 seconds with five overlapping lanes. The rejected intermediate flag ordering is retained as a failed receipt. Independent review checked the full front-door entry point after that correction.
- **Source:** First-hour tutorial engineering replay, 2026-10-06.
- **Archived:** 2026-10-06
