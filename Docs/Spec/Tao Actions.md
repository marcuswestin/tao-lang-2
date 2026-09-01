# Tao Actions

Actions are effectful values. A named action may update Tao state and data, invoke another action with
`do`, stop deliberately with `fail`, or cross a typed TypeScript boundary. The runtime contains every
root invocation in one serialized transaction.

## Failure contracts

A native action reports an expected failure where it detects it:

```tao
type SaveFailure is one of Offline, Rejected

action Save() {
   fail Offline "Could not save this draft."
}
```

`fail Case "sentence"` aborts the action. The compiler infers the native action's failure contract from
the `fail` statements owned by that action, including statements in its nested action blocks but not in
a separately declared nested action. The same case may appear at several failure sites with different
sentences.

A foreign action has no Tao body from which to infer that contract, so it declares the cases and fallback
sentences on its head:

```tao
action Publish(Value text)
   fails Offline "Publishing is unavailable."
   fails Rejected "Publishing was rejected."
   from ./Api.ts
```

The path must name a relative TypeScript or TSX module. The module provides the named export matching the
action. Repeating a case is accepted; runtime case matching uses the first matching declaration when it
needs a declared sentence.

A foreign implementation may fail with an object carrying a string `case` or `caseName`, or throw an
`Error`. The runtime converts it to the action failure report described below. Calling any foreign action
marks the transaction as having crossed an external-effect boundary, whether the implementation succeeds
or fails.

## Latest-only foreign actions

A high-frequency foreign boundary may retain only its latest not-yet-started call:

```tao
action SyncDraft(Path text, SourceVersion text, Content text) runs latest from ./StudioActions.ts
```

`runs latest` is valid only on a foreign action. Each action value runs one call at a time and retains at
most one waiting call. A newer call replaces the waiting arguments; the superseded call resolves as
skipped and never enters `runAction`, crosses an external boundary, or publishes a failure. After the
current call settles, the newest waiting call runs. Its direct or joined transaction runner belongs to
that call, so an older suspended or detached invocation cannot lend it stale transaction ownership or
diagnostic frames.

## Joined transactions

Root action invocations are serialized. `do Callee(...)` does not open a second transaction: it joins the
caller's transaction, and its name becomes another diagnostic frame. A failure anywhere in that joined
call chain aborts the whole transaction, skips the rest of the caller's block, and publishes one report for
the root action.

State and runtime data schemas participate through private overlays:

- reads inside the action see earlier writes from the same action;
- no provider sees the private data overlay;
- a body failure discards the overlay without publishing it;
- successful data commits record the action's delta and apply it to the latest committed provider snapshot,
  preserving compatible remote changes made while the action was suspended.

Commit has a prepare phase followed by a publish phase. Every participating resource preflights before any
resource is published. If publication itself throws, already published state and data resources restore
their previous committed value in reverse order. A data conflict found while applying the delta therefore
cannot leave an earlier resource from the same action committed.

This is a runtime transaction over the currently participating Tao state and data resources. It does not
claim the future Revolution authority model or an atomic durable commit across independent external
providers. Provider persistence still begins only from a committed Tao snapshot.

External TypeScript effects execute inline at the authored boundary and cannot be rolled back. The runtime
records whether such an effect ran. A failure report is retry-eligible only when none ran; this release
reports that fact but does not automatically retry an action.

An `async { ... }` action block is detached from its caller. When encountered inside a transaction, it starts
as a new serialized root after the caller finishes rather than joining the caller's overlay.

## Unexpected render failure containment

Unexpected render failures have no Tao author syntax. Runtime wrappers provide three automatic levels:

- every `loop` item is isolated from its siblings;
- every screen or presented view is a screen boundary; and
- every app host has an overlay boundary.

The healthy path renders the child directly. A crash switches that boundary to a diagnostic pass over the
same subtree and records its declaration, bounded and structurally redacted arguments, compiler-owned Tao
source range when available, and React component stack. A retry that deterministically fails with the same
error and state escalates from item to screen to app; at app level it becomes a stopper card rather than a
crash loop.

The recovery surface offers Try again only when no external effect occurred since the boundary began.
Restart app remounts the app while leaving data untouched. Reset app data is offered only when every
registered provider grants reset; it requires a second confirmation and saves a semantic runtime capture
before the destructive provider calls begin.

## Runtime capture and Studio replay

The behavior below is the current implemented runtime contract. Its adoption as generalized Tao language
semantics is explicitly deferred in `Roadmap.md`; automatic failure containment is adopted independently.

A runtime capture is a versioned JSON artifact assembled only from explicitly registered semantic domains.
The built-in domains are:

- `action-history`: at most 50 bounded, redacted action-failure reports;
- `data`: exact provider snapshots keyed by stable datasource identity and occurrence;
- `navigation`: restorable app navigation descriptors; and
- `persisted-state`: mounted app-level `(persist)` values keyed by declaration identity.

Opaque objects, cycles, non-finite numbers, credentials, and unregistered stores cannot enter through this
registry. Studio adds its current cell environment, receives failure captures through the exact-origin
preview channel, displays the failing source location, and can load or paste an artifact to reconfigure and
remount that cell. Restore applies known matching-version domains immediately and retains the artifact for
matching domains that register during remount.

## Failure reports

The runtime contains a failed root action and reports:

- the root action name and structurally sanitized arguments;
- the stable failure case;
- action frames from the root through the innermost failing `do` call;
- the selected user message;
- whether retry is eligible; and
- a timestamp.

Message selection follows this ladder:

1. a sentence carried by the thrown provider or server `Error`;
2. the sentence declared for the matching foreign case, or the sentence at a native `fail` site;
3. `Couldn't finish '<action name>.' Nothing was changed.`

An unknown provider case never borrows the sentence declared for a different case.

The runtime retains at most the latest 50 failure reports. Diagnostic capture copies those reports and
recursively removes fields whose keys name credentials, passwords, secrets, tokens, or authorization.
Circular values become a marker and unsupported opaque values are omitted. Diagnostic reset clears this
bounded report history only; it does not change app state or data.

## Current boundary

The complete semantic capture/replay and automatic render-containment path above is implemented and
contract-tested. Containment is adopted; the generalized capture/replay semantics remain deferred. The
implementation deliberately does not serialize arbitrary React hooks, timers, native controls, process
state, authentication stores, or any domain that has not opted into the registry. Studio replay remounts
one preview cell; it does not automatically write the capture back as Tao fixture and scenario source.

Action-failure reports still carry name-only call frames rather than compiler source ranges. Render-failure
frames carry the source range supplied by their automatic boundary. `retryEligible` is reported, and render
containment can offer Try again, but the runtime does not automatically reinvoke a failed action. Root
serialization prevents a second root action from overlapping the active transaction; unrelated host
callbacks still do not have separate async transaction context.

`TR.Errors` is the runtime's one error-handling surface. It publishes `capture` and `reset` for the bounded
action-history diagnostics, `onFailure` for contained root action failures, and `onUnowned` and
`reportUnowned` for failures no caller can observe. A single runtime module (`TR-errors`) owns that surface
together with the error types Tao throws deliberately, the credential-key redaction policy, and the
development-only warning used when a failure is contained rather than surfaced; the automatic render
boundary reuses that same policy rather than repeating it. The full capture artifact stays owned by
`TR.Capture`, and resetting action diagnostics does not reset runtime state.

Centralization covers reporting, not every throw site. Invariant violations elsewhere in the runtime raise
the runtime's own typed errors through `RuntimeAssert` and `TR.Errors` — `UnexpectedBehaviorError` for a
state the compiler should have prevented, `UserInputError` for the program's own data or contract being
wrong, `HostEnvironmentError` for a failing device or native module — so a reader can tell whose mistake an
error reports. Locally handled failures, such as an unavailable native module or an unrestorable navigation
snapshot, are still contained where they occur rather than surfacing as action failures.
