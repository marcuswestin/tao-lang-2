# Tao Presentation and Navigation

Status: authoritative implemented contract for the current WordFlower tranche.

Tao has one renderable declaration kind, `view`, and presentation is a property of each call
site: the same view may compose inline in a render tree, be presented as an overlay, sheet, or
toast, be presented into a nav, or be asked for a typed response. The implemented core hierarchy
is:

```tao
primitive view
primitive nav is view with { implement }
```

`nav` refines `view`, so a configured nav fills any view-typed configuration slot; it is not a
render-bearing declaration, and cannot be embedded as an ordinary render child. Apps mount
navigation; they do not render ordinary content directly.

## Apps and configured navigation

```tao
use Local from @tao/data
use SelectionNav, StackNav from @tao/nav

nav HomeStack = StackNav {
   Initial Home
}
nav SettingsStack = StackNav {
   Initial Settings
}
nav WordFlowerNavigator = SelectionNav {
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

An app value and each configured nav descriptor have process-local declaration identity. Universal
auto-typed `let` remains equivalent and may name any of the descriptors above without changing that
identity. The `nav Name = Assignment` and `app Name = Assignment` heads constrain their value
families without erasing the more precise inferred type; they declare values, not reusable types.
Reusable derivation uses `type Name is nav|app with { ... }`. `Type { ... }` constructs a value and
is sugar for `Type with { ... }`, while derivation from an existing value must retain `with`.
Mounting creates occurrence state; targeting
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

Every app value, including variants, must be declared in the entry file; cross-module
variant derivation is unreachable. `run`, imports, and strict app identity accept any complete app
value uniformly whether its declaration uses a primitive `app` head or inferred `let`.

Strict app targets name a complete app value statically and select its running occurrence dynamically.
`present App@key`, `present Ui() in App@key`, and `replace Nav in App` walk the enclosing app chain
for the nearest occurrence with the named declaration identity. The app position may name either a
root app or an in-file complete variant; a variant is a static spelling for its originating app
identity, not a separately targetable declaration. No match is a structured runtime error; target
resolution never mounts or falls back to the named app definition. A strict selection key must exist
on the root app's SelectionNav and every variant of that root declared in the same file.

One source module may declare several apps. Generated modules expose a registry local to that module
and retain the selected app as their default export. `run AppName` selects directly from that module.
Ordinary tooling uses `tao compile PATH --app NAME` and `dev PATH --app NAME`. Without `--app`, an
interactive terminal asks which app to use; a noninteractive process fails before code generation or
Expo startup and lists the available names. Filename, source order, and a global name registry never
select an app.

## Self-hosted nav declarations

The stdlib navs are ordinary Tao declarations whose public properties are their complete generic
configuration contract:

Reusable nav types use `type Name is nav with { ... }`. Their explicit protocol-binding clause is
`nav <Export> from <path>`; it fills primitive `nav`'s implementation requirement but is not an
ordinary Tao data property.

```tao
public
type StackNav is nav with {
   Initial view

   nav StackNavKind from ./NavKinds.ts
}
```

A reusable `nav` type is top-level, declares its visibility, and binds one implementation with
`nav <Export> from <path>`; it is not a render-bearing product declaration. The
binding is package-level in the sense that it belongs to the declaration rather than an app or an
inline configuration. The validator reads property names, types, required values, and an optional
`@key` item contract from the linked declaration. Copied or third-party nav declarations therefore
receive the same validation and compilation without compiler name cases.

The implementation always names a sibling TypeScript sidecar, for example
`nav StackNavKind from ./NavKinds.ts`; the inline fence is retired. The sidecar exports the named
zero-argument factory — a named export, never a default — and the compiler copies and imports it
into generated output and evaluates it once for the declaration.
The resulting value implements the published `TR.NavKind` protocol. Its immutable descriptor keeps
the Tao declaration identity and normalized configuration. Each mount creates independent state.
The protocol owns `configure`, `mount`, `render`, `present`, `dismiss`, `back`, `reset`,
`canGoBack`, and keyed activation; it does not drive native navigation directly. Every implementation
must pass the exported `TR.testNavKind(kind, profile)` common and profile-specific conformance suite.
`StackNav` is the shipped proof that the stdlib itself uses this mechanism.

## Navigation kinds

The implemented declarations are:

- `StackNav { Initial <view> }` keeps ordered push history. Covered entries stay mounted but hidden
  visually and from accessibility traversal, preserving local state.
- `SlotNav { Initial <view> }` shows one presented value at a time. Dismissing presented
  content restores its configured initial value.
- `SelectionNav` requires `Initial @key`, `Display <text>`, and at least one keyed item with `Label`
  text and view-typed `Content`. An item may also supply `Icon` text as system-icon metadata.
  Selecting another key reveals its mounted item without pushing a content occurrence. Inactive
  items stay mounted but hidden, preserving their state.

The configured `Initial` value is a descriptor, not an invoked rendered element. The general
declaration-completeness rule requires every supplied slot to be filled before any declaration is
used as a value. Every `Initial` value and every SelectionNav item `Content` is view-typed;
`nav` refines `view`, so a configured nav fills the same slots.

Selection keys belong to their configured declaration's namespace. `Initial` must name one of its
items. The visible controls use each item's `Label`; `Icon` is preserved in the descriptor while the
current native selection control remains label-rendered. A target-only activation reveals a root
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

`Key` is text and `Duration` is a non-negative duration value such as `3.s`. Presenting the same key replaces the existing toast and restarts its
expiry; different keys coexist. Toasts render above app content, do not consume Back, and are not
plainly dismissible.

Arguments use the shared owner binder. `Name: Value` selects a parameter owned by the invoked view;
unlabeled values bind uniquely by exact or nominal type. A presented view's parameters are ordinary
parameters — an ephemeral presentation such as an overlay or toast may take a non-serializable
value like an `action`. Unknown, duplicate, ambiguous, missing, or
incorrectly typed arguments are diagnostics, and source order never disambiguates.

## Responses, dismissal, and replacement

A view that can answer declares the case set it responds with:

```tao
view ConfirmClose(Document) responds ConfirmResult {
   // ...
   on press -> { respond Confirmed }
}

action CloseDocument() {
   let Result = ask ConfirmClose(Document)
   if Result is Confirmed { dismiss }
}
```

`ask` targets a view that declares `responds`, creates an independent stacked occurrence above the
nearest nav, and suspends only its calling action until that occurrence answers. `respond Case`
supplies the declared case and is legal only in a view that declares `responds`. Bare `respond`,
Back, or plain dismissal answers `none`. Removal completes before the suspended continuation
resumes.

Outside an asked occurrence, `dismiss` delegates to the nearest enclosing nav. It removes the top
overlay, pops a stack entry, or restores a SlotNav's initial value as appropriate. Dismissal at a
root-safe state changes nothing.

```tao
replace FoundationNavigator in WordFlowerFoundationTest
```

`replace <nav> in <App>` is allowed only from an action inside a view declaration. It replaces
that app's mounted root with the given configured nav and does not append a stack occurrence.

## Back, mounting, and layout

Presenting the same view and semantic arguments again creates a distinct occurrence. Entity-valued
parameters remain live, and navigation hosts subscribe to data revisions. Mounts of the same
descriptor in separate app occurrences remain independent.

The visible Back affordance, platform hardware Back, and Tao test `back` step all dispatch through
the same app reducer. The reducer gives app auxiliaries first opportunity, then the root nav; each
nav removes its top overlay before delegating into its content history. Root-safe Back returns
without changing state. Each behavior check resets every mounted app and nav occurrence before it
starts.

Whether a view is presented or composed inline is decided where it is used; presenting,
dismissing, replacing, and selection activation are legal in any view body. A configured nav is
mounted at an app root, as an app auxiliary, or as content of another nav; it is not an ordinary
child view. Tags used by Tao tests attach metadata to concrete rendered roots and do not add
navigation or layout nodes.
