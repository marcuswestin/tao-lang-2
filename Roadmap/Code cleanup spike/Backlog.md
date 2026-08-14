# Code cleanup spike backlog

Branch: `feat/cleanup-spike`\
Base: `2906cfa60ece4fe4766087f36a9af67f56e48938` (`feat/wordflower-tranche-3`)\
Last full sweep: baseline, 2026-08-14

This is the live state for the in-between-tranches cleanup spike. A value score is the estimated
number of rule violations removed divided by non-mechanical lines changed. Pure file moves are not
counted as authored lines. Chartered work remains required even when its ratio is lower than an
unchartered candidate.

## Baseline

The mechanical scan counts tracked, non-generated TypeScript and TSX under `packages/`; it excludes
`node_modules` and every `_gen_` path. Function counts come from the TypeScript AST and include a
function when it is over 40 lines or its control-flow nesting exceeds three levels.

| Package        |      Lines |
| -------------- | ---------: |
| ast-utils      |      3,208 |
| compiler       |      3,898 |
| dev            |      6,835 |
| formatter      |      2,753 |
| ide-extension  |        640 |
| parser         |      3,608 |
| runtime        |     10,883 |
| shared         |      2,925 |
| source-actions |      1,264 |
| tao-cli        |      1,749 |
| validator      |     10,774 |
| workspace      |        499 |
| **Total**      | **49,036** |

- Files over 400 lines: 23 (13 source, 10 test; six tests are over 800 lines).
- Source functions over 40 lines or nested over three levels: 72.
- Compound-condition candidates from the mechanical R1 scan: 76 before value review.
- Native `switch` statements: 0.
- Verification: 14 suites, 668 tests passed, 2,398 expectations plus two suites without expectation
  counts; 11.63s process wall time and 9.5s reported suite wall time.

## Added rules

None. Add a rule here only when the same worthwhile, uncovered cleanup appears in multiple places
and an immediate repo-wide application clears the abstraction and value bars.

## Chartered and threshold backlog

| Status             | Location                                                                  | Rule            |          Estimated size |   Value score | Measurable effect                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------- | --------------- | ----------------------: | ------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| done               | `packages/validator/validator-src/validators/`                            | R3 / charter 1  |      mostly moves + 142 |        19/142 | Put all 19 feature validators under `validators/`; validator infrastructure remains at the package root.                                                                                     |
| in progress        | `packages/validator/validator-src` traversal entry and feature validators | R4 / charter 1  | 287 so far + follow-ups | 20/287 so far | Typed append-only node dispatch now owns 22 handler kinds; direct full-tree scans are 70 -> 50 after consolidating all 16 test-validator passes.                                             |
| queued             | `packages/runtime/TaoRuntime-src/TR-navigation.ts`                        | R3 / charter 2  |     mostly moves + ~120 |        3/~120 | Replace one 1,583-line, four-concept module with descriptor, state/reducer, host/rendering, and target/resolution owners under 400 lines where coherent.                                     |
| queued             | `packages/validator/validator-tests/validator.test.ts`                    | R10 / charter 3 |      mostly moves + ~80 |         1/~80 | Split the 4,931-line test by validator source seams without changing assertions.                                                                                                             |
| queued             | `packages/runtime/runtime-tests/runtime-e2e.jest-test.tsx`                | R10 / charter 3 |      mostly moves + ~60 |         1/~60 | Split the 2,668-line runtime integration test by runtime feature seams.                                                                                                                      |
| queued             | `packages/parser/parser-tests/parser.test.ts`                             | R10 / charter 3 |      mostly moves + ~40 |         1/~40 | Split the 1,369-line parser test by grammar/source seams without touching grammar.                                                                                                           |
| queued             | `packages/runtime/TR-tests/TR.test.ts`                                    | R10 / charter 3 |      mostly moves + ~35 |         1/~35 | Split the 1,040-line TR test along runtime module seams.                                                                                                                                     |
| queued             | `packages/compiler/compiler-tests/compiler.test.ts`                       | R10 / charter 3 |      mostly moves + ~35 |         1/~35 | Split the 991-line compiler test by codegen feature seams.                                                                                                                                   |
| queued             | `packages/formatter/formatter-tests/formatter.test.ts`                    | R10 / charter 3 |      mostly moves + ~35 |         1/~35 | Split the 956-line formatter test by formatter feature seams.                                                                                                                                |
| queued             | 13 source files currently over 400 lines                                  | R3              |        inspect per seam |        13/TBD | Split only where a real second concept exists; record cohesive files as deliberately left alone.                                                                                             |
| queued             | 72 source functions over 40 lines or nesting depth three                  | R2              |    inspect per function |        72/TBD | Decompose only into meaningful named steps with lower nesting or sub-threshold owners.                                                                                                       |
| queued             | 76 mechanically flagged conditions                                        | R1              |   inspect per predicate |        76/TBD | Name non-obvious decisions; reject short guard clauses whose extraction would be churn.                                                                                                      |
| queued             | repeated meaningful non-message literals found by the package sweep       | R6 / charter 4  |       inspect per owner |           TBD | Name repeated values at the module that owns their meaning.                                                                                                                                  |
| done               | repeated Android, compiler assertion, and unexpected-error messages       | R12 / charter 4 |                      26 |          6/26 | Replace ten byte-identical message literals in four owners with four local constants; four abstractions each pay at two or three sites.                                                      |
| baseline-satisfied | parser creation and ordinary Tao parse output                             | R7 / charter 5  |                       0 |           n/a | The Tranche 3 base already sets the parser configuration that suppresses the deliberate ambiguity log; a live `./tao check` emits no warning. Revisit only if the full sweep disproves this. |

## Repo-rule conformance backlog

| Status             | Location                                                            | Rule | Estimated size | Value score | Measurable effect                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------- | ---- | -------------: | ----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| done               | validator Typir initialization and invocation validator             | R5   |             -7 |         1/7 | Remove the only call, exported object member, type-only import, and implementation of a deliberately empty validation hook.                                                    |
| done               | compiler, formatter, and source-actions internal module exports     | R5   |             36 |       18/36 | Make 17 file-local types private and delete one unused `Compile` re-export, net two lines; retain the package-facing test-plan and formatter/action types.                     |
| done               | `packages/shared/shared-tests/shared.test.ts`                       | R7   |              2 |         1/2 | Preserve formatter-sorted imports; baseline `./agent verify` exposed and corrected this pre-existing formatting violation.                                                     |
| done               | direct `process` use in dev, IDE extension, and runtime test owners | R7   |             19 |        7/19 | Route seven environment, cwd, and stdout accesses through the existing `Platform.runtimeProcess` boundary.                                                                     |
| baseline-satisfied | all non-generated package source                                    | R7   |              0 |         n/a | The baseline contains no native `switch`, no direct Langium import outside the parser owner, and direct Node filesystem/process imports are confined to shared wrapper owners. |

## Findings outside the spike

None yet. Suspected bugs, performance work, public API changes, grammar changes, dependency changes,
and one-off smells without a rule belong here rather than in code.
