# Tao Actions

Actions are effectful values. A named action may update Tao state and data, invoke another action with
`do`, stop deliberately with `fail`, or cross a typed TypeScript boundary. The runtime contains every
root invocation in one serialized transaction.

An action names nothing a person reads. It is a private procedure, and no surface lists one. The
discoverable verb is a `command`.

## Reactive inputs

An ordinary action parameter keeps its caller's storage when the action writes it. The compiler
infers that requirement through action calls, command inputs, and view forwarding. Callers must supply writable
state or an ordinary item field path. A computed expression cannot satisfy a writable parameter.

`copy Value text` makes an action or command parameter independent for each invocation. Mutating that copy
does not mutate the caller. Copies recursively detach items and lists while preserving entity handles.
Native controls receive generated Tao action callbacks for explicitly `mutable` parameters.

## Commands

A command is a standalone configured value: one action invocation, the words a person reads, and the
slots that invocation still needs.

```tao
primitive command with {
   Title text,
   Description text is "",
   Summary text is "",
   Label text is "",
   Icon text is "",
   Key shortcut is none,
   Enabled boolean is true,
}
```

`Title` is required and must be a static text literal, because a verb nothing can name is not
discoverable and the catalog reads titles before any value exists. An unfilled `Label` reads
as the command's `Title`; the default is written as empty text because a slot default is a literal
rather than a reference to a sibling slot.

A command is declared at module level or in a view or scene body — the placement `action` already
has, and for the same reason: a command written in a view body closes over that view's parameters,
state, and actions. Its slots are its parameters, declared exactly as an action declares its own:

```tao
package
command Finish(Document) {
   Title "Finish document"
   Description "Moves a document out of drafts and into the archive."
   Summary "Finish { Document.Title }"
   Icon "checkmark.circle"
   Enabled Document.Final is Draft
   do -> {
      update Document {
         Final
}  }  }
```

`Document` in the parameter list is a slot taking its same-named type, exactly as
`view CookScreen(Recipe)` reads, and `command Like(Track Song)` renames a typed slot the way any
parameter list does. The body holds member fills and exactly one `do` clause naming the action it
runs — an inline action, or a named action with its call parentheses. Because the slots are not in
the body, juxtaposition means one thing there: a name followed by a value fills that member.
`Enabled CanSave`, `Enabled Document.Final is Draft`, and `Key primary + "n"` are all ordinary
values, and a name the command has no member for is diagnosed. Slots follow the ordinary parameter
rules: a slot declared twice, or one that shadows a value the command can already see, is diagnosed
at the parameter.

A command is invoked exactly as an action is. `do Finish(Document)` binds its arguments to the
command's slots by label or by type through the one mechanism an action `do` uses, and gets the
same arity and type diagnostics — a missing argument, an unmatched one, or two of one type:

```tao
on press -> { do Finish(Document) }
```

Binding a command is derivation. `Finish with { Document }` derives a command value with a slot
filled, for surfaces and menus, and a binding may also refine any other contract member (`Label`,
`Icon`, `Key`, `Enabled`, `Description`, `Summary`); overriding `Title` is an error, because the title
is what identifies the verb wherever it is listed.
A bound command invokes over the slots its binding left open, so `do` on it takes exactly the
arguments its type still asks for. A toolbar mention is unfilled on purpose: the presenting scene
supplies the slot from its own parameters, matched by type, when the command is invoked, and a slot
the scene cannot supply unambiguously is reported at the mention.

Every module emits a table of the commands it declares and registers it at load through
`TR.Interaction.RegisterCommands`; a view-body command registers while its view is mounted. The
table records each command's identity, its slots and whether each names an entity, and the value to
run, so a verb surface can ask which commands act on what a person has in front of them.

Entity `commands { A, B }` entries order the default verbs and `commands hide { C }` withholds a command
unless a view explicitly lists it. These data entries are comma-separated like fields and storage
facts. A view's `Commands { ... }` promotes applicable commands and `hide X` excludes inherited
defaults. The target verb layer folds view promotions, rendered inner
controls, entity defaults, then remaining applicable commands. Identical visible labels fold onto
the first verb in that priority order, retaining its provenance, so a generated verb surface never
presents indistinguishable duplicate choices; duplicate registrations of one command also fold.

At the implemented boundary, module-level command catalogs belong to the compiled project: app
variants and sibling app declarations in that project share the catalog. A separate running-app
ownership boundary requires an authored ownership construct and is not inferred from app variants.

## Shortcuts

`shortcut` is the type of the key a command answers to. A bare string literal in `Key` position is a
shortcut literal (`Key "s"`), and `primary + "n"` chains the one registered modifier onto a key.
`primary` is a value in `@tao/keys`: the host maps it to whatever chord key the platform it runs on
already uses, so one authored shortcut is correct on every one of them. Naming a platform key
directly — `cmd`, `ctrl`, `meta` — is an error, and so is a modifier no tranche has registered.
Modifier chords dispatch directly using the nearest applicable scope: engaged input, modal
occurrence, targeted item, focused scene, app-wide command, then reducer keys. Bare single-letter
keys are accelerators only while the target verb layer is open. The runtime-owned palette is always
available through `primary+K`; it lists every titled command and entity and shares attention's
locale-aware word-prefix subsequence matcher. Hints, overview, verb, and palette rows receive
deterministic label-derived keys without shadowing reducer keys or explicit shortcuts.

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
the root action, unless a `when do` on the way contains it (see Effect outcomes below).

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

## Effect outcomes

A call site that must react to a verb's failure runs it with `when do` and names what happens next:

```tao
type ExportFailure is one of Offline, TooLarge

action ExportDocument(Format text)
   fails Offline "Exporting needs a connection."
   fails TooLarge "This document is too long to export."
   from ./Export.ts

action RunExport() {
   when do ExportDocument(Format: "pdf") {
      saved -> { set Status = "Exported" }
      Offline -> { set RetryWhenOnline = true }
      rejected -> Problem { set Status = Problem }
      error -> Message { set Status = Message }
}  }
```

`when do` is an action statement. Its invocation is exactly a `do`'s, a command included, and the verb
joins the caller's transaction as it would under `do`. What differs is failure: the runtime takes a
savepoint of the caller's private overlays before the verb runs, and a failure restores it, so the verb's
own writes vanish while the caller's earlier writes stay. The site then runs one outcome:

- `saved` when the verb finished on this device. It takes no name.
- a case the verb declares, when the site names that case. It handles only itself.
- `rejected -> Problem` for every other declared case.
- `error -> Message` for any failure the verb never declared: an undeclared provider case, a thrown error.

The name after `->` is optional wherever it is allowed, and binds the selected user message from the
failure-report ladder below, with the fallback naming the verb. Each outcome appears at most once, and a
named case must belong to the verb's effective failure contract. An outcome block is a nested action block,
so `check` is rejected inside one as it is inside `if` and `guard`. There is no `queued` outcome yet.

Authentication verbs from `@tao/auth` use `completed` for success, not `saved`, and may return
`cancelled`; neither outcome binds a payload. `rejected -> Problem` and `error -> Message` remain
available. `SignIn()` keeps its presented flow open through a required challenge, returning
`completed` on success and `cancelled` when the user cancels. `SignOut()` completes after durable auth cleanup.
An account's data row may still be unavailable after authentication completes; guard that row
before reading its fields.

The terminal bar form is also supported:

```tao
use SignIn from @tao/auth

action Enter() {
   when do SignIn()
      | completed -> { do OpenWorkspace() }
      | cancelled -> { }
      | otherwise -> { do ShowSignInProblem() }
}
```

A bar match requires its final `| otherwise ->` arm. An arm may contain one action statement or
an explicit block; multiple statements require a block. The fallback handles outcomes not named
by earlier arms. The braced form above remains supported and has no implicit fallback.

A failure the site names no outcome or fallback for leaves exactly as a plain `do` failure would:
it aborts the root and publishes the root's report. A handled failure publishes no report. External effects that already ran
cannot be undone, so they stay recorded and still make a later report ineligible for retry. A `respond`
or `async` block queued by the rolled-back verb is dropped with its writes. Row ids stay monotonic: a row
the rolled-back verb created never lends its id to a later row. A `runs latest` call that a newer call
superseded never ran, so it runs no outcome at all.

When the verb is dynamic — an action-typed parameter — its contract is unknown at the site. No case can be
named there; any declared failure it raises runs `rejected`, and only an undeclared throw runs `error`.

A verb's effective failure contract is the cases its own `fail` or `fails` declare, plus those of every
verb it reaches through a plain `do`, transitively and cycle-safe, minus those a `when do` inside it
handles. A `when do` that names `rejected` handles every declared case. An `async` block is a boundary:
it runs as its own root after the action returns, so nothing inside it joins the action's contract.

An unhandled failure stays silent at runtime, but the compiler warns at a root invocation whose effective
contract is not covered: a view event handler (`on press Verb` or a `do` in `on press -> { … }`), an
`on select` handler, a command's `do` clause, or a `do` directly inside an `async` block. The warning names the cases and points at `when do`; at a
root `when do` it names the cases the site leaves unhandled. A `do` inside another action is not a root —
its cases join that action's contract instead.

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
