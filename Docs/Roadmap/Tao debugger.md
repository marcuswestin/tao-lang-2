# Tao debugger — design exploration

Status: **exploration, dialogue open**. This is the plan for a debugger over running Tao apps: at
minimum, breakpoint-style step-by-step execution of actions, and beyond that whatever the language's
own structure makes cheap. Direction settled with Ro is recorded in dated sections as the dialogue
proceeds. Nothing here is language law until it reaches `Tao Revolution/Decisions.md`, which wins
wherever the two collide; in particular the debugger is developer tooling over the implemented
runtime, and it does not adopt any of the deferred action-transaction, capture/replay, or journal
contracts by existing.

## Framing

A JavaScript debugger stops a program at a line and shows whatever happens to be in memory. A Tao
debugger can do better, because the compiler and runtime already know what a step _is_. An action
body is a list of language statements — `set`, `do`, `create`, `update`, `fail`, `ask`, `present`,
`async` — each compiled one at a time. Every root invocation runs in one serialized transaction with a
private read-your-writes overlay, and nothing that overlay holds reaches the screen until commit.
Every nested `do` pushes a named diagnostic frame. The store, navigation, and persisted state already
have exact, versioned capture codecs. So the three questions a debugger answers — _where am I, what
is about to happen, and what has happened so far_ — each map onto a runtime seam that exists:

- **Where am I** is a statement inside a frame inside a transaction, and the frame stack is already
  kept (`ActionTransaction.frames`).
- **What is about to happen** is the transaction's overlay: the set of state and data writes this
  action will publish if it reaches commit, versus the values currently on screen. No other debugger
  can show "pending writes" as a first-class thing because no other runtime keeps them apart.
- **What has happened** is the action journal — today a bounded tail of failures only, tomorrow every
  root with its outcome — and the capture codec makes any point in it restorable.

The consequence worth stating up front: **pausing a Tao action never shows a half-applied app.** The
preview keeps rendering the last committed state while the developer walks the overlay. That is a
better story than any React or Swift debugger can tell, and it costs nothing extra; it falls out of
the transaction design.

## What is already in place (the audit)

Runtime (`packages/runtime/TaoRuntime-src`):

- `TR-action-transactions.ts`: root serialization, joined `do` calls, the named frame stack, private
  overlays for state (`RuntimeState.set`), persisted state, and data, prepare/publish commit with
  reverse-order rollback, the external-effect flag, deferred `async` bodies, after-commit effects,
  and launch-generation abandonment. Every root — user action, `async` block, latest-only foreign
  call — funnels through `runAction`, so one hook there sees everything.
- `TR-errors.ts`: the failure report (root name, sanitized arguments, case, frames, message,
  retry eligibility, timestamp), a 50-entry bounded history, credential-key redaction, and
  `TR.Errors.onFailure` as a listener seam. Frames are names only; no source ranges yet.
- `TR-runtime-capture.ts`: the explicit domain registry and the version-1 capture artifact with
  `action-history`, `data`, `navigation`, `persisted-state`, and cell-local `scheme` domains, plus
  restore. Studio already replays one into a cell.
- `TR-units.ts`: `TR.Clock`, virtual under `beginTest`, real time otherwise. A Studio preview runs on
  real time today.
- `dev-runtime/`: a development-only layer (layout bounds, dev menu) that is the natural home for an
  on-device debug toggle if the debugger ever leaves Studio.

Compiler (`packages/compiler/compiler-src/codegen/app`):

- `ActionsCompiler.ts` compiles an action to `TR.Action(callback, metadata)`; `ActionBlockBody`
  emits statements one by one through `ActionStatement`, so a per-statement hook has exactly one
  place to land.
- `action-control-flow.ts` decides per block whether the callback is `async` (an `ask`, a guard, an
  `if`, or a `do` into something that suspends). A body with none of those is synchronous. A pausable
  body must be able to suspend, so instrumentation changes this decision; see below.
- `declaration-identity.ts` emits a canonical identity tuple per declaration, and
  `studio-preview-manifest.ts` carries source ranges (`start`/`end` offsets) for what Studio needs.
  There is no statement-level identity and no TypeScript source map.

Studio (`packages/studio/studio-src`):

- An exact-origin preview channel (`TR-studio-preview.tsx` ↔ `StudioProtocol.ts`) with typed,
  versioned messages in both directions: `preview-runtime-failure`, `preview-runtime-captured`,
  `preview-console`, `highlight-source`, `preview-select-source`, `source-action`, and friends. A
  debugger's traffic is a handful of new members of that union.
- Source ↔ render selection and highlight already work in both directions, so "highlight the paused
  statement in the editor" and "show which view a paused action came from" reuse existing plumbing.
- The Tao-owned client (`TaoStudioClient.tao`) renders every drawer and inspector panel; the code
  editor is a CodeMirror foreign view (`@tao/code-editor`) with no gutter extension yet.
- `StudioTestRunner.ts` runs `tao test` as a subprocess and parses its output; tests do not execute
  inside the preview realm.
- Studio v1 explicitly preserved this seam and deferred the feature: "Debugger manifest/source maps:
  keep protocol capabilities optional … omit debugger UI, DAP/CDP bindings, breakpoint hooks."

Language: there is no `log` statement and no debugger syntax of any kind. That is a strength for
the plan below — none of it needs Tao source to change — and one open question (Q4).

## What a Tao debugger could offer

The floor is A. Everything after it is ordered by how much it reuses what exists.

### A. Pause and step through action statements

Breakpoints on any statement in an action body; pause before the statement runs; step over, step
into a `do` (native actions only — a foreign action is one opaque frame), step out to the caller's
next statement, continue, and pause-on-entry for a named action. The paused statement is highlighted
in the editor and the transaction's frame stack is shown root-first. Because roots are serialized,
a second user tap while paused simply queues; it runs when the paused root finishes, exactly as it
would have without the debugger.

### B. The transaction inspector

While paused, show the whole transaction, not just a stack:

- **Frames and arguments**: every frame from root to the current `do`, with sanitized arguments
  (the failure report's existing redaction policy).
- **Action-local values**: the parameters and any `ask` result bound in the block's scope
  (`TR.BlockScope` is a prototype chain of named bindings; the compiler knows every name).
- **Pending writes**: for every state and data resource the transaction has touched, the overlay
  value beside the committed value — literally "what this action will publish." For data, the
  delta the commit will apply (creates, updates with prior values, deletes).
- **Effects so far**: whether an external boundary was crossed (retry-eligible or not), which
  `async` blocks are queued to start after commit, and which after-commit effects are registered.
- **Outcome preview** at the last statement: commit, or fail with which case and sentence.

### C. The action journal

Widen `action-history` from failures-only to every root: name, arguments, start and settle time,
outcome (committed, failed with case, skipped by `runs latest`, abandoned by launch), whether an
external effect ran, the frames it visited, and a summary of the delta it committed. Bounded like
the failure tail today, larger under Studio. This is the debugger's "what has happened" pane and,
later, the substrate for time travel. It needs no compiler change — every root already passes
through one function.

### D. Live state, data, and navigation

A live view of app state, persisted state, provider snapshots, and the navigation stack — the same
domains the capture artifact already serializes, shown reactively rather than at failure time.
Editing a value from the debugger runs as a synthetic root action, so it goes through the same
transaction and provider path as authored code rather than poking a store.

### E. Invoke an intent from the debugger

A console line such as `do FavoriteRecipe(Shakshuka)` against the running cell: any action, typed
arguments resolved against the store, run as an ordinary root, observed in the journal. This is the
in-Studio twin of the decided `Palette all` and `as assistant do …` surfaces, and it gives agents a
way to drive an app that is not a screen tap.

### F. Richer breakpoint kinds

- **Failure breakpoints**: pause at any `fail`, at a foreign action's throw, or at a specific case
  — before the transaction rolls back, so the overlay is still inspectable. This is probably the
  most-used breakpoint in practice, and it needs no source location at all.
- **Conditional breakpoints** on a Tao expression evaluated in the paused scope.
- **Data breakpoints**: pause whenever a named state or an entity field is written. Every write
  goes through a runtime seam (`RuntimeState.set`, the data overlay), so this is a hook, not a scan.
- **Run to statement** and **pause on next root** without placing a persistent breakpoint.

### G. Reactivity tracing

After a commit, which views re-rendered and which state or data reads they depend on. Tao owns the
reactive sources (`TR-reactive.ts`) and the render identity, so "why did this re-render" is
answerable in Tao terms — a declaration and a reactive source — rather than in React profiler terms.
Highlight the affected renders in the preview through the existing selection channel.

### H. Step through a test journey

Run one `.test.tao` check inside the Studio preview cell, pausing between steps (`press`, `enter`,
`expect`, `advance`), with the action debugger active underneath, so a failing expectation can be
inspected at the exact step rather than read from Jest output. This requires the test-plan executor
to run in the preview realm instead of a subprocess; it is the largest single piece here and stands
on its own.

### I. Time travel and replay

Snapshot the capture domains every N journal entries; scrub the journal to any root and remount the
cell there; replay a captured failure step by step with breakpoints. `Deterministic simulation.md`
owns the journal-as-replay design; the debugger is its consumer. Undo-by-derivation (`Decisions.md`
§8) is the same inverse the store computes for a delta, so a store-only root can be reversed from the
journal. This item depends on the deferred capture/replay decision being resumed.

### J. Provider and network tracing in a cell

Fills, saves, injected latency, offline refusals, and scripted fill failures as journal entries with
timing, alongside the actions that caused them. The Studio environment overlay already scripts all
of these; it does not yet report them.

### K. Agent and IDE surfaces

The same protocol exposed as a machine-readable `tao debug` session (JSON over the Studio session
server, or an MCP tool set) so Codex and other agents can set breakpoints, step, and read the
inspector — the roadmap's "enable Codex to interact with Studio on its own." Later, a Debug Adapter
Protocol adapter in the IDE extension that speaks to the Studio session, so breakpoints set in a
`.tao` file in VS Code drive the same runtime controller. Both are thin once the protocol exists.

## Design: how a pause works

### Instrumented codegen

The runtime cannot pause a synchronous JavaScript function, so pausing requires the action body to
be able to suspend at every statement. Proposal: a compiler option, `debug: true`, that makes
`ActionBlockBody` emit one gate before each statement,

```ts
await TR.Debug.At(step, _Scope)
```

and forces every action callback and every `do` site to be `async` (the `actionBlockRequiresAsync`
decision becomes "always" under the option). `step` is a stable statement identity: the owning
declaration's canonical identity plus the statement's path within the block. The preview manifest
gains a step table mapping each identity to its source path and range, so Studio can place gutter
markers and highlight the paused line without a TypeScript source map.

When the debugger is off, `TR.Debug.At` returns a resolved promise and the body proceeds. When it is
off at compile time, nothing is emitted: production and `tao test` builds are byte-identical to
today. Studio compiles its preview runtime, so Studio previews can be instrumented always (Q9).

Consequence to prove: instrumenting makes every root asynchronous, which moves it from the immediate
path in `runAction` onto the serialized queue. Ordering is preserved (the queue is FIFO), but
`interrupt` responses, latest-only scheduling, and launch abandonment all have async branches that
today only some bodies exercise. The gate for this slice is the whole Tao test suite green under
instrumentation, and the runtime's transaction tests run in both modes.

### Pause semantics

- Granularity is the action statement. The gate sits before the statement, so "paused at `set
  Name`" means `Name` has not been written yet, even to the overlay.
- The preview keeps rendering the last committed state throughout. The overlay is private until
  commit, so a pause is invisible to the app and to the person looking at it.
- Other roots queue behind the paused one, as they would behind any suspended root. The debugger
  shows the queue depth.
- Timers: a paused root on a real clock can be overtaken by a `@tao/time` ticker or a toast expiry.
  Recommended: the controller holds `TR.Clock` while paused, exactly as a test check holds it,
  and releases it on continue (Q2).
- An `ask` is a suspension the app authored, not a breakpoint. The inspector shows "waiting for a
  response" with the presenting view; stepping resumes when the response arrives.
- Foreign actions are opaque: one frame, step over only, with the external-effect flag flipping
  when it returns. Source maps into the sidecar's TypeScript are out of scope (Q8).
- `async { }` blocks are their own roots; a breakpoint inside one fires when that root runs, and
  the inspector names the root that queued it.
- A failure breakpoint pauses in `runJoinedAction`'s catch path before `finishRootFailure` rolls
  back, so the overlay and frames are intact; continue proceeds to the normal rollback and report.

### Runtime controller

A new runtime module, `TR-debug.ts`, exposing `TR.Debug`:

- a state machine (`detached | running | paused`), the breakpoint table (statement, action-entry,
  failure, data, conditional), and the step mode (`over | into | out | continue`);
- `At(step, scope)`: the gate; returns immediately unless a breakpoint or step mode applies;
- hooks into `runAction`/`runJoinedAction` for journal entries, frame changes, and the failure gate;
- inspection: a sanitized snapshot of frames, arguments, scope bindings, and each transaction
  resource's committed and overlay values, reusing the failure report's redaction and the capture
  codec's JSON rules so credentials and opaque values never cross the channel;
- a listener seam (`TR.Debug.onEvent`) the preview forwards to Studio, mirroring `TR.Errors`.

Nothing in the module is reachable from Tao source. It is tooling over the runtime; the deferred
transaction and capture decisions in `Roadmap.md` stay deferred.

### Protocol and product surfaces

New members of the `StudioWindowMessage` union, versioned with the rest:

- Studio → preview: `debug-configure` (breakpoint table, hold-clock flag), `debug-continue`,
  `debug-step` (`over | into | out`), `debug-pause`, `debug-invoke` (action name and arguments),
  `debug-inspect` (resource or scope path for lazy expansion).
- Preview → Studio: `preview-debug-paused` (step identity, frames, arguments, scope, pending
  writes, effects, queue depth), `preview-debug-resumed`, `preview-debug-journal` (batched
  entries), `preview-debug-state` (live domain snapshots on change).

Studio:

- a **Debug drawer** in `TaoStudioClient.tao`, Tao-owned like every other panel: journal list,
  paused-transaction inspector with frames / scope / pending writes / effects sections, breakpoint
  list, and the console line for invoking intents;
- **gutter breakpoints** in the code editor, a small CodeMirror extension in `@tao/code-editor`
  driven by the manifest's step table, and the paused line highlighted through `highlight-source`;
- a **paused badge** on the matrix cell in the slot the runtime-failure panel uses today, with
  continue/step controls;
- breakpoints stored in Studio user state under `.artifacts/user/studio/`, keyed by project and
  source path — never in Tao source, which stays project truth (Q5).

The IDE extension and the agent surface consume the same session-server protocol later (K).

## Sequencing sketch (pre-decision)

Each phase lands with contract tests on the runtime and Studio protocol, the Tao test suite green in
both compile modes once instrumentation exists, and browser evidence for the Studio surface through
the existing smoke lanes.

1. **Journal and drawer** (C, D, E — no compiler change). Widen the action history to every root,
   add `TR.Debug` with journal and invoke, forward it over the preview channel, and render the Debug
   drawer with the journal, live domain snapshots, and the intent console. Useful on its own and
   proves the panel and protocol.
2. **Breakpoints and stepping** (A, B — the floor Ro named). Instrumented codegen with statement
   identities and the manifest step table; the gate, step modes, and pause semantics above; gutter
   breakpoints and the paused-transaction inspector with frames, arguments, scope, pending writes,
   and effects. Definition of done: set a breakpoint in a WordFlower action, step through it,
   watch the overlay diverge from the committed value, continue, and see the commit in the journal.
3. **Richer breakpoints** (F). Failure, action-entry, data, conditional, run-to-statement.
4. **Reactivity and provider tracing** (G, J). Journal entries for renders and provider traffic,
   preview highlighting of affected renders.
5. **Test-journey stepping** (H). Run one check inside the preview cell with per-step pausing;
   this is where `StudioTestRunner` stops being a subprocess wrapper for the debugging case.
6. **Time travel** (I). Snapshot-per-N journal entries, scrubbing, replay of captured failures with
   breakpoints — after the capture/replay decision is resumed and in step with
   `Deterministic simulation.md`.
7. **Agent and IDE surfaces** (K). `tao debug` over the session server or MCP, then a DAP adapter.

Phases 1 and 2 are the plan's deliverable; 3 onward are ordered by cost and can be re-cut once the
first two are in use.

## Open questions (the decisions queue)

1. **Pause contract.** Statement granularity, gate before the statement, overlay visible and the
   screen unchanged while paused — is that the model, or should a pause be able to show pending
   writes in the preview itself?
2. **Clock while paused.** Hold `TR.Clock` during a pause (recommended) or let real time run?
3. **Where it runs.** Studio only, or also the `./tao dev` loop and the on-device dev menu through
   `dev-runtime`? Studio first is assumed; the controller is host-agnostic either way.
4. **A `log` statement.** The plan needs no syntax. Whether Tao gains `log "…"` or a debugger-only
   `note` is a language decision; the preview console channel would carry it if so.
5. **Breakpoint storage.** Studio user state per project (proposed) versus a project-local ignored
   file agents and people can share.
6. **Journal ownership.** Runtime codec extending `action-history`, or a Studio-protocol-only stream
   that never enters the capture artifact? The simulation exploration asks the same question (its
   Q6); one answer should serve both.
7. **Scope introspection.** Does the compiler emit the block's binding names for phase 2, or does
   the inspector show only parameters and `ask` results until a later slice?
8. **Foreign code.** Opaque frames only (proposed), or is a sidecar source map worth its cost?
9. **Always instrument previews?** Studio previews instrumented unconditionally (proposed, pending
   a measured cost), or a per-cell toggle.
10. **Data breakpoints on entity fields.** These hook the data overlay's write path; confirm that
    seam may carry a debugger listener, given the transaction contract itself is deferred.
