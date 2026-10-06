---
name: simplify-repo
description: >-
  Plan and run Tao repository simplification. Use when asked for a repository cleanup pass,
  reduced instructions or documentation, package consolidation, or /simplify-repo; organize
  changes around shared functions, established patterns, and enforceable rules.
---

# Simplify Repo

The goal is the best concluding state, not the smallest diff: current structure is no constraint.
Each run has a plan under `Docs/Roadmap/Repository simplification <n>/`; this skill owns what every
run shares. Standing decisions below are the Developer's and are not reopened; anything new goes through
`decision-rounds`.

## Sequence

1. Read the previous runs' plans, archived under `Docs/Archive/Plans/Repository simplification*/`
   once each lands, and `git log -i --grep=simplif` so the pass builds on them.
2. Run `./agent simplify-audit` for the baseline; `--json` lists every row. `references/audit.md`
   says what it measures and what it cannot.
3. Find concurrent work with `./agent board`, read each branch's touched paths, and write them into
   the plan as fences. Files several branches edit belong to the orchestrator alone.
4. Propose the top five projects from the audit, plus other focuses the numbers suggest, and settle
   them with the Developer through `decision-rounds`.
5. Write the plan: decisions, fences, projects, waves with exclusive path ownership and a model
   tier per agent, and a ledger. `delegation`'s `references/parallel-implementation.md` owns the
   fan-out mechanics.
6. Execute on one branch through `./agent`'s own commands (`verify`, `typecheck`, `dead-exports`,
   `parser-gen`, `ledger-index`, …), not a direct `just` recipe it already exposes. Run narrow checks
   and `verify-changed` while iterating; hosted `Verify` on the landing route `verification-lanes`
   owns is the only merge evidence. After moving or renaming a package, `./agent setup --refresh-lockfile`
   is the one install that rewrites `bun.lock`. A read-only `reviewer` using `delegation`'s effort policy reads every wave's
   seams before it starts and the whole diff again before every landing, briefed to hunt what
   `./agent typecheck` cannot see — a moved literal that still resolves, just not to what it used to.
   Package moves and alias renames go last, after merging `main`, in one mechanical commit; if a move
   touched a Git hook script, `./agent doctor` after landing checks the shared `.git/hooks` picked it
   up rather than a stale script silently exiting 0.
7. Record before and after in the plan's ledger: non-test source lines, instruction lines,
   allowlist entries, defects fixed. Archive the plan when the run lands.

## Standing scope

- Never touch test code: `*.test.*`, test helpers, `*-tests/`, Test Apps, the test compiler, the
  runner and lanes under `packages/testing/verification`. `repo-lint.ts` is the exception; it is
  where new gates land.
- Fix a defect a slice exposes, in that slice, and name it in the commit.
- Under `Apps/`, documentation only. Emitted TSX may change shape.

## Focuses

- Code: `references/code.md` — shared functions, house patterns, structural splits, allowlists.
- Instructions and documentation: `references/instructions-and-docs.md` — budgets, placement, rules
  into code, the archive.
- Packages: `references/packages.md` — when packages group, when they merge, and how aliases follow.

## Prefer a gate to a sentence

Every pattern or rule this pass settles ends as a lint, hook, or command behavior where a machine
can judge it, and the prose that stated it is deleted in the same change. A pattern only a reader
can judge stays review-only, written once in the nearest `AGENTS.md`.
