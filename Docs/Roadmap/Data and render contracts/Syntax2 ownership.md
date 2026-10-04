# Syntax2 ownership and interface agreement

Read with [the program](<Implement Syntax2.md>) and [coordinator brief](<Syntax2 coordinator brief.md>).
This manifest allocates source ownership, including across separate worktrees. It does not add
language decisions. The first render foundation must land before A1/D1 dispatch. Each manager
starts from fetched main containing this document and that implementation, records its exact base,
and works in a separate feature branch/worktree. Later transfers are explicit amendments.

## First concurrent wave

- A owns the exact paths in [A's brief](<Syntax2 A names and capabilities.md>), including Type.ts.
- D owns the exact paths in [D's brief](<Syntax2 D outcomes and cleanup.md>).
  For D1 only, ast-utils.ts export aggregation is transferred to D to publish its failure contract;
  A1 needs no aggregation change. Return this file to the coordinator after D1 integration.
- B owns the explicit parser/prefix/runtime transfers in [B's brief](<Syntax2 B rendering and slots.md>).
  Return shared grammar/attachment/dispatch files to the coordinator after B1 integration.
- C starts the bounded native-quantity prototype in [C's brief](<Syntax2 C numeric and native values.md>);
  production source ownership is released after its ABI handoff.
- The coordinator owns all other shared source and app graduation.

The coordinator reserves parser grammar outside B1's explicit prefix transfer, parser installation/scoping/export aggregation, invocations.ts,
ast-utils export aggregation outside D1's explicit transfer, validator registration, formatter dispatch, FunctionalCoreValidator.ts,
FunctionalCoreCompiler.ts, Compile.ts, Backend.ts, InvocationsCompiler.ts, TR.ts, bridge-metadata.ts,
project-tooling publication, stdlib shared declarations, and all Apps/Syntax2 executable/future
source moves. Managers request a minimal seam change or an explicit whole-file transfer before editing.
Each owns its feature-specific tests and validator message factories alongside approved source.

## Binding and effects

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
