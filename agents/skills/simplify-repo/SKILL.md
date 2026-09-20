---
name: simplify-repo
description: >-
  Plan and run a repository-wide simplification pass: remove code through shared functions, bring
  code to the house patterns, shrink agent instructions and documentation, move written rules into
  code that enforces them, and consolidate packages. Use when Ro asks to simplify the repo, run a
  simplification or cleanup pass, reduce instructions or docs, or invokes /simplify-repo.
---

# Simplify Repo

The goal is the best concluding state, not the smallest diff: current structure is no constraint.
Each run has a plan under `Docs/Roadmap/Repository simplification <n>/`; this skill owns what every
run shares. Standing decisions below are Ro's and are not reopened; anything new goes through
`decision-rounds`.

## Sequence

1. Read the previous runs' plans and `git log -i --grep=simplif` so the pass builds on them.
2. Run `./agent simplify-audit` for the baseline; `--json` lists every row. `references/audit.md`
   says what it measures and what it cannot.
3. Find concurrent work with `./agent board`, read each branch's touched paths, and write them into
   the plan as fences. Files several branches edit belong to the orchestrator alone.
4. Propose the top five projects from the audit, plus other focuses the numbers suggest, and settle
   them with Ro through `decision-rounds`.
5. Write the plan: decisions, fences, projects, waves with exclusive path ownership and a model
   tier per agent, and a ledger. `delegation`'s `references/parallel-implementation.md` owns the
   fan-out mechanics.
6. Execute on one branch. `./agent verify` gates each slice; a deep-tier `reviewer` reads each
   wave's seams. Package moves and alias renames go last, after merging `main`, in one mechanical
   commit.
7. Record before and after in the plan's ledger: non-test source lines, instruction lines,
   allowlist entries, defects fixed. Archive the plan when the run lands.

## Standing scope

- Never touch test code: `*.test.*`, test helpers, `*-tests/`, Test Apps, the test compiler, the
  runner and lanes under `repository-tests/`. `repo-lint.ts` is the exception; it is where new
  gates land.
- Fix a defect a slice exposes, in that slice, and name it in the commit.
- Under `Apps/`, documentation only. Emitted TSX may change shape.

## Focuses

- Code: `references/code.md` — shared functions, house patterns, structural splits, allowlists.
- Instructions and documentation: `references/instructions-and-docs.md` — budgets, placement, rules
  into code, the archive.
- Packages: `references/packages.md` — when packages merge and how aliases follow.

## Prefer a gate to a sentence

Every pattern or rule this pass settles ends as a lint, hook, or command behavior where a machine
can judge it, and the prose that stated it is deleted in the same change. Patterns only a reader
can judge stay review-only and are written once, in the nearest `AGENTS.md`.
