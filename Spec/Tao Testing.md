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
   check "starts empty" {
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
never choose it. Focused `render` subjects, authored row seeding, remote-provider adapters, and
direct action/value tests remain deferred.

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

Global selectors use exact normalized user-visible text, accessibility labels, or placeholders:

```tao
press text "Save"
enter "Home" into label "Workspace name"
submit placeholder "Workspace title"

expect text "Saved"
expect missing text "Loading…"
expect input label "Workspace name" value "Home"
```

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
- `back` dispatches the same root-safe app reducer as the visible Back affordance and platform
  hardware Back;
- `expect` and `expect missing` inspect the current rendered tree;
- grouped and tag-scoped expectations run as one plan step;
- `select #tag[N] { ... }` supplies a dynamically re-resolved row scope.

Each event runs inside React's `act` boundary so synchronous Tao state, data, and navigation updates
settle before the next step. Assertions do not currently poll or sleep.

Overlay and toast journeys use the same ordinary interaction and assertion vocabulary; they are no
longer deferred test subjects. Every nav's overlay lane sits absolutely above its content. Stacked
overlay occurrences remain mounted, while all but the top occurrence are hidden visually and from
accessibility. A product `dismiss` action and visible, hardware, or test Back all enter the runtime's
navigation reducers; the top overlay is consumed before covered content, and a root-safe request is
inert. Covered stack and selection content likewise stays mounted, so a later assertion can observe
its preserved local state.

A toast is app-level and transient. Different keys coexist, while presenting the same key replaces
the prior occurrence and restarts its numeric-seconds duration. Toasts do not consume Back or plain
dismissal. Tests may assert their immediate rendered state and keyed replacement; deterministic
expiry testing remains deferred until the runner has an explicit clock or wait contract.

The launched app's active datasource can be driven without naming its catalog:

```tao
data loading
data error "Local storage is unavailable"
data ready
```

Memory is the shipped `@tao/data` declaration bound through the published `TR.DataProvider`
full-snapshot protocol. Its provider implementation passes the same `TR.testProvider` empty-load,
round-trip, key/instance-boundary, ordering, and rejection conformance used by other providers.
Before every check, the runner installs a fresh Memory instance and prevents the app's configured
Local binding from replacing it, so these steps do not read or mutate durable data.
Catalog-qualified status syntax is retired; any future multi-datasource test model must introduce
an explicit new targeting contract rather than reviving schema-qualified steps.

## Compiler/runtime boundary

The compiler emits structured IR containing suite/check names and source locations, the selected app
name and source module, ordered action/assertion steps, selector descriptions, expectation groups,
row scopes, and datasource status changes. The test compiler resolves that declaration to a unique
generated module path. The runtime loads that module directly; it does not resolve apps through a
process-global name table. Generated navigation targets also refer to the owning module's app
declaration binding, so same-named apps remain isolated regardless of compilation or execution
order. The compiler does not emit test-runner calls into app code.

The runtime adapter owns app launch, input events, selection, assertions, settling, reset, and error
formatting. Failures identify the suite, check, step, and Tao source location. This boundary allows
future web, native-device, or simulator adapters to execute the same plan without changing Tao test
syntax.

## Non-goals

The implemented surface intentionally omits direct state/value assertions, direct action calls,
provider-row inspection or seeding, production datasource access, arbitrary sleeps, public runtime
or test IDs, entity-ID row selection, focused render subjects, and navigation diagnostic assertions.
Those may be designed independently without weakening the current user-observable testing contract.
