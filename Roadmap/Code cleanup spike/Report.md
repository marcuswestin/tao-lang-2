# Post-Tranche 3 code cleanup spike report

Date: 2026-08-14\
Branch: `feat/cleanup-spike`\
Base: `feat/wordflower-tranche-3`

## Outcome

The spike completed all five chartered investigations, evaluated the twelve original rules, added
one repo-wide rule, and applied qualifying work through 97 independently verified implementation
commits. No Tao
language behavior, grammar, diagnostic text, generated-code semantics, public API, stdlib surface,
dependency, WordFlower tier, or archived roadmap content changed.

Ro directed the spike to wrap after the already-identified reviewer-launch cleanup. Structural
Sweep A then found no further qualifying R1/R2/R3/R10/R11 work. Repo-conformance Sweep B found eight
new, non-urgent R4/R5 groups. This follow-up completed seven of those groups in six commits and
rejected the Switch helper after stack-parity revalidation; no item remains deferred. The original
two-no-item hard stop is still not claimed. The last
attempted large candidate, review streaming, had exact behavioral parity but was restored
byte-for-byte when an honest decomposition proved to require 440 changed lines.

## Before and after

Tracked, non-generated TypeScript and TSX under `packages/`:

| Package        |   Baseline |      Final |    Delta |
| -------------- | ---------: | ---------: | -------: |
| ast-utils      |      3,208 |      3,357 |     +149 |
| compiler       |      3,898 |      3,904 |       +6 |
| dev            |      6,835 |      6,935 |     +100 |
| formatter      |      2,753 |      2,763 |      +10 |
| ide-extension  |        640 |        641 |       +1 |
| parser         |      3,608 |      3,572 |      -36 |
| runtime        |     10,883 |     11,299 |     +416 |
| shared         |      2,925 |      2,927 |       +2 |
| source-actions |      1,264 |      1,285 |      +21 |
| tao-cli        |      1,749 |      1,750 |       +1 |
| validator      |     10,774 |     11,054 |     +280 |
| workspace      |        499 |        499 |        0 |
| **Total**      | **49,036** | **49,986** | **+950** |

| Signal                                        | Baseline | Final | Change |
| --------------------------------------------- | -------: | ----: | -----: |
| Files over 400 lines                          |       23 |    28 |     +5 |
| Source files over 400 lines                   |       13 |     5 |     -8 |
| Test files over 400 lines                     |       10 |    23 |    +13 |
| Test files over 800 lines                     |        6 |     0 |     -6 |
| Source functions over 40 lines or depth three |       72 |    56 |    -16 |
| Native `switch` statements                    |        0 |     0 |      0 |
| Test suites                                   |       14 |    14 |      0 |
| Tests                                         |      668 |   668 |      0 |
| Static tracked test-source `Expect(` sites    |    1,587 | 1,587 |      0 |
| Reported dynamic expectations                 |    2,398 | 2,398 |      0 |
| Verification process wall time                |   11.63s |  6.6s | -5.03s |
| Reported suite wall time                      |     9.5s |  6.5s |  -3.0s |

The file-count increase is intentional structural overhead: two monolithic test owners became
cohesive feature suites below 800 lines, and the navigation/runtime seams became independently
owned modules. Through the follow-up implementation head, Git records 16,521 insertions and 15,335
deletions across the whole repository; most of that churn is byte-identical movement. The 950-line package growth is the import/type/test
fixture overhead that cleared the chartered file boundaries plus named phase extraction overhead.
The follow-up itself is 157 insertions and 229 deletions across eleven package files, net -72 lines.

No static assertion site was deleted. Every moved validator, runtime, parser, compiler, formatter,
and TR callback was checked against a pinned title/body or tokenized-callback manifest. An
independent base archive had localized the closure snapshot's four-count dynamic difference to the
unchanged parser and formatter WordFlower app/sidecar gates. The follow-up verification ran the
absorbed/equal path and returned to 2,398 dynamic expectations without changing any static site.

## Chartered work

1. Validator traversal and organization: all 19 feature validators live under `validators/`; 70
   repeated whole-file traversals became one shared typed node dispatch consumed by validation and
   Typir.
2. Navigation runtime: the 1,583-line `TR-navigation.ts` owner became a 350-line public facade plus
   twelve cohesive modules of 24–342 lines.
3. Oversized tests: the 4,931-line validator suite, 2,668-line runtime E2E suite, and remaining
   parser, TR, compiler, and formatter owners were split; no test file exceeds 800 lines.
4. Repeated values: review timeouts and repeated owning-module messages now reuse their owners'
   constants; value review rejected generic literal churn.
5. Chevrotain warning: the Tranche 3 base already suppresses the deliberate ambiguity warning;
   live parse output confirmed the charter was baseline-satisfied, so no change was manufactured.

## Final rulebook

R1 NAMED CONDITIONS. Conditions with three or more boolean operators, mixed boolean forms, or a
non-obvious comparison use a question-shaped name rather than exposing operand mechanics.

R2 FUNCTION SHAPE. Functions over roughly 40 lines or nested beyond three levels decompose into
meaningful named steps; early returns beat arrowhead nesting, and meaningless extraction names are
rejected.

R3 FILE ORGANIZATION. A module owns one main concept; source files over roughly 400 lines or with
unrelated concept clusters split on feature seams without barrel files.

R4 DUPLICATION. Two near-identical blocks merge only when the result net-reduces lines; a helper
that needs parameters or generics must pay across at least three sites.

R5 DEAD CODE. Proven-unused exports, branches, parameters, comments, and stale completed-work
markers are deleted.

R6 MAGIC VALUES. Repeated meaningful literals become constants at the owning module, never in a
global dumping ground.

R7 REPO-RULE CONFORMANCE. Shared `Switch`, platform wrappers, parser AST boundaries, behavior
tests, validator diagnostics, and codegen assertion ownership follow the repository's existing
rules.

R8 NAMING. Internal misleading, vocabulary-inconsistent, or unexplained abbreviated names are
fixed only when the new name reveals meaning; synonym churn is rejected.

R9 COMMENTS. Restatement comments are deleted, contradictions are corrected from code and test
evidence, and retained comments explain why.

R10 TEST HEALTH. Oversized tests split by source seam; duplicate coverage is removed only with a
named surviving assertion, and readable individual failure output is preserved.

R11 SIGNATURES. Internal functions with more than four parameters or opaque boolean flags use
named options; published and grammar-visible surfaces are unchanged.

R12 MESSAGE CONSTANTS. Diagnostic and error strings used in more than one place live byte-for-byte
in the owning module's message constants.

R13 EXHAUSTIVE UNION DISPATCH. Closed literal or `$type`/`kind` union dispatch with three or more
mutually exclusive outcomes uses `Switch`, `Switch.type`, or `Switch.kind`; repeated two-way
dispatch in one concept also qualifies. Validation/failure guards, progressive state, open input,
unsupported structural unions, and intentional special/default grouping stay as ordinary control
flow. No cast, stringification, or invented discriminator is allowed merely to fit `Switch`.

No repeated repo-wide pattern justified R14.

## Closure sweeps

Sweep A covered structural rules R1, R2, R3, R10, and R11 across all 301 tracked non-generated
package TypeScript/TSX files and 50,058 lines. It reproduced 56 R2 mechanical hits (50 long, eight
deep, with two overlapping), five source files over 400, 23 tests over 400, zero tests over 800,
155 compound-condition hits (77 with at least three boolean operators and 78 additional mixed
forms), zero signatures over four parameters, and 17 source boolean-literal calls after excluding
tests. Value review found no further qualifying item and no cleanup-written violation.

Sweep B independently covered R4–R9, R12, R13, and new repeated-pattern discovery over the same
301 files. It found zero native switches and inspected 1,509 `if` statements, 13 `else if` chains,
225 adjacent-if runs, 157 terminal-if runs, and 15 nested-ternary roots. The remaining branch forms
are validation/failure guards, progressive or stateful control, open input, unsupported structural
unions, or intentional special/default grouping. All twelve package TypeScript checks pass. R6–R9,
R12, R13, wrapper conformance, naming/comments, and new-rule discovery are clean. The exact-block,
export, and symbol-reference review found the deferred R4/R5 groups below.

## Post-wrap R4/R5 resolution

The specifically deferred follow-up is resolved. Seven items completed and one was rejected with
evidence; none remains deferred.

| Status   | Item                                     | Evidence and result                                                                                                                                                                                                                                                                                  |
| -------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| complete | validator diagnostic codes               | Repo-wide symbol search found only the empty declaration; the spike deletes it and its comment.                                                                                                                                                                                                      |
| complete | dev review lens exports                  | Repo-wide external-consumer search was empty; the spike makes both constants file-local.                                                                                                                                                                                                             |
| complete | app value-reference dispatch             | The spike merges the byte-identical branches, net -4; diagnostic text/order/ranges were identical.                                                                                                                                                                                                   |
| complete | parser owning-ancestor traversal         | The spike preserves all six public signatures behind one private predicate traversal, net -30.                                                                                                                                                                                                       |
| complete | parser value scopes                      | The spike uses separate declaration-layering and boolean-case helpers, net -29.                                                                                                                                                                                                                      |
| complete | ast-utils binding reporters              | The spike shares both duplicate-type families across all three owners, net -2; the combined eleven-diagnostic snapshot preserved text/order/ranges and AST-node identity.                                                                                                                            |
| complete | validator declaration-to-type resolution | The spike shares the three-site configuration tail, net -4; the focused four-diagnostic snapshot was identical.                                                                                                                                                                                      |
| rejected | shared Switch invocation tail            | Any shared invocation helper adds an internal frame to missing-handler and handler-thrown stacks. Caller-side error construction or stack rewriting preserves the old frame shape only by losing the net reduction or adding platform-specific complexity. The six public variants remain unchanged. |

## Deliberately left alone

- `runStreamingInvocation` in `packages/dev/dev-src/commands/code-review/streaming.ts`: 203-line
  closure-heavy lifecycle. An exact five-scenario draft preserved JSONL, timeout, spawn-error,
  heartbeat, and artifact-failure traces, but its honest minimum was +277/-163 (440 changed lines).
  Restored to exact HEAD.
- `packages/ast-utils/ast-utils-src/invocations.ts` diagnostic reporting: the natural split creates
  two new 50–65-line exhaustive reporters; a handler-table rewrite would be churn.
- `packages/ast-utils/ast-utils-src/Type.ts` (1,048), parser `value-scope.ts` (604), runtime `TR.ts`
  (561), runtime `TR-data-schema.ts` (433), and ast-utils `Packages.ts` (431): cohesive owners with
  no second concept seam that clears R3's value bar.
- The remaining 56 R2 mechanical hits: cohesive state machines, exhaustive reporters, public
  orchestration, or barely-over-threshold collect/report owners whose extraction adds indirection
  without reducing branches or reuse.
- `FS.shouldYield(..., false, options)`: one literal boolean remains mechanically visible, but an
  options conversion adds lines without clearing a file/function threshold and fails the
  positive-growth invariant at this stopping point.
- `validateVisibleDeclarations`: a cohesive 39-line, depth-four collection-and-report function;
  splitting its one-use two-level index would relocate the same traversal without reducing total
  branching or complexity.
- The 23 test owners over 400 lines: each is a cohesive feature suite below the explicit 800-line
  split threshold.
- Remaining compound conditions and sequential `if` groups: question-named or ordinary guards,
  progressive checks, state transitions, open input, and intentional default grouping.

## Findings outside the spike

None. No suspected behavior bug, performance issue, public-API wart, or unresolved design ambiguity
was uncovered that warranted handoff outside the rulebook.

## Verification and preservation

- Every implementation commit passed `./agent verify` before commit.
- Final follow-up gate before the documentation commit: 14/14 suites, 668/668 tests, 2,398 reported
  expectations plus two suites without expectation counts; captured process wall 6.6s and longest
  reported suite 6.5s.
- Focused parity matrices pinned diagnostic order/ranges, binding pairs, registration order,
  runtime state transitions, reviewer event/status artifacts, and callback identity where broad
  tests were too indirect.
- The final branch diff contains no `.langium`, `_gen_`, `Apps/WordFlower`, or `Roadmap/Archive`
  path.
- Ro's concurrent `Apps/WordFlower/2 - Next` work was never edited, staged, or committed by the
  cleanup follow-up. Its current eleven file hashes are:

| File                       | SHA-256                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `Data.tao-next`            | `c919dae46ece65e16d22116c9bddc2b5b30921f3b51098189873ba90d0c3156c` |
| `Design.tao-next`          | `7337272008bb0ec2de18286caa2d1a82356db0d290268bb3b91502497dc9b827` |
| `Documents.tao-next`       | `9000b937ebd61f9af8bf0c9da60a161438167f7a3e3c8fb51024e2c2f6b0029a` |
| `Documents.test.tao-next`  | `c0ade5024a54696e33d60cecb6d81a396927fa7bb19b39b5a4a63137b207071f` |
| `Foundation.tao-next`      | `720cf4ad837341eb543e461a8ca11a30c526faeae547c6651676969d54c1f0aa` |
| `Foundation.test.tao-next` | `49d9e6af03b408c02aaa266d53fe7d0b9ae3d8dd69924a530972c2bc17ad2f6a` |
| `Shared.tao-next`          | `d22dd9b8abd7824d08fc1a8e931f64c8e80bcb958c18f3098a488981b9e99267` |
| `WordFlower.tao-next`      | `7fc86e2b03fea6f18bc8650fc685702706340e5d0f19b195289bddde2ab0ca16` |
| `WordFlower.test.tao-next` | `8c9d4bf758454b4bb2a32a85c587414f2495dee996bd39344acb2e86b66a00df` |
| `Workspaces.tao-next`      | `58b673dfb6ef24b026dc3d27432c8b468557d7f22cea3f4007279b67f92e2b64` |
| `Workspaces.test.tao-next` | `dc77e9aa40353029b404035dd9a52dde302e9eca5fd66873f39e651d6451291f` |
