# Tao Presentation and Navigation

Status: authoritative implemented contract for the current WordFlower tranche.

Tao has one renderable declaration kind, `view`, and presentation is a property of each call
site: the same view may compose inline in a render tree, be presented as an overlay, sheet, or
toast, be presented into a nav, or be asked for a typed response. The implemented core hierarchy
is:

```tao
primitive view
primitive scene is view with {
   Title text is ""
   Toolbar list of command is []
   Header boolean is true
}
primitive nav is scene with { implement }
```

`nav` refines `view`, so a configured nav fills any view-typed configuration slot; it is not a
render-bearing declaration, and cannot be embedded as an ordinary render child. Apps mount
navigation; they do not render ordinary content directly.

## Apps and configured navigation

```tao
use Local from @tao/data/providers/local
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

view Home() {
   Title "Home"
   render HomePage()
}

view Settings() {
   Title "Settings"
   render SettingsPage()
}
```

`Name` is display text and `Navigator` is the primary configured nav. `Datasource` configures the
app's provider; Local's storage identity is specified in `Tao Data.md`. App auxiliaries remain valid
for genuine app-specific hosts such as windows. Overlays and toasts never require auxiliary hosts.

Every project has one checked-in opaque `id`. `tao create <id>` creates it and
`tao project id <id> [path]` adds missing metadata; `--replace` deliberately makes a fork independent
and severs persisted-state compatibility. A missing ID is a diagnostic, never a path-, repository-,
lockfile-, or process-derived fallback. Two dependencies with the same project ID but different
project roots are a resolution error.

An app, view, nav, or datasource declaration has canonical owner-defined identity:
project ID, the owning project's checked-in `@package` folder (or the reserved `@workspace` root),
owner-relative module path, declaration kind, and declaration name. Clone location, consumer install
name, remote, branch, and revision do not participate. A public view alias is a lexical declaration
for navigation and diagnostics, but its canonical identity is the final target's; alias chains
flatten, alias cycles are invalid, and a wrapper body is required to create a new authored address.

Configured nav descriptors retain process-local `Symbol` identity as an optimization and add a
canonical structural descriptor for persistence. Universal auto-typed `let` remains equivalent and
may name any of the descriptors above without changing that identity. The
`nav Name = Assignment` and `app Name = Assignment` heads constrain their value
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

## Scenes and host-facing slots

A `scene` is a view that is presented rather than composed. `scene is view`, so everything that
accepts a view accepts a scene; the one thing a scene adds is a fact its body cannot state, and the
render site enforces it — composing a scene inline is an error.

`Title`, `Toolbar`, and `Header` are supplied slots declared by primitive `scene` in the prelude.
They are not compiler-owned metadata and do not make a second kind of view body statement. Keeping
them on `scene` rather than on `view` is what makes chrome nothing reads unrepresentable: a
declaration that is only ever composed cannot name a title. A declaration fills them with the same
capitalized-member form used for other supplied slots:

```tao
scene StoryScreen(Story) {
   Title Story.Title

   action OpenStoryLink() {
      do OpenURL(Story.Url)
   }
   command Open {
      Title "Open story"
      Icon "safari"
      do OpenStoryLink()
   }
   Toolbar { Open }

   render StoryPage(Story)
}
```

A plain view may still be presented. A scene is the way to add chrome, not a requirement for being
presented: a plain view pushed on a `StackNav` is legal and shows Back-only header chrome. Only a
scene is held to filling `Title` at such a placement, because only a scene can fill one.

`Header false` is the explicit opt out, for a scene that owns its whole surface. It removes the bar,
including the Back affordance drawn in it; it does not remove Back, which belongs to the reducer and
stays reachable through the platform gesture and the hardware key. A scene that suppresses its
header may not fill `Title` or `Toolbar` — that chrome would be dead — and is exempt from the
pushed-scene `Title` requirement.

The values are reactive in the presented occurrence. If `Story.Title`, a parameter, a query, or
local state used by a fill changes, the mounted host updates its chrome. A host reads only the view
it directly presents. It never searches descendants, so a wrapper that should carry chrome fills
its own slots and a child's title or toolbar cannot bubble through it. Presentation sites cannot
override these fills.

A `command` is the discoverable verb; the action behind it is a private procedure that names
nothing. `Toolbar` is typed `list of command`, so a toolbar lists commands and only commands — an
action has no title of its own to show. `Tao Actions.md` owns the command declaration itself. A
command written in a view body closes over that view occurrence and is active while the nearest
presentation of the view has focus; a module-level command is a verb for the whole app and must
have every slot filled at the mention, which is why a toolbar lists only commands that need
nothing more. `Toolbar { ... }` lists commands in source order, with optional commas. Native hosts put them in trailing
platform chrome; basic and web hosts render equivalent styled controls. When space is insufficient,
the current mobile/basic header policy keeps the first two controls direct and moves the trailing
suffix into an accessible `More` affordance in the same order. A future wider host may expose more
direct controls without reordering them. A command is never clipped or dropped, and a disabled
command remains visible but inert.

The stdlib host-family contract fixes the current read and requirement sets:

| Host placement                                                                  | Reads              | Requires |
| ------------------------------------------------------------------------------- | ------------------ | -------- |
| every `StackNav` entry, including `Initial` and later pushes                    | `Title`, `Toolbar` | `Title`  |
| reserved `present ... as window` contract, including its full-screen fallback   | `Title`, `Toolbar` | `Title`  |
| `SlotNav`, `SelectionNav`, `SplitNav`, `FrameNav`; root, sheet, menu, and toast | neither            | neither  |

`Toolbar` is optional wherever it is read. Selection item `Label` and `Icon` remain explicit item
configuration, and split-pane configuration is not inferred from child content. Native and basic
implementations of the same family have identical sets. A missing required fill is diagnosed at the
placement, not the declaration: a view remains valid until it is placed in a host that requires the
slot. For example, a push reports that `StoryScreen` is pushed on a `StackNav` and must fill `Title`.

## Self-hosted nav declarations and kits

The stdlib navs are ordinary Tao declarations whose public properties are their complete generic
configuration contract:

Reusable nav types use `type Name is nav with { ... }`. Their explicit protocol-binding clause is
`nav <Export> from <path>`; it fills primitive `nav`'s implementation requirement but is not an
ordinary Tao data property.

The standard package has the same root/native/basic shape as `@tao/ui`. Its native declaration is
ordinary Tao plus a TypeScript protocol binding:

```tao
public
type StackNav is nav with {
   Initial view

   nav StackNavKind from ./NavKinds.ts
}
```

The root transparently republishes that declaration rather than constructing another kind:

```tao
use package ./native

public type StackNav = native.StackNav
```

This configurable-type alias preserves the target declaration's identity, inferred interface,
primitive family, configuration type, host-slot contract, and runtime implementation. Product code
uses `StackNav` from bare `@tao/nav`, which is native by default. A harness or product that wants the
portable rendering imports the same family name from `@tao/nav/basic`; configurations and call sites
do not change.

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
Protocol version 2 owns `configure`, `mount`, `render`, `present`, `dismiss`, `back`, `reset`,
`canGoBack`, keyed activation, and immutable host-slot `reads` and `requires` metadata. Tao's reducer
continues to own occurrence identity, history, overlay precedence, and Back semantics; a host renderer
may drive native transition and chrome machinery without becoming a second navigation state owner. Every implementation
must pass the exported `TR.testNavKind(kind, profile)` common and profile-specific conformance suite.
Every shipped native and basic kind passes that suite.

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
- `SplitNav` requires keyed panes with view-typed `Content` and numeric `Width`. `Resizable` defaults
  to false. A resizable pane renders a runtime-owned drag affordance; a writable state width receives
  drag updates and a portable double-tap resets it to its declared default. A non-writable width still
  resizes for the mounted occurrence but is forgotten on remount.
- `FrameNav` surrounds one navigated center with fixed chrome edges. Its slots are `@top`,
  `@bottom`, `@left`, `@right`, and `@center`, and each takes `Label` text, view-typed `Content`,
  and a numeric `Size`; all three default, so a declared slot may supply none of them. Horizontal
  bars win the corners: `@top` and `@bottom` span the full width and `@left`/`@right` occupy the
  space between them. `left` and `right` are the language's own layout terms and reverse with the
  writing direction. `Size` is the one perpendicular dimension — height on `@top`/`@bottom`, width
  on `@left`/`@right` — and absence means content-derived; `@center` takes no `Size`, because it is
  whatever the edges leave. A slot whose `Content` evaluates to `none` reserves no space and
  contributes no container: the rule is semantic, never measured, and the slot's `Content` is read
  on every render rather than captured when the frame is configured. `present` prefers `@center`,
  Back routes to `@center`'s own navigator, and an edge slot never takes Back even while it holds a
  navigator of its own. A frame's restorable state is each slot's nav state, edges included.

The native `StackNav` maps those reducer-owned entries to the platform stack and header through the
pinned `react-native-screens` host. A native dismissal or gesture reconciles exactly one Tao Back;
overlays still consume Back before content history. The basic stack renders a fixed title/back/toolbar
header and scrollable safe content. On web, the native kit uses that basic chrome, updates
`document.title`, mirrors semantic pushes into same-URL `history.state`, and maps browser Back to one
Tao Back. This is history integration, not routing: internal mount paths are not shareable or
reloadable URLs.

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

Window hosting, routes, deep links, animation policy, public occurrence handles, presentation results,
and lifecycle hooks remain deferred unless a later
WordFlower tier states an explicit future design. The window host's read/require set above is
settled now so its future implementation cannot invent call-site title overrides or different
fallback semantics.

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
parameters. A toast or asked occurrence may take a non-serializable value like an `action` because
neither is restored. A stack, slot, overlay, or sheet presentation may not; when statically known,
the diagnostic belongs to the `present` usage site rather than the view declaration. Unknown,
duplicate, ambiguous, missing, or
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

## Relaunch restoration

Navigation restoration is default-on and host managed. Apps write `Restore` only to deviate:

```tao
app Preview = WordFlower with {
   Restore fresh
}

app WordFlower {
   Restore automatic { Exclude sheets, menus, toasts }
}
```

`Restore fresh` neither reads nor writes host navigation storage. `Exclude` names semantic
presentation categories, not runtime lanes; the accepted words are `sheets`, `menus`, and `toasts`.
Toasts and asked/responding occurrences never restore by language rule. An exclusion is a declared
subtraction applied while snapshotting; a restoration failure never causes an undeclared partial
tree.

The host stores a versioned snapshot of StackNav entries, SlotNav presentation, SelectionNav active
keys and item histories, app auxiliaries, and restorable nav overlays. Every committed reducer
change schedules a coalesced snapshot, and equal payloads suppress writes. A successfully restored
tree must be one the app reducer could have produced. Invalid or version-mismatched data, an
unregistered view, a provider failure, or a nav kind without restoration capability resets the
whole app to its live initial root and emits a warning-level structured diagnostic for tooling.
Applications cannot observe that diagnostic stream. Third-party nav restoration is optional for
now; absence follows this same diagnostic-and-fallback path and does not make the application wrong.

Snapshots are keyed by canonical app identity, app variant, and the complete configured datasource
binding. Provider-owned opaque entity tokens are stored with provider, schema, and entity identity;
restoration reconstructs a live handle whose availability may be loading, available, missing,
unauthorized, or failed. Changing a variant or provider binding therefore cannot consume another
binding's tokens. Arguments containing actions, functions, cycles, or opaque host values are skipped
at snapshot time. There is no Tao serialize, deserialize, migrate, restore hook, or named fallback
destination.

## Back, mounting, and layout

Presenting the same view and semantic arguments again creates a distinct occurrence. Entity-valued
parameters remain live, and navigation hosts subscribe to data revisions. Mounts of the same
descriptor in separate app occurrences remain independent.

The host-owned visible Back affordance, platform hardware Back, native stack gesture, browser Back,
and Tao test `back` step all
dispatch through the same app reducer. The reducer gives app auxiliaries first opportunity, then the
root nav; each nav removes its top overlay before delegating into its content history. Root-safe
Back returns without changing state. A browser stops intercepting at that point so
the browser's own Back leaves the app origin. Each behavior check resets every mounted app and nav
occurrence before it starts.

On a browser host, session history mirrors exactly the mutations Back can consume: StackNav pushes,
SlotNav presentations, overlay presentations, and asked occurrences. Selection activation, toasts,
and root replacement do not add entries. Each mirrored mutation pushes the same URL with only an
opaque per-attachment epoch and monotonic sequence number in a Tao-namespaced `history.state` field;
other occupants' state fields are preserved, and only one mounted app host owns the browser mirror
at a time. Ordinary navigation never manufactures a URL. Browser history is not app state. A
backward sequence delta dispatches Back through the reducer, and any mismatch is re-armed from the
reducer rather than imposed on it. Remounting an app host rebuilds equivalent browser Back depth from
the live in-memory reducer mirror. Replacing the root or resetting the app starts a fresh root epoch.

Forward is an in-memory redo journal. A consecutive Back chain can be replayed in order, creating
fresh occurrences from the retained presentable and arguments; local view state such as scroll
position is therefore not preserved by Forward. A new history-visible mutation truncates the redo
journal, as does a history-free selection change or root replacement because an older replay may
no longer target the same reducer context. A structural third-party selection that keeps its active
key opaque remains Back-capable, but its replays become inert after such an opaque state change
rather than risking cross-item presentation. Back dismisses an asked occurrence as `none`, but
Forward never asks it again because its continuation has already resumed; landing on that
unreplayable entry is inert and re-arms history to the current app state. In-app dismissal reconciles
the matching browser entry so Back and Forward remain as close as the History API permits to
operations the reducer can honor. Positions from an earlier page lifetime carry a different epoch,
resolve to no live journal entry, and are likewise inert. Forward across a reload is not supported.

Whether a view is presented or composed inline is decided where it is used; presenting,
dismissing, replacing, and selection activation are legal in any view body. A configured nav is
mounted at an app root, as an app auxiliary, or as content of another nav; it is not an ordinary
child view. Tags used by Tao tests attach metadata to concrete rendered roots and do not add
navigation or layout nodes.
