# Decision memo - Tao Studio v2

Status: active record of the Developer's Studio v2 decisions and unresolved questions. This memo controls the
remaining Studio v2 work, but it does not amend `Docs/Roadmap/Tao Revolution/Decisions.md` by itself.

## Adopted language decisions

- String-named scenario groups with nested string-named entries, group-default inheritance, and
  `(source path, group, entry)` compiler/Studio identity are adopted in Revolution Decisions §16.
- Typed foreign views using `accepts content slots @name from ./Sidecar.tsx`, with one `Slots` record,
  are adopted in Revolution Decisions §15.
- Native failure inference from `fail Case "sentence"` and declaration-head foreign
  `fails Case "sentence" ... from ./Sidecar.ts` are adopted in Revolution Decisions §15.
- Foreign `runs latest` retains one running call and only the newest waiting call; replaced waiting calls
  resolve as skipped. The running call is not cancelled. This is adopted in Revolution Decisions §8.
- Automatic render-failure containment at loop-item, screen/presentation, and app boundaries, with
  escalation and guarded recovery, is adopted in Revolution Decisions §15.

## Decided implementation state

### Persistence stays top-level

Persisted state is allowed only directly on an app. Tao will not add persisted state to view instances.
Studio folder expansion must therefore be represented by one top-level app state value and passed through
the recursive Files views with its update action. This replaces the proposed Slice 2 view-instance keying,
schema, missing-key, rename, movement, and repeated-instance work; those semantics are no longer open.

Implemented: Studio stores collapsed folder paths in one top-level persisted app state, passes that value
and its app-owned update action into a bound root view, and threads both through the recursive Files views.
The generic bound-view configuration seam preserves live values without adding view-level persistence.
Parser, validator, formatter, compiler, runtime-isolation, and Studio folder-model tests cover the path.
An ordinary-host browser reload smoke remains part of the external browser gate.

### Scheme precedence

For each preview cell:

1. an authored or transient scenario `appearance light` / `appearance dark` pin wins;
2. otherwise `Appearance: Light` / `Appearance: Dark` wins;
3. otherwise `Appearance: System` follows the host environment.

Cells resolve independently.

### Scheme capture and replay

A capture records:

- the requested appearance (`System`, `Light`, or `Dark`);
- the resolved Scheme (`Light` or `Dark`); and
- the source of the resolution (`scenario`, `preference`, or `system`).

Replay freezes the captured resolved Scheme. Promoting a capture to source writes the resolved
`appearance light` or `appearance dark` pin.

### Scheme native boundary

Browser Scheme is reactive through the Tao runtime and design system. A native target that does not yet
support reactive appearance resolves Scheme to `Light` in the runtime and reports an honest fixed-Light
capability. It must not simulate Scheme with browser-only CSS.

Implemented: the runtime resolves Scheme with this precedence, reacts to browser System changes, fixes
unsupported native hosts honestly to Light, conditions mounted design values through the ordinary runtime,
and captures requested/resolved/source/capability state. Studio carries that state through each cell,
publishes runtime resolution changes over its trusted protocol, freezes captured resolution during replay,
and writes the resolved light/dark pin when saving current scenario values.

## Explicitly deferred

Fixture-through-action result and handle semantics are deferred. `through` remains fail-closed; Slices 7
and 8 must not infer handle multiplicity, row references, transaction/rollback behavior, capture/replay,
or test-harness seeding semantics.

The runtime action-transaction contract is deferred. The roadmap now records the unresolved root
serialization, nested-join, overlay, prepare/publish, rollback, distributed-atomicity, and retry questions.
Implemented Studio runtime behavior is not authoritative language adoption for those questions.

The generalized semantic failure capture and replay contract is deferred. The roadmap now records the
unresolved artifact, domain registry, compatibility, restore timing, exclusion, Studio environment, and
validation questions. Automatic containment and its guarded recovery controls remain adopted separately.

Failure-capture promotion into authored fixture-plus-scenario source is deferred with that generalized
contract, including durable naming and conflict behavior. The implemented transient workflow is not
authority for future authored-source semantics.

## Remaining Studio decision state

No undecided item remains on the implementation-ready Studio path. General Tao concurrency questions
(`runs single`, policy keying, and cancellation) and richer border vocabulary belong to their broader
language workstreams, not this Studio decision memo. Implemented behavior for the deferred items above may
remain contract-tested, but it must not be described as an adopted language contract.
