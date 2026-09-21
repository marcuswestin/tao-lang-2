# DEVENV-TAO-FIX-NEVER-REUSES-THE-CHECK-MEMO — Tao fix never reuses the check memo, so every verify lane refixes the whole repository

- **Status:** Candidate
- **Section:** External
- **Area:** Verification performance
- **Impact:** `CheckCache` is opened only for a run that validates and does not write, so `tao check`
  can reuse a per-workspace verdict and `tao fix` never can. The consequence is asymmetric between
  lanes: `check` and `land-barrier` run `_tao-check` and reach the memo, while `verify` and
  `verify-changed` run `_fix-tao` instead and pay a whole-repository pass every single time. The
  per-commit gate is therefore the one lane that can never benefit from the memo that exists, and the
  cost does not fall with the size of the change — a one-line TypeScript edit refixes all 126 Tao
  files exactly as a Tao edit would.
- **Evidence:** `packages/cli/tao-cli/cli-src/source-commands.ts:82` —
  `const cache = options.validate === true && !options.write ? await CheckCache.open(options.cache) : undefined`.
  `runFix` reaches it through `runCanonicalSource(path, { ...options, write: true })`
  (`source-commands.ts:51-53`), so the condition is false for every fix. Measured 2026-09-21 on a
  quiet machine: `_fix-tao` carries a 21.9s recorded EMA and took 17.8s in a `verify` run whose whole
  80.6s serial floor was `_fix-just-fmt -> _fix-dprint -> _parser-gen -> _fix-tao -> tao-apps#1`, so
  it sits on the critical path rather than beside it. For contrast, a warm `./tao check` over the
  same tree is 0.5s and `./tao check` scoped to one app directory is 0.24s.
- **Workaround:** Pass a path. `./tao fix <path>` and `./tao check <path>` do only what they are
  given; bare, both do the whole repository. Root `AGENTS.md` now tells agents to do this while
  iterating, which avoids the cost by hand rather than fixing it.
- **Proposed change:** Two candidates, and the cheaper one is not obviously the better one. Scoping
  `_fix-tao` to the changed paths in the narrow lanes only adds no new state and leaves the wide
  lanes' whole-repository guarantee intact, so its only cost is that `verify-changed` checks less —
  which is already that lane's declared contract. Teaching the fix path to reuse the memo for its
  no-op case is more general but introduces write-state invalidation: a future agent adding a fixer
  step must remember to invalidate, or trees are left silently non-canonical. Prefer the first unless
  the second earns its complexity.
- **Dependencies:** The gate list lives in `packages/dev/dev-src/repository-tests/`, which the CLI
  restructure moves to `packages/testing/verification`. Scoping `_fix-tao` should land before that
  slice starts or wait until after it.
