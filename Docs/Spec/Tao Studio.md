# Tao Studio

Status: authoritative executable contract for the current Tao Studio development surface.

Tao Studio is a local development product over a Tao project. Tao source is the durable authority for
executable product behavior. The one current exception is unsnapped freehand geometry, whose explicit
project authority is Studio's committed `.tao-project/studio/sketches.jsonc` catalog. The editor and
flowed visual tools submit versioned source actions; Studio keeps no other hidden layout, example, or
runtime state as project truth. `fixture` and grouped `scenarios` are the shared Tao-owned source for
examples; there is no `example` declaration or Studio-only cases file.

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
every entry selects exactly one device and exactly one subject. A fixture is optional; omitting it
creates a real isolated empty store. A fixture becomes required when `prepare` or a focused-render
argument references one of its handles:

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
Tao types. A required action parameter may be omitted only from a scenario render; Studio supplies a
per-cell recording stand-in that logs evaluated invocations without granting product authority. An
app subject may optionally name a destination with `run App at Destination(...)`;
destination execution is not connected to the current preview host yet.

After the effective subject, an entry may contain an ordered journey prefix using complete `press`,
`enter`, and `submit` operations; `press down`, `press up`, `hover`, tag-only `focus`, scoped
`select #tag[index] { ... }`, and deterministic `advance`. Studio replays that prefix once for each
mounted cell revision, then leaves the reached preview fully interactive. Phase presses do not
synthesize a plain press. Assertions, launch and relaunch, Back, and host-only toolbar operations
remain test-only. The implemented optional clauses are one ordered `prepare { update ... }` block,
`appearance light` or `dark`, a string locale or `pseudolocale`, `direction rightToLeft`, and
`network online` or `offline`. A pseudolocale requires right-to-left direction. Device presets are
`phone`, `tablet`, and `laptop`; custom positive whole-number width and height may follow the preset.
The defaults used by the Studio manifest are 390 by 844, 768 by 1024, and 1440 by 900 respectively.

Scenario groups are also metadata in ordinary app builds. A Studio compilation emits one source-owned
scenario record and initially one preview cell per authored entry. Focused previews run inside an
isolated app-owned navigation occurrence, so contextual presentation and Back work exactly as they do
inside an app while remaining isolated from other cells.

## Studio compilation manifest

Preview compilation emits `TaoStudioManifest.ts` with format version 2. Production compilation does
not emit this sidecar. The compiler manifest contains:

- every app and view subject with stable compilation-local ID and Tao source range;
- the selected app name and each view's parameter name, requiredness, Tao type name, and control kind;
- fixture execution plans;
- scenario group and entry name, optional fixture, ordered preparation and journey steps, subject and
  arguments, viewport, appearance, locale, direction, and network metadata.

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

The project-root `@/` package is reserved for committed generated source. Studio owns `@/studio`,
writes one public view per file with an ownership header, and keeps those files at mode `0444`.
Project open repairs the mode because Git does not track the write bit. A Studio write temporarily
grants only owner-write and restores read-only mode after success or failure; neither Studio nor the
repository uses filesystem immutable flags. The ordinary Tao and dprint fix lanes check generated
source but do not rewrite it.

### Freehand Draw, Snap, and Feed catalog

The Draw slice stores each unsnapped rectangle in `.tao-project/studio/sketches.jsonc`. The file is
JSONC on input and canonical indented JSON on every Studio write. It is committed project state, not
an artifact or browser preference. Format version 1 has this shape:

```jsonc
{
  "formatVersion": 1,
  "nextViewNumber": 2,
  "revision": 1,
  "sketches": [
    {
      "height": 76,
      "id": "sketch-row",
      "name": "View1",
      "project": "/path/to/project",
      "rectOrder": ["rect-cover"],
      "rects": [
        {
          "content": "Cover art",
          "height": 52,
          "id": "rect-cover",
          "fieldBinding": {
            "parameter": "Playlist",
            "path": "Cover",
            "presentation": { "kind": "image", "label": { "path": "Title" } }
          },
          "kind": "Placeholder",
          "width": 52,
          "x": 12,
          "y": 12
        }
      ],
      "snapped": [],
      "view": "View1",
      "width": 360
    }
  ]
}
```

Sketches and rectangles have stable unique IDs. `rectOrder` preserves the total order across free
`rects` and flowed `snapped` associations, so partial Snap and Unsnap cannot change z-order. A
snapped association retains the exact rectangle plus the generated path, view, element kind,
source version, render identity, and Studio rectangle marker. Coordinates are
finite and nonnegative, dimensions are finite and positive, `kind` is an open Tao element name, and
optional `content` is a string. An optional `fieldBinding` records a validated parameter, dotted field
path, and text or image presentation; an image label may name its own path and text affixes. Unknown
fields, duplicate IDs, duplicate sketch names or views, malformed JSONC, and unsupported format
versions are rejected rather than repaired silently. `revision` is the server conflict precondition.
`nextViewNumber` is project-wide and must
remain greater than every generated `view` association; deletion and reopening never reuse a `ViewN`
number. `name` remains display text and does not control allocation.

The session handshake includes the current catalog and advertises catalog format version 1. The same
snapshot is available from `GET /api/sketches`. Draw mutations use typed requests at
`POST /api/sketches/action` with a unique request ID and the expected catalog revision. The server
serializes them with other project mutations, rejects a stale revision as an HTTP 409 conflict,
replays an identical request ID idempotently, rejects reuse of that ID for different input, and
publishes successful snapshots through `sketch-catalog-changed`.

The catalog provider defines sketch deletion, but the project session currently rejects that action.
Deleting a sketch remains unavailable until removal of its generated source can participate in the
same rollback contract. Rectangle creation, update, duplication, and deletion are catalog-only and do
not compile or rewrite the generated Tao file.

Creating a sketch allocates `ViewN`, atomically replaces the catalog through a sibling temporary file,
and creates `@/studio/ViewN.tao`. The generated file contains one public view whose flowed render tree
is a sketch-sized `Placeholder`, plus a co-located, fixtureless phone scenario named `draft` in the
`sketch` group. It contains no free `Rect`, positioned-container, or offset syntax. If generated-source
creation or compilation fails, the session removes the new generated file and atomically restores the
prior catalog snapshot, including its revision and allocator. A generated-name collision is rejected;
Studio never overwrites an existing `@/studio/ViewN.tao`.

The browser Draw canvas renders ordered catalog rectangles through a TypeScript sketch workspace that
lives beside the keyed preview grid, not inside a scenario row. Each created view keeps the canvas
origin it was drawn at, shows its view name above an off-white board, and stays mounted across the
compile that writes `@/studio/ViewN.tao`. Handshake and catalog-change snapshots re-render the overlay
in authoritative catalog order and ignore an older revision. The Draw layout preset shows only that
canvas; Run hides it so a running preview has no drawing surface.

The geometry model normalizes drawing in either direction, enforces a four-pixel minimum extent,
selects the frontmost rectangle, moves and resizes through eight handles, cancels a pointer gesture back
to its prior snapshot, and duplicates with Option-drag. Pointer capture and primary-pointer ownership
keep stray events from completing another gesture. Kind and content edits preserve geometry and
binding. Each completed gesture is serialized into one catalog action; an asynchronous rejection rolls
the overlay back to its authoritative snapshot and exposes the error on the sketch host. Selecting,
moving, resizing, retyping, and editing a free rectangle never write the Tao render tree. The language
boundary is fixed: only snapping writes free rectangles into flowed Tao source.

Snap projects selected rectangles through a deterministic server-owned inference: one clean
separating axis chooses `Row` or `Col`, stacked lanes nest, median neighbour distance becomes `gap`,
sketch-edge distance becomes root `pad`, opposite-edge contact becomes `fill`, the widest slack
assigns `claim 1` to its neighbour, drawn numeric sizes remain `width` and `height` entries even when
that claim lets the node absorb main-axis slack, and Text/Image hug. Two clean axes and
overlap are ambiguous. The committed 16-case component-layout regression corpus records 12 direct
projections (75 percent) and four proposals; it does not constitute the FS-D11 real-screen acceptance
corpus or measure inspector-fix counts. Nested padding and cross-axis alignment inference remain open.
Clean projections apply directly. Ambiguity returns the canonical tree and diff through the proposal
route and requires the exact proposed source version to confirm.

Generated leaves carry private `#studio_rect_...` markers while Studio owns the source under
`@/studio`; authored source cannot publish or spoof that identity, and Move to package strips the
markers. The compiler publishes current render identities and element names; the preview reports
finite cell-relative measured rectangles. Snap inserts only newly selected projected nodes and Unsnap
removes only selected Studio leaves, preserving manual edits and typed flow actions. Snap, repeated
partial Snap, Unsnap, direction changes, separator insertion, weighted Spacer edits, and Undo are
serialized source/catalog transactions: generated source compiles before the catalog advances, both
stores roll back on failure, and successful revisions remain monotonic. Unsnap first uses the retained
rectangle. On reopen, reconciliation waits for a manifest matching the current source version before
missing, duplicated, or retyped associations are dropped; an active matching preview measurement is
the fallback, otherwise Studio returns the retryable `measurement-unavailable` conflict without
changing either store. Free rows remain in the TypeScript overlay beside the flowed preview until they
are snapped.

### Feed source contracts

Studio preview manifests preserve a Tao entity parameter's canonical entity identity while retaining
the JSON-object control representation. Primitive values are rejected for entity arguments. A
`public fixture` is importable through an ordinary `use` statement; scenario fixture clauses and
their row handles resolve across that file boundary, and fixture-only imports emit no runtime binding.
This is the executable basis for the generated `@/studio/Sketches.tao` home.

The deterministic Feed generator requires an explicit seed and emits empty, typical, and edge rows
from compiler-owned entity metadata. Fixture, generated, live-store, and library rows normalize to one
immutable typed inventory with stable opaque IDs and promotion records. Generated and live rows remain
values only; generating them does not write source. The shared-fixture source builder creates or
extends one Studio-owned `public fixture Sketches`, preserves existing imports and rows, is idempotent,
and rejects a same-name row whose entity or fields differ.

Two structured source actions implement the source half of binding. `add-sketch-entity-parameter`
adds the imported entity parameter and supplies a validated fixture handle to every entry in the
owned sketch scenario group. `bind-sketch-field` resolves a typed field path and rewrites one exact
tagged leaf as current-dialect `Text` or accessible `Image` source while preserving its marker and
layout. Catalog action `bind-rect` persists the equivalent structured binding on a free or snapped
rectangle without disturbing geometry, total order, or its Snap target. Parameterized
`insert-project-view` derives exact-type arguments from declarations visible at its insertion gap,
including the nearest loop row and owning-view parameters; unresolved or ambiguous required values
fail before mutation, and an explicit structured binding can disambiguate.

These are server-side and source-action foundations, not yet the complete Feed gesture. The current
Studio client does not yet expose the four-source row browser, drag entity/field chips, Keep as one
multi-file transaction, or Move-to-package scenario-group relocation. Until those land, callers must
not present Slice 3 as an end-to-end Studio workflow.

The catalog is intended to be recovered through version control. A malformed or unsupported catalog
blocks publication instead of discarding geometry. Restore a known-good committed copy or repair it
while preserving stable IDs, rectangle order, `revision`, and a `nextViewNumber` above every retained
`view`. Do not reset the allocator to reuse a deleted number or hand-edit generated source to resolve a
collision. Studio's automatic rollback covers failed create transactions; Move to package is the
supported way to take ownership of a generated view.

Move to package transfers one `@/studio/<Name>.tao` file into an existing authored `@package`, removes
the generated header and private Studio rectangle markers, restores normal writable ownership, and rewrites every parsed
`use <Name> from @/studio` site to the target package before one serialized compile. A declaration
with the same name in the target package returns a conflict for the client to resolve before any
mutation; all nonconflicting moves proceed without an extra confirmation.

### Canvas mode

Canvas mode edits one view definition on its own. With an element selected in a running cell, the
toolbar's **Focus view** button is enabled when the element's owning view already has a focused
`scenarios` group, and pressing it hides every group that does not render that view alone, leaving
that view's cells and a bar that names the view and offers **Back to app**. Cells stay mounted, so the
app's previews keep their state. Selection inside a focused cell edits the owning view's source, and
because each cell is a scenario entry over one definition, every occurrence in the app updates at
once. A view without a focused scenario group cannot be focused yet; adding a `scenarios View` entry
is the way in.

Inside canvas mode the inspector carries the content edits Figma users expect. The Actions section
wraps the selected element in a `Row`, `Col`, or `Stack` (`wrap-render`, which also imports the
wrapper) and removes a direct child render together with its attached tag (`remove-render`; the root
render stays). The palette still inserts `Row`, `Col`, and `Text` at the selected gap. The Text
section appears for a `Text` or `TextMultiline` leaf: the inspection publishes the leaf's current
argument source, its literal when it is a plain string, and the values it could show instead, and
the section edits the literal (`set-text-content`, which rewrites only the first argument and keeps
named arguments and the layout clause) or binds the leaf to one offered value (`bind-text`).

Binding candidates are computed from declaration identity and lexical scope at the render: the owning
view's parameters, loop items and local values visible at that statement, and, for entity-typed
values, every compatible non-optional scalar field one level deep. A text value binds as `Text(Path)`
and a number is interpolated as `Text("{ Path }")`. Case/enum values are not offered because Tao has
no adopted enum-to-text conversion syntax; Studio does not invent one. Optional fields, deeper
relations, collections, app state, unresolved spellings, and imports that cannot be preflighted are
not offered. `bind-text` refuses any expression the inspection did not offer, so the client cannot
write a path the source does not have.

These actions carry the ordinary render-occurrence identity and the same proposal, checkpoint, and
undo path as every other visual edit; the server admits them only with that identity.

## Foreign views and code editor

A Tao view may name a TypeScript or TSX sidecar with `from`. The compiler imports the named component,
passes evaluated parameters as JavaScript values and action parameters as invokable action values, and
supplies `Layout`, `Tag`, optional caller `children`, and the declared named-slot `Slots` record. The
foreign component owns its native root and must render each accepted content channel exactly once.
Occurrence-level `render inject` remains a separate supported mechanism.

The expo host copies the sidecar's transitive relative TypeScript, TSX, JavaScript, JSX, and JSON
module graph while leaving installed packages external, copying one graph per sidecar file however
many Tao files name that file, so the copies of a module that holds state stay a single instance.
Studio's own client declares the foreign view in the app-local package `Apps/Tao Studio/@code-editor`,
which names `studio-src/TaoStudioProductHost.tsx` — the same module the client's other views reach,
so the editor subscribes to the host state the host publishes — and is backed by the CodeMirror
component in `studio-src/code-editor/`, the implemented reusable foreign component for CodeMirror 6: it accepts
Tao-owned content and selection, publishes change/selection actions, and can attach the existing
JSON-over-WebSocket LSP transport. Studio mounts this foreign view in
the production editor slot. The legacy workbench editor remains as the hidden controller for file lifecycle,
draft synchronization, tabs, diagnostics, and source actions while a typed ProductHost protocol mirrors its
versioned ephemeral buffer and selection into Tao. The adopted named-slot declaration spelling is
`accepts content slots @name from ./Sidecar.tsx`; the sidecar receives one `Slots` record keyed by those
declared names.

## Syntax lenses

The Studio editor folds Tao by meaning rather than by line. A lens is a set of syntax facets the
person wants to see; everything outside the set collapses while the document itself is untouched, so
saving, formatting, the language server, and preview compilation never notice. The facets are
Structure (views, render trees, slots, render control flow), Layout (layout clauses and design
declarations), Behavior (event handlers, actions, commands, functions), Data (state, queries,
bindings, types, data declarations), Wiring (imports, app configuration, injected TypeScript), Tests
(tests, fixtures, scenarios, tags), and Comments. Presets name the sets that match a way of working:
Compose shows Structure; Style shows Structure and Layout; Trace shows Behavior and Data; Data shows
Data; Outline shows nothing but declaration heads; All is the plain editor. The lens is one global
preference kept in browser storage, and Shift+Alt+L steps through the presets.

The server classifies the active document into facet-tagged ranges alongside its highlight tokens,
using a parse without linking so a file that does not resolve still folds. The editor projects that
tree against the active facets: a node is shown when its facet is on or when something shown lives
inside it, which keeps the path down to a handler visible in Trace. A hidden declaration, layout
clause, or handler keeps its head and turns its body into a facet glyph, so `[padding, gapSmall]`
reads `[▦]`, `on press -> { ... }` reads `on press ➜`, and `action Save() { ... }` reads
`action Save() ➜`. Hidden render statements, one-line data declarations, imports, tags, and comments
vanish. Whole hidden lines collapse into runs; a run that swallowed more than a single line leaves a
faint `⋯` marker, a run of one-liners leaves nothing. A parse that recovered from errors keeps the
previous projection, mapped through the edits since, until the file parses again.

Clicking a glyph or run marker peeks that whole subtree open; a lens change or Re-fold closes every
peek. The caret is never left inside hidden text: navigation from a preview element, a diagnostic, or
a search peeks the region open, and hidden spans are atomic for cursor motion. Copy still takes the
full text of a selection, hidden parts included.

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

The browser client implements the target frame: project toolbar, Design/Code/Run/Draw presets, command palette,
icon rail with an agent toggle, a floating, draggable, and collapsible agent panel in the bottom left, persisted resizable and collapsible left/right/bottom panes,
CodeMirror editor with breadcrumbs, scrolling scenario canvas, a one-column inspector whose Scenario pane
holds the scenario's arguments, environment, and captured state above the four-context Selection pane, and
bottom drawer. One token sheet in the client stylesheet styles the shell, the Tao-rendered panels (through
host-owned button, segmented, choice, and section views), and the agent panel. The command palette indexes files,
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
Development validation reports raw unnamed values on style keys as a warning; named tokens and layout keywords do not. Release compilation promotes
only that diagnostic to an error, and native packaging preflights the executable Tao client under that
release policy.

This is an explicit executable subset of Revolution §13. Parameterized palette functions and calls,
reactive Screen-class selection at use sites, pressed/focused/hovered interaction-state execution, the
`rules {}` policy engine, and raw typed typography dimensions remain deferred language work. Named size
references work; the legacy numeric style surface remains compatible.

The Inspector Data context reports the selected view/element and active cell, revision, and scenario.
`StudioRenderInspection` publishes declaration-resolved, scope-checked binding candidates for the Text
actions described above rather than a second general-purpose binding graph. The runtime publishes no
general action inventory; Actions exposes only implemented, preflighted source actions and does not
invent runtime invocation.

Problems provides project diagnostics with click-to-source, and Compile shows live status and revisions.
Data requests a trusted runtime capture from the active preview, renders its datasource/entity rows, polls
while selected, and links to active-cell fixture capture. Preview console calls cross the trusted preview
message channel; Logs renders the active cell's bounded record and can clear it. Tests invokes the Tao test
runner through session-scoped status/run endpoints, can rerun after a successful compile, retains bounded
structured failures and output, and jumps to the reported source location. Runs are serialized per project.
The packaged native payload includes the Node-target test command, Jest/runtime dependencies, and a
relocated Node plus native-library closure rather than relying on the developer shell.

## Executable Tao client strangler

`Apps/Tao Studio/TaoStudioClient.tao` is an executable, canonical, release-valid Tao app. Its
named ProductHost slots render the real StudioServer file hierarchy through recursive Tao `FileTree` and
Studio-local `Disclosure` views, mount the stdlib Components and manifest-derived project View/Screen
inventories, expose parser-owned DesignTokens, mount the code editor foreign view, and compose the
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

`packages/ides/studio/README.md` owns the operational guide around Studio: launch modes and their
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
The complete host-browser acceptance pass remains pending. Focused operations are contract-tested, and
the simulated-user journey runs as an ordinary `verify-full` gate and recorded its ten consecutive
reliable normal-terminal runs on 2026-09-20. Native and canary acceptance remains a separate
person-run gate, so no final browser acceptance is claimed here.

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
source, and writes only after confirmation.

Each authored matrix cell also exposes `Record journey`. Recording switches that preview to Run mode and
captures only replayable semantic `press`, committed `enter`, and Enter-driven `submit` operations. It
chooses a unique Tao tag, accessibility label, placeholder, or visible-text target in that order; an
ambiguous action becomes an explicit unresolved draft step and cannot be saved. Password, payment,
one-time-code, and explicitly sensitive input is redacted unless the person opts in before recording.
Existing journey replay is excluded from capture. A preview remount or source-identity change invalidates
the draft. Stopped drafts show their canonical Tao operations, obtain a server-canonical source diff,
and append to the exact scenario as one checkpoint only after confirmation; ordinary Studio Undo can
restore the prior source.

`tao review` starts the real web Studio renderer, waits for each authored cell's exact applied revision,
settles fonts and paint, and captures only the cell viewport twice. Replay settlement means that the
ordered semantic replay, including every authored `advance`, completed; it does not guess when ambient
network or action work has become quiet. A scenario whose reviewed state depends on delayed work must
author an `advance` before that state. The immutable review bundle contains
PNG evidence, relative source/scenario identity, normalized render inputs, environment and renderer
fingerprints, sanitized browser-event metadata,
`review.json`, a separate portable `annotations.json`, and a static `index.html`. A prior
`review.json` structurally pairs added, removed, changed, unchanged, failed, and renderer-incomparable
cells. The report supports side-by-side, blink, and opacity-overlay inspection plus exportable per-cell
decisions and comments bound to both image digests; changed pixels reopen earlier decisions while
preserving them as context. Missing, escaped, altered, or unstable evidence fails closed. Pixel
difference is not a pass/fail policy, and this first command makes a web-renderer claim only.

The following remain open before the scenario matrix is a complete user feature:

- keep fixture-through-action execution fail-closed while its result/handle contract remains deferred;
- load accepted captured state through the test harness after those semantics are adopted;
- expand recording beyond the implemented semantic scenario prefix, and resume generalized runtime-state
  capture/replay and authored failure-capture promotion only after their explicitly deferred artifact,
  restoration, naming, and conflict contracts are adopted;
- complete the remaining wide-screen inspector smoke and real Electrobun interaction passes; live file
  CRUD, independent retained cell state across two recompiles, drawer data/log/compile surfaces, and the
  WordFlower Tao test run have browser evidence;
- preserve server-canonical source-action proposals and same-origin browser/native routes; a future
  cross-origin host will require explicit origin injection.

Scenarios declared in imported files and authored `run App at Destination(...)` subjects are rejected during
Studio compilation with actionable messages. This satisfies the current mount-or-reject and execute-or-reject
boundary without publishing blank cells or silently substituting the selected app's default route.

A physical iPhone or iPad renders one cell through the Tao Companion development build
(`packages/ides/studio-companion-app`, an Expo dev client with a fixed bundle id and scheme). Every Studio launch
starts one `tao-studio-device-v1` gateway beside the loopback server, bound to every interface on an
ephemeral port and carrying pairing, project/app identity, scenario bootstrap, revision state, and
device reports; the loopback server, its Host validation, and the per-project Metro are unchanged. The
generated preview root mounts `TR.Studio.DeviceHost` on native platforms and the browser bridge on the web,
so one compilation and one Metro file graph drive both canvases. Trust is an authenticated X25519 exchange
with Ed25519 identities, a six-digit code compared on both screens and confirmed in Studio, XChaCha20-Poly1305
sealed frames with strictly increasing sequence numbers, Keychain storage on the device, and a revocable
trusted-device list under the Studio user state root. Trust/revocation writes are serialized across
Studio processes, and the gateway acknowledges only effects that committed successfully. Closed or
replaced sessions detach their device state, synthetic app/session records are not retained, and cells
recover through compatible session/network changes. Sealed-frame limits include framing and
authentication overhead. A device is one more opaque preview instance of the cell it selects,
acknowledges the exact compile revision it rendered, and follows Fast Refresh like the browser cell.
The workbench **Device** popover opens the installed shell through Expo's dev-client link (with a
QR and copyable URL), runs pairing, shows compile versus applied revisions, switches scenarios, and revokes
trust. The protocol, threat model, and message set are in
`Docs/Roadmap/Tao Studio companion app/Slice 1 - Device protocol and trust.md`. After pairing is
confirmed, a device may send `device.selectCell`, `device.selectSource`, `device.setNetwork`,
`device.sourceAction` (validated and applied with the same identity tuple as a browser request),
`device.applied`, `device.log`, `device.report`, and runtime-capture results; before confirmation only
`device.ping` is answered. Studio now advertises authenticated Bonjour candidates and a trusted device
rediscovers the current gateway and Metro endpoints after a network or session change; the advertisement
is bound to Studio's pinned identity and the QR/deep-link route remains the fallback. The device panel
exposes LAN/cable choice. The Tao relay and companion beta delivery remain roadmap work, and this
software contract is not evidence of a successful physical cable or other real-device run.
