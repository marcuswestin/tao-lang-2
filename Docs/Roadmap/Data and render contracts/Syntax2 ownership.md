# Syntax2 ownership and interface agreement

Read with [the program](<Implement Syntax2.md>) and [coordinator brief](<Syntax2 coordinator brief.md>).
This manifest allocates source ownership, including across separate worktrees. It does not add
language decisions. The first render foundation must land before A1/D1 dispatch. Each manager
starts from fetched main containing this document and that implementation, records its exact base,
and works in a separate feature branch/worktree. Later transfers are explicit amendments.

## First concurrent wave

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
repair are reviewed and integrated; the coordinator publishes their shared facade. C's alias/
persisted-output completion repair is frozen for final integration review. Their next proposals
remain read-only; no capability, numeric/unit or slot frontend release is implied by this manifest.
TR.ts remains reserved until C's reviewed accessor chain is integrated. The coordinator owns the
callable export hook, subsequent runtime facade hooks, combined verification and landing.

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
