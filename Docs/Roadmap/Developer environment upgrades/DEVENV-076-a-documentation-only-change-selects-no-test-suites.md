# DEVENV-076 — A documentation-only change selects no test suites

- **Status:** Candidate
- **Area:** Test selection
- **Impact:** Documents that are now proven by a test suite — `Docs/Tutorials/Your First Tao App.md`
  is replayed, formatted, validated, and run by `packages/tao-cli/cli-tests/tutorials.test.ts` — can
  be edited and iterated on without that suite ever being selected. The breakage only surfaces at
  `verify --complete`, which is the merge gate but not the iteration loop.
- **Evidence:** `TestSelection.ts` treats `.md$` and `^Docs/` as `DOCUMENTATION_PATTERN` and skips
  those paths entirely, so `./agent verify-changed` on a branch that only edits
  `Docs/Tutorials/**` reports no selected suite.
- **Workaround:** Run `just test-file packages/tao-cli/cli-tests/tutorials.test.ts` after editing a
  tutorial, or rely on `verify --complete` before review.
- **Proposed change:** Let a document declare the suite that proves it — a small map from path
  prefix to suite in `TestSelection.ts`, seeded with `Docs/Tutorials/` to `tao-cli` — so a proven
  document selects its prover while unproven documentation keeps skipping selection.
- **Dependencies:** None.
- **Acceptance:** `./agent verify-changed` on a branch that only edits `Docs/Tutorials/**` selects
  the `tao-cli` suite and says which path selected it.
- **Source:** 2026-09-17 tutorial test coverage work.
