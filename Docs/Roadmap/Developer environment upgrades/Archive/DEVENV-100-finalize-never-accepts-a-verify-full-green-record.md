# DEVENV-100 — Finalize never accepts a `verify-full` green record

- **Status:** Resolved
- **Area:** Verification lanes, landing
- **Impact:** `finalize` re-runs `just verify --complete` on a tree that `verify-full` has already
  proved, because the lane names it will accept are misspelled and therefore match nothing. The
  intended behavior is the one `GreenTree` describes — a green `verify-full` is also a green
  `verify`, being a superset — so the waste is a whole verification pass on every branch whose last
  lane was the wider one. That is the ordinary state right after a landing, which runs `verify-full`.
- **Evidence:** `packages/dev/dev-src/repository-tests/Finalize.ts:28` reads
  `const VERIFY_ACCEPTED_LANES: readonly string[] = ['verify', 'full-verify-sandbox', 'full-verify']`.
  The lanes are actually named `verify-full-sandbox` and `verify-full`: those are the spellings in
  the `Justfile` recipes, in each lane's `--green-tree` argument, and in the records `GreenTree`
  writes. Two of the three entries can never match a record, so only a `verify` record is ever
  reused. Found during the 2026-09-19 review of the landing-lock branch; it is pre-existing on
  `main` and not caused by that branch.
- **Workaround:** None needed for correctness — the failure is a redundant pass, never a false
  green. `verify --complete` simply runs again.
- **Proposed change:** Correct the two names. Then stop the class of bug rather than the instance:
  the lane names exist in `Justfile` recipes, in `--green-tree` arguments, in `LandingLock`'s locked
  set, and here, with nothing tying them together. A single exported list of lane names that all
  four consult, or a test asserting every name in these sets is one the `Justfile` actually
  defines, would have caught this and would catch the next one.
- **Dependencies:** `GreenTree.ts` owns the superset rule this is meant to implement;
  `LandingLock.ts` keeps a second hand-maintained list of the same lane names.
- **Acceptance:** A branch whose tree was last proved by `verify-full` runs no verification in
  `finalize`, and a test fails if any lane name in `Finalize.ts` or `LandingLock.ts` is not a
  recipe the `Justfile` defines.
- **Resolution (2026-09-19):** Both names corrected, and the class closed rather than the instance.
  `VerificationLanes.ts` now holds the lane names once; `Finalize` and `LandingLock` consult it
  instead of spelling their own copies. `verification-lane-names.test.ts` pins every name against
  the recipes the `Justfile` defines, and checks the other direction too — every `--lane` the
  `Justfile` passes must be a name the code knows, which is how a locked lane would otherwise go
  free by typo. Restoring the old `full-verify` spelling fails that suite, so it catches the
  original bug rather than merely describing it.
- **Source:** 2026-09-19 adversarial review of the landing-lock branch.
- **Archived:** 2026-09-19
