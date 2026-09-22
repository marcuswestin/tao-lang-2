# Brief - Enforcement And Diagnostics Surface

Draft for review. Orchestrator brief: findings and constraints, not a plan. Devise the plan yourself.
Every fact was verified against `main` at `6cfd88be` on 2026-08-14; re-verify anything you rely on.

## Scheduling

These two workstreams were selected because they conflict with nothing else in flight. A large
language tranche is being implemented concurrently on its own branch, touching parser, validator,
formatter, source-actions, compiler, runtime, and the stdlib. Neither item below edits those surfaces,
so you can run alongside it without coordination.

Two things follow from that:

- **Expect `main` to move under you**, and expect a long-lived feature branch that is red for
  extended stretches by design. Neither is a problem to fix.
- **Do not widen scope into language, runtime, or package-structure work.** Other work is already
  underway there — including a reorganization of `packages/dev` and a split of `packages/runtime`. If
  you find yourself needing to change either, stop and ask the Developer rather than absorbing it.

## Repo state

- `main` is `6cfd88be`: six commits, green, content-current. `./agent verify` reports 14 suites, 782
  tests, 9.0s suite wall time, 30.8s suite-sum.
- **`origin/main` is still `444b02ed`.** The push is the Developer's to make. Until it lands, a hosted gate has
  nothing current to run against — raise this with the Developer before building one.
- `Apps/WordFlower/2 - Next/` holds **uncommitted** files under the Developer's review. Do not disturb or commit
  them.
- Toolchain is nix/devenv + direnv + bun. A fresh worktree needs `direnv allow` then
  `direnv exec . ./agent setup`. Branch `feat/<name>`; never commit from detached HEAD.
- `./agent verify` before every commit. The cleanup spike's R1–R13 rulebook in
  `Docs/Archive/Reports/Code cleanup spike/Report.md` is the live quality bar. Read `AGENTS.md` and
  `packages/AGENTS.md` first.
- Fifteen-plus worktrees share this repo and other agents commit concurrently. Preserve changes you
  did not make, and never write into another worktree.

---

## 1. Enforcement gate

There is no `.github/`, no CI configuration of any kind, and no non-sample Git hooks. The remote is
`https://github.com/marcuswestin/tao-lang-2`. `./agent verify` is the entire quality bar, and it runs
only when a human or an agent chooses to run it.

That matters more here than in a single-developer repo. Agents work in concurrent worktrees,
`AGENTS.md` warns explicitly about concurrent edits, and merges into `main` are frequent enough that a
merge-readiness checklist existed. Nothing establishes that `main` is green at a given commit, and
nothing would catch two individually-verified branches that break in combination.

`main` is now current and green, which makes it a trunk worth defending — and a long-lived feature
branch is about to be merging into it.

What to work out: hosted (GitHub Actions) versus local hooks, or both at different strengths; how a
nix/devenv/bun toolchain reproduces in a hosted runner and what that costs against a 9-second local
suite; which `just check` legs run remotely versus locally; blocking versus reporting.

Three constraints:

- **Invoke `just` / `./agent` recipes, never file paths.** `Justfile` line 3 hardcodes
  `WORD_FLOWER_APP` to a single `.tao` file, and concurrent work will turn that into a directory. Any
  gate that reaches past the recipes will break when it does.
- **Report rather than block on feature branches** that are mid-implementation. A gate that blocks a
  branch designed to be red for weeks will simply be turned off.
- A merge-readiness command (`./agent merge-feature-preflight`) exists today and is being **deleted**
  by concurrent work. It inspects read-only Git state — branch, dirtiness, upstream, ahead/behind
  counts — and never runs the tests. Decide with the Developer whether the gate should subsume any of that
  before it disappears.

## 2. Diagnostics CLI surface

The validator is the largest source package — 5,769 lines across 24 feature validators — and produces
the language's entire semantic diagnostic vocabulary. Of the six `tao` commands (`dev`, `compile`,
`fmt`, `fix`, `check`, `test`), exactly one prints a validation diagnostic: `tao test`, and only as a
preflight before running tests.

Reproduced on `6cfd88be`:

```text
$ tao check .          # file contains: view Main { render Missing("hi") }
Needs fixes ../../../../tmp/taoprobe2/y.tao
1 noncanonical, 0 unchanged
```

```text
$ tao check .          # file contains: view A {\n render B(
Failed to check .../x.tao: Expected: Tao source without syntax errors when applying source fixes
0 noncanonical, 0 unchanged, 1 failed
```

An unresolvable view is reported as a formatting concern. A syntax error surfaces as internal `Assert`
text — the `Expected: …` prefix comes from `Assert` in `packages/shared/shared-src/core/Assert.ts` —
carrying no line, no column, and no statement of what was wrong, even though Chevrotain hands the
parser exact positions. Path rendering also degrades outside the repo root.

So the two most common things a user does wrong both produce output that either misdescribes the
problem or leaks an internal invariant. `tao check` is a canonicalization checker whose name promises
correctness checking. The diagnostics themselves are well-built; they have no command.

**Why this is worth doing now.** A dozen new language features are being implemented concurrently by
people who currently get an assertion string instead of a line number. Every day this lands earlier is
a day of better feedback for that work.

Useful existing material: `packages/shared/shared-src/core/Errors.ts` already separates
`UserInputError` / `UnexpectedBehaviorError` / `CommandExecutionError` with `formatForUser` and
`formatForLog`. The error taxonomy exists; this rendering path does not use it.

Scope this to `packages/cli/tao-cli`, `packages/shared/shared-src/core/Errors.ts`, and the parser's error
plumbing.

What to work out: whether `check` gains semantic reporting or a distinct command appears, and what
that implies for the `check` / `fix` / `fmt` triad's meaning; what a rendered diagnostic should
contain (position, source excerpt, severity); how syntax errors get promoted from assertion failures
to positioned diagnostics without weakening the "codegen assumes validated input" contract in
`packages/AGENTS.md`.

**Do not start a diagnostic-code taxonomy.** Assigning stable identities across 24 validators is being
considered separately and would collide with concurrent validator work. Design the rendering path so
a code could be displayed later if one arrives, and leave it at that.

---

## Sequencing

The two are independent. Workstream 2 delivers value to concurrent work the moment it lands, which
argues for doing it first. Workstream 1 partly depends on the Developer pushing `main`, so it may be gated on
something outside your control.

## What a plan should be explicit about

- Whether the gate blocks or reports, per branch class, and who can turn it off.
- Whether workstream 2 changes the meaning of an existing command or adds one — that is a
  user-visible decision needing the Developer's sign-off before implementation.
- Whether each is one branch or several, given `./agent verify` must pass before every commit.
  Baseline to hold: 14 suites, 782 tests, 9.0s.
- Which findings here you disagree with after reading the code yourself.
