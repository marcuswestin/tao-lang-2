# Tao Studio

Status: authoritative executable contract for the current Tao Studio development surface.

Tao Studio is a local development product over a Tao project. Tao source is the durable authority:
the editor and visual tools submit versioned source actions, and Studio keeps no hidden layout,
example, or runtime state as project truth. `fixture` and grouped `scenarios` are the shared Tao-owned
source for examples; there is no `example` declaration or Studio-only cases file.

This page distinguishes implemented protocol/runtime foundations from product wiring that remains
open. A type or manifest field existing does not by itself mean the browser preview executes that
behavior.

## Fixtures

A file-level fixture declares a reusable identity and data graph:

```tao
fixture HNStories {
   account Ro {
      Name: "Ro",
      Email: "ro@example.com"
   }
   LeadStory = create Story {
      Title: "Tao Studio"
   } for Ro
}
```

A fixture contains named `account` entries and named entity `create` bindings. The compiler preserves
their declaration order, and fields may name fixture handles. A create may use `through Action(...)`
and may end in `for Account`. Fixture fields and arguments currently accept text, number, boolean,
`now`, and fixture references. Lists and arbitrary Tao expressions are not fixture values in this
slice.

The `through` syntax, validation, and manifest plan are implemented, but fixture-through-action result
and handle semantics are explicitly deferred. The runtime and fixture generator therefore fail closed
rather than inferring result multiplicity, later-row references, transaction or rollback behavior,
capture/replay, or test-harness seeding.

The validator requires unique fixture names per file, unique handles per fixture, known entity
fields, all required create fields, assignable values, and valid action arguments. Accounts are
identity handles, not a promise of a particular authentication provider.

Fixtures are metadata in ordinary application compilation. They do not create rows merely because a
production app module evaluates. Studio compilation serializes their ordered accounts, creates,
fields, `through`, and `for` plan into the preview manifest.

## Scenario groups

A file-level `scenarios` declaration gives a string-named group of entries. The optional declaration
subject is either a whole app or one focused view. Clauses on the group are defaults; an entry clause
of the same kind replaces the group clause as a whole, including `run` or `render`. After inheritance,
every entry selects exactly one fixture, exactly one device, and exactly one subject:

```tao
scenarios HNReader "devices" {
   fixture HNStories
   appearance light
   network online

   scenario "phone" {
      device phone
      locale "en"
   }

   scenario "tabletDark" {
      device tablet 1024 x 1366
      appearance dark
      network offline
   }
}

scenarios StoryRow "states" {
   fixture HNStories
   device phone 390 x 844

   scenario "leading" {
      prepare {
         update LeadStory { Title: "Leading story" }
      }
      render (Story: LeadStory)
   }
}
```

The subject may instead be written inside each entry, so groups without a declaration subject can
contain independently targeted scenarios. Entry names must be unique within a group. A group with one
entry is the singleton form; the former dotted singular spelling such as `scenario StoryRow.leading`
is retired without an alias. These group, inheritance, and `(group, entry)` language-identity semantics
are adopted; compiler and Studio identity additionally include the source path.

`run` and `render` are mutually exclusive. A declaration subject supplies the omitted name, as in
`scenarios StoryRow` plus `render (...)` or `scenarios HNReader` with no explicit `run` clause. Focused
render arguments are named and validated against the view's parameter names, required parameters, and
Tao types. An app subject may optionally name a destination with `run App at Destination(...)`;
destination execution is not connected to the current preview host yet.

The implemented optional clauses are one ordered `prepare { update ... }` block, `appearance light`
or `dark`, a string locale or `pseudolocale`, `direction rightToLeft`, and `network online` or
`offline`. A pseudolocale requires right-to-left direction. Device presets are `phone`, `tablet`, and
`laptop`; custom positive whole-number width and height may follow the preset. The defaults used by
the Studio manifest are 390 by 844, 768 by 1024, and 1440 by 900 respectively.

Scenario groups are also metadata in ordinary app builds. A Studio compilation emits one source-owned
scenario record and initially one preview cell per authored entry. The test runner does not yet
execute fixtures or scenarios; its current `test`/`check` contract remains separate.

## Studio compilation manifest

Preview compilation emits `TaoStudioManifest.ts` with format version 2. Production compilation does
not emit this sidecar. The compiler manifest contains:

- every app and view subject with stable compilation-local ID and Tao source range;
- the selected app name and each view's parameter name, requiredness, Tao type name, and control kind;
- fixture execution plans;
- scenario group and entry name, fixture, ordered preparation, subject and arguments, viewport,
  appearance, locale, direction, and network metadata.

The Studio session adapts that compiler output into preview-manifest version 2. The preview manifest
adds project identity, source versions, compile and manifest revisions, parameter controls, cells,
state layers, and capability declarations. It rejects duplicate or dangling subjects, fixtures,
scenarios, cells, parameters, and states before publication. Scenario IDs are stable within a source
file by the encoded `(group, entry)` pair; the source path supplies project-wide namespacing.

Each cell is identified by:

```text
project + appName + manifestRevision + compileRevision + cellId + cellRevision
```

A mounted renderer adds a random `previewInstanceId`. Preview URLs carry only that opaque instance ID
and the fact that the root is a Studio cell. The server keeps the cell bootstrap record. Arguments,
fixture plans, state, and source paths are not encoded into the URL.

Reconfiguring a cell validates its parameters, environment, and state layers, increments
`cellRevision`, and invalidates every live preview instance of that cell. A cell may have several
live instances at once, such as the browser iframe and a paired physical device. Requests with stale manifest, compile,
cell, or instance identity fail as conflicts rather than applying to a newer render. The browser
client creates a separate iframe realm for every cell so ordinary module and runtime singletons are
not shared between examples.

Across a successful source recompile, stable cell IDs retain compatible explicit argument,
environment, and state-layer overrides. The session rebases live opaque instances onto the new
manifest identity and publishes the new manifest to the browser; existing cells refresh their controls
without replacing their iframe. Added, removed, or renamed cells still require rebuilding the grid.

The matrix identity, validation, registration, bootstrap, reconfiguration, grouped-row layout, and
grid-frame creation are implemented. The browser client uses that grouping in its live preview path:
it renders source-ordered group rows, left-to-right cells, and keyed reconciliation across manifest
changes while retaining compatible cell frames. An `IntersectionObserver` blanks cells outside a
600-pixel canvas margin to `about:blank` and restores their latest preview URL when they return; source
changes update the retained URL while a cell is suspended. The generated Studio root installs the cell
host, creates fixture rows in declaration order, applies ordered `prepare` updates after datasource
binding, resolves fixture handles into view arguments, and mounts the focused `render` subject. The real
WordFlower `states / novel` scenario generates and typechecks through this path. Fixture setup through an
action remains unsupported and fails explicitly rather than silently bypassing that action. Completing
that execution path remains deferred until its result/handle and test-harness semantics are adopted.

## State

Studio state is versioned, JSON-safe, and split into named runtime domains. The runtime exposes a
codec registry that validates, decodes, composes, and re-encodes domains in source order. Duplicate
domains use their registered composition rule; conflicts name the domain and contributing layers.
The Studio library additionally detects missing layers, cycles, incompatible codec versions, and
later-domain overrides.

The Studio-authored state-layer library currently defines only its `data` codec. Its value is the exact
set of full provider snapshots keyed by provider storage key. Composition accepts identical or disjoint
snapshots and rejects two different snapshots for the same storage key.

The domain codecs, deterministic composition, diagnostics, exact provider seed, and exact provider
capture are implemented library contracts. Resolved data state is passed into the generated cell host
and seeds its provider overlay. A matrix cell can convert its current provider rows into a dependency-
ordered named fixture proposal and save the accepted plan through the versioned, undoable source-action
bus. Before confirmation, the client submits the exact source-action envelope to the server's proposal
endpoint; the server validates the current project/source/cell identity, applies the canonical patch without
writing or reserving a checkpoint, and returns the pending content, edits, version, and compact diff shown to
the user. Relations become fixture-handle references; missing or cyclic relations, non-scalar fields, and
conflicting snapshots are rejected. Loading an accepted captured fixture through the Tao test harness is
explicitly deferred with the fixture-through-action semantics, and the current generated manifest
consequently publishes no separate named state entries.

Automatic render-failure containment and guarded recovery at loop-item, screen/presentation, and app
boundaries are adopted. The versioned semantic capture artifact and restore behavior described here are
implemented Studio/runtime behavior, but their adoption as a generalized Tao capture/replay contract is
explicitly deferred. The artifact's registered runtime domains are `action-history`, `data`, `navigation`,
`persisted-state`, and cell-local `scheme`; Studio also adds the active cell's environment. Item, screen/presentation, and app
boundaries publish that artifact after a diagnostic render
pass. Studio activates the failing cell, displays its bounded failure and compiler-owned source range,
accepts a capture from a JSON file or clipboard, and remounts one cell with the restored semantic domains.
This implementation does not serialize arbitrary React hooks, timers, native controls, process state,
credentials, or other unregistered stores. Promotion of a failure artifact into durable authored
fixture-plus-scenario source is explicitly deferred with the generalized contract, including its naming
and conflict semantics.

## Per-cell environment

The preview-manifest environment has three parts:

- `viewport`: positive width and height plus an optional preset name;
- `network`: non-negative latency and normal, offline, or explicit-error outcome;
- `scheme`: requested System, Light, or Dark appearance plus resolved Light/Dark, resolution source, and
  the reactive-browser or fixed-Light-native capability.

The runtime provider overlay isolates seeded load/persist snapshots from the configured durable
provider. It never calls that provider's durable `load` or `persist`; it delegates only remote `fill`,
preserving configuration and fill-cache behavior. A cell can delay fills through Tao's clock, reject
them as offline, or inject a named fill failure by entity and occurrence. Capture returns the cell's
current exact snapshot envelope.

The authored scenario surface currently maps viewport and online/offline into the cell contract.
Latency and declared fill failures have runtime and protocol representation but no Tao scenario
spelling. The generated host installs the provider overlay through the ordinary configured datasource
binding, so cell-local seed, persistence, latency, offline, and injected-fill behavior use the same
`TR.Data` path as the app rather than a parallel store.

Scheme is resolved by the ordinary Tao runtime, never by Studio CSS. A scenario pin wins over the
Appearance preference, whose System value follows the browser environment. The resolved value flows
through mounted design conditions independently per preview cell. Runtime capture records requested,
resolved, source, and capability; replay freezes that record, and authored scenario save writes the
resolved Light or Dark pin. Native hosts without reactive appearance report `fixed-light-native` and
resolve to Light rather than implying unsupported parity.

## Editing, identity, and trust

Studio uses the shared Langium language server for editing and a separate versioned Studio protocol
for compile state, previews, selection, inspector data, and source actions. Source-action protocol v2
binds project, app, preview instance, source version, revision-bound source range, compiler-emitted node
kind, and owning view. The current mutation surface targets only render nodes, so `render` is the only
real node-kind value; that field and its mismatch check are forward-compatibility scaffolding for a future
multi-kind source-action surface. A matrix-cell edit additionally binds the exact cell revisions and authored
scenario. The server resolves the range in current parsed source and rejects fabricated node-kind, render-owner,
source-version, preview, cell, or scenario mismatches with structured conflict codes before writing.
Source ranges remain revision-bound locators, not durable IDs.

The preview bridge accepts messages only from the registered parent source and exact origin. In the
current loopback-only browser transport that parent origin is supplied in the iframe URL, so this is a
local isolation check rather than authenticated pairing and must not be exposed on a LAN. The Mac
project session also validates the request Host, source versions, and action preconditions before
writing. Proposal and apply use the same canonical preparation path, with apply revalidating current
source. Undo accepts only the latest committed checkpoint, its retained source-action identity, and its
exact post-edit source version. Visual insertion, reorder/move, supported layout changes, wrapping, and
undo all go through typed source actions; previews do not write source or persist visual state themselves.

Files are a versioned StudioServer resource. The browser tree groups real `.tao` paths recursively and
shows dirty dots and diagnostic counts. Create, rename, and delete use dedicated HTTP endpoints, serialize
with other project mutations, compile the resulting file set, and publish refreshed file metadata. The
server rejects paths outside the project, non-Tao files, stale source versions, destructive changes to the
active entry file, and rename/delete while the file has an unresolved dirty draft. File contents remain
ephemeral editor buffers and never enter the StudioServer entity model.

## Foreign views and code editor

A Tao view may name a TypeScript or TSX sidecar with `from`. The compiler imports the named component,
passes evaluated parameters as JavaScript values and action parameters as invokable action values, and
supplies `Layout`, `Tag`, optional caller `children`, and the declared named-slot `Slots` record. The
foreign component owns its native root and must render each accepted content channel exactly once.
Occurrence-level `render inject` remains a separate supported mechanism.

The runtime-toolchain copies the sidecar's transitive relative TypeScript, TSX, JavaScript, JSX, and JSON
module graph while leaving installed packages external. `@tao/code-editor` is the implemented reusable
foreign component for CodeMirror 6: it accepts Tao-owned content and selection, publishes change/selection
actions, and can attach the existing JSON-over-WebSocket LSP transport. Studio mounts this foreign view in
the production editor slot. The legacy workbench editor remains as the hidden controller for file lifecycle,
draft synchronization, tabs, diagnostics, and source actions while a typed ProductHost protocol mirrors its
versioned ephemeral buffer and selection into Tao. The adopted named-slot declaration spelling is
`accepts content slots @name from ./Sidecar.tsx`; the sidecar receives one `Slots` record keyed by those
declared names.

## Action failures, scheduling, and containment

A native action declares an expected failure with `fail Case "sentence"`; its failure cases are inferred
from its own failure sites. A foreign action has no Tao body and instead declares
`fails Case "sentence" ... from ./Sidecar.ts` on its declaration head. These failure contracts are adopted.
An expected failure aborts the complete joined call, discards its private writes, and skips the remaining
caller statements. Provider failures cross as structured cases, unknown cases do not borrow another case's
copy, and injected code gains no durable authority.

Foreign `runs latest` is also adopted. One action value has at most one running invocation and one waiting
invocation. A newer call replaces the waiting call's arguments; the replaced call resolves as skipped
without entering the action transaction, crossing the external boundary, or reporting a failure. The
running call is not cancelled, and a native action may not declare `runs latest`.

Automatic render-failure containment has no Tao author syntax. It isolates loop items, treats screens and
presented views as screen boundaries, and places an overlay boundary at the app host. Repeated failure of
the same subtree and state escalates from item to screen to app. Guarded recovery offers retry only before
an external effect, restarts without clearing data, and permits reset only with provider authority,
confirmation, and a recoverable backup. This containment and recovery contract is adopted.

Those adopted contracts do not adopt the broader runtime action-transaction or generalized semantic
capture/replay models. The repository's current root serialization, nested joins, private overlays,
prepare/publish, rollback, detached ownership, and retry metadata remain implemented runtime behavior, not
authoritative language semantics. Their contract is explicitly deferred, as are the generalized capture
artifact and authored failure-capture promotion described above.

## Product workbench and design

The supporting Tao runtime now permits recursive view references and stops only at a render depth of 256;
the first frame beyond that cap fails into the ordinary containment path. App-level
`state Name is T = default (persist)` stores versioned, runtime-type-checked device-local state, participates
in action overlays and runtime capture, loads asynchronously over its declared default, and serializes
writes. `SplitNav` can mark a pane `Resizable true`; it owns the drag affordance, writes a bindable width,
resets that width to its declaration default on a portable double-tap, and keeps an unbound resize
ephemeral. The Navigation test app's Resizable Split journey exercises the combined syntax and render path; focused
runtime tests cover persistence edge cases, the depth cap, and resize gestures.

The browser client implements the target frame: project toolbar, Design/Code/Run presets, command palette,
icon rail, persisted resizable and collapsible left/right/bottom panes, CodeMirror editor with breadcrumbs,
scrolling scenario canvas, four-context inspector, and bottom drawer. The command palette indexes files,
project views, grouped scenarios, commands, and component/view insertions. The component palette uses the
stdlib catalog plus compiler-manifest project views; drag to canvas emits position-aware source actions,
and drag to editor inserts formatted snippets with required-parameter placeholders selected for editing.

Layout inspection uses parser-owned current clauses. Style inspection carries landing provenance and
blast radius for inline entries and local/imported bundles. The structured design surface supports color
tokens and numeric families, Scheme-conditional colors, named px/rem sizes with one folded addition,
text styles, Screen thresholds, named styles, and capitalized element defaults. `set-style-entry` can edit
or fork a local bundle, update an element landing, or promote supported raw colors and sizes to a token or
element default. The decided `background` and `ink` spellings compile through the compatible runtime
`bg`/`fg` ABI, and Studio validates supported color paths, named or numeric sizes, symbolic or numeric
weights, line height, spacing, and radius before dispatch; shared edits require an edit-versus-fork choice.
Development validation reports raw inline design exploration as a warning. Release compilation promotes
only that diagnostic to an error, and native packaging preflights the executable Tao client under that
release policy.

This is an explicit executable subset of Revolution §13. Parameterized palette functions and calls,
reactive Screen-class selection at use sites, pressed/focused/hovered interaction-state execution, the
`rules {}` policy engine, and raw typed typography dimensions remain deferred language work. Named size
references work; the legacy numeric style surface remains compatible.

The Inspector Data context reports the selected view/element and active cell, revision, and scenario.
`StudioRenderInspection` does not yet publish an argument/binding graph, so the context states that binding
metadata is unavailable instead of manufacturing it. The runtime likewise publishes no general action
inventory; Actions exposes the supported Wrap in Stack source action and does not invent runtime invocation.

Problems provides project diagnostics with click-to-source, and Compile shows live status and revisions.
Data requests a trusted runtime capture from the active preview, renders its datasource/entity rows, polls
while selected, and links to active-cell fixture capture. Preview console calls cross the trusted preview
message channel; Logs renders the active cell's bounded record and can clear it. Tests invokes the Tao test
runner through session-scoped status/run endpoints, can rerun after a successful compile, retains bounded
structured failures and output, and jumps to the reported source location. Runs are serialized per project.
The packaged native payload includes the Node-target test command, Jest/runtime dependencies, and a
relocated Node plus native-library closure rather than relying on the developer shell.

## Executable Tao client strangler

`packages/studio/studio-src/TaoStudioClient.tao` is an executable, canonical, release-valid Tao app. Its
named ProductHost slots render the real StudioServer file hierarchy through recursive Tao `FileTree` and
Studio-local `Disclosure` views, mount the stdlib Components and manifest-derived project View/Screen
inventories, expose parser-owned DesignTokens, mount the `@tao/code-editor` foreign view, and compose the
inspector's live Layout/Style/Data/Actions and scenario-environment contexts. Create, rename, confirmed
delete, palette insertion, screen opening, inspector actions, and undo call the trusted workbench
controller. Style changes use server-canonical proposal/review/apply; stale active-cell environment edits
are rejected by cell identity and revision. The editor preserves versioned writes without putting file
contents into the entity model.

The server event stream now publishes explicit entity-family invalidations. The Tao provider consumes
them through the existing full-snapshot subscription seam, ignores duplicate revisions, treats a lower
revision as a new server-side datasource generation, and
replaces a complete validated mirror while retaining the prior snapshot on refresh failure. Its schema-
selected fills include Files, Screens, Views, Scenarios, Checkpoints, and parser-owned DesignTokens.
Problems and the other controller-owned drawer states cross the ProductHost as bounded, validated,
revisioned payloads; Tao owns their panel structure, iteration, empty/error branches, and actions rather
than presenting them as queried StudioServer entities.
`ServerOrigin` can name an explicit HTTP session
base for a native host; an empty value preserves same-origin browser/session routing.

This remains a strangler slice rather than a second product shell. Tao structurally renders Files,
Components, project Views, Screens, DesignTokens, Search, every drawer panel, detailed
scenario/environment controls, and the Layout/Style/Data/Actions inspector contexts; it owns their
queries, iteration, drafts, branching, and ordinary actions. The editor is a typed foreign view.
TypeScript retains primitive numeric/file leaves where Tao has no equivalent, typed serialization and
trusted controller boundaries, toolbar/rail destinations, preview iframe lifecycle, workbench and file
controllers, and native window chrome. The ProductHost protocol
publishes revisioned active-file, selected-render, active-cell,
and parsed inspector state as transient view parameters. They are browser-local UI state, not StudioServer
entities or durable project authority. Recursive folder expansion is derived from one top-level persisted
collapsed-path set passed through a bound root view; view-instance persistence is not supported. The action sidecars still use same-origin session routing, so a
separately hosted cross-origin Tao surface would need corresponding write-origin injection.

## Current boundary

`packages/studio/README.md` owns the operational guide around Studio: launch modes and their
options, ports, artifact roots, launch manifests, `doctor`, the smoke lanes, the native canary, and
the release steps. This section states what Studio implements.

The local web Studio shell, editor/LSP connection, stable Expo preview publication, bidirectional
source/render selection, visual source actions, review checkpoint/undo, file CRUD, live Data tables,
failure capture/replay, Electrobun project and packaged-service scaffold, compiler manifest, matrix
identity, Tao-owned typed per-cell argument/viewport/network controls, reactive Scheme state, focused
fixture/view execution, per-cell provider/environment wiring, and state-domain libraries exist. The
generated real WordFlower Studio host typechecks as one integration proof.

The browser client is split into API/event, editor, matrix, shell, visual-editing, file-tree, and
product-panel modules behind a thin compatibility entry point. Its live preview path renders grouped
scenario rows and keyed cells, reconciles them across new manifests, and suspends offscreen iframe realms.
The complete host-browser execution pass remains pending; its wide/narrow viewport, pane-resize,
pointer-drag, screenshot, console, and exception operations are deterministic and contract-tested.

`./dev studio` and `./dev studio-native` both start the multi-project session server. Every opened project
owns its own Expo server, generated preview runtime, preview session, file watcher, and initial compile;
the opaque session ID prefixes its HTTP and WebSocket routes. Browser mode opens the initial project
session. Native mode opens Welcome plus the initial project window, posts directory-picker selections to
the server to create further project sessions, and closes the corresponding server resource when a
project window closes. Closing is idempotent, and cancellation stops Metro waits and releases partial
resources.

Welcome recent projects persist as validated versioned JSON in the device-local Studio user state at
`.artifacts/user/studio/recent-projects.json` by default. Writes are serialized through atomic replacement,
flush during shutdown after sessions close, and malformed or unsupported state is ignored rather than
preventing Studio from starting. This history is auxiliary; Tao source remains project truth.

The Electrobun/Hutch integration generates an isolated direct-Hutch project with exact Hutch 0.24.3,
Cottontail 0.5.0, Electrobun 2.0.2-beta.12, and Bun-types 1.4.0 pins. The packaged resource contains a
bundled standalone Studio service and a production-only dependency closure installed from the frozen
repository lock. That service starts the session server from packaged paths, opens projects selected from
Welcome, owns their Metro/watcher/runtime resources, stores recents and logs under native user data, and
drains resources before quit. An externally supplied loopback service remains a development/probe option,
not a packaged-runtime requirement.

Source generation, two identical frozen-lock payload materializations, service bundling, launch/package
commands, runtime-probe parsing, origin restrictions, opaque-session routing, cancellation, updater API,
and HTTPS-release contracts are tested. `hutch install` owns `hutch.lock`; ordinary startup and packaging
then use `hutch electrobun prepare`, which preserves an existing valid projection. `hutch electrobun sync`
is an explicit upgrade operation and is not part of ordinary launch or release builds.

Hutch is installed at its installer-owned user path, and native startup resolves either `PATH` or that
location before creating artifacts. The real command projects and builds the generated Electrobun app, uses
an ephemeral Metro port, and tears down Studio and Metro when the native child exits. AppKit application
registration aborts when launched under the Codex host coalition, so visible windows, menus, the real
directory picker, WebSocket/iframe bridge, shortcut, signed/notarized `.app`, DMG, differential update, and
HTTPS release-host round trip still require an ordinary Terminal and release credentials.

Per-cell argument controls can save their current values back into the authored focused scenario entry
as one reviewable and undoable source action. Each matrix cell also exposes `Capture fixture`: Studio
asks for a Tao fixture name, captures only the isolated provider state, shows the proposed fixture
source, and writes only after confirmation. The following remain open before the scenario matrix is a
complete user feature:

- keep fixture-through-action execution fail-closed while its result/handle contract remains deferred;
- load accepted captured state through the test harness after those semantics are adopted;
- resume generalized semantic capture/replay and authored failure-capture promotion only after their
  explicitly deferred artifact, restoration, naming, and conflict contracts are adopted;
- complete the remaining wide-screen inspector smoke and real Electrobun interaction passes; live file
  CRUD, independent retained cell state across two recompiles, drawer data/log/compile surfaces, and the
  WordFlower Tao test run have browser evidence;
- preserve server-canonical source-action proposals and same-origin browser/native routes; a future
  cross-origin host will require explicit origin injection.

Scenarios declared in imported files and authored `run App at Destination(...)` subjects are rejected during
Studio compilation with actionable messages. This satisfies the current mount-or-reject and execute-or-reject
boundary without publishing blank cells or silently substituting the selected app's default route.

A physical iPhone or iPad renders one cell through the Tao Companion development build
(`packages/studio-companion-app`, an Expo dev client with a fixed bundle id and scheme). Every Studio launch
starts one `tao-studio-device-v1` gateway beside the loopback server, bound to every interface on an
ephemeral port and carrying only pairing, project/app identity, scenario bootstrap, revision state, and
device reports; the loopback server, its Host validation, and the per-project Metro are unchanged. The
generated preview root mounts `TR.Studio.DeviceHost` on native platforms and the browser bridge on the web,
so one compilation and one Metro file graph drive both canvases. Trust is an authenticated X25519 exchange
with Ed25519 identities, a six-digit code compared on both screens and confirmed in Studio, XChaCha20-Poly1305
sealed frames with strictly increasing sequence numbers, Keychain storage on the device, and a revocable
trusted-device list under the Studio user state root. A device is one more opaque preview instance of the
cell it selects, acknowledges the exact compile revision it rendered, and follows Fast Refresh like the
browser cell. The workbench **Device** popover opens the installed shell through Expo's dev-client link (with a
QR and copyable URL), runs pairing, shows compile versus applied revisions, switches scenarios, and revokes
trust. The protocol, threat model, and message set are in
`Docs/Roadmap/Tao Studio companion app/Slice 1 - Device protocol and trust.md`; Bonjour discovery, the Tao
relay, beta delivery, and device-originated source actions remain roadmap work.
