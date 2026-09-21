# DEVENV-086 — The compiled-app fingerprint hashes all of `packages/`, so any concurrent edit invalidates every memo

- **Status:** Candidate
- **Section:** External
- **Area:** Verification performance
- **Impact:** `TestCache.fingerprint` folds in a toolchain identity that hashes every Git-visible
  file under `packages/`, and `CheckCache` does the same for `tao check`. That is correct — a Tao
  compile's output genuinely depends on the parser, validator, formatter, and stdlib sources — but it
  makes the memo all-or-nothing across a tree that several agents edit at once. One agent saving a
  file anywhere under `packages/**` invalidates every compiled-app and every checked-workspace entry
  for everyone, including entries whose workspace that file cannot reach. The gate lanes lose
  nothing, because `GateCatalog` already declares these nodes as reading `ts`, so any TypeScript
  change reruns them regardless. What pays is local iteration: an agent working on TypeScript pays a
  full cold compile and a full cold check on every save, and a second agent measuring performance in
  the same checkout cannot get a warm reading at all.
- **Evidence:** three consecutive `./tao test Apps` runs intended as a warm baseline each recompiled
  (~1,900 new files per run) and took 28.8 / 29.8 / 29.9s rather than the expected ~4.7s, because
  another agent was editing `packages/dev`; warm readings were only obtainable during a lull. Two
  `./tao check` runs 40s apart missed entirely for the same reason.
- **Narrowed 2026-09-21, by denylist rather than by derived closure.** `packages/cli/tao-cli/cli-src/toolchain-packages.ts`
  now leaves three groups out of both identities — `packages/dev`, `packages/ides/*`, `packages/testing/*` —
  and both `CheckCache` and `TestCache.fingerprint` hash the rest. The shape is deliberately the
  opposite of what this entry first proposed: naming the _irrelevant_ groups means a new, renamed or
  unconsidered package is hashed by default and the cache merely misses, where naming the relevant
  ones would silently exclude anything new and an excluded input a verdict depends on is a stale
  green. `toolchain-packages.test.ts` proves the promise rather than asserting it — it walks the real
  manifests and fails on any dependency edge from a verdict-relevant package into an excluded group,
  and separately pins that the CLI's one edge into `tao-dev` stays a single lazy import inside
  `studio-review`. Measured after: editing `packages/dev` costs **0.53s** against 34.4s before, while
  editing `packages/language/ast-utils` still costs 35.9s, which is the half that matters.
- **Still open.** The derived closure this entry asked for is not built, because `PackageGraph` models
  only literal TypeScript imports and cannot see the non-import edges — `TaoAppModules` locating
  `packages/apps/runtime` by filesystem test, `TAO_STDLIB_ROOT`, the workspace manifests,
  `packages/tsconfig.base.json`. The denylist does not need those edges to be safe, because it
  excludes only groups nothing reaches; a closure narrow enough to exclude `packages/ai` or
  `packages/providers` still would, and both are reached by real manifest edges today
  (`packages/compiler` depends on `tao-generation`, `packages/apps/stdlib` on `tao-icloud`).
- **Measured impact (2026-09-21):** on a quiet machine, the lane cost of one invalidation is 34.4s.
  A single comment added to `packages/dev/dev-src/performance/admission-experiment.ts` — a file no
  Tao verdict can depend on — made `just check` re-check all 126 Tao files, against 0.5s for a warm
  `./tao check` over the same tree, 0.24s scoped to one app directory, and 745ms for the whole lane
  on a tree that had not changed at all. The gate lanes do lose something after all: `check` and
  `land-barrier` pay this on every run that follows any edit under `packages/`.
- **Workaround:** none, beyond a quiet tree. Any future measurement quoting a warm baseline should
  say whether the tree was quiet while it was taken. `./tao check <path>` avoids the whole question
  by hand, which is what root `AGENTS.md` now tells agents to do while iterating.
- **Proposed change:** narrow the toolchain identity from "all of `packages/`" to the packages a
  verdict can actually depend on — for the compile, the parser, validator, formatter, stdlib, and
  their own dependencies; for `tao check`, the same set. The package graph that `PackageGraph.ts`
  already builds is the obvious input. The risk to weigh is the opposite error: a package left out
  of the set is a stale input nothing notices, which is strictly worse than a cache that misses too
  often, so the narrowing should be derived from the graph rather than hand-listed.
- **Missing proof (2026-09-20):** The current `PackageGraph` extracts TypeScript import strings, but a
  compile also reaches sibling packages through filesystem operations. In particular, `TaoAppModules`
  locates and links `packages/runtime` without a TypeScript import, and the compile stamp separately
  names stdlib, runtime-toolchain, manifests, and the lockfile. Until the dependency model declares
  those non-import edges and table-driven tests prove edits/additions/deletions throughout the derived
  closure invalidate while an unrelated synthetic package does not, broad invalidation is the safe
  behavior. Unknown roots, unresolved aliases, or undeclared filesystem reads must disable reuse.
  The 2026-09-20 follow-up also found that the current package closure rooted at `tao-cli` still reaches
  nearly every package, while computed `require`, runtime sibling discovery, workspace manifests, and
  `packages/tsconfig.base.json` remain outside `PackageGraph`'s literal TypeScript-import model. A safe
  implementation first needs an entrypoint-level resolver that reports unknown edges and disables
  reuse, plus an explicit checked registry for non-import filesystem inputs. Tests must cover a new
  import, alias, manifest rename, computed require, and filesystem dependency; merely enumerating the
  present package list cannot prove future completeness.
  Re-audited on 2026-09-20 on `feat/devenv-parser-cache-followups`: the current `PackageGraph` closure
  rooted at `tao-cli` contains 18 of the repository's 20 packages, so it would save almost no hashing
  even before correctness guards. The graph still derives edges only from literal TypeScript import
  strings, while `TaoAppModules.runtimeRoot` discovers `packages/runtime` by testing the filesystem.
  The missing proof is a fail-closed dependency model for those non-import reads, followed by one
  table-driven invalidation matrix shared by `TestCache` and `CheckCache`; the present cache suites
  prove broad invalidation only.
- **Dependencies:** DEVENV-081 (the compiled-output memo) and the `tao check` workspace stamp both
  key on this identity.
- **Acceptance:** an edit under `packages/<name>` invalidates only the memos whose verdict can reach
  that package, and a table-driven test proves each toolchain package still invalidates.
- **Source:** 2026-09-19, found independently by two agents measuring warm baselines in a shared
  checkout.
