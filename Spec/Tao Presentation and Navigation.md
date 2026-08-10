# Tao Presentation And Navigation

Status: authoritative intended design. This specification defines the target language and runtime behavior. The navigation surface is not implemented yet; the current parser/runtime must not be read as contradicting or completing this contract.

The rationale, implementation order, and decision traceability live in `Roadmap/Add navigation and routing MVP/Research - Add navigation and routing MVP.md`. `Roadmap/Add navigation and routing MVP/.tao-future/Writer.tao` is the complete intended usage sketch, not an executable conformance fixture yet.

## Roles

Tao separates reusable visual content, presentable content, navigation containers, and response-demanding conversations:

- `view` defines reusable UI content. It may be embedded in a `view`, `ui`, or `dialogue`.
- `ui` defines content that may enter an app's presentation tree.
- `nav` defines a native-backed or Tao-composed container that holds presentables and owns navigation policy.
- `dialogue` defines response-demanding UI invoked with `ask`.

`ui` and `nav` are distinct types. Their shared sum is:

```tao
type Presentable is ui | nav
```

This allows composition without making a nav renderable as ordinary UI. A nav may be mounted only as an app navigator, an app auxiliary, or a child of another nav. Rendering a nav inside a `view` or `ui` is a validation error.

A Tao-defined nav renders exactly one root nav descriptor:

```tao
nav WorkspaceNav {
   Workspace Data.Workspace

   render Nav.SplitNav {
      // keyed pane properties
   }
}
```

Each conditional branch in that render must produce one nav descriptor. Fallback visual content belongs in a UI mounted by a nav, not beside the nav descriptor.

## Definitions And Configured Values

`app`, `ui`, `nav`, and `dialogue` definitions are configurable declaration values. UI, nav, and dialogue definitions are callable with their public properties; an app is complete when declared and may be copied with `with` into another launch configuration. All follow the binding rules in `Tao Type System.md`.

```tao
ui DocumentEditor {
   Document Data.Document
   optional Mode EditorMode
   let Title = Document.Title

   render Editor Document
}
```

Applying every required public property creates an immutable configured descriptor:

```tao
let Editor = DocumentEditor Document
let ReadOnlyEditor = Editor with { Mode "read-only" }
```

`with` copies the descriptor and replaces public properties. It does not mutate the source. Internal `let` bindings such as `Title` are derived implementation details and cannot be patched.

Partial application is not part of this design. An invocation either supplies every required property or is invalid. A definition may still be passed where a callable definition type is explicitly expected.

Every property of a configured `ui` or `nav` must be restorable. Validation occurs when the descriptor is formed, not only when it happens to be presented.

## Identity

Navigation uses three separate identities:

- **Semantic identity** identifies configured content by stable declaration identity and normalized identity-bearing properties.
- **Occurrence identity** identifies one presentation of a semantic value. A stack may contain multiple occurrences with the same semantic identity.
- **Mount identity** identifies an occurrence at one stable path in one active app or scene instance.

A `let` name is not identity. It names a value. Canonical descriptor equality includes every normalized public property, including non-semantic presentation metadata. Equivalent bindings evaluate to equal descriptors and can locate a mounted nav only when exactly one active mount has that equal descriptor. This full-value comparison is distinct from semantic identity, which nav policies use to decide whether content represents the same destination.

Public properties on a user-defined UI or nav participate in semantic identity by default. Standard navigation descriptors classify placement metadata separately: labels, icons, badges, display mode, overlay layout, pane sizing, and window title update presentation without creating different semantic content. `Key` on `Occurrence`, `Toast`, or `Window` distinguishes occurrence identity; it is not content identity. User-defined identity metadata is deferred as `DEF-NAV-015`.

Defaults are normalized into a configured value before semantic identity is computed. Changing a later package default therefore cannot silently change the identity of restored state.

A stable declaration ID is derived from a logical Tao project ID, package, module path, declaration kind, and declaration name. `tao create` generates the project's immutable opaque ID in checked-in project metadata. That ID travels with clones and published artifacts and never depends on the local filesystem path, display name, remote URL, or current commit. A fork that intends to become an independent Tao project must explicitly regenerate its ID. Dependencies use the required project's logical ID, not its resolved revision, so an ordinary dependency update does not rename every declaration it exports. The declaration-ID algorithm itself is versioned; the presentation-state schema and migrations, rather than declaration identity, account for incompatible source revisions. Source offsets and declaration order never participate. Renaming or moving a declaration is therefore a presentation-state schema change unless a later migration facility maps the old ID.

Canonical descriptor construction is recursive and deterministic. Properties are ordered by owner-qualified slot identity; omitted optionals normalize to `none`; omitted defaults normalize to their explicit values; lists preserve order; keyed objects preserve stable keys and entry order; nested descriptors use their canonical form; and entity references normalize to stable identity tokens rather than current entity fields. These rules define descriptor equality and hashing across compiler runs and process restarts.

## App Ownership

Every app has an implicit root host. The host owns restoration, deep-link transactions, native scene coordination, and replacement of the entire presentation tree. It draws no chrome itself.

The built-in app property surface requires `Name text` and `Navigator nav`. `Auxiliaries { @ nav }` is optional and normalizes to an empty keyed object. Auxiliary registration is part of the full target model but is not in the first Slot/Stack implementation slice.

The app declares one primary navigator and may explicitly register auxiliary navigators:

```tao
app Writer {
   Name "Writer"

   Navigator Nav.StackNav {
      Initial HomeUi
   }

   @overlays Nav.OverlayNav {}
   @toasts Nav.ToastHost {}
   @windows Nav.WindowHost {}
}
```

The direct keyed entries bind to `Auxiliaries`. `Auxiliaries { ... }` remains the explicit form, but the property name is descriptor structure rather than a navigation path segment.

Declaring, importing, or binding a nav does not mount it. An auxiliary exists only when registered by an app or, in a future multi-scene model, by a scene root.

`run` accepts a complete configured app value, including one produced with `with`. Rooted targets still use that value's originating app declaration ID.

Static keys such as `@overlays` are stable parts of persisted mount paths. Renaming one is a presentation-state schema change.

## Navigation Targets

A navigation target denotes an active nav mount or targetable placement wrapper. It is not a parent-component reference and does not expose provider instances.

### Rooted targets

A rooted path begins with the active app or scene and follows stable keyed entries:

```tao
Writer@workspace@documents
Writer@windows
```

Targetable entries are scoped to their directly owning configured declaration and must be unique within that owner. Nested configured declarations begin new key scopes, so the same spelling may recur at a different path depth. Keyed property names are never path segments: `Writer@workspace@documents` is valid, while `Writer.Auxiliaries@overlays` and `Writer@workspace.Panes@documents` are not navigation targets.

The runtime may follow active content transparently between explicit segments. Every named segment must still exist on the resolved path.

The root name identifies the originating `app` definition, not the exact configured descriptor. A value derived with `Writer with { ... }` therefore remains addressable through `Writer@...` when it is the active app. The current implementation slice permits one active instance of that app definition; future multi-scene support must add scene/instance qualification rather than making this path ambiguous silently.

### Relative targets

A relative path begins at the nearest enclosing nav context:

```tao
present InspectorUi Paragraph in @inspector
```

Relative resolution captures the origin mount's ancestor chain and searches from the innermost owning nav outward. At each ancestor layer, the first path segment may match a targetable keyed wrapper directly owned by that nav, including configured inactive Selection items and collapsed Split panes because activation may reveal them. The first ancestor layer with a match wins; a nearer owner shadows the same key on an outer owner. Zero matches fail. Duplicate matches under one owner violate the owner-key uniqueness invariant and are rejected when the descriptor forms or when invalid restored/runtime data is encountered. Remaining segments then resolve strictly downward from the matched wrapper, transparently following active content where the path omits an unkeyed nav.

### Configured-value targets

A configured nav value may locate its active mount:

```tao
let WorkspaceSlot = Nav.SlotNav { Initial WorkspaceChooserUi }

present DocumentEditorUi Document in WorkspaceSlot@documents
```

The binding is evaluated to its descriptor. Resolution succeeds only if exactly one active mount has that descriptor. Mounting the same descriptor twice requires an explicit rooted or relative path.

### Compiler-created keyed targets

Entries such as selection items and split panes create targetable placement wrappers. Their identities and forwarding behavior are derived by the compiler from the owner descriptor, static key, and mount path. The user does not need to spell a wrapper instance:

```tao
Nav.SplitNav {
   @documents {
      Content Nav.StackNav { Initial DocumentListUi Workspace }
   }
}
```

Targeting `@documents` reveals the pane and forwards the operation to its `Content` nav. Relative resolution selects the nearest owning namespace containing that key.

A targetable keyed entry exposes its owner-qualified key value throughout the containing invocation, independent of source order. `Initial @home` therefore refers to the `@home` entry assigned to that SelectionNav's `Items`, not to an unscoped global value. The compiler retains `Items` and `Panes` in descriptor data while omitting those property names from mounted target paths.

The `@` marker means an owner-scoped name across Tao, but it does not erase role distinctions. Navigation keys are configured data entries; UI render slots are declared content channels. Direct names occupy one namespace within their configured owner, and validation rejects duplicates or any name that could bind to both a slot and an open keyed property. Direct keyed-entry elision is valid only when exactly one property can accept the entry; otherwise callers must write the property block explicitly. Render slots never participate in navigation paths.

### Strictness

Explicit targets are strict. A missing, ambiguous, incompatible, or unmounted target produces a structured diagnostic. Tao never falls back to another nav for an explicit target.

An omitted target is contextual rather than best-effort. Resolution starts at the nearest enclosing nav, asks it to handle the operation, and delegates outward according to the deterministic nav policies below. If no nav handles the operation, the operation fails with an unhandled-operation diagnostic.

Each source event retains its origin nav ancestry. If an earlier operation removes the origin occurrence, a later omitted-target operation resumes at the nearest still-mounted ancestor from that captured chain; it never adopts a replacement occupant as its new origin. If no captured nav ancestor survives or accepts the operation, the reducer emits `source-origin-unmounted` or the normal unhandled-operation diagnostic. Explicit targets always resolve against the current tree and remain valid after origin removal.

## Presentation Operations

### Present content

`present` is non-blocking. It delivers a configured presentable to a nav:

```tao
present WorkspaceDetailsUi Workspace
present DocumentEditorUi Document in Writer@workspace@documents
```

The receiving nav decides whether delivery pushes, replaces a slot, selects an item, opens an overlay, or opens/focuses a window. The action continues after the semantic tree update; it does not wait for native animation or eventual dismissal.

### Activate a target

When `present` receives only a target path, it activates and reveals the existing destination without changing its content:

```tao
present Writer@workspace
present @inspector
```

This is selection/reveal, not content delivery.

Target-only activation is syntactically limited to paths containing at least one `@` segment. A bare configured nav expression after `present`, such as `present WorkspaceNav`, is always content delivery; its meaning never changes according to current mount count. Configured nav values act as targets after `in`, with or without descendant path segments.

### Replace

`replace Value in Target` asks a nav to replace according to that nav's policy:

```tao
replace PreviewUi Document in Writer@workspace@inspector
```

Targeting an app replaces its primary navigator and resets the previous presentation tree, including navigation history:

```tao
replace SignedOutNav in Writer
```

App-root replacement also clears transient auxiliary state and closes active overlays, toasts, and windows before the new primary tree becomes active. The app's configured auxiliary registrations remain available for subsequent presentations.

The implicit app host accepts only `replace <nav> in <App>`. Delivering with `present ... in <App>`, replacing the root with a `ui`, and `dismiss in <App>` are incompatible operations. A rooted path below the app, such as `Writer@workspace`, targets the addressed descendant normally.

### Dismiss

`dismiss` asks the nearest enclosing nav to remove or leave the current occurrence. `dismiss in Target` addresses a specific nav context:

```tao
dismiss
dismiss in Writer@overlays
```

Dismissal is not a silent no-op. A nav either handles it, delegates it, or produces an unhandled-operation diagnostic after delegation is exhausted.

### Results

`present`, `replace`, and `dismiss` return no user-visible value in the initial design. Internal occurrence IDs and provider acknowledgements exist for reducer correctness and diagnostics only. Public handles or immediate status values are deferred.

## Standard Navigation Policies

All standard navs implement the same semantic operation protocol even though they apply different policies.

| Nav                    | Initial state              | `present Value`                                | `replace Value`                               | `dismiss`                                         |
| ---------------------- | -------------------------- | ---------------------------------------------- | --------------------------------------------- | ------------------------------------------------- |
| Implicit app root      | Required primary navigator | Incompatible                                   | Replace primary with a nav and reset the tree | Incompatible                                      |
| `SlotNav`              | Optional `Initial`         | Set active content                             | Set active content                            | Restore/clear changed content; otherwise delegate |
| `StackNav`             | Required `Initial`         | Push a new occurrence                          | Replace top occurrence                        | Pop; delegate when at root                        |
| Static `SelectionNav`  | Configured keyed items     | Delegate into active item                      | Delegate into active item                     | Delegate from active item                         |
| Dynamic `SelectionNav` | Optional dynamic entries   | Focus semantic identity or create entry        | Replace addressed entry                       | Close dynamic entry or delegate                   |
| `SplitNav`             | Configured keyed panes     | Requires a pane target or unique child handler | Same                                          | Delegate through addressed pane                   |
| `OverlayNav`           | Optional `Initial`         | Stack overlay occurrence                       | Replace top overlay                           | Remove top overlay                                |
| `ToastHost`            | Empty                      | Show or refresh toast occurrence               | Replace addressed toast                       | Hide addressed or latest toast                    |
| `WindowHost`           | Empty                      | Open or focus window occurrence                | Replace addressed window content              | Close addressed window                            |

Delivered values have these compatibility rules:

| Delivered value  | General content navs             | Dynamic `SelectionNav` | `ToastHost`                  | `WindowHost`                  |
| ---------------- | -------------------------------- | ---------------------- | ---------------------------- | ----------------------------- |
| Configured `ui`  | Accepted according to nav policy | Accepted               | Accepted as implicit `Toast` | Accepted as implicit `Window` |
| Configured `nav` | Accepted according to nav policy | Accepted               | Incompatible                 | Accepted as implicit `Window` |
| `Nav.Occurrence` | Incompatible                     | Accepted               | Incompatible                 | Incompatible                  |
| `Nav.Toast`      | Incompatible                     | Incompatible           | Accepted                     | Incompatible                  |
| `Nav.Window`     | Incompatible                     | Incompatible           | Incompatible                 | Accepted                      |

Static Selection and Split do not consume delivered content themselves; they forward to their active or explicitly addressed child, which then applies this matrix. `Occurrence` is initially supported only by Dynamic Selection.

Occurrence and mount IDs follow these lifecycle rules:

| Transition                                           | Identity behavior                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Slot set, replace, or restore Initial                | Retire the previous content occurrence and allocate a new occurrence, even for equal semantic content |
| Stack present                                        | Allocate a new occurrence                                                                             |
| Stack replace top                                    | Retire the top and allocate a new occurrence                                                          |
| Stack dismiss                                        | Retire the top; preserve the revealed occurrence and mount IDs                                        |
| Static Selection activation or Split reveal/collapse | Preserve configured child occurrence and mount IDs                                                    |
| Dynamic Selection semantic focus                     | Preserve the matching item and child IDs                                                              |
| Dynamic Selection new semantic identity              | Allocate a new item and child occurrence                                                              |
| Dynamic Selection keyed update                       | Preserve the keyed item wrapper; replace its child occurrence only when content changes               |
| Overlay present/replace/dismiss                      | Present allocates; replace retires and allocates; dismiss retires                                     |
| Keyed Toast refresh                                  | Preserve occurrence ID, increment generation, and replace content metadata                            |
| Window semantic/key focus                            | Preserve the window occurrence; replace its child occurrence only when content changes                |
| App-root replace                                     | Preserve the implicit app host; retire and recreate the entire primary and auxiliary occurrence tree  |

Mount IDs incorporate occurrence identity and stable path, so replacing a child cannot inherit callbacks intended for the retired child. Retired occurrence and mount IDs are never reused during one app instance.

Outside code does not yet address a dynamic Toast, Window, or Dynamic Selection occurrence by interpolating its runtime key into a mounted path. `present` with the same key focuses or updates it; contextual `replace` or `dismiss` affects the originating occurrence, while an operation targeting only the host affects its focused/latest occurrence. General key-based occurrence targeting is deferred as `DEF-NAV-016`.

### Slot and stack

`SlotNav` is the explicit one-place replacement container. Dismiss restores a different `Initial`, or clears content when the initial value is absent. If the slot is already at its initial/empty state, dismissal delegates outward instead of reporting a handled no-op. `StackNav` always has an initial presentable and creates a new occurrence for every push, even when semantic identity matches an existing occurrence.

### Selection

A static selection has an ordered, nonempty keyed object of items and an `Initial` value whose type is `key of Items`. Targeting an item activates it and reveals any ancestors. Untargeted operations delegate into the active item's content.

Selection item UI content is normalized to `SlotNav { Initial Content }`; nav content is mounted directly. This gives every targetable item one receiving child nav without making UI a nav.

A dynamic selection may begin with empty items and no initial key, then receive new presentables. If it supplies `Initial`, that value must still be a key of its configured Items. It focuses an existing semantic identity by default and creates an entry when none exists. An explicit occurrence key distinguishes multiple entries with equal semantic identity.

`Display "automatic"` lets the provider choose tabs, sidebar, navigation rail, or drawer from platform and available space. Explicit `"tabs"`, `"sidebar"`, `"rail"`, and `"drawer"` request supported native chrome without changing selection semantics.

### Split

A split owns keyed panes and layout metadata. Each pane contains a nav. Targeting a pane reveals collapsed ancestors and forwards into its content. `SplitNav` itself does not guess whether a delivered UI should replace or push; its child nav owns that choice.

Untargeted delivery that reaches a split with no unique active receiver is an error. This prevents layout structure from silently choosing application behavior.

Delegation traverses directed mount edges and records visited mounts. A delivery entering Selection or Split from its parent may move inward through one selected or addressed child. If that child returns unhandled, traversal resumes strictly outward from the container's parent and cannot re-enter any visited child. An operation originating inside a child similarly continues outward when the child declines it. This prevents Selection/Stack and Split/child cycles.

### Overlays

An overlay is ordinary non-blocking presentation above current content. Overlay presentations stack and are dismissible by default. Layout metadata may request a sheet, popover, full-screen overlay, palette, inspector, or floating panel, subject to platform support.

Overlay presentation is not a dialogue and never returns a user response.

### Toasts

A toast host accepts restricted transient UI. Toast content is small, timed, non-navigational, and cannot contain another nav. A key may refresh or replace an existing toast; otherwise presentations create transient occurrences. Presenting an ordinary configured UI to `ToastHost` is shorthand for a `Toast` with default metadata.

The Tao runtime, not the native provider, schedules toast expiration as a semantic input event carrying host mount ID, occurrence ID, and generation. Refreshing a keyed toast increments its generation and invalidates the prior timer. A stale expiration event is ignored; a current one removes the occurrence through the reducer. A provider that observes native early dismissal reports the same semantic intent rather than mutating local authoritative state.

### Windows

`WindowHost` owns top-level native windows. `Nav.Window` describes one window occurrence:

```tao
present Nav.Window {
   Content DocumentEditorUi Document
   Key "comparison-left"
   Title Document.Title
} in Writer@windows
```

Reusing a key focuses or updates the matching occurrence. Distinct keys permit multiple windows with semantically equal content. Passing an ordinary configured UI or nav to a window host is shorthand for `Nav.Window { Content ... }` with semantic-identity focus behavior.

`Window` is accepted only by `WindowHost`, `Toast` only by `ToastHost`, and `Occurrence` only by navs that support identity-based focus. A statically known incompatible target is a validation error; a contextual operation whose receiving nav is known only at runtime produces an incompatible-target diagnostic. These wrappers cannot be used to smuggle native windows or transient toasts into a stack or ordinary UI.

Advanced geometry and multiple-scene ownership are deferred.

## Semantic Reducer And Native Providers

Tao owns one semantic presentation tree. Every operation in one event reduces that tree synchronously and in source order:

```tao
on select -> Document {
   present WorkspaceNav Workspace in Writer@workspace
   present DocumentEditorUi Document in Writer@workspace@documents
}
```

The second statement sees the semantic result of the first. A source event has a unique event ID, originating mount ID, and ordered operation sequence. Each operation also carries its configured value, optional target, and current semantic revision. Nested named actions inherit the same origin and synchronous event transaction.

Each successful source-ordered operation advances the semantic revision. If a later operation in the same action fails, earlier successful operations remain applied and the failure emits a diagnostic; Tao does not imply transaction rollback. Providers reconcile only the final snapshot produced by that source event unless a future explicit transaction feature specifies otherwise.

Native providers receive the resulting revisioned snapshot and reconcile native components after the event's semantic updates. They do not maintain a second authoritative navigation model.

Native back, tab/drawer selection, interactive overlay dismissal, pane collapse, and window close are semantic input events, not provider acknowledgements. Each has a unique native event ID, affected mount ID, and observed revision. The reducer deduplicates by event ID, then revalidates the affected mount against the current tree. It applies an intent that is still meaningful to current state; if the occurrence no longer exists or is incompatible, it emits a stale-native-event diagnostic without transitioning a different occurrence. An old observed revision alone never causes Tao to discard a real user intent silently.

Provider acknowledgements use a separate envelope containing provider operation identity and the semantic snapshot revision being acknowledged. Duplicate or stale acknowledgements are harmlessly ignored and never re-enter navigation policy. This separation makes reconciliation idempotent without conflating user input with transport completion.

Native Back delegates through Stack, Slot, and ancestor policies. If it reaches the implicit app host with nothing left to dismiss, the host emits the platform's normal root-back effect, such as backgrounding or exiting on Android. A user-authored `dismiss in App` remains incompatible and never masquerades as process control.

A provider injection receives a compiler-supplied payload containing the canonical nav descriptor and public properties, its mounted semantic subtree, the current revision, and provider operation IDs. Its only navigation callbacks are `dispatchNativeIntent`, `acknowledgeProviderOperation`, and `rejectProviderOperation`; each constructs the corresponding envelope defined above. It has no ambient access to Tao scope or unresolved references. Compiler output calls shared TR navigation APIs; it does not emit a reducer implementation per app. Unsafe native code is separately marked and cannot establish restoration, targeting, or completion guarantees by itself.

A runtime provider rejection does not roll back already committed Tao operations. The reducer records a structured provider-failure diagnostic and marks the affected mount unrealized for that revision. The app host renders a standard recoverable provider-error surface at that mount while the latest semantic tree remains authoritative. A later compatible revision or explicit retry may reconcile it. Build- or launch-time validation still rejects provider incompatibility that can be proven before execution.

The reducer reserves extension points for transition guards and lifecycle events. Exact source syntax for unsaved-change interception, focus/blur, appear/disappear, queueing, and cancellation is deferred.

## Restoration

Presentation properties must be restorable, not merely serializable. Tao must reconstruct an equivalent semantic presentation after process termination, app restart, state restoration, deep linking, or handoff.

Valid properties include:

- Primitive serializable values.
- Serializable records and lists whose nested values are restorable.
- Entity IDs and entity references.
- Cached entity values.
- Explicit entity snapshots.

Invalid properties include actions and functions, whether inline or named, closures, native handles, component instances, ephemeral provider objects, and any value whose meaning cannot survive restart. Reusable callback-taking content remains valid as a `view` composed internally by a UI; callable values cannot configure the UI or nav descriptor itself.

Bare entity values use reference semantics. Tao persists identity and restores the current entity through cache or provider. Explicit `snapshot Entity` requests captured-value semantics.

A restored entity reference may be loading, available, missing, unauthorized, or failed. UI receiving an entity reference must be able to represent those states. Deletion does not make the descriptor structurally unrestorable; it produces the missing state.

Persisted presentation state includes:

- A schema version.
- Stable declaration IDs.
- Normalized descriptor properties.
- Static item and pane keys.
- Explicit occurrence keys and generated occurrence IDs.
- Active mounted paths, selection, and ordering.
- Provider-independent layout state needed for equivalent semantics.

Valid restored state takes precedence over `Initial` values. Invalid or incompatible state is rejected with a structured restoration diagnostic and the app starts from its current valid initial tree. Custom migrations are deferred.

Toast occurrences and active dialogues are never restored. Overlay and Window restoration policy is deferred as `DEF-NAV-014` and must be decided before their provider projects persist presentation state.

## Dialogue

Dialogue is a separate later implementation slice:

```tao
dialogue ConfirmClose responds ConfirmResult {
   Document Data.Document

   render Col {
      Button "Close", on press -> { respond "confirmed" }
      Button "Cancel", on press -> { respond }
   }
}

let Result = ask ConfirmClose Document
```

`ask` is the explicit suspension point. `present` cannot accept a dialogue, and `respond` is valid only inside a dialogue. A dialogue declares its successful result type; every `ask` currently infers an optional result so bare `respond`, platform cancellation, and dismissal produce `none`.

Initial suspension is process-local. Process termination abandons the continuation and active dialogue. Durable suspended workflows require explicit application state until a separate continuation model is designed.

## Diagnostics

The following failures are required behavior:

| Failure                                                                 | Phase                                         | Result                                          |
| ----------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| Nav rendered inside ordinary UI                                         | Validation                                    | Invalid nav placement error                     |
| Unbound required descriptor property                                    | Validation                                    | Incomplete configuration error                  |
| Ambiguous property or argument binding                                  | Validation                                    | Ambiguous binding error listing candidate slots |
| Static Selection has empty Items, no Initial, or an unknown Initial key | Validation                                    | Invalid-selection-configuration error           |
| One owner declares the same targetable key more than once               | Validation                                    | Duplicate-owner-key error                       |
| Direct keyed entries have more than one compatible property assignment  | Validation                                    | Ambiguous-keyed-property error                  |
| A keyed collection key escapes its configured collection                | Validation                                    | Invalid-key-scope error                         |
| Non-restorable UI/nav property                                          | Validation                                    | Non-restorable presentation property error      |
| Statically impossible target                                            | Validation                                    | Invalid target error                            |
| Explicit target has zero active matches                                 | Runtime                                       | Target-not-found diagnostic; no fallback        |
| Explicit target has multiple active matches                             | Runtime                                       | Ambiguous-target diagnostic; no transition      |
| Target nav cannot accept the operation/value                            | Validation when provable, otherwise runtime   | Incompatible-target diagnostic                  |
| Contextual operation exhausts delegation                                | Runtime                                       | Unhandled-operation diagnostic                  |
| A source event removes its origin and no captured ancestor survives     | Runtime                                       | Source-origin-unmounted diagnostic              |
| Native provider cannot realize required semantics                       | Build/launch when provable, otherwise runtime | Unsupported-provider diagnostic                 |
| Native intent names a removed or incompatible mount                     | Runtime                                       | Stale-native-event diagnostic; no transition    |
| Persisted tree is invalid or incompatible                               | Restoration                                   | Restoration diagnostic, then valid initial tree |

Structured diagnostics are observable by Tao tests, Studio, logs, and development tooling. Production policy may control reporting, but it cannot change explicit target semantics or silently redirect an operation.

## Routes And Deep Links

Public routes map stable route identities and restorable parameters to semantic navigation transactions. They do not expose internal mount paths as URLs. A transaction may select static items, mount parameterized nav descriptors, and present content in one atomic reducer update.

Exact route declaration syntax, URL mapping, and app-authored presentation-state migration syntax are deferred until descriptor, target, and restoration IR exist.

## Deferred Capabilities

The following do not block the first Slot/Stack implementation:

- Exact route declaration syntax, the source-facing restoration API, and custom restoration migrations.
- Selection, Split, Overlay, Toast, and Window providers, which are specified here but implemented in ordered follow-up projects.
- Multiple scenes, spatial/immersive presentation, widgets, and complications.
- Advanced window geometry and popover anchoring.
- Public presentation handles or immediate status results.
- Durable dialogue continuations and entity policy across suspension.
- Navigation guards, lifecycle syntax, and concurrent action scheduling.
- Platform-specific declaration syntax and unsafe-injection annotation syntax.
- Overlay/Window restoration policy and user-defined semantic-identity metadata.
- External key-based targeting of dynamic Window, Toast, and Selection occurrences.
