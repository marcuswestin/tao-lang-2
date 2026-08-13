# Tao Presentation and Navigation

Status: authoritative implemented contract for the current WordFlower tranche.

Tao separates embeddable `view` values from first-class `ui` values that may enter an app's
presentation tree. A configured `nav` is also presentable. The shared role is declared in Tao:

```tao
public type Presentable is ui | nav
```

Apps mount navigation; they do not render ordinary content directly.

## Apps and configured navigation

```tao
use Local from @tao/data
use SelectionNav, StackNav from @tao/nav

let HomeStack = StackNav {
   Initial Home
}
let SettingsStack = StackNav {
   Initial Settings
}
let WordFlowerNavigator = SelectionNav {
   Initial @home
   Display "automatic"
   @home {
      Label "Home"
      Content HomeStack
   }
   @settings {
      Label "Settings"
      Content SettingsStack
   }
}

app WordFlower {
   Name "WordFlower"
   Navigator WordFlowerNavigator
   Datasource Local {
      StorageKey "WordFlowerData"
   }
}
```

`Name` is display text and `Navigator` is the primary configured nav. `Datasource` configures the
app's provider; Local's storage identity is specified in `Tao Data.md`. App auxiliaries remain valid
for genuine app-specific hosts such as windows. Overlays and toasts never require auxiliary hosts.

An app value and each configured nav descriptor have process-local declaration identity. A `let`
may name a descriptor without changing that identity. Mounting creates occurrence state; targeting
the descriptor resolves its mounted occurrence within the enclosing app. Neither configuration nor
target resolution consults a shipped-name table. Two declarations or generated modules may reuse a
display name without overwriting each other's app or nav definitions.

App variants are immutable launch configurations. A property-position `with` merge-copies the
configured value already held by that property:

```tao
workspace let WordFlowerDrawer = WordFlower with {
   Name "WordFlower - Drawer Preview"
   Navigator with {
      Display "drawer"
   }
}
```

One source module may declare several apps. Generated modules expose a registry local to that module
and retain the selected app as their default export. `run AppName` selects directly from that module.
Ordinary tooling uses `tao compile PATH --app NAME` and `dev PATH --app NAME`. Without `--app`, an
interactive terminal asks which app to use; a noninteractive process fails before code generation or
Expo startup and lists the available names. Filename, source order, and a global name registry never
select an app.

## Self-hosted nav declarations

The stdlib navs are ordinary Tao declarations whose public properties are their complete generic
configuration contract:

````tao
public nav StackNav {
   Initial ui

   implement inject nav ```ts
      return TR.NavKind.Stack()
   ```
}
````

A `nav` declaration is top-level, has `package`, `workspace`, or `public` visibility, and binds one
implementation with `implement inject nav`; it is not a render-bearing product declaration. The
binding is package-level in the sense that it belongs to the declaration rather than an app or an
inline configuration. The validator reads property names, types, required values, and an optional
`@key` item contract from the linked declaration. Copied or third-party nav declarations therefore
receive the same validation and compilation without compiler name cases.

The injected value implements the published `TR.NavKind` protocol. Its immutable descriptor keeps
the Tao declaration identity and normalized configuration. Each mount creates independent state.
The protocol owns `configure`, `mount`, `render`, `present`, `dismiss`, `back`, `reset`,
`canGoBack`, and keyed activation; it does not drive native navigation directly. Every implementation
must pass the exported `TR.testNavKind(kind, profile)` common and profile-specific conformance suite.
`StackNav` is the shipped proof that the stdlib itself uses this mechanism.

## Navigation kinds

The implemented declarations are:

- `StackNav { Initial <ui> }` keeps ordered push history. Covered entries stay mounted but hidden
  visually and from accessibility traversal, preserving local state.
- `SlotNav { Initial <ui-or-nav> }` shows one presentable value at a time. Dismissing presented
  content restores its configured initial value.
- `SelectionNav` requires `Initial @key`, `Display <text>`, and at least one keyed item with `Label`
  text and `Content` presentable. Selecting another key reveals its mounted item without pushing a
  content occurrence. Inactive items stay mounted but hidden, preserving their state.

The configured `Initial` value is a descriptor, not an invoked rendered element. It must be
mountable without runtime arguments. A `StackNav` initial value is a `ui`; a `SlotNav` initial value
and SelectionNav item content may be a `ui` or configured `nav`.

Selection keys belong to their configured declaration's namespace. `Initial` must name one of its
items. The visible controls use each item's `Label`. A target-only activation reveals a root
SelectionNav item without presenting new content:

```tao
present WordFlower@settings
```

Split navigation, windows, routes, deep links, restoration, animation policy, public occurrence
handles, presentation results, and lifecycle hooks remain deferred unless a later WordFlower tier
states an explicit future design.

## Presenting overlays and toasts

Ordinary presentation is an invocation and always includes parentheses:

```tao
present WorkspaceDetail(Workspace)
present FoundationSlot() in FoundationNavigator
```

With no target, Tao delivers to the nearest enclosing nav. An explicit `in <target>` overrides that
scope. A target is a configured nav value or a genuine app auxiliary such as
`WordFlower@windows`; it resolves by descriptor identity and must be mounted in the enclosing app.
Tao never falls back to a similarly named or merely visible container.

Every nav owns an overlay lane. Overlay presentation layers above the nearest enclosing nav, or
above an explicit target when `in` follows the presentation mode:

```tao
present WorkspaceNameNotice() as overlay
present DocumentInfo(Document) as overlay in WorkspaceNav
```

The runtime gives each nav a relative host and an absolute-fill overlay layer above its content.
Overlays stack. Covered overlay entries remain mounted but are hidden visually and from
accessibility; revealing them restores their state. `dismiss` or Back consumes the top overlay before
the nav's ordinary content history.

A toast is app-level, transient, and never accepts `in`:

```tao
present SavedToast() as toast (Key: "document-saved", Duration: 3)
```

`Key` is text and `Duration` is a finite non-negative number of seconds. Unit literals such as
`N.seconds` remain deferred. Presenting the same key replaces the existing toast and restarts its
expiry; different keys coexist. Toasts render above app content, do not consume Back, and are not
plainly dismissible.

Arguments use the shared owner binder. `Name: Value` selects a parameter owned by the invoked `ui`;
unlabeled values bind uniquely by exact or nominal type. Unknown, duplicate, ambiguous, missing, or
incorrectly typed arguments are diagnostics, and source order never disambiguates.

## Dialogue, dismissal, and replacement

A dialogue declares the enum it can answer:

```tao
dialogue ConfirmClose Document responds ConfirmResult {
   // ...
   on press -> { respond Confirmed }
}

action CloseDocument {
   let Result = ask ConfirmClose(Document)
   if Result is Confirmed { dismiss }
}
```

`ask` creates an independent stacked occurrence above the nearest nav and suspends only its calling
action until that occurrence answers. `respond Case` supplies the declared enum case. Bare `respond`,
Back, or plain dismissal answers `none`. Removal completes before the suspended continuation resumes.

Outside a dialogue, `dismiss` delegates to the nearest enclosing nav. It removes the top overlay,
pops a stack entry, or restores a SlotNav's initial value as appropriate. Dismissal at a root-safe
state changes nothing.

```tao
replace FoundationNavigator in WordFlowerFoundationTest
```

`replace <nav> in <App>` replaces that app's mounted root with the given configured nav. It does not
append a stack occurrence.

## Back, mounting, and layout

Presenting the same `ui` and semantic arguments again creates a distinct occurrence. Entity-valued
parameters remain live, and navigation hosts subscribe to data revisions. Mounts of the same
descriptor in separate app occurrences remain independent.

The visible Back affordance, platform hardware Back, and Tao test `back` step all dispatch through
the same app reducer. The reducer gives app auxiliaries first opportunity, then the root nav; each
nav removes its top overlay before delegating into its content history. Root-safe Back returns
without changing state. Each behavior check resets every mounted app and nav occurrence before it
starts.

`ui` is presentable content and `view` is embeddable content. Both use ordinary render and layout
rules internally. A configured nav is mounted at an app root, as an app auxiliary, or as content of
another nav; it is not an ordinary child view. Tags used by Tao tests attach metadata to concrete
rendered roots and do not add navigation or layout nodes.
