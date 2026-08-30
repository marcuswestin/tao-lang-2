# Tao Studio

Status: authoritative executable contract for the current Tao Studio development surface.

Tao Studio is a local development product over a Tao project. Tao source is the durable authority:
the editor and visual tools submit versioned source actions, and Studio keeps no hidden layout,
example, or runtime state as project truth. `fixture` and `scenario` are the shared Tao-owned source
for examples; there is no `example` declaration or Studio-only cases file.

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

The validator requires unique fixture names per file, unique handles per fixture, known entity
fields, all required create fields, assignable values, and valid action arguments. Accounts are
identity handles, not a promise of a particular authentication provider.

Fixtures are metadata in ordinary application compilation. They do not create rows merely because a
production app module evaluates. Studio compilation serializes their ordered accounts, creates,
fields, `through`, and `for` plan into the preview manifest.

## Scenarios

A file-level scenario selects exactly one fixture, exactly one device, and exactly one subject. The
subject is either a whole app or one focused view:

```tao
scenario HNReader.phone {
   fixture HNStories
   run HNReader
   device phone
   appearance light
   locale "en"
   network online
}

scenario StoryRow.leading {
   fixture HNStories
   prepare {
      update LeadStory { Title: "Leading story" }
   }
   render StoryRow(Story: LeadStory)
   device phone 390 x 844
   appearance dark
   network offline
}
```

`run` and `render` are mutually exclusive. Focused render arguments are named and validated against
the view's parameter names, required parameters, and Tao types. An app subject may optionally name a
destination with `run App at Destination(...)`; destination execution is not connected to the
current preview host yet.

The implemented optional clauses are one ordered `prepare { update ... }` block, `appearance light`
or `dark`, a string locale or `pseudolocale`, `direction rightToLeft`, and `network online` or
`offline`. A pseudolocale requires right-to-left direction. Device presets are `phone`, `tablet`, and
`laptop`; custom positive whole-number width and height may follow the preset. The defaults used by
the Studio manifest are 390 by 844, 768 by 1024, and 1440 by 900 respectively.

Scenarios are also metadata in ordinary app builds. A Studio compilation emits one source-owned
scenario record and initially one preview cell per authored scenario. The test runner does not yet
execute fixtures or scenarios; its current `test`/`check` contract remains separate.

## Studio compilation manifest

Preview compilation emits `TaoStudioManifest.ts` with format version 1. Production compilation does
not emit this sidecar. The compiler manifest contains:

- every app and view subject with stable compilation-local ID and Tao source range;
- the selected app name and each view's parameter name, requiredness, Tao type name, and control kind;
- fixture execution plans;
- scenario fixture, ordered preparation, subject and arguments, viewport, appearance, locale,
  direction, and network metadata.

The Studio session adapts that compiler output into preview-manifest version 1. The preview manifest
adds project identity, source versions, compile and manifest revisions, parameter controls, cells,
state layers, and capability declarations. It rejects duplicate or dangling subjects, fixtures,
scenarios, cells, parameters, and states before publication.

Each cell is identified by:

```text
project + appName + manifestRevision + compileRevision + cellId + cellRevision
```

A mounted renderer adds a random `previewInstanceId`. Preview URLs carry only that opaque instance ID
and the fact that the root is a Studio cell. The server keeps the cell bootstrap record. Arguments,
fixture plans, state, and source paths are not encoded into the URL.

Reconfiguring a cell validates its parameters, environment, and state layers, increments
`cellRevision`, and invalidates its former preview instance. Requests with stale manifest, compile,
cell, or instance identity fail as conflicts rather than applying to a newer render. The browser
client creates a separate iframe realm for every cell so ordinary module and runtime singletons are
not shared between examples.

Across a successful source recompile, stable cell IDs retain compatible explicit argument,
environment, and state-layer overrides. The session rebases live opaque instances onto the new
manifest identity and publishes the new manifest to the browser; existing cells refresh their controls
without replacing their iframe. Added, removed, or renamed cells still require rebuilding the grid.

The matrix identity, validation, registration, bootstrap, reconfiguration, and grid-frame creation
are implemented. The generated Studio root now installs the cell host, creates fixture rows in
declaration order, applies ordered `prepare` updates after datasource binding, resolves fixture handles
into view arguments, and mounts the focused `render` subject. The real WordFlower
`WorkspaceRow.novel` scenario generates and typechecks through this path. Fixture setup through an
action remains unsupported and fails explicitly rather than silently bypassing that action.

## State

Studio state is versioned, JSON-safe, and split into named runtime domains. The runtime exposes a
codec registry that validates, decodes, composes, and re-encodes domains in source order. Duplicate
domains use their registered composition rule; conflicts name the domain and contributing layers.
The Studio library additionally detects missing layers, cycles, incompatible codec versions, and
later-domain overrides.

The only implemented capture domain is `data`. Its value is the exact set of full provider snapshots
keyed by provider storage key. Composition accepts identical or disjoint snapshots and rejects two
different snapshots for the same storage key. Capture therefore covers provider data and identity,
not arbitrary React hooks, navigation stacks, timers, native controls, or process state.

The domain codecs, deterministic composition, diagnostics, exact provider seed, and exact provider
capture are implemented library contracts. Resolved data state is passed into the generated cell host
and seeds its provider overlay. A matrix cell can convert its current provider rows into a dependency-
ordered named fixture proposal, present a client rendition for confirmation, and save the accepted plan
through the versioned, undoable source-action bus. The server independently emits the canonical Tao
source; returning that exact pending source or diff before acceptance remains open. Relations become
fixture-handle references; missing
or cyclic relations, non-scalar fields, and conflicting snapshots are rejected. Loading accepted
captured state in tests is still open, and the current generated manifest consequently publishes no
separate named state entries.

## Per-cell environment

The preview-manifest environment has three parts:

- `viewport`: positive width and height plus an optional preset name;
- `network`: non-negative latency and normal, offline, or explicit-error outcome;
- `scheme`: requested light or dark appearance with status exactly `inert`.

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

Scheme is deliberately not simulated. The current design runtime has no reactive `Scheme`/
appearance resolution, so the protocol accepts only an explicitly inert capability, runtime
validation refuses an active claim, and Studio presents the requested value in a disabled control
with a visible explanation. It does not recolor a preview by browser-only CSS and imply native
behavior.

## Editing, identity, and trust

Studio uses the shared Langium language server for editing and a separate versioned Studio protocol
for compile state, previews, selection, inspector data, and source actions. The compiler records render
owner and node kind, but the current window/source-action identity binds project, app, preview instance,
source version, and source range; wiring owner/kind as enforced preconditions remains open. Source
ranges are revision-bound locators, not durable IDs.

The preview bridge accepts messages only from the registered parent source and exact origin. In the
current loopback-only browser transport that parent origin is supplied in the iframe URL, so this is a
local isolation check rather than authenticated pairing and must not be exposed on a LAN. The Mac
project session also validates the request Host, source versions, and action preconditions before writing. Visual insertion,
reorder/move, supported layout changes, wrapping, and undo all go through typed source actions;
previews do not write source or persist visual state themselves.

## Current boundary

The local web Studio shell, editor/LSP connection, stable Expo preview publication, bidirectional
source/render selection, current visual source actions, review checkpoint/undo, Electron wrapper,
compiler manifest, matrix identity, typed per-cell argument/viewport/network controls, a visibly inert
Scheme control, focused fixture/view execution, per-cell provider/environment wiring, and state-domain
libraries exist. The generated real WordFlower Studio host typechecks as the integration proof.

Per-cell argument controls can save their current values back into the authored focused `scenario` as
one reviewable and undoable source action. Each matrix cell also exposes `Capture fixture`: Studio asks
for a Tao fixture name, captures only the isolated provider state, shows the proposed fixture source,
and writes only after confirmation. The following remain open before the scenario matrix is a complete
user feature:

- support fixture setup through actions;
- load accepted captured state through the test harness;
- prove concurrent examples preserve independent compatible state during edits;
- complete the listener-dependent browser/Electron interaction pass; the repository gate is green;
- return the exact server-produced fixture source or diff before capture acceptance.
- make the packaged macOS application start a usable project flow without launcher-only environment
  variables.
- mount or reject scenarios declared in imported files instead of publishing blank cells, and execute
  or reject authored `run App at Destination(...)` subjects rather than silently using the default route.

A phone or other native device is not currently a Studio renderer. The feasible follow-up design and
required real-iPhone proof are recorded in
`Docs/Roadmap/Tao Studio v1/Exploration - Native device as Studio canvas.md`.
