# DEVENV-FORMATTER-FAILURE-MISCLASSIFIED-AS-SANDBOX-RESTRICTION — Formatter failure misclassified as sandbox restriction

- **Status:** Resolved
- **Section:** External
- **Area:** Verification failure classification in `RunSummary.ts`.
- **Impact:** A normal source-format failure is reported as a sandbox restriction, encouraging
  unnecessary host escalation or permission diagnosis when formatting the named file is sufficient.
- **Evidence:** On 2026-10-03, `./agent check` log
  `.artifacts/logs/agent/check/2026-10-03T23-10-15-933Z-43804.log` reported `_dprint-check`
  as `exited 20 (sandbox-restriction)`. Its node log
  `.artifacts/logs/check/2026-10-03T23-10-16-090Z-43899-b0ee562b/dprint-check.log` instead
  showed one unformatted execution-document table and `Found 1 not formatted file.`
  Exact-path `./agent fmt` fixed the file; the next complete frozen-tree check passed
  (`2026-10-03T23-11-06-633Z-54844`). This was not an approval-review rejection or host denial.
  Source inspection finds the generic permission signature in `RunSummary.ts` matches EPERM
  text anywhere on a non-assertion line. The formatter's displayed document diff contained EPERM
  in historical prose (node log lines81/86/110/115). That signature can mistake displayed source
  content for a permission diagnostic; the label is not evidence that exit code20 denotes denial.
  The shared dev/ro repair on 2026-10-04 excludes numbered source-diff rows only for the formatter
  node with its recognized header. Independent review is clear; focused RunSummary tests pass39/39
  (`2026-10-04T06-54-12-255Z-6038`). A bounded actual dprint refusal checks exactly one unchanged
  scratch fixture containing historical EPERM, PermissionDenied and EACCES text, returns20, and
  is classified `repository`. Original output, status, log path and unformatted-file evidence are
  preserved in `.artifacts/formatter-classification-probe/receipt.json`; owned scratch is removed.
- **Workaround:** Read the failed node's complete log before treating its generic classification
  as a permission diagnosis. Format only the named task-owned file, then rerun the appropriate gate.
- **Proposed change:** Implemented: classify the formatter's known formatting refusal using node-specific
  evidence while preserving genuine sandbox-denial classification. Do not treat permission words
  inside a displayed source diff as a diagnostic about the running tool.
- **Dependencies:** None.
- **Acceptance:** Source regressions distinguish a formatter diff containing historical EPERM prose
  from a genuine sandbox refusal, preserving the original exit code and full log. A bounded real
  formatting refusal identifies its unformatted file and is not labeled sandbox-restriction.
- **Source:** Managed-loop acceptance execution, shared `dev/ro`, 2026-10-03.
- **Archived:** 2026-10-04
