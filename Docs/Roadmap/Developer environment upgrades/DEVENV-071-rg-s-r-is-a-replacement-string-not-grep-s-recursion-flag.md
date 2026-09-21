# DEVENV-071 — `rg`'s `-r` is a replacement string, not grep's recursion flag

- **Status:** Candidate
- **Section:** External
- **Area:** Agent tooling
- **Impact:** `rg -rn <pattern> <path>` prints every match with the matched text replaced by the literal
  `n`, so the output reads as genuine source and can be quoted into a document or a review as fact.
- **Evidence:** `rg -rn TAO_STUDIO_CHROME_PATH packages/` printed lines such as
  `Platform.runtimeProcess.env['n']`, because `-r` consumed `n` as the replacement string rather than
  combining with `-n` as `grep -rn` does.
- **Workaround:** `rg` recurses by default; pass no `-r`, and use `-n` alone for line numbers.
- **Proposed change:** One clause in the `AGENTS.md` search bullet noting that `rg` recurses by default
  and that `-r` means replace.
- **Dependencies:** None.
- **Acceptance:** The search guidance names the `-r` difference where it tells agents to prefer `rg` over
  `grep -r`.
- **Source:** 2026-09-17 branch-wide agent findings.
