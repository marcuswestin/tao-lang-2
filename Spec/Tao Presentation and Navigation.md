# Tao Presentation and Navigation

Status: authoritative implemented contract for the current WordFlower tranche.

Tao separates embeddable `view` values from first-class `ui` values that may enter an app's
presentation tree. A configured `nav` is also presentable. The minimal common role is:

```tao
public type Presentable is ui | nav
```

Apps mount navigation; they do not render ordinary content directly.

## Apps and configured navigation

```tao
use Local from @tao/data
use OverlayNav, StackNav from @tao/nav

app WordFlower {
   Name "WordFlower"
   Navigator StackNav {
      Initial WorkspaceList
   }
   @overlays OverlayNav { }
   Datasource Local with {
      StorageKey "WordFlowerData"
   }
}
```

`Name` is display text. `Navigator` is the primary configured nav. Keyed entries such as
`@overlays` are app-owned auxiliary navs and stable strict targets. `Datasource` configures the app's
provider; Local's explicit storage identity is specified in `Tao Data.md`.

An app value has process-local identity. A configured nav value also has stable process-local
identity: naming it with `let` and mounting or targeting that value refers to the same runtime nav.
Restoration across launches, public occurrence handles, routes, and project IDs remain deferred.

One source module may declare several apps. Generated modules expose a named registry and retain the
selected app as their default export. `run AppName` selects from that registry directly. Ordinary
tooling uses `tao compile PATH --app NAME` and `dev PATH --app NAME`. If a multi-app file is given
without `--app`, an interactive terminal asks which app to use; a noninteractive process fails before
code generation or Expo startup, lists the available names, and gives an actionable `--app` example.
Filename and source order never select an app.

## Navigation containers

The implemented containers are:

- `StackNav { Initial <ui> }`: keeps ordered push history. Covered entries stay mounted but
  hidden visually and from accessibility traversal, preserving their local state.
- `SlotNav { Initial <ui-or-nav> }`: shows one presentable value at a time. Dismissing presented
  content restores its configured initial value.
- `OverlayNav { }`: stacks dismissible content above the covered app tree.

The configured `Initial` value is a presentable, not an invoked rendered element: a `ui` for
StackNav, and a `ui` or `nav` for SlotNav (nav entries inside stacks remain deferred). The initial value
must be mountable without supplied runtime arguments.

Selection, split, window, toast, routes, deep links, restoration, animation policy, navigation
results, and lifecycle hooks remain deferred.

## Presenting, dismissing, and replacing

Presentation is an invocation and always includes parentheses:

```tao
present WorkspaceDetail(Workspace)
present WorkspaceNameNotice() in WordFlower@overlays
present FoundationSlot() in FoundationNavigator
```

With no explicit target, Tao delivers to the nearest enclosing nav that can present the value. An
explicit target is either a configured nav value, an app auxiliary such as `WordFlower@overlays`, or
another statically valid configured target. Targets resolve by identity and must exist; Tao never
falls back to a similarly named or currently visible container.

Arguments use the shared owner binder. `Name: Value` selects a parameter owned by the invoked `ui`;
unlabeled values bind uniquely by exact or nominal type. Unknown, duplicate, ambiguous, missing, or
incorrectly typed arguments are diagnostics, and source order never disambiguates.

`dismiss` delegates to the nearest enclosing nav. It pops an overlay or stack entry and restores a
SlotNav's initial value. Dismissal at a root-safe state changes nothing.

```tao
replace FoundationNavigator in WordFlowerFoundationTest
```

`replace <nav> in <App>` is the app root operation. It replaces that app's mounted root with the
given configured nav; it does not append a stack occurrence.

## Back and identity

Stack occurrences have runtime-private identity. Presenting the same `ui` and semantic arguments
again still creates a distinct occurrence. Entity-valued parameters remain live, and navigation
hosts subscribe to data revisions so presented content observes writes.

The runtime's native Back control, platform hardware back, and Tao test `back` step dispatch through
the same root-safe reducer. Back pops the nearest active stack occurrence and reveals the preserved
covered instance. Each behavior check resets all mounted navigation state before it starts.

## UI and layout boundary

`ui` is presentable content; `view` remains embeddable content. Both use ordinary render and layout
rules internally. A nav is mounted at an app root, as an app auxiliary, or inside another nav; it is
not an ordinary child view. Tags used by Tao tests attach metadata to concrete rendered roots and do
not add navigation or layout nodes.
