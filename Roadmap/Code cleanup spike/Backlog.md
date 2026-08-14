# Code cleanup spike backlog

Branch: `feat/cleanup-spike`\
Base: `2906cfa60ece4fe4766087f36a9af67f56e48938` (`feat/wordflower-tranche-3`)\
Last full sweep: baseline, 2026-08-14
Last touched-package re-sweep: after 72 commits, 2026-08-14

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

## Ten-commit checkpoint

- Tracked non-generated TypeScript/TSX: 49,002 lines, down 34 from baseline.
- Complexity-qualified source functions: 70, down two; no cleanup-written function newly qualifies.
- Files over 400 lines: 24 (14 source, 10 test); six tests remain over 800 lines.
- `expressions-compiler.ts` crossed from 400 to 402 lines through R12. Do not manufacture an R3
  split for that cleanup-created crossing; its independently qualifying closed-union dispatch can
  bring it back under threshold.
- Native `switch`, compound-condition, direct platform/Langium, TODO-marker, and unused-export
  scans found no new cleanup-written violations.

## Twenty-commit checkpoint

- Tracked non-generated TypeScript/TSX: 49,044 lines, up eight from baseline. The five chartered
  navigation boundaries add 79 lines; all other cleanup work has net-deleted 71 lines.
- Complexity-qualified source functions: 70, unchanged from the ten-commit checkpoint; none of the
  five new navigation owners contains a qualifying function.
- Files over 400 lines: 23 (13 source, 10 test); six tests remain over 800 lines.
  `TR-navigation.ts` is down from 1,583 to 1,294 lines and remains charter work in progress.
- `expressions-compiler.ts` is back under threshold at 399 lines. No cleanup-written threshold
  crossing remains.
- Native `switch`, direct platform/Langium access, and TODO/legacy/compat scans remain clean in the
  touched packages. An explicit sequential-branch sweep found four pre-existing R13 misses, so R13
  is reopened until those sites are converted and rechecked.
- The R6 literal sweep found one qualifying owner: six planner timeout outcomes repeat constants
  already owned by the review subsystem. All other high-frequency literals failed the value bar.

## Thirty-commit checkpoint

- Tracked non-generated TypeScript/TSX: 49,201 lines, up 165 from baseline. The completed
  navigation split accounts for 201 added physical lines; all other work through the first three
  validator test seams has net-deleted 36 lines.
- Complexity-qualified source functions: 70, down two from baseline. No cleanup-written function
  newly qualifies; moved navigation functions retain their pre-existing shapes.
- Files over 400 lines: 25 (12 source, 13 test); six tests remain over 800 lines. Navigation removes
  one oversized source owner, while the first three validator splits deliberately add three
  sub-800 feature suites before the 3,090-line residual is fully divided.
- The mechanical R1 scan now flags 72 conditions. Value review finds no new cleanup-written
  candidate; remaining short guards, progressive checks, and already-question-named functions stay
  rejected as churn.
- Native `switch` remains at zero. The completed R13 follow-up audit still finds no qualifying
  sequential closed-union miss in touched packages.

## Forty-commit checkpoint

- Tracked non-generated TypeScript/TSX: 49,272 lines, up 236 from baseline. The completed
  navigation split adds 201 physical lines and the validator/runtime test splits add 136; all
  other work net-deletes 101 lines.
- Complexity-qualified source functions: 70, down two from baseline; no cleanup-written function
  newly qualifies. Files over 400 lines: 30 (12 source, 18 test), reflecting the completed
  validator split into sub-800 owners. Five tests remain over 800 lines, down one from baseline.
- The refined mechanical R1 scan still flags 72 conditions. Value review finds no new
  cleanup-written candidate. Native `switch` remains zero.
- A full R13 audit inspected 1,513 `if` statements, all 15 `else if` chains, all 225 adjacent-if
  groups, and every plausible same-discriminant cluster across 271 package files. It found zero
  missed `Switch.*` conversions; open inputs, validation guards, progressive state, structural
  unions, and intentional special/default grouping account for the rejected chains.
- The same sweep found two direct R4 collapses, deleting 15 lines and five redundant branches.
  R5, R9, and R11 audits added the qualifying follow-up batches below; R8 found no rename above the
  value bar.

## Fifty-commit checkpoint

- Tracked non-generated TypeScript/TSX: 49,319 lines, up 283 from baseline. The completed source
  navigation split still accounts for 201 added physical lines; the remaining growth is structural
  overhead from splitting the chartered test monoliths into readable, independently owned suites.
- Complexity-qualified source functions remain at 70, down two from baseline; no
  cleanup-written function newly qualifies. Files over 400 lines: 33 (12 source, 21 test), while
  only three tests remain over 800 lines: parser, compiler, and formatter.
- The refined mechanical R1 scan still flags 72 conditions. Value review finds no new
  cleanup-written candidate. Native `switch` remains at zero, and the full sequential-branch R13
  audit remains exhaustive with no missed closed-union conversion.
- The TR test owner is now 508 lines after moving its data and navigation seams byte-for-byte. All
  36 original callback hashes remain identical; no TR test file exceeds 800 lines.

## Sixty-commit checkpoint

- Tracked non-generated TypeScript/TSX: 49,446 lines, up 410 from baseline. All chartered oversized
  test splits are complete, and no test file remains over 800 lines.
- Complexity-qualified source functions remain at 70, down two from baseline; no
  cleanup-written function newly qualifies. Files over 400 lines: 29 (six source, 23 test). Only
  two of the six source owners still have a qualifying second concept; four are cohesive owners
  deliberately left intact.
- Six of eight qualifying non-chartered source owners are now split below 400 lines. The remaining
  owners are invocation binding and runtime data; R5 and R11 remain deferred until those module
  boundaries settle.
- The refined mechanical R1 scan still flags 72 conditions, native `switch` remains at zero, and
  the exhaustive R13 audit has no known missed conversion. A fresh post-R3 sequential-branch sweep
  remains required before the hard stop.

## Seventy-commit checkpoint

- Tracked non-generated TypeScript/TSX: 49,574 lines, up 538 from baseline. Invocation binding is
  fully split below threshold, and six of the seven runtime-data seams are now extracted.
- The pinned AST scan finds 70 complexity-qualified source functions, down two from the 72-function
  baseline and unchanged from commit 61. Re-running that same scan against both revisions exposed a
  one-count transcription error in the thirty-through-sixty checkpoint prose, corrected above.
- Files over 400 lines: 28 (five source, 23 test); no test exceeds 800 lines. Runtime data is the
  only remaining qualifying source split, while `Type`, `value-scope`, `TR`, and `Packages` remain
  cohesive owners deliberately left intact.
- The refined R1 scan still flags 72 conditions. Native `switch` remains at zero, and a fresh R13
  audit of 15 else-if chains, 15 nested-ternary roots, 222 adjacent-if runs, and 128 terminal-if
  runs found no missed closed-union conversion.

## Added rules

R13 EXHAUSTIVE UNION DISPATCH. Closed literal or `$type`/`kind` discriminated-union dispatch with
three or more mutually exclusive outcomes uses shared `Switch`, `Switch.type`, or `Switch.kind`;
repeated two-way dispatch within the same concept also qualifies. Keep ordinary `if`/early-return
logic for validation and failure guards, progressive or stateful short-circuiting, open/unknown
input, structural unions without a supported discriminator, and intentional special-case/default
grouping where exhaustive handlers would add duplication. Never cast, stringify, or invent a
discriminator merely to make `Switch` fit.

The initial repo-wide audit found ten qualifying pre-existing sites across ast-utils, compiler,
validator, and runtime. The twenty-commit sequential-branch sweep found four further misses in
ast-utils, validator, and runtime. Applying all fourteen is net-negative and leaves open-input,
stateful, guard, structural-union, and intentional special/default false positives alone.

## Chartered and threshold backlog

| Status             | Location                                                                  | Rule            |       Estimated size | Value score | Measurable effect                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------- | --------------- | -------------------: | ----------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| done               | `packages/validator/validator-src/validators/`                            | R3 / charter 1  |   mostly moves + 142 |      19/142 | Put all 19 feature validators under `validators/`; validator infrastructure remains at the package root.                                                                                           |
| done               | `packages/validator/validator-src` traversal entry and feature validators | R4 / charter 1  |                  826 |      69/826 | Replace 70 direct full-file traversals with one shared node array and typed append-only dispatch; Typir consumes the same array, while localized initializer/block walks remain local.             |
| done               | `packages/runtime/TaoRuntime-src/TR-navigation.ts`                        | R3 / charter 2  |                2,812 |    13/2,812 | Split the 1,583-line owner into a 350-line public contracts-and-controls facade plus 12 cohesive owners of 24–342 lines; no navigation source file remains over 400 lines.                         |
| done               | `packages/validator/validator-tests/validator.test.ts`                    | R10 / charter 3 |                8,645 |     8/8,645 | Split the 4,931-line monolith into eight feature owners of 508–677 lines, sharing two existing fixtures; all 167 callback hashes remain identical and no test exceeds 800 lines.                   |
| done               | `packages/runtime/runtime-tests/runtime-e2e.jest-test.tsx`                | R10 / charter 3 |                4,613 |     7/4,613 | Split the 2,668-line monolith into seven E2E owners of 132–681 lines with a shared lifecycle; all 62 callback hashes remain identical and no test exceeds 800 lines.                               |
| done               | `packages/parser/parser-tests/parser.test.ts`                             | R10 / charter 3 | 1,282 moved, net +14 |     2/1,282 | Split the 1,369-line owner into 737-line core, 522-line workspace, and 124-line type suites; all 37 callback hashes remain identical and grammar is untouched.                                     |
| done               | `packages/runtime/TR-tests/TR.test.ts`                                    | R10 / charter 3 |  1,071 moved, net +5 |     2/1,071 | Split the 1,040-line owner into 508-line core, 762-line data, and 413-line navigation suites plus one eight-line shared fixture; all 36 callback hashes remain identical.                          |
| done               | `packages/compiler/compiler-tests/compiler.test.ts`                       | R10 / charter 3 |    798 moved, net +8 |       1/798 | Split 13 file/codegen callbacks into a 402-line owner, leaving a 597-line test-plan/IR owner; all 28 callback hashes remain identical and neither file exceeds 800 lines.                          |
| done               | `packages/formatter/formatter-tests/formatter.test.ts`                    | R10 / charter 3 |    411 moved, net +3 |       1/411 | Move the nine-callback injection suite into a 203-line owner and share its fence fixtures, leaving a 753-line residual; all 53 original callback hashes remain identical.                          |
| done               | `packages/dev/dev-src/dev-loop/test-runner/TestRunner.ts`                 | R3              |   434 moved, net +16 |       1/434 | Split result parsing, aggregation, and reporting into a 215-line owner, leaving the runner at 349 lines while preserving its facade and a type-only back edge.                                     |
| done               | `packages/dev/dev-src/commands/code-review/planner.ts`                    | R3              |   332 moved, net +12 |       1/332 | Split budget normalization and provider availability into a 162-line owner, leaving review planning at 353 lines with its existing public facade intact.                                           |
| done               | `packages/validator/validator-src/validators/data-validator.ts`           | R3              |   245 moved, net +13 |       1/245 | Split strict create, update, and delete validation into a 126-line owner, leaving query and schema validation at 308 lines while preserving message/check facades.                                 |
| done               | `packages/validator/validator-src/validators/FunctionalCoreValidator.ts`  | R3              |   209 moved, net +17 |       1/209 | Split pure-function declarations and calls into a 109-line owner, leaving expression and control validation at 318 lines while preserving its facade and order.                                    |
| done               | `packages/validator/validator-src/validators/navigation-validator.ts`     | R3              |   519 moved, net +17 |       1/519 | Split configured values, patches, and app-variant configuration into a 259-line owner, leaving navigation validation at 355 lines with adjacent registration order.                                |
| done               | `packages/validator/validator-src/validators/types-validator.ts`          | R3              |   689 moved, net +27 |       1/689 | Split configured item construction into a 351-line owner, leaving declarations, typed constructors, and member access at 364 lines with facade order intact.                                       |
| done               | `packages/ast-utils/ast-utils-src/invocations.ts` shared matching         | R3              |    135 moved, net +7 |       1/135 | Extract four byte-identical generic matching primitives into a 65-line internal owner, with no change to the `ASTUtils` facade; the invocation split remains in progress.                          |
| done               | `packages/ast-utils/ast-utils-src/invocations.ts` item-property binding   | R3              |    272 moved, net +8 |       1/272 | Extract the item-property resolver and its eight private helpers into a 280-line owner, reducing the invocation owner from 1,150 to 878 lines with every moved and residual declaration unchanged. |
| done               | `packages/ast-utils/ast-utils-src/invocations.ts` data-write binding      | R3              |    254 moved, net +8 |       1/254 | Extract the data-write resolver and its nine private helpers into a 262-line owner, reducing the invocation owner from 878 to 624 lines with all 13 moved declarations unchanged.                  |
| done               | `packages/ast-utils/ast-utils-src/invocations.ts` argument binding        | R3              |    280 moved, net +7 |       1/280 | Extract the argument resolver and eight private helpers into a 287-line owner, reducing the residual invocation owner from 624 to 344 lines with all 12 moved declarations unchanged.              |
| done               | `packages/runtime/TaoRuntime-src/TR-data.ts` provider implementations     | R3              |    133 moved, net +8 |       1/133 | Extract provider implementations and conformance into a 141-line owner, reducing the runtime-data facade from 1,143 to 1,010 lines while preserving its existing exports and consumers.            |
| done               | `packages/runtime/TaoRuntime-src/TR-data.ts` definition validation        | R3              |     52 moved, net +3 |        1/52 | Extract schema-definition and primitive-value validation into a 55-line owner, reducing the runtime-data facade from 1,010 to 958 lines with validation bodies unchanged.                          |
| done               | `packages/runtime/TaoRuntime-src/TR-data.ts` persistence                  | R3              |   105 moved, net +11 |       1/105 | Extract snapshot types, envelope parsing, and stored-row validation into a 116-line owner, reducing the runtime-data facade from 958 to 853 lines with all ten declarations unchanged.             |
| done               | `packages/runtime/TaoRuntime-src/TR-data.ts` entity handles               | R3              |     38 moved, net +8 |        1/38 | Extract entity-handle identity, metadata, and lookup into a 46-line owner, reducing the runtime-data facade from 853 to 815 lines through a type-only schema backedge.                             |
| done               | `packages/runtime/TaoRuntime-src/TR-data.ts` row and query values         | R3              |   121 moved, net +14 |       1/121 | Extract row normalization, stored-field conversion, filter evaluation, and comparison into a 135-line owner, reducing the runtime-data facade from 815 to 694 lines.                               |
| done               | `packages/runtime/TaoRuntime-src/TR-data.ts` global registry              | R3              |    16 moved, net +54 |        1/16 | Extract schema/test registries and global subscriptions into a 70-line owner, preserving test-mode timing and local-version/global-revision/local-listener/global-listener observation order.      |
| done               | `packages/runtime/TaoRuntime-src/TR-data.ts` schema state machine         | R3              |    425 moved, net +8 |       1/425 | Extract the byte-identical schema state machine into a cohesive 433-line owner, leaving a 253-line public contracts/DataControls facade and an acyclic nine-module data family.                    |
| done               | 5 non-chartered source files currently over 400 lines                     | R3              |     inspect per seam |       2/TBD | Both qualifying owners are split; the remaining cohesive `Type`, `value-scope`, `TR`, `Packages`, and data-schema owners have no worthwhile second concept.                                        |
| queued             | 70 source functions over 40 lines or nesting depth three                  | R2              | inspect per function |      15/TBD | Fifteen pass value review; run overlapping R3 splits first, then remeasure before decomposing them into meaningful named steps.                                                                    |
| done               | compound decisions across seven packages                                  | R1              |                   77 |       14/77 | Name 12 audited questions across 14 qualifying condition sites, including two reused extension/countability policies; net-delete one code line and reject churn.                                   |
| done               | `packages/dev/dev-src/commands/code-review/planner.ts` timeouts           | R6 / charter 4  |                   11 |        6/11 | Reuse the two owning review-timeout constants across six provider outcomes, collapsing the repeated values and net-deleting five lines.                                                            |
| done               | repeated Android, compiler assertion, and unexpected-error messages       | R12 / charter 4 |                   26 |        6/26 | Replace ten byte-identical message literals in four owners with four local constants; four abstractions each pay at two or three sites.                                                            |
| baseline-satisfied | parser creation and ordinary Tao parse output                             | R7 / charter 5  |                    0 |         n/a | The Tranche 3 base already sets the parser configuration that suppresses the deliberate ambiguity log; a live `./tao check` emits no warning. Revisit only if the full sweep disproves this.       |

## Repo-rule conformance backlog

| Status             | Location                                                             | Rule | Estimated size | Value score | Measurable effect                                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------- | ---- | -------------: | ----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| done               | validator Typir initialization and invocation validator              | R5   |             -7 |         1/7 | Remove the only call, exported object member, type-only import, and implementation of a deliberately empty validation hook.                                                    |
| done               | compiler, formatter, and source-actions internal module exports      | R5   |             36 |       18/36 | Make 17 file-local types private and delete one unused `Compile` re-export, net two lines; retain the package-facing test-plan and formatter/action types.                     |
| done               | primitive data types and recursive type-definition dispatch          | R4   |            -15 |        5/15 | Collapse five identical primitive-field branches and two identical type-definition branches into one branch per concept, deleting 15 lines.                                    |
| done               | file-local exports across seven packages                             | R5   |             -5 |       44/48 | Remove 43 unnecessary export modifiers, one wholly dead type, and its redundant forwarding re-export while retaining package, public runtime, and test-facing surfaces.        |
| done               | `packages/validator/validator-src/validators/ActionsValidator.ts`    | R9   |             -3 |         1/3 | Delete the decorative `Private` separator that only restated TypeScript visibility, net-deleting three lines.                                                                  |
| queued             | internal signatures and literal boolean call sites across packages   | R11  |       ~360–420 |     30/~400 | After overlapping R3 moves settle, replace 15 over-wide signatures and 15 literal boolean call sites with concept-shaped options across 21 functions and 44 callers.           |
| done               | `packages/shared/shared-tests/shared.test.ts`                        | R7   |              2 |         1/2 | Preserve formatter-sorted imports; baseline `./agent verify` exposed and corrected this pre-existing formatting violation.                                                     |
| done               | direct `process` use in dev, IDE extension, and runtime test owners  | R7   |             19 |        7/19 | Route seven environment, cwd, and stdout accesses through the existing `Platform.runtimeProcess` boundary.                                                                     |
| done               | closed-union dispatch across ast-utils, compiler, validator, runtime | R13  |            347 |      14/347 | Convert all fourteen audited closed-union sites to shared Switch helpers, net-delete 21 code lines, and leave open-input/stateful false positives unchanged.                   |
| baseline-satisfied | all non-generated package source                                     | R7   |              0 |         n/a | The baseline contains no native `switch`, no direct Langium import outside the parser owner, and direct Node filesystem/process imports are confined to shared wrapper owners. |

## Findings outside the spike

None yet. Suspected bugs, performance work, public API changes, grammar changes, dependency changes,
and one-off smells without a rule belong here rather than in code.
