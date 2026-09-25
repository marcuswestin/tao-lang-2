# Tao Testing

Status: authoritative executable contract for the current WordFlower tranche.

Tao behavior tests exercise compiled apps through the Expo/React Native render harness. Tests are
black-box: they act on rendered controls and assert rendered output rather than reading Tao state,
provider rows, navigation internals, or generated TypeScript.

## Suites, checks, and app selection

Tests may be inline in ordinary `.tao` files or live in `.test.tao` sidecars:

```tao
use WordFlower from ./

test "WordFlower" {
   test "starts empty" {
      run WordFlower
      expect text "No workspaces yet"
   }
}
```

A `test` groups checks. Each `check` runs independently, starts exactly one declared app with
`run AppName`, and receives a fresh mounted app, capability-matched in-memory datasource stand-in, and navigation
state. A sidecar sees declarations through ordinary Tao import and visibility rules. Test files and
inline test declarations are excluded from application builds.

`run` selects a named app directly from the generated module that owns that declaration. A module's
app registry is local to that generated module, and target references retain the selected app
declaration object. Loading another generated module with an app of the same name cannot overwrite
the first definition, so module evaluation and test order do not affect target resolution. The
selected app remains the compiled module's default export for launch; filename and source order
never choose it. A check drives whatever the running app presents, including overlays. Focused
`render` subjects, authored row seeding, remote-provider adapters, and direct action/value tests remain
deferred in ordinary `test` checks. Studio scenarios do execute their focused renders and ordered
journey prefixes through the same interaction adapter.

Tao now accepts file-level `fixture` declarations and named `scenarios` groups for source-owned Studio
examples. Group clauses provide defaults inherited by their scenario entries; an entry may override the
matching subject or environment clause. These declarations are typechecked and emitted into Studio
preview metadata, but ordinary production compilation treats them as metadata. Studio executes each
scenario's ordered interaction prefix; `tao test` continues to execute only authored test checks. In
particular, a scenario entry's focused
`render View(Parameter: FixtureHandle)` subject must not be confused with a test check's `run AppName`
subject. See `Tao Studio.md` for the implemented source and manifest contract.

`tao test [path]` discovers inline and sidecar tests, compiles them to structured test-plan IR, and
runs the plans through the repository's runtime Jest harness. Each test check is one case in that
harness, named `<file> <suite> > <test>`, so `tao test --name <pattern>` runs only the checks whose
name matches that case-insensitive regular expression anywhere; a pattern that matches no check is
an error rather than an empty passing run, unless `--pass-with-no-tests` says an empty selection is
an expected answer — which is what a scheduler handing one pattern to every suite it knows about
needs, and which a person typing a pattern does not. A file-level test is a suite, and a suite
declares its checks as the tests nested inside it: written as a leaf journey it would compile to a
suite of no checks and run nothing, so the validator rejects that shape. JSON, artifacts, retries,
and alternate device adapters remain future work.

`tao test --watch` composes with paths, `--name`, `--output`, and `--pass-with-no-tests`: it runs the
selected set once, then reruns the whole selected set on any change under the selected paths or the
project roots of the selected tests, until Ctrl-C. Changes are debounced the way `tao dev`
debounces a recompile, and a change that arrives while a run is still in progress queues exactly one
rerun rather than starting one per change. A rerun uses the same compiled-output cache a plain
`tao test` does: its fingerprint covers every watched file, so a real change always recompiles. A failing
run is reported the same way a one-shot `tao test` reports it and does not stop the loop; between
runs the command prints one line naming what it is watching and that it is waiting for the next
change.

## Device and fixture

`test "…" on <device>` pins the viewport preset for every check inside that test; `test "…" with
<fixture>` starts every check's fresh store from a named `fixture` instead of empty. Either or both
may appear, in either order, and both reuse a scenario's own vocabulary (§13 of Decisions, `Tao
Studio.md`): `on phone|tablet|laptop`, optionally followed by `width N x height N`, and `with
<FixtureName>` referencing a `fixture` declaration:

```tao
fixture StarterWorkspace {
   Home = create Workspace { Name: "Home" }
}

test "WordFlower full target" on phone with StarterWorkspace {
   test "opens the starter workspace" {   // inherits its parent's device and fixture
      run WordFlower
      expect text "Home"
   }
   test "on a tablet" on tablet { … }     // overrides the device, still inherits the fixture
}
```

Tests nest arbitrarily deep, and a nested test inherits the nearest ancestor's `on`/`with` unless it
repeats the clause itself, which overrides every ancestor's for that test and everything nested
inside it. A test may declare at most one `on` and one `with`; a fixture name that does not resolve,
or a fixture whose created entity the running app cannot bind (no bound datasource claims it), are
diagnostics rather than a runtime failure.

A check's device viewport is applied before its first step, through the same seam a Studio scenario
uses to size its preview; the test language itself has no selector for a chosen layout direction, so
a journey proves the device by the rows and controls it can still reach at that size, not by reading
back which way an adaptive layout laid out. The viewport simulation sends one synthetic layout
event per mounted node; it does not recalculate a layout whose child sizes change afterward. A
check's fixture seeds the store the same way: every `create` binding in the fixture materializes
before launch through the running app's bound or device-local store, the same runtime seam a Studio
scenario's fixture already seeds through (`Tao Studio.md`).
A fixture's `through <Action>(...)` binding is not yet executed by a test's `with` (Studio's own
scenario fixtures share this limit); write a `with`-driven fixture without `through` until that lands.

## Tags and selectors

`#tag` attaches to the immediately following render or loop:

```tao
#nameInput
TextInput(Value: Name, Label: "Name", Placeholder: "Home")

#rows
loop Workspaces / Workspace {
   Col() {
      Text(Workspace.Name)
   }
}
```

A render tag becomes private Tao-props metadata and is merged into that render's existing concrete
native root. A loop tag scopes each repeated row. Tagged loops must contain exactly one
unconditional direct row-root render; zero, multiple, or conditional roots are diagnostics with
guidance to wrap the row in one view or layout. The keyed row remains a Fragment, so adding a tag
does not add a layout node or change the host hierarchy.

Tags are test metadata, not public render or test IDs. The former `id "..."` declaration and all
ID-based selectors are retired. Entity handles do expose a stable, read-only `.Id` data member and
retain it after deletion, but that value is not a selector. Stable entity-ID row selection is
deliberately not implemented.

Tags and hexadecimal design colors share one lexical terminal. AST context determines
the role: a tag must match `#[A-Za-z_][A-Za-z0-9_]*`; a design color is validated separately as
`#RGB`, `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`. Digit-leading `#...` therefore cannot silently become a
tag, and letter-leading colors are not misclassified by the lexer.

Global selectors use exact normalized user-visible text, accessibility labels, or placeholders:

```tao
press text "Save"
enter "Home" into label "Workspace name"
submit placeholder "Workspace title"

expect text "Saved"
expect missing text "Loading…"
expect input label "Workspace name" value "Home"
```

A loop row's label is derived by the interaction outline (see _Accessible names and the interaction
outline_ in `Tao Layout and UI.md`), so `expect label "Chapter one"` inside
`select #drafts[1] { … }` asserts that outline metadata. A selectable row projects the same label as
the accessible name of its press surface. For a non-selectable row, this assertion does not imply a
row-level platform traversal stop; visible descendant text remains platform-readable.

Actions and input-value assertions require exactly one match. Positive text/label/placeholder
expectations require at least one; `missing` requires none. Text is exact and case-sensitive after
trimming outer whitespace and collapsing internal whitespace.

A tag can target the tagged native root directly:

```tao
press #save
enter "Home" into #workspaceName
submit #workspaceName
expect #workspaceName input value "Home"
```

Scoped expectation blocks combine assertions without exposing layout structure:

```tao
expect {
   text "WordFlower"
   missing text "Loading…"
}

expect #workspaceName {
   placeholder "Home"
   input value ""
}
```

A tag must be unique within its lexical block; the validator rejects duplicates. Repeated inner
tags may occur in separate rows but remain ambiguous globally. Tests select a
1-based row scope from a tagged loop:

```tao
select #workspaces[1] {
   expect text "Home"
   press #openWorkspace
}
```

The runner re-resolves the selected row before every nested operation because an earlier step may
rerender or remove it. Nested selectors and expectations remain inside the selected host subtree.

## Actions, assertions, and deterministic state

A check can force one declared failure case for a foreign action before `run`:

```tao
test "export fails offline" {
   action Export fails Offline
   run ExportApp
   press #export
   expect text "Waiting for a connection"
}
```

The named action must be foreign and must declare the named failure with `fails Case "sentence"`.
The stub lasts for this check only, uses that declared sentence, and bypasses the TypeScript
implementation on every invocation. A second check starts without it. A check may stub each
foreign action once. Return-value stubs and return-valued actions are not implemented.

Executable steps run in source order:

- `press`, `enter`, and `submit` deliver the corresponding native event to one matched control;
- `press down` and `press up` deliver only their respective press phase, and `hover` delivers pointer
  entry; each accepts the same exact text, label, placeholder, or `#tag` selector family as `press`;
- `focus #tag` focuses one tagged native control and is intentionally tag-only;
- `press key "Key"` dispatches one normalized interaction key through the app's attention reducer;
- `narrow "words"` appends those words to the focused region's narrowing text;
- `press toolbar command "Label"` invokes one enabled command in the focused host toolbar;
- `back` dispatches the same root-safe app reducer as the visible Back affordance and platform
  hardware Back;
- `relaunch`, and `relaunch fresh`, quit the running app and open it again on the same device,
  described below;
- `expect` and `expect missing` inspect the current rendered tree;
- `expect navigation title "Title"` observes the focused host's user-visible title, and
  `expect toolbar command "Label" enabled|disabled` observes one focused toolbar control;
- `expect target "Label"`, `expect focus region "Label"`, and `expect verbs "A", "B"` inspect the
  reducer's user-visible attention projection and require exact labels and verb order;
- grouped and tag-scoped expectations run as one plan step;
- `select #tag[N] { ... }` supplies a dynamically re-resolved row scope;
- `advance <duration>` moves the held clock, described below.

Phase steps never imply a complete activation. For example, `press down #save`, `advance 600.ms`,
and `press up #save` deliver exactly those phases; a later plain `press #save` remains the full
activation.

Checkboxes have a control-specific assertion for their two-state surface:

```tao
expect checkbox #rememberMe checked
expect checkbox #marketingOptIn unchecked
```

The selector resolves exactly one `Checkbox`; `checked` and `unchecked` assert its current exposed
control state. This does not expose arbitrary Tao state or provider data.

Navigation chrome has its own user-facing vocabulary because a native title or toolbar item need
not occur in the React content tree:

```tao
expect navigation title "Home"
expect toolbar command "Save workspace" disabled
enter "Renamed" into #workspaceName
expect navigation title "Renamed"
expect toolbar command "Save workspace" enabled
press toolbar command "Save workspace"
```

These assertions inspect the active host surface, not reducer entries, declaration slots, or
generated metadata. Labels are normalized by the same exact user-visible-text rule as ordinary
controls. The command must be unique in the focused toolbar; pressing a disabled command is a test
failure rather than a silent no-op.

Each event runs inside React's `act` boundary so synchronous Tao state, data, and navigation updates
settle before the next step. Assertions do not currently poll or sleep.

Keyboard-attention steps drive the semantic reducer directly rather than synthesizing platform DOM
or native events. `press key` fails when no layer handles the normalized key. `narrow` follows the
same locale-aware word-prefix subsequence matching as product input; it targets a sole remaining
candidate without activating it. Attention starts fresh for every check. The `interaction` capture
contains both immutable `outline` and `attention` snapshots; tests do not receive a mutation handle.

Generated interaction layers are ordinary rendered output for text assertions. `press key "?"`
toggles hints, `press key "."` opens the target's verb layer, `press key "primary+k"` opens the
command palette, and Escape with no narrower operation left opens the region overview. Journeys
assert stable headings (`Interaction hints`, `Actions for …`, `Command palette`, `Interaction
overview`) and generated `<KEY> — <label>` rows, so a missing runtime layer cannot pass through app
copy alone. Keyboard presence is recorded through the same `press key` dispatch seam.

Behavior checks use one deterministic navigation rule: the test runtime disables optional native
host surfaces and renders the native kind through its synchronous basic surface. Product source can
therefore keep the bare native-default `@tao/nav` import, while a dedicated harness may import
`@tao/nav/basic` explicitly. Adapter-level runtime tests separately exercise the native screen and
header bindings. The same title, command, Back, and reducer semantics must pass through both hosts;
journeys do not wait for platform animation timing.

Overlay and toast journeys use the same ordinary interaction and assertion vocabulary; they are no
longer deferred test subjects. Every nav's overlay lane sits absolutely above its content. Stacked
overlay occurrences remain mounted, while all but the top occurrence are hidden visually and from
accessibility. A product `dismiss` action and visible, hardware, or test Back all enter the runtime's
navigation reducers; the top overlay is consumed before covered content, and a root-safe request is
inert. Covered stack and selection content likewise stays mounted, so a later assertion can observe
its preserved local state.

A toast is app-level and transient. Different keys coexist, while presenting the same key replaces
the prior occurrence and restarts its duration. Toasts do not consume Back or plain dismissal. Tests
assert their rendered state, their keyed replacement, and — since the runner holds the clock — their
expiry.

## The clock a check holds

Every check starts from a fresh clock held at a fixed instant, and it moves only when the journey
says so:

```tao
advance 1.s
advance 90.s
advance 1.min
```

`advance` takes a literal duration, folded at compile time, so a step reads as a fixed amount of
time rather than as a value a journey cannot see. It moves the clock forward and fires every
callback that falls due, in time order, which is what makes a journey over several tickers see the
same sequence a real clock would produce. Advancing backwards is a diagnostic.

The clock owns every repeating and delayed callback in the runtime: `@tao/time`'s tickers, toast
expiry, and `now`. A held clock therefore makes a ticking display, a countdown, and a transient
notice all deterministic, and releases at the end of the check.

## What a relaunch keeps

A check can restart the app it is driving:

```tao
run WordFlower
press "Widen sidebar"
relaunch
expect text "Sidebar width 360"
```

`relaunch` is a person quitting the app and opening it again on the same device. The mounted
instance is torn down and a new one launches in its place. The device is the same one, so
everything the device owns is still there:

- device-local `(persist)` app state keeps its current value, read back out of device storage the
  way a newly started process reads it;
- stored data keeps its rows;
- the held clock keeps its current instant — a relaunch does not rewind time;
- the stored navigation position is read back, under the app's own `Restore` policy, so the app
  reopens where the person left it.

Everything the launched instance owned is gone:

- view-local `state` and every `let` derivation over it start again from their declarations;
- in-flight asks and pending handlers are discarded, and so is the action each one suspended: an
  action waiting on an `ask` does not resume when the app is quit, and an action still running in
  the background finishes against nothing. Neither commits, and neither reports a failure — the app
  a person quit has not failed;
- every navigation lane is rebuilt from the app's declared configuration before restoration runs
  over it, so nothing the previous instance held in memory carries across.

A check therefore tells the two kinds of state apart: what a person would still find after
reopening the app, and what they would not.

Restoration is on across a relaunch because a real relaunch restores. An app that declares
`Restore fresh` still starts fresh under a check, because that is its contract; what a check
changes is where restoration reads and writes, not whether it happens.

### Opening on the initial screen

A journey that wants a cold launch — the one a device gives when it has never run the app — asks
for it:

```tao
run WordFlower
press "Open detail"
relaunch fresh
expect text "Home"
```

`relaunch fresh` opts that one launch out of restoring. It reads nothing back and opens on the
app's initial screen, and it then records where it opened, so an ordinary `relaunch` after it
returns to the initial screen rather than to a position the run before it left behind. `fresh` is
per-step, not a mode: the next `relaunch` without it restores again.

`fresh` opts out of restoring, not out of the device. Persisted state, stored rows, and the held
clock survive `relaunch fresh` exactly as they survive `relaunch`.

### Operands and placement

`relaunch` takes `fresh` and nothing else, and must come after the check's `run`. It cannot appear
inside a `select` block, because a relaunch replaces every row that selection resolves; the `fresh`
modifier does not excuse that.

A relaunch keeps the device; a new check does not get one. Before every check the runner replaces
the device-local `(persist)` store, the navigation restoration store, and the datasource, and
returns every declared persisted value to the default its declaration names. A width one check
widens and a screen one check reached are therefore both gone when the next check in the same file
launches the same app, and checks in a file never depend on the order they are written in.

Encoding and decoding a navigation snapshot — argument serialization, schema-version fallback,
variant keying, entity handles — stays with the runtime's restoration suite in
`packages/apps/runtime/TR-tests/`, and so does the launch-boundary lifecycle a `relaunch` step drives.
The same split holds for persisted state: a relaunch really does read the device again, so a journey
asserting a persisted value across one fails when the round trip through storage is broken, while
the encoding and the storage keys themselves stay with the runtime's persisted-state suite.

Before every check, the runner installs a fresh in-memory provider stand-in, so no step reads or
mutates durable provider data. Snapshot providers use whole-snapshot saves: an offline or rejected
save by a network-dependent provider puts the datasource into an error state visible through
`guard … error`; local Memory and Local saves continue offline. A provider that
declares per-write recovery gets an isolated stand-in with queued, failed, and retryable records;
`WritesQueued`, `WritesFailed`, `WriteError`, and `retry` retain that provider's capability. A
fill-capable provider still binds for query fills (see `Tao Data.md`). The shipped Memory declaration in
`@tao/data/providers/memory` is bound through the published `TR.DataProvider` connection protocol;
its implementation passes the same `TR.testProvider` empty-load, round-trip,
key/instance-boundary, ordering, and rejection conformance used by other providers.

Driving a provider into `loading`, `error`, or `ready` from a test step is retired (Decisions §16).
The states those steps reached return through `network offline|online`, `wait for sync`, and
`datasource fails after create|update|delete <Entity> "message"`. Each declared failure waits for the
next provider attempt containing the named row operation. An offline granular write stays queued and
its matching failure fires on reconnect; an offline network-dependent snapshot save leaves the
failure armed. `wait for sync` succeeds when no writes remain pending and reports an offline or
failed sync rather than pretending it completed. Each check starts online with no
injection, regardless of the prior check. These controls are in-process journey behavior; host
adapters preflight and reject them until they implement equivalent capabilities.

## Compiler/runtime boundary

The compiler emits structured IR containing suite/check names and source locations, the selected app
name and source module, ordered action/assertion steps, selector descriptions, expectation groups,
and row scopes. The test compiler resolves that declaration to a unique generated module path. The
runtime loads that module directly; it does not resolve apps through a process-global name table.
Generated navigation targets also refer to the owning module's app declaration binding, so
same-named apps remain isolated regardless of compilation or execution order. The compiler does not
emit test-runner calls into app code.

The runtime adapter owns app launch, input events, selection, assertions, settling, reset, and error
formatting. Failures identify the suite, check, step, and Tao source location. This boundary allows
future web, native-device, or simulator adapters to execute the same plan without changing Tao test
syntax.

## Non-goals

The implemented test-runner surface intentionally omits direct state/value assertions, direct action
calls, provider-row inspection, production datasource access, arbitrary sleeps, public runtime or
test IDs, entity-ID row selection, focused render subjects, and navigation diagnostic assertions. A
`with <fixture>` clause seeds a check's store (`through <Action>(...)` bindings excepted, above), but
reading it back stays through ordinary rendered output, never a store query. `as <account>` and
`expect refused` remain out of scope.
