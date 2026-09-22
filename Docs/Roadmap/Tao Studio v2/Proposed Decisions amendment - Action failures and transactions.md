# Proposed Decisions amendment - Action failures and transactions

Status: partially adopted by the Developer on 2026-08-31. Native `fail` inference, foreign declaration-head `fails`,
foreign `runs latest`, and automatic containment are incorporated into
`Docs/Roadmap/Tao Revolution/Decisions.md` §§8 and 15. The runtime action-transaction model and generalized
semantic capture/replay contract are explicitly deferred in `Roadmap.md`.

## Conflict with current Decisions

The current Declared failures section in Decisions places `fails` inside a bodied action and delegates with
an ordinary `from` expression. It also says that foreign failures are structured outcomes, that English
never crosses the TypeScript boundary, and that a sidecar can fail only through a declared case.

The implemented Studio v2 language instead follows the native-inference/foreign-declaration asymmetry:

- native actions contain `fail Case "sentence"` statements and infer their failure contract from those
  statements;
- foreign actions have no body and declare `fails Case "sentence"` clauses on the declaration head before
  `from ./Sidecar.ts`;
- a provider may supply the selected case and a server-authored sentence, with the runtime message ladder
  deciding what the person sees.

Decisions also reserves `transaction` for the future authority and all-or-nothing durable-row model. The
implemented action overlay must be described as today's runtime action transaction, not as completion of
that broader Revolution contract.

## Adopted action failure and scheduling wording

An expected native action failure is written at the detection site:

```tao
type SaveFailure is one of Offline, Rejected

action Save() {
   fail Offline "Could not save this draft."
}
```

- `fail Case "sentence"` aborts the complete joined action call, discards its private writes, and skips the
  remaining statements in every caller block.
- A native action's failure contract is inferred from the `fail` statements it owns. The same case may be
  used at several sites with different sentences.
- A nested `do Callee()` joins the caller's transaction rather than creating another commit.

A foreign action declares what a native body would reveal:

```tao
action Publish(Value text)
   fails Offline "Publishing is unavailable."
   fails Rejected "Publishing was rejected."
   from ./Api.ts
```

- `fails Case "sentence"` is a declaration-head clause used only by a foreign action.
- The relative TypeScript or TSX module provides the named export matching the action.
- Crossing that boundary counts as an external effect. The effect executes inline and is not reordered,
  deferred, or rolled back.
- A provider failure selects a case and may carry a server-authored sentence. An unknown case remains that
  unknown case and never borrows copy from another declaration.

A foreign action may additionally declare latest-only scheduling:

```tao
action SyncDraft(Path text, SourceVersion text, Content text) runs latest from ./StudioActions.ts
```

- One action value has at most one invocation running and one invocation waiting.
- A call arriving while another is waiting replaces the waiting call's arguments. The replaced call
  resolves as skipped; it does not enter a transaction, cross an external boundary, or report a failure.
- When the running call settles, the newest waiting call starts with the direct or joined ownership mode
  captured at its own call site. It does not inherit a transaction merely because the older call was
  suspended there.
- `runs latest` is a foreign-action scheduling contract. A native action using it is a validation error.

Failure messages use, in order: the provider/server sentence; the sentence from the matching foreign
declaration or native `fail` site; then `Couldn't finish '<action name>.' Nothing was changed.`. Command
labels and humanized action names are not part of the implemented fallback contract.

## Proposed runtime wording

- Root actions are serialized. State and data writes use private read-your-writes overlays.
- Commit applies recorded data mutations as a delta to the latest committed snapshot rather than replacing
  it with the action's starting snapshot.
- Commit has a prepare phase across every participating resource, then a publish phase. A prepare failure
  publishes nothing; a publish failure restores resources already published by that commit.
- Providers receive only committed snapshots. This runtime guarantee does not promise a distributed atomic
  commit across independent external providers.
- A failure is eligible for retry only when the transaction crossed no external-effect boundary. Retry
  eligibility is recorded; automatic retry is not implied.
- Failure reports retain the root action, sanitized arguments, the nested action frame chain, the selected
  case and message, retry eligibility, and time. Runtime history is bounded to 50 reports and structurally
  excludes credentials and common secret-bearing fields.

## Adopted containment and deferred capture boundary

The automatic render-error architecture is now implemented at loop-item, screen/presentation, and app
boundaries. The happy path renders directly. After a crash, the boundary reruns its subtree through a
diagnostic pass, captures compiler-owned declaration/source metadata and bounded arguments, and presents
Try again. The same failure against the same state escalates from item or screen, or plants an app stopper,
instead of retrying forever. Restart app remounts the app without clearing data. Reset app data appears only
when every participating provider grants reset, requires a second confirmation, and captures a backup first.

Containment and its guarded recovery controls are adopted. Generalized runtime capture/replay is deferred;
the current implementation uses an explicit, versioned registry rather than object-graph serialization. Its
domains are `action-history`, `data`, `navigation`, and `persisted-state`; Studio adds its cell environment,
receives the complete failure artifact over the trusted preview bridge, links to its source range, and can
load or paste the artifact to remount one cell with restored semantic state. Credentials and opaque stores
cannot enter unless a future domain explicitly registers them. These implemented details are not yet an
adopted language contract.

This implementation still does not claim:

- transaction context isolation for arbitrary host callbacks while an action is suspended;
- automatic retry of a failed action merely because its report is retry-eligible;
- capture of arbitrary React hooks, timers, native controls, process state, or unregistered stores;
- automatic conversion of a failure capture into durable authored fixture-plus-scenario source; or
- command-label lookup or humanization in the action-failure fallback message; or
- source ranges on the name-only frames in action-failure reports. Render-failure frames do carry the
  compiler-owned range supplied by their automatic boundary.
