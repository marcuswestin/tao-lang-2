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
`run AppName`, and receives a fresh mounted app, Memory datasource replacement, and navigation
state. A sidecar sees declarations through ordinary Tao import and visibility rules. Test files and
inline test declarations are excluded from application builds.

`run` selects a named app directly from the generated module that owns that declaration. A module's
app registry is local to that generated module, and target references retain the selected app
declaration object. Loading another generated module with an app of the same name cannot overwrite
the first definition, so module evaluation and test order do not affect target resolution. The
selected app remains the compiled module's default export for launch; filename and source order
never choose it. A check drives whatever the running app presents, including overlays. Focused
`render` subjects, authored row seeding, remote-provider adapters, and direct action/value tests remain
deferred in the test runner.

Tao now accepts file-level `fixture` declarations and named `scenarios` groups for source-owned Studio
examples. Group clauses provide defaults inherited by their scenario entries; an entry may override the
matching subject or environment clause. These declarations are typechecked and emitted into Studio
preview metadata, but ordinary production compilation treats them as metadata and `tao test` does not
execute them yet. In particular, a scenario entry's focused
`render View(Parameter: FixtureHandle)` subject must not be confused with a test check's `run AppName`
subject. See `Tao Studio.md` for the implemented source and manifest contract.

`tao test [path]` discovers inline and sidecar tests, compiles them to structured test-plan IR, and
runs the plans through the repository's runtime Jest harness. Richer filtering, watch, JSON,
artifacts, retries, and alternate device adapters remain future work.

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

A loop row's accessibility label is derived by the interaction outline (see _Accessible names and
the interaction outline_ in `Tao Layout and UI.md`), so `expect label "Chapter one"` inside
`select #drafts[1] { … }` asserts the name the platform reads for that row, and holds only because
the label is derived from what the row renders.

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

Executable steps run in source order:

- `press`, `enter`, and `submit` deliver the corresponding native event to one matched control;
- `press toolbar command "Label"` invokes one enabled command in the focused host toolbar;
- `back` dispatches the same root-safe app reducer as the visible Back affordance and platform
  hardware Back;
- `relaunch`, and `relaunch fresh`, quit the running app and open it again on the same device,
  described below;
- `expect` and `expect missing` inspect the current rendered tree;
- `expect navigation title "Title"` observes the focused host's user-visible title, and
  `expect toolbar command "Label" enabled|disabled` observes one focused toolbar control;
- grouped and tag-scoped expectations run as one plan step;
- `select #tag[N] { ... }` supplies a dynamically re-resolved row scope;
- `advance <duration>` moves the held clock, described below.

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
`packages/runtime/TR-tests/`, and so does the launch-boundary lifecycle a `relaunch` step drives.
The same split holds for persisted state: a relaunch really does read the device again, so a journey
asserting a persisted value across one fails when the round trip through storage is broken, while
the encoding and the storage keys themselves stay with the runtime's persisted-state suite.

Before every check, the runner installs a fresh in-memory snapshot store and prevents the app's
configured snapshot provider from replacing it, so no step reads or mutates durable data (a
fill-capable provider still binds; see `Tao Data.md`). The shipped Memory declaration in
`@tao/data/providers/memory` is bound through the published `TR.DataProvider` connection protocol;
its implementation passes the same `TR.testProvider` empty-load, round-trip,
key/instance-boundary, ordering, and rejection conformance used by other providers.

Driving a provider into `loading`, `error`, or `ready` from a test step is retired (Decisions §16).
The states those steps reached return through the world controls — network, sync, and datasource
fault injection — which have not landed yet.

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
calls, provider-row inspection or fixture/scenario seeding, production datasource access, arbitrary
sleeps, public runtime or test IDs, entity-ID row selection, focused render subjects, and navigation
diagnostic assertions. Those may be connected independently without weakening the current
user-observable testing contract.
