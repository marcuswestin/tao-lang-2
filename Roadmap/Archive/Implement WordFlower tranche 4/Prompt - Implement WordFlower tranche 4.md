# Implement WordFlower Tranche 4

You are the orchestrating implementation agent for Tao's active WordFlower tranche.

## Goal

Make `Apps/WordFlower/1 - Current/` successfully parse, validate, format, compile, and execute the
complete product contract currently represented by `Apps/WordFlower/2 - Next/`. Close the tranche
only when Current and Next meet the repository's directory absorption gate and all verification
passes.

`Next` is the authoritative semantic contract, not merely example code. Its header and every file in
the directory are required. `Current` is allowed to change wherever implementation proves that its
old shape is insufficient. If a Next assumption is demonstrably invalid, correct Next and every
affected active specification deliberately; do not leave the tiers silently divergent.

## Start here

Read these before planning or editing:

1. `AGENTS.md` and `packages/AGENTS.md`.
2. `Apps/WordFlower/README.md` for the tranche process.
3. `Roadmap/Implement WordFlower tranche 4/Brief - Implement WordFlower tranche 4.md` for seams,
   constraints, and the directory-gate migration.
4. `Apps/WordFlower/2 - Next/WordFlower.tao-next`, then every sibling contract file. The absorbed
   scratch contracts now live at `packages/stdlib/tao/Prelude.tao` and
   `packages/stdlib/tao/text/Text.tao`.
5. The active specs and decision records cited by those files, especially
   `Roadmap/Deferred Tao language decisions.md`.

Inspect the live checkout and existing tests before choosing implementation order. Do not assume an
old roadmap fact still matches the code.

## Operating model

- Work on a named `feat/...` branch in a clean Worktrunk-created worktree. Preserve concurrent
  changes, and never alter another worktree or its index.
- Choose dependency-aware vertical slices yourself. A language feature normally spans grammar/AST,
  scoping, validation, formatter and source actions, compiler, runtime, stdlib, Tao fixtures, and
  behavior coverage. Do not land parser-only or codegen-only fragments.
- Start with the mechanical directory absorption gates early enough that they guard the real work.
  Migrate the Prelude and `@tao/text` scratch contracts into their final stdlib locations as their
  slices land, then remove the scratch copies at tranche close.
- Implement design last, exactly as `Design.tao-next` requires. Do not expand flat tokens and named
  clause bundles into semantic tokens, recipes, design tooling, or other later-tier work.
- Keep `loop` as the collection surface; do not add a stdlib `List`. Keep InstantDB, remote
  authorization semantics, richer data-provider test controls, snapshots, SplitNav/windows,
  semantic design recipes, and general concurrency policy out of this tranche.
- Use `render inject` and the declared ambient channels exactly as the Next contract specifies;
  do not revive an implicit props bag or compiler-prefixed bindings.
- Treat `Next` as a forcing app: every syntax form and behavior represented there must compile and
  execute. Add focused package tests for diagnostics and lowerings that a product fixture cannot
  prove.

## Decisions and judgment

You are expected to resolve ordinary implementation details independently: slice order, AST shapes,
internal APIs, diagnostics wording, test placement, migration mechanics, and local refactors.

Raise a question for Ro only when evidence reveals a genuine language-semantic contradiction or a
choice that would materially change the authored Tao model. Before asking, inspect Next, the active
specifications, validators, and existing runtime seams; present the smallest concrete alternatives
and a recommendation. Do not stop for routine uncertainty.

Declaration-spike Q11 was resolved during this tranche: a reusable `nav`/`datasource` type keeps the
explicit `implement inject nav|provider` protocol-binding clause. This remains distinct from the
primitive's required `implement` slot and from a visual declaration's `render inject` body.

## Commits and verification

Commit each coherent, green vertical slice as you go. Use concise messages with bullets describing
the actual slice. Before every commit, run focused relevant tests and `./agent verify`; do not stage
unrelated work. At the end, run the full verification suite again, confirm the Current/Next directory
gate, inspect active docs for stale syntax, and leave a clean feature branch with a concise handoff
that names every commit, validation result, deliberate correction, and any remaining blocker.
