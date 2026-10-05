# Syntax2 ownership and interface agreement

Read with [the program](<Implement Syntax2.md>) and [coordinator brief](<Syntax2 coordinator brief.md>).
This manifest allocates source ownership, including across separate worktrees. It does not add
language decisions. The first render foundation must land before A1/D1 dispatch. Each manager
starts from fetched main containing this document and that implementation, records its exact base,
and works in a separate feature branch/worktree. Later transfers are explicit amendments.

## Review cadence

The Developer selected substantially less frequent independent review on 2026-10-05. Managers
implement substantial coherent batches, making multiple sensible commits before requesting one
review of the accumulated range. Focused checks and manager inspection continue while writing;
individual commits, worker returns and small integration handoffs do not require a dedicated
reviewer. The coordinator may integrate inspected commits and continue dependent work within the
existing ownership grants.

Reserve independent review for substantial completed milestones and the final integrated change
before landing. Request an earlier targeted review only for a concrete unresolved correctness risk.
Finish an already running review without duplicating it. This cadence supersedes earlier requests
for independent review of each bounded cut; historical review receipts and ownership boundaries
remain valid.

## First concurrent wave

### Current slot validation and formatting release

The reviewed nine-path frontend is integrated at `9a39f2b0e`; those paths returned to the
coordinator. The next bounded B release owns existing
`parser-src/ast-structure.ts` solely for cycle-safe view-alias slot contracts,
`validator-src/validators/views-validator.ts` solely for the real fill/placement discriminator
and repeated placement rules, and `formatter-src/formatters/ViewsFormatter.ts` solely for slot
declarations, arguments and colon fills. It also owns new renderer-slots-validator.ts,
RendererSlotsValidationMessages.ts and validator/formatter renderer-slots tests in their owning
language packages. Use the returned callable binder and real AST identities; do not create a
second matcher. The coordinator owns facade exports, validator registration, source migrations,
compiler integration and app graduation. No value-scope, Type or compiler ownership is transferred.
Authored-source migrations require a separate exact-path release after inventory.

The grants below record the first-wave implementation. A1, B1, C1 and D1 are committed and reviewed;
their shared seams are returned to the coordinator for integration. The D1 foreign-error follow-up
also returned TR.ts. Later implementation requires a fresh bounded release; current read-only
next-slice proposals do not confer source ownership.

- A owns the exact paths in [A's brief](<Syntax2 A names and capabilities.md>), including Type.ts.
- D owns the exact paths in [D's brief](<Syntax2 D outcomes and cleanup.md>).
  For D1 only, ast-utils.ts export aggregation is transferred to D to publish its failure contract;
  A1 needs no aggregation change. Return this file to the coordinator after D1 integration.
- B owns the explicit parser/prefix/runtime transfers in [B's brief](<Syntax2 B rendering and slots.md>).
  Return shared grammar/attachment/dispatch files to the coordinator after B1 integration.
  After the source-shape review, B1 also owns StatementsFormatter.ts, langium-formatting.ts,
  and the minimal VisualNativeRoot label path in runtime TR.ts. The coordinator makes no other
  edits to those shared files until B1 returns them. Its new mounted proof lives in
  expo-host-tests/render-prefixes-e2e.jest-test.tsx.
  B1 also owns Native.tao's existing host-control occurrence-label precedence and routing.
- C starts the bounded native-quantity prototype in [C's brief](<Syntax2 C numeric and native values.md>);
  production source ownership is released after its ABI handoff.
  C0's reviewed runtime/cell/native probe releases C1 exclusively in TR-quantity-values.ts and
  TR-tests/TR-quantity-values.test.ts. The coordinator retains uniform accessor, facade and
  generated metadata/publication wiring; descriptors remain declaration-owned.
- A1's constructor parity diagnosis additionally transfers item-property-bindings.ts,
  configured-item-validator.ts and ExpressionsCompiler.ts, limited to the reviewed construction
  compatibility callbacks/fallbacks. Callable admission remains upward-only. Return these after A1.
- A1 also owns StateValidator.ts temporarily for construction compatibility on member writes only;
  whole-state and writable-parameter assignment stay strict. Return this file after A1 integration.
- The coordinator owns all other shared source and app graduation.
  The coordinator's parallel import foundation owns imports.langium, value-scope.ts,
  Packages.ts's wildcard target filter, use-validator.ts, UseFormatter.ts, UseStatementCompiler.ts,
  Backend.ts's import resolution and focused wildcard-imports tests. Its resolved-import helper
  amendment waits for B1 to return ast-structure.ts; A does not duplicate wildcard work.
  B1 froze and returned ast-structure.ts source-edit ownership after its prefix review. Its completed
  prefix diff remains in B1's commit; the coordinator now owns the resolved-import helper amendment.

The coordinator reserves parser grammar outside B1's explicit prefix transfer, parser installation/scoping/export aggregation, invocations.ts,
ast-utils export aggregation outside D1's explicit transfer, validator registration, formatter dispatch, FunctionalCoreValidator.ts,
FunctionalCoreCompiler.ts, Compile.ts, Backend.ts, InvocationsCompiler.ts, TR.ts, bridge-metadata.ts,
project-tooling publication, stdlib shared declarations, and all Apps/Syntax2 executable/future
source moves. Managers request a minimal seam change or an explicit whole-file transfer before editing.
Each owns its feature-specific tests and validator message factories alongside approved source.

## Second bounded releases

The integrated first-wave source is the prerequisite for these releases. Managers integrate that
coordinator commit in their own clean worktrees; they do not modify the coordinator checkout or land
their branches. The coordinator reviews and validates the combined tree before landing.

1. B's accessibility-prefix repair owns source-actions' studio-source-text.ts, studio-render-tree.ts,
   studio-extract-view.ts and its new render-prefixes.test.ts. Removal, movement, wrapping and
   extraction use AST.renderPrefixCluster so metadata remains attached to the original occurrence.
   Preserve the integrated wildcard-import work. The reviewed repair returned these paths. B's next
   runtime-only renderer slice owns new TR-render-slots.tsx, TR-render-slots.test.ts and mounted
   render-slots-runtime.jest-test.tsx. Stable body components receive current captured environments;
   placements retain independent state, defaults use own-property selection, and explicit empty
   suppresses the default. No facade, slot grammar/compiler or foreign-adapter ownership is released.
2. D's runtime lexical-cleanup slice owns TR-action-transactions.ts, TR-errors.ts, TR-effect-outcomes.ts
   and TR-defer-actions.test.ts, plus focused parity assertions in the corresponding existing runtime
   tests. Publish runActionScope, registerDeferredAction and actionExitOf. Cleanup is joined, serial
   LIFO and preserves a primary failure while retaining cleanup failures. Existing callers remain
   valid. General cancellation and abandonment unwinding are not part of this bounded runtime slice;
   neither grammar/compiler wiring nor TR.ts facade ownership is transferred.
3. A's concrete callable-signature adapter owns new callable-signatures.ts and its ast-utils test,
   the bounded argument-bindings.ts core extraction, and type-binding-matches.ts only if the shared
   matcher needs a full per-role compatibility predicate. Preserve the existing resolver's pairs and
   diagnostics. Compare readonly input domains contravariantly, caller-owned writable domains in
   both directions, omission separately from none, and full known/open failure bounds. Local slot
   binder aliases do not replace public role identity. The coordinator publishes the export hook.
   Associated capability/method/converter source remains unreleased.
4. C's uniform native-accessor slice owns new TR-js-value.ts, TR-reactive-values.ts,
   TR-persisted-state.ts and the accessor/public-value-output integration in TR.ts, with focused
   reactive, quantity, accessor and persisted-state tests. The coordinator pauses other facade edits
   until return. getJSValue reevaluates live values and extracts quantity canonical backing; other
   payloads retain their existing JavaScript identity. Keep minimal legacy evaluable input contracts
   valid. Composite/resource/secret serialization and general action/presentable access are excluded.
   C's numeric/unit grammar proposal remains read-only; Type, grammar and native publication are
   not transferred by this accessor release.

## Binding and effects

Second-wave return status: B's Studio repair and renderer runtime are frozen and integrated;
D's lexical runtime plus its single-adoption joining repair are frozen and integrated. Their listed
source paths have returned to the coordinator. A's concrete signatures and complete-correspondence
repair are reviewed and integrated; the coordinator published their shared facade. The foundation
landed at `580f88cc5d8bec4682ebe430d08068f16aac3cb3`. C's accessor chain, including complete alias
and persisted-output recognition, is reviewed and integrated on the follow-up numeric branch.
The coordinator retains TR.ts and native publication; existing cleanup facade methods are published.

Current exclusive assignments:

- A's reviewed parameter-array adapter is integrated at `0ac15b312`; those paths have returned.
  Its carrier runtime is integrated at `dc1e7266c`, returning TR-capabilities.ts and its tests.
  Attach, reproject and method selection preserve the original receiver and live reads through
  ordinary Function returns, without eager probes or a public nominal registry. The coordinator
  owns its facade hookup. This isolated runtime leaf does not admit source-level structural
  dispatch before purity/type/frontend proof. A independently reviews native import routing while
  the shared frontend remains held; this read-only review transfers no source ownership.
  Associated capability/method/converter frontend source remains withheld.
- C owns the complete numeric/unit construction vertical: its focused feature modules/tests,
  numeric grammar integration and parser AST/scoping, Type.ts, the AST facade, registrations,
  NumericUnitsCompiler and ExpressionsCompiler. Its bounded validator adapters also own
  types-validator.ts and configured-item-validator.ts for numeric unit bodies/construction,
  DeclarationOrder.ts for unit-construction traversal, InjectionsCompiler.ts and
  runtime-type-compiler.ts for numeric backing cases, preserving unrelated item construction and
  upward-only invocation admission. The coordinator adds branded owner publication after return.
  C additionally owns quoted-render.ts's parser-constructor injection while preserving quotation
  lowering, use-package-validator.ts's bounded numeric alias admission and formatting.ts's units
  brace selection. These are the three reviewed integration gaps; no broader formatter, alias or
  parser redesign is released.
  No other manager
  writes these shared seams.
- D's existing-block cleanup lowering and outcome assertion are integrated at `858a971f9`;
  their source ownership has returned. Coordinator event/selection callers and mounted payload
  cleanup proof are committed at `033a6d760`, including a caught scope-removal mutation.
  D's reviewed transitive purity/failure packet releases exactly new failure-contracts.ts,
  callable-effects.ts and ast-utils-tests/callable-effects.test.ts, plus effect-outcomes.ts and
  callable-signatures.ts solely to move/reexport the unchanged failure algebra. The producer
  consumes immutable, already-resolved execution facts, without Type/admission reentry, native
  trust inferred from spelling, or a second target resolver. Separate purity and known/open failure
  contracts preserve conservative unknown boundaries and recursive computation. Root supplies
  resolution/native facts and shared admission/validation hooks after C returns its frontend.
  No validator registration, native classification, function-failure lowering, defer grammar or
  then/result-token extension is released by this semantic-leaf grant.
- B's renderer and native-leaf paths have returned; slot frontend and foreign adapters remain held.
  The isolated leaf is integrated at `62b2cac5d`, supplying constructor-only types.Owner.Unit methods
  and allocated checked-factory/type linkage metadata from one owner factory, with executable/static
  proof. To parallelize its publisher integration, B now owns bridge-metadata.ts,
  ProjectToolingService.ts and new project-tooling-tests/QuantityPublication.test.ts, limited to
  source quantity leaf/companion publication, mapped owner types and existing manifest lifecycle.
  Its reviewed alias-publication amendment additionally owns quantity-native-module.ts and its
  existing compiler test, limited to extracting the existing deterministic surface allocation and
  sharing that plan with direct emission and canonical alias forwarding. Explicit local declaration,
  canonical owner and native import-name metadata replace guessed exports. Forwarding modules retain
  canonical factories and constructor objects across multiple source leaves; they allocate no owner
  symbol or factory. Keep erased-contract collisions and full-source reservations consistent.
  Preserve current erased contracts and dependency discovery. Supply explicit output/type-binding
  and reexport APIs before coordinator Backend consumption; C owns NumericUnits/Type discovery.
  The coordinator retains Backend/compiled output/DTS/native import rewriting, ProjectOutputPublisher
  and snapshots, runtime ingress, compiler dependencies and whole-graph singleton acceptance.
  B's slot frontend packet remains read-only until these shared publisher paths return.
- The coordinator owns Backend/compiled native factory publication,
  InvocationsCompiler/FunctionalCoreCompiler caller adaptations, runtime facade, preparatory
  comma-helper retirement, app/stdlib graduation, combined verification and landing.

## Associated frontend release

The following release supersedes the frontend holds above. The integrated numeric input is
`334ddc94a`; its 29 frontend, Type and helper paths returned unchanged. C retains only
ExpressionsCompiler.ts and compiler-tests/numeric-units.test.ts until its native-result handoff.
The supplied-graph callable-effects producer is integrated at `6cd436ad8`; its five paths have
returned. Focused numeric parser, validator, formatter, callable-effects and type checks passed
on that combined input. The original preserved compiler input is consumed without transferring
the two retained paths.

A now owns the first associated-method and structural-capability source vertical. The forcing
case has distinct text nominals with distinct pure ToText implementations, a distinct descendant
inheriting a method, structural Display admission, and live witness forwarding through an ordinary
function return. This release does not add decisions or claim generic Self, converters, static
factories, ui, collection storage or whole-app effect refinement is complete.

Exact existing shared paths transferred to A, bounded to that vertical:

- parser-grammar/{types,expressions,blocks,tao-grammar}.langium;
  parser-src/{ast-structure,value-scope,parser}.ts.
- ast-utils-src/{Type,ast-utils}.ts.
- validator-src/{Validate,DeclarationOrder}.ts and
  validators/{types-validator,functions-validator,FunctionalCoreValidator}.ts.
- formatter-src/Format.ts and formatters/{TypesFormatter,ExpressionsFormatter}.ts.
- compiler-src/codegen/react-native/Compile.ts and
  app/{StatementsCompiler,FilesCompiler,runtime-type-compiler,reactive-parameters}.ts.

Prefixes in this list refer to the existing owning packages under packages/language or
packages/compiler. No other shared file is implicitly transferred. A also owns new feature files
associated-methods.ts and associated-methods.test.ts in ast-utils; associated-methods-validator.ts,
AssociatedMethodsValidationMessages.ts and associated-methods.test.ts in validator;
AssociatedMethodsFormatter.ts and associated-methods.test.ts in formatter;
AssociatedMethodsCompiler.ts and associated-methods.test.ts in compiler; and parser's new
associated-methods.test.ts. The positive Associated Methods Test App and its Tao journey may be
created after source integration; the coordinator owns the app index and Syntax2 graduation.

Publish AST and method/type descriptor interfaces early. Structural admission must consume proved
transitive function purity and full known/open failure bounds, without resolver/admission recursion.
Unknown native effects stay unknown. Preserve concrete callable correspondence and nominal
descendant identity; no sibling/downward implicit conversion or public nominal registry.
The coordinator supplies actual source-effect/native facts and retains TR.ts, runtime modules,
InvocationsCompiler, FunctionalCoreCompiler, Backend, bridge publication and all unlisted Type
consumers. A requests a bounded consumer hook when needed, rather than changing another owner's
file. C's two retained compiler paths remain untouched by A.

A additionally owns formatter-src/formatting.ts and formatter-src/langium-formatting.ts for the
associated-method vertical only. Preserve the existing numeric-unit formatting exemption; add the
associated-body closing-brace boundary and canonical function keyword/return-arrow formatting
hooks. This release does not authorize unrelated formatter normalization. Return both exact paths
with the frontend cut and keep the agreed readable method layout in regression expectations.

A also owns formatter-tests/{functional-core,typed-values,numeric-units,formatter}.test.ts solely
to update existing canonical function keyword and return-arrow expectations. Preserve authored
legacy input coverage and every unrelated assertion; do not weaken expectations to admit both
outputs. Return these fixture paths with the associated formatter cut.

D now owns exactly new ast-utils-src/callable-effect-facts.ts and
ast-utils-tests/callable-effect-facts.test.ts. This discovery leaf consumes immutable, already
published target, correspondence, read and native-contract rows keyed by real AST identity. It
walks actual execution, arguments despite incomplete binding, selected defaults and live alias
initializers; carrying a callable does not execute its body. Unproved native and unsupported
indirect targets remain open. Import AST and effect-contract types only; no Type, binder, resolver,
facade or resolution callbacks. Publish the input-row ABI early for the associated frontend.
The coordinator retains production row publication and phase separation: correspondence must be
available without effect-dependent admission, followed by effect analysis and final admission.
Provisional correspondence never proves compatibility. Two-file discovery proof alone is not
integrated function-purity or capability-admission proof; additional shared paths need a new grant.

The integrated numeric continuation gate exposed one regression in source-actions' existing
adjacent accessibility-label extraction case: a parenthesized label followed by a view invocation
is consumed as a unit construction. A's parser grant includes repairing that syntactic boundary
without unit-name guessing, newline significance or field-name reservations. Preserve the existing
regression fixture and verify the whole source-actions scope after repair. The coordinator's
reference-app comma migration and one-off comma-helper retirement are separate source paths.

B additionally owns validator-tests/structural-contracts.test.ts for authored configuration comma
migration only. Preserve all diagnostic and behavior assertions, including rejected examples; add
only the delimiters required by the accepted configuration/item syntax. Parser diagnostic wording
and the `(persist)` call boundary remain A-owned. This fixture-only grant does not release slot
frontend or shared validator source. Return the exact test file after its focused proof.

C's reviewed authenticated-parent runtime slice owns exactly
TaoRuntime-src/TR-quantity-values.ts and TR-tests/TR-quantity-values.test.ts in the runtime package.
Implement factory-owned derive, immutable private ancestry, distinct exact ownsPayload and upward
acceptsPayload, inherited invariant checks, and view changes retaining the concrete descendant.
Descendants inherit the same unit table; this grant adds no unit override or extension policy.
Prove covariant declaration-proof types without authorizing reverse or sibling admission, preserving
canonical-number accessor inference and existing default generic callers. No compiler, Type,
grammar, facade, native admission adapter or publication changes are released. Return the exact
two-path independently reviewed cut; the coordinator supplies later source ancestry/publication.

A additionally owns parser-src/grammar-words.ts solely to preserve the existing author-facing
`value` diagnostic for the new ValueReferenceTarget union. Preserve all other wording and grammar
roles; this diagnostic adapter grant adds no lexer or unit-case source ownership.

A's reviewed lowercase-unit lexical amendment additionally releases parser-grammar/terminals.langium,
parser-grammar/numeric-units.langium and parser-src/tao-token-builder.ts. Add a lowercase unit token
categorized as ordinary ID, and use its distinct grammar role for unit declarations and qualified
final segments. Preserve all ordinary identifier spellings, keyword-prefix handling, existing
continuation boundaries and persisted state syntax. Prove generation plus positive lowercase and
negative uppercase/mixed-case suffixes, uppercase owners, lowercase ordinary views/fields/aliases
and interpolation. No uppercase naming mandate for ordinary declarations is introduced.

B's reviewed isolated slot-emitter packet releases exactly compiler-src/codegen/react-native/app/
render-slot-hoists.ts and renderer-slot-codegen.ts, with compiler-tests/render-slot-hoists.test.ts
and renderer-slot-codegen.test.ts. Consume already compiled fragments and real source anchors;
reject duplicate hoist anchors/names, evaluate selection and props once, and project arguments only
for a nonempty renderer. Preserve stable body identity and fresh captured environments. No parser,
slot admission, facade, FilesCompiler, shared TaoProps or collision-name allocator ownership is
released. The coordinator supplies those production seams and mounted acceptance after return.

The lowercase lexical amendment is integrated at `4dd034184`; A has returned parser grammar,
AST and scope ownership for the next explicit slot frontend release. Associated and lowercase-unit
regressions remain required when those seams change. This return alone does not grant B unlisted
source edits. C's authenticated ancestry runtime pair returned at `71be4aa26`.

C now owns a spelling-only fixture migration in exactly these six test paths: compiler-tests/
numeric-units.test.ts and quantity-publication.test.ts; project-tooling-tests/QuantityPublication.test.ts;
parser-tests/numeric-units.test.ts; formatter-tests/numeric-units.test.ts; validator-tests/numeric-units.test.ts.
The first two are under packages/compiler; the others are under their packages/language owners.
Use lowercase unit declaration/suffix names and matching emitted unit members and diagnostics while
preserving test cases, values, assertions and semantic failures. Keep runtime-only unit table tests
case-sensitive and unchanged. A's new lowercase-units.test.ts is a frozen input, not a migration
target. No production source, owner typing, grammar, native imports or metadata policy changes are
released. A bounded worker may implement this settled migration; its manager reviews and commits
the exact diff and returns focused proof before coordinator integration.

B now owns the renderer-slot frontend in exactly six existing paths under packages/language:
parser/parser-grammar/{views,blocks}.langium; parser/parser-src/{ast-structure,value-scope,parser}.ts;
and ast-utils/ast-utils-src/reactive-parameters.ts. Three new paths are released:
parser/parser-tests/renderer-slots.test.ts, ast-utils/ast-utils-src/renderer-slots.ts and
ast-utils/ast-utils-tests/renderer-slots.test.ts. Consume the integrated lowercase lexer and
associated AST at `62d34b064`; preserve their guards and regression suites. Add real slot
parameters, placement arguments, binder/default/body ownership and repeated placements through
the existing parameter-array callable and binding APIs. Keep ParameterizedDeclaration unchanged
and use a separate slot accessor. Prove receiving fills versus placements, explicit empty,
legacy zero-input bodies, missing/duplicate/unknown arguments and writable variance. No Type,
matcher, validator/formatter registration, shared compiler, facade or generated output ownership
is transferred. Request the follow-on registration hooks after this bounded frontend returns.

C now owns the generated quantity role-proof alignment in exactly packages/compiler/compiler-src/
quantity-native-module.ts and compiler-tests/quantity-native-module.test.ts. Consume runtime ancestry
`71be4aa26` and lowercase fixture migration `9ffe32d20`. Pass the declaration's private symbol proof
through the runtime payload/factory/constructor generic contracts; preserve declaration identity,
strict known-value admission, read/inUnit signatures and source mappings. Do not silence TS2352
with an unknown cast or weaken native nominal checks. Prove actual generated modules type-check,
same-name owners stay distinct, and raw/reverse/sibling negatives remain rejected. No Type,
source ancestry, bridge metadata, runtime or companion publication ownership is transferred.

A now owns canonical effect-independent publication in six paths under language/ast-utils:
new ast-utils-src/canonical-effect-snapshot.ts and ast-utils-tests/canonical-effect-snapshot.test.ts;
existing ast-utils-src/{Type,invocations,associated-invocations,argument-bindings}.ts. Publish a
branded immutable correspondence snapshot from actual linked files; retain targets, descriptors,
canonical argument pairs, read proofs, exhaustive default eligibility, independent native phases
and explicit metadata coverage. Reuse the existing admission kernel, binder and signature comparator
with a phase-local relation; unresolved and pending competitors keep correspondence open and
defaults possible. No inferred purity, native trust or concrete body failure proof is manufactured.
Keep default behavior of ordinary public resolution unchanged. Index semantic metadata only;
the existing effect discovery owns the one execution traversal. Publish the concrete type/factory
ABI in an early reviewed commit for D. Root retains facade, native/requirement evidence, validation
and compiler wiring. This release includes no whole-app refinement or new language decision.

D's next release owns new ast-utils-src/callable-effect-publications.ts and
ast-utils-tests/callable-effect-publications.test.ts under the same package. Source writing starts
after consuming A's frozen actual snapshot ABI. Project that factory's records into the existing
CallableEffectFactInputs; retain real source witnesses and conservative uncovered regions, without
a second execution traversal, Type import, resolver or matcher. Prove actual parsed source through
the canonical factory, projection, discovery and analyzer, including aliases/defaults, receiver
reads, recursion, requirement failures and unknown native phases. If the projection is redundant,
return that finding before introducing another layer. Root supplies final sealed admission/wiring.

D additionally owns existing ast-utils-src/callable-effect-facts.ts and
ast-utils-tests/callable-effect-facts.test.ts for the reviewed source-root/coverage adapter.
Add optional inert discovery context with actual owner identity, real body roots, actual parameter
default initializer witnesses and canonical covered nodes. Seed these edges in the existing queue;
do not introduce another execution traversal, fabricated call rows, Type/resolver callbacks or
purity promises. Whole-declaration default inclusion is a conservative admission upper bound;
ordinary calls retain their independently selected defaults. An uncovered reached node keeps
known facets and edges while opening the remainder. Root identity must match the analysis owner,
and unsupported/pending metadata must remain open. Preserve independent read/native facets and
all old context-free callers. Plural callee bodies remain incomplete until explicitly supported;
never choose one alternative body to manufacture closure. This two-path adapter can proceed before
A's committed snapshot ABI; D's production projector still waits for that coherent reviewed cut.

A's canonical snapshot cut returns its six shared paths at `3caea4bb1`.
The next bounded release owns new ast-utils-src/capability-transport.ts and
ast-utils-tests/capability-transport.test.ts, plus new validator-src/validators/
capability-transport-validator.ts and validator-tests/capability-transport.test.ts under language/.
Plan runtime transport after final sealed admission using the existing Type relation and exact
witness correspondence: identity, concrete attachment, capability projection, nested inputs/results,
and none/present splitting. Unique or equivalent plans are safe; erased alternatives needing
different plans receive a source diagnostic rather than payload-based dispatch. Keep Type admission
unchanged. Publish immutable plans and their concrete ABI early for compiler consumption; root
retains facade, registration, production context and compiler wiring. Also release only existing
canonical-effect-snapshot.ts and its test for the reviewed actual PostfixMemberAccess selection
facet: retain the real callee and static selected declaration without promising receiver purity.
The existing discovery walker must still evaluate the real receiver independently. No Type,
resolver, parser or ordinary action-call publication changes are granted by this follow-up.

Managers implement against supplied frozen inputs in isolated worktrees and reconcile the landed
base before frozen return. This manifest transfers no unlisted shared file implicitly.

1. A preserves resolveArgumentBindings's parameter-ordered pairs and diagnostics, and the existing
   named/dynamic/unresolved action resolver. D consumes these APIs unchanged in its first slice.
2. D publishes a failure contract containing known cases and an open flag. Union preserves openness;
   handling known cases never closes an unknown remainder. effectFailureCases may temporarily remain
   a compatibility projection while all consumers requiring completeness move to the full contract.
3. Failure effects remain separate from value type inference. A later capability check uses D's
   failure-bound compatibility helper: open actual effects cannot satisfy a closed requirement.
   Pure functions additionally exclude actions/I/O/suspension; failure-free does not establish purity.
4. Existing bound action results join their transaction. D1 needs no new quantity/live-handle ABI.
   Preserve containment/savepoints, detached scheduling and source diagnostics with parity checks.

## Native contract boundary

The selected checked native contract supplies generated type factories from canonical JS backing
and a uniform getJSValue accessor. Unit factories normalize readings once; Duration's backing remains
seconds and its selected-unit view is separate. Checked construction reports modeled failures for
shape, nonfinite backing or declared invariant violations. Accessing another view must not normalize
canonical backing again. These requirements do not claim the current unchecked TR.Value implements them.

Preserve live entity handles, schema.read/DataControls.Read and cached dependency reads; do not copy
them into frozen records. Generated callbacks retain Tao wrappers and nominal contracts. Checked
row/list builders and exact SDK exports are coordinator engineering work after A's nominal/member
contracts; C/E consume the published implementation instead of creating competing wrappers.
BridgeMetadata plans output; ProjectToolingService owns .tao-ts publication/typechecks/cleanup.

## Integration

Managers can split implementation among their own sub-agents only within their listed ownership.
Do not revert another owner's work. Deliver coherent independently valid slices, reviewed diffs,
focused evidence, and required repository gates. Commit exact reviewed paths on a feature branch;
keep landing with the coordinator until explicitly released for that concrete slice. A slice's
completed handoff enables its dependent wave, not the entire program.
