# DEVENV-065 — The raw-`Error` allowlist is line-precise with no way to re-derive it

- **Status:** Candidate
- **Section:** External
- **Area:** Repository lint
- **Impact:** Every edit to a file that holds allowlisted raw `Error` constructions moves the
  remaining entries, so `_repo-lint` fails with two paired errors per shifted line — one demanding a
  new entry, one demanding the old entry be dropped. The failure has nothing to do with the change
  under review, and an agent that edits such a file repeatedly pays it once per edit. `nodeImport`
  was moved to file-scoped entries on `main` and no longer has this problem; `rawError` and
  `rawThrow` still share the line-precise `allowlistBySite` mechanism, and the fix that worked for
  the third rule is available to them.
- **Evidence:** During the September follow-up branch, four separate `verify --complete` runs failed
  only on `RAW_ERROR_ALLOWLIST` drift after edits to `packages/dev/dev-src/studio/StudioCdp.ts` and
  `packages/dev/studio-smoke/studio-simulated-user.test.ts`; one run reported forty paired errors.
  Re-deriving by hand is error-prone because removing a file's entries first loses the grouping
  comment that says which block a new entry belongs to. The same failure hit `NODE_IMPORT_ALLOWLIST`
  twice on 2026-09-21 before that rule went file-scoped: its entries for
  `packages/dev/dev-tests/repo-lint.test.ts` were renumbered once by hand when tests were added, then
  broke again when `_fix-dprint` reflowed the same file — four errors at once for a fixture block
  nobody had edited. The hand renumbering had also been silently wrong: the recorded pair pointed at
  two sibling fixture strings the rule does not match at all, two lines above the real ones. A
  line-precise entry can therefore be stale, wrong, and green at the same time, which is the argument
  for giving the two remaining rules the same treatment.
- **Workaround:** Re-derive the list from the lint output rather than editing it by hand: read every
  `constructs` line as an addition and every `no longer constructs` line as a removal, decide each
  new entry's comment group from the list's contents _before_ applying the removals, and rewrite the
  array sorted by path then line.
- **Proposed change:** Give `repo-lint` a `--fix` that applies exactly that re-derivation, or anchor
  each exemption to something stable — the enclosing function's name, or a trailing pragma comment
  on the construction itself — so ordinary edits above it do not invalidate it.
- **Dependencies:** None.
- **Acceptance:** Editing a file with allowlisted constructions, without adding or removing any,
  leaves `_repo-lint` green; adding one has a single supported command that records it.
- **Source:** 2026-09-17 September remediation follow-up.
