# DEVENV-OUTPUT-HOOK-REQUIRES-UNAVAILABLE-READ-TOOL — Output hook requires an unavailable read tool

- **Status:** Resolved
- **Section:** External
- **Area:** Output-discipline hook and shell inspection guidance.
- **Impact:** Bounded source and instruction reads are refused while the prescribed replacement
  tool is unavailable in the active harness. Ordinary read-only inspection needs overrides or
  less convenient searches; the refusal also catches `git diff --check`, which emits no patch.
- **Evidence:** During managed-loop continuation on 2026-10-04, a bounded `sed` read of the
  execution document was rejected with `Read files with the Read tool, not sed`. The current tool
  inventory exposes shell execution but no local Read tool. Independent source workers observed
  the same mismatch and a refusal of `git diff --check`. Documented overrides are recorded in
  `.artifacts/logs/hook-overrides.jsonl`; the diagnosis does not imply an OS sandbox denial.
- **Workaround:** Use bounded `rg` inspection or the documented `# hook-ok: <reason>` mechanism.
  Capture patches in task-local artifacts before reading them.
- **Proposed change:** Align the hook's replacement guidance with the active tool inventory, and
  distinguish patch-producing Git invocations from whitespace-only checks. Preserve bounded
  output and generated-tree protections across every supported harness.
- **Dependencies:** None.
- **Acceptance:** Bounded file reads have an available supported route; whitespace-only diff
  checks are admitted; whole-patch and generated-tree scans still receive actionable refusals.
- **Source:** Shared dev/ro managed-loop autonomous continuation, 2026-10-04.
- **Resolution:** The 2026-10-06 repository pass measured 3,311 `sed` and 75 `cat` overrides of
  this rule in one week, nearly all citing an absent read tool. The hook now reads the harness from
  its payload (`turn_id` or a `.codex/` transcript path) and admits bounded shell reads where no
  file tool exists, while `sed -i`, patch dumps and the other rules still refuse; `git diff --check`
  counts as bounded. `output-discipline.test.ts` covers both harnesses and the whitespace check.
- **Archived:** 2026-10-06
