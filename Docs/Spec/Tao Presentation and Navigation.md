# Tao Presentation and Navigation

Status: authoritative implemented contract for the current WordFlower tranche.

Tao has one renderable family rooted at `view`, and presentation is a property of each call site: a
plain view may compose inline in a render tree, be presented as an overlay, sheet, or toast, be
presented into a nav, or be asked for a typed response. A `scene` carries the additional
presented-not-composed rule and host-facing description. The implemented core hierarchy is:

```tao
primitive view
primitive scene is view with {
   Title text is ""
   Toolbar list of command is []
   Header boolean is true
}
primitive nav is scene with { implement }
```

`nav is scene is view`, so a configured nav fills any view-typed configuration slot and may be
rendered at a view site. A nav is still a configured value rather than a render-bearing product
declaration: the render site mounts that descriptor through the navigation host. An app owns one
root through its `view` statement; that root may itself be a nav or an ordinary shell view that
renders a nav-typed parameter.

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

scene Home() {
   Title "Home"
   render HomePage()
}

scene Settings() {
   Title "Settings"
   render SettingsPage()
}
```

`Name` is display text. `Navigator Root` supplies a direct nav root; `view Root(args)` supplies a
view root, mounting a value bound to its arguments in a synthesized slot navigator. A shell uses
`view Shell(WordFlowerNavigator)` and renders that nav inside ordinary layout. `Datasource`
configures the app's provider; Local's
storage identity is specified in `Tao Data.md`. App auxiliaries remain valid for genuine
app-specific hosts such as windows. Overlays and toasts never require auxiliary hosts.

Every project has one checked-in opaque `id`. `tao create` writes it (from `--id` or a confirmed
suggestion) and
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

App variants are immutable launch configurations. A variant may rebind the root view, including a
shell parameter that selects a differently configured navigator:

```tao
app WordFlowerDrawer = WordFlower with {
   Name "WordFlower - Drawer Preview"
   view WordFlowerShell(WordFlowerDrawerNavigator)
}
```

App values are ordinary visible declarations: they may live in any project or package module, and
variants may derive across module boundaries. An unmarked direct `app` remains folder-visible for
source compatibility; explicit `file`, `folder`, `package`, `workspace`, and `public` visibility
otherwise follows the common declaration rules. `run`, imports, and strict app identity accept any
complete app value uniformly whether its declaration uses a primitive `app` head or inferred `let`.

Strict app targets name a complete app value statically and select its running occurrence dynamically.
`present App@key`, `present Ui() in App@key`, and `replace Nav in App` walk the enclosing app chain
for the nearest occurrence with the named declaration identity. The app position may name either a
root app or an in-file complete variant; a variant is a static spelling for its originating app
identity, not a separately targetable declaration. No match is a structured runtime error; target
resolution never mounts or falls back to the named app definition. A strict selection key must exist
on the root app's SelectionNav and every reachable variant of that root.

One source module may declare several apps. Generated modules expose a registry local to that module,
and the module owning the selected app becomes the generated default entry. `run AppName` resolves
the declaration through ordinary local/import visibility.
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
   command Open() {
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
presentation of the view has focus; a module-level command is a verb for the whole app, and a
mention of one is unfilled on purpose — the presenting scene supplies the slot from its own
parameters, matched by type, when the command is invoked. That is what lets one declared verb serve
a row's button and the scene's own chrome without either restating what it acts on. A slot the
scene cannot supply unambiguously — no parameter of that type, or more than one — is reported at
the mention, because a surface cannot choose on the author's behalf. `Toolbar { ... }` lists commands in source order, with optional commas. Native hosts put them in trailing
platform chrome; basic and web hosts render equivalent styled controls. When space is insufficient,
the current mobile/basic header policy keeps the first two controls direct and moves the trailing
suffix into an accessible `More` affordance in the same order. A future wider host may expose more
direct controls without reordering them. A command is never clipped or dropped, and a disabled
command remains visible but inert.

On iOS, native stack headers use the pinned host's system bar-button descriptors: the first two
commands are direct buttons and the remaining suffix is an ordered native `More` menu. Labels,
enabled state and invocation remain Tao command capabilities. Icon metadata is an SF Symbol name;
the descriptor retains its title when UIKit cannot resolve the image. UIKit owns material and
grouping. Other hosts and the explicit toggle keep portable command controls.

The stdlib host-family contract fixes the current read and requirement sets:

| Host placement                                                                | Reads              | Requires |
| ----------------------------------------------------------------------------- | ------------------ | -------- |
| a `scene` entry in `StackNav`, including `Initial` and later pushes           | `Title`, `Toolbar` | `Title`  |
| the same entry when the stack is an item of a `Display "toggle"` selection    | `Title`, `Toolbar` | `Title`  |
| a plain `view` entry in `StackNav`                                            | neither            | neither  |
| reserved `present ... as window` contract, including its full-screen fallback | `Title`, `Toolbar` | `Title`  |
| `SlotNav`, `SelectionNav`, `SplitNav`; root, sheet, menu, and toast           | neither            | neither  |

`Toolbar` is optional wherever it is read. Selection item `Label` and `Icon` remain explicit item
configuration, and split-pane configuration is not inferred from child content. Native and basic
implementations of the same family have identical sets. A missing required fill is diagnosed at the
placement, not the declaration: a view remains valid until it is placed in a host that requires the
slot. For example, a push reports that scene `StoryScreen` is pushed on a `StackNav` and must fill
`Title`. A pushed plain view instead receives Back-only chrome and has no host-facing slots to read.

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
  items stay mounted but hidden, preserving their state. `Display` chooses the surface:
  `"automatic"` is the platform tab bar where the native kit has one, `"tabs"` and `"drawer"` are
  Tao-drawn row and column controls, and `"toggle"` is the single bottom bar described below.
- `SplitNav` requires keyed panes with view-typed `Content` and numeric `Width`. `Resizable` defaults
  to false. A resizable pane renders a runtime-owned drag affordance; a writable state width receives
  drag updates and a portable double-tap resets it to its declared default. A non-writable width still
  resizes for the mounted occurrence but is forgotten on remount.

### The toggle bar

`Display "toggle"` draws one compact bar floating over the bottom edge, the shape Safari uses on
iPhone, and no top bar at all. Back sits on the left and walks the active item through the same
reducer as the platform gesture and hardware Back; it is disabled when there is nothing to go back
to. The middle is a pill holding the visible screen's `Title` and `Toolbar`. The right-hand control
is named by the item it switches to and activates the item after the active one, wrapping, so with
two items a tap alternates between them. Every item keeps its content mounted, and content scrolls
beneath the bar and clears it at the end.

A `StackNav` that is an item's content draws no header under a toggle bar. It still reads the scene
it presents, and hands that scene's `Title` and `Toolbar` to the bar rather than drawing them, so the
title, the toolbar, and Back each appear exactly once. The toolbar keeps its mobile policy — two
direct commands, the ordered remainder behind `More` — and no command is dropped. A scene with
`Header false` hands the bar nothing; an item whose content is a plain view, or whose screen fills no
`Title`, shows the item's `Label`. The native kit renders the bar's surfaces as Liquid Glass on iOS 26
and as a translucent material everywhere the effect is unavailable, with identical behavior.

Persistent chrome around navigated content is not a navigation kind. A shell is a view that renders
its navigator as ordinary content, which the next section describes.

## Rendered navs and the root view

`nav is scene is view`, and a render site may name a nav: a nav declaration, or a parameter of the
owning view whose type is `view`, `scene`, or `nav`. A shell is therefore ordinary layout, and the
app root is a view bound to its arguments, which is how one shell serves every configured navigator:

```tao
app WordFlower {
   Name "WordFlower"
   view WordFlowerShell(WordFlowerNavigator)
}

app WordFlowerDrawer = WordFlower with {
   Name "WordFlower - Drawer Preview"
   view WordFlowerShell(WordFlowerDrawerNavigator)
}

view WordFlowerShell(Navigator nav) {
   render Col() [fill] {
      Navigator() [fill]
      when CurrentSession {
         empty -> { }
         otherwise -> { FocusBar() }
   }  }
}
```

`view Shell(args)` binds the root view's parameters exactly as `Initial Shell(args)` binds a
configured `Initial`, and carries the same argument diagnostics; the bare `view Shell` is the same
reference with nothing to bind. Tao synthesizes the slot navigator that mounts the root view under a
canonical identity derived from the app declaration, so a root-view app restores like any other. An
app variant's patch may rebind the root with the same `view Shell(other)` entry; a root view
statement anywhere else is a diagnostic.

A nav or a parameter renders as the value it was bound to: the render site contributes its layout
clauses and its test tag and passes no arguments, content, or events, all diagnosed at the site. A
view-typed parameter renders as an ordinary occurrence of the view it was bound to. A nav renders
as one mount held by the nearest enclosing navigation occurrence — for a shell, the synthesized
root navigator — and that mount outlives the React tree that rendered it, so covering the shell and
returning to it finds the navigator where it was. The host routes to what it holds: Back reaches a
rendered nav after the host's own overlays and content history; `present @key` reaches a rendered
`SelectionNav` through the host; and the host snapshots each rendered nav by that nav's own
canonical descriptor and restores it when the view mounts it, since a view is the only thing that
renders one. A nav rendered outside any navigation occurrence still mounts once per descriptor.

Three invariants hold at the render site: a nav declaration renders **at most once** across the
workspace and a nav-typed parameter at most once in its view; a nav renders **never inside a loop**;
and **never inside a conditional branch**, because its history lives on its mount and a branch that
unmounted it would silently drop where the person was. A view beside the navigator may be
conditional; only the navigator is held to the rule. A scene composed inline remains a diagnostic —
a nav is the one scene that supplies its own chrome, which is why a render site may name it.

`replace <nav> in app` replaces the app's whole root, the shell view included, because the root is
what the app mounts; the synthesized navigator and every nav its view rendered go with it.

The native `StackNav` maps those reducer-owned entries to the platform stack and header through the
pinned `react-native-screens` host. A completed native dismissal reconciles its dismissed entry count
once; duplicate or stale notifications cannot remove more history, and a canceled gesture changes
no Tao state. Covered stacks disable native gestures and dismissal before an overlay or asked
dialogue can lose its underlying history. Covered page sheets also prevent native swipe dismissal;
Android modal Back consumes the top semantic layer first. App frames and authored scroll views
preserve handled control taps while the keyboard is open. Overlays still consume Back before
content history. The basic stack renders a fixed title/back/toolbar header and scrollable safe
content. On web, the native kit uses that basic chrome, updates
`document.title`, mirrors semantic pushes into same-URL `history.state`, and maps browser Back to one
Tao Back. This is history integration, not routing: internal mount paths are not shareable or
reloadable URLs.

The configured `Initial` value is a descriptor, not an invoked rendered element. The general
declaration-completeness rule requires every supplied slot to be filled before any declaration is
used as a value. Every `Initial` value and every SelectionNav item `Content` is view-typed;
`nav is scene is view`, so a configured nav fills the same view-typed slots and carries scene
chrome when a host presents the nav itself.

Selection keys belong to their configured declaration's namespace. `Initial` must name one of its
items. The visible controls use each item's `Label`; native iOS tabs use `Icon` as an SF Symbol and
Android tabs use supported names through the portable icon mapping, retaining labels for unsupported
icons. Automatic native selection uses the pinned `Tabs.Host` and `Tabs.Screen` contract with stable
item keys and native-owned provenance. Programmatic acknowledgements do not invoke commands again;
reselecting a tab preserves its stack and scroll position. All tab content remains mounted.

On iPadOS 18 and later, automatic navigation selects the system tab/sidebar controller mode. UIKit
owns its window-size adaptation; this does not change `SplitNav` collapse or pane semantics. iOS
retains every destination through its native overflow. Android uses the complete basic selection
surface above five destinations. Missing expected mobile native APIs and Android overflow emit a
structured tooling warning; explicit basic navigation, deterministic behavior checks and web do not.
Native host acceptance rejects fallback. Platform acceptance and outstanding device checks are
recorded in `Docs/Roadmap/Add navigation and routing MVP/Native navigation acceptance.md`.

A target-only activation reveals a root
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
the nav's ordinary content history. An overlay covers the nav that presented it, not the window;
`ask` alone draws at the window level. An entry presented while a native sheet is showing is hosted
by that sheet — it draws inside the sheet's window and the sheet stays showing beneath it — while
Back and `dismiss` still take the top entry first (`Tao Layout and UI.md` § _Safe Area And Keyboard
Insets_ owns the lanes and windows).

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
mounted at an app root, as an app auxiliary, as content of another nav, or as a rendered child of a
view under the rules above. Tags used by Tao tests attach metadata to concrete rendered roots and do
not add navigation or layout nodes.
