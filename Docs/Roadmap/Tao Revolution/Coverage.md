# Tao Revolution — Coverage

The capability → forcing-feature → test matrix. Enforces `Process.md` principle 2: a capability
exists only if a real feature forces it, and every decided capability names that feature and the
available evidence that proves it.

Every row's Forcing feature cell is now filled, with one exception spelling: a cell reading
**`none — for the Developer`** means the capability is decided but _no feature in any of the four apps forces
it_. Those are red flags to resolve at MVP derivation (step 4) — cut the capability, or let the Developer name
the feature that earns it — and they are deliberately not given a contrived one. Occurrence queries
are the sharpest of the five: `Decisions.md` §17 decides Hearth's repeating list items as the
forcing feature, and Hearth does not have them. **Post-MVP recommendation:** add real routines to
Hearth before activating occurrence queries: generate dated occurrences without stored copies and
persist completion against each occurrence. If that product feature is cut, reconsider the capability.

Tier values: **MVP** (must run for v1), **Post-MVP** (Revolution; activated with the app
expansion), **TBD** (assigned at step 4). Test status is updated as tranches land.

| Capability (Decisions §)                                    | Forcing app · feature                                                         | Tier     | Test status               |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- | -------- | ------------------------- |
| Types, typed slots, unit values (§2)                        | WordFlower · everywhere; units: focused-writing mode                          | MVP      | in Current                |
| Convertible unit families, dimensional arithmetic (§2)      | Hearth · a search radius in km; Skillet · step timers and total time          | Post-MVP | —                         |
| Entities, relations, yes/no poles (§2)                      | WordFlower · workspaces, documents, paragraphs                                | MVP      | partially in Current      |
| `relation` trait for a differently-named relation (§2)      | Skillet · `Person (relation Accounts)`; Wayfare · `Seats`                     | Post-MVP | —                         |
| `required` completeness, `Incomplete`, `Problems` (§2)      | WordFlower · workspace and document forms                                     | MVP      | in Current[^16]           |
| `validate` and `refuse when` (§2)                           | WordFlower · document and workspace rules                                     | Post-MVP | —                         |
| Cross-row validate, lowered per write path (§2)             | Skillet · a kitchen needs an owner; Wayfare · a trip needs an owner           | Post-MVP | —                         |
| `together` as one fact (§2)                                 | Skillet · an amount never syncs without its unit                              | Post-MVP | —                         |
| Preferences incl. device scope (§2)                         | Hearth · keep this home offline, an Around radius                             | Post-MVP | —                         |
| `secret` capability values and rotation (§2, §4)            | Skillet · a share code; Wayfare · a seat's invite code                        | Post-MVP | —                         |
| Deleted-row / redacted-account refs (§2)                    | Hearth · a finished chore keeps who finished it after they leave              | Post-MVP | —                         |
| Authority: access, audiences, through (§3)                  | Skillet · who cooks here (owner, cook, guest) and what each may write         | Post-MVP | —                         |
| Holder-of-secret grants, invites (§3)                       | Skillet · an invitation that works once, for one address                      | Post-MVP | —                         |
| Public boundary: publish, projections (§4)                  | Skillet · the shared recipe as a different read-only type                     | Post-MVP | —                         |
| Projection with a filtered relation (§4)                    | Hearth · a shared list shows open items and nothing finished                  | Post-MVP | —                         |
| Generated publication preview (§4)                          | Skillet · "this is what crosses the boundary" before creating the link        | Post-MVP | —                         |
| Direct write verbs (§5)                                     | WordFlower · document operations (single-user subset)                         | MVP      | —                         |
| Named transactions, for-caller (§5)                         | Skillet · StartKitchen and membership operations                              | Post-MVP | —                         |
| One atomic commit across rows (§5)                          | Skillet · StartKitchen; Wayfare · CreateTrip mints the owner's own seat       | Post-MVP | —                         |
| Bulk write verbs (`update each`, `delete each`) (§5)        | Skillet · clear what was bought; Hearth · clear a finished list               | Post-MVP | —                         |
| Guard default, effect outcomes (§5)                         | WordFlower · document availability and export outcomes                        | MVP      | in Current                |
| Outcome vocabulary incl. `queued` (§5)                      | Wayfare · saving a stop with no network                                       | Post-MVP | —                         |
| Queries: filters, ordering, limits (§6)                     | WordFlower · drafts, finished documents, paragraphs                           | MVP      | in Current                |
| Entity-declared search consumed by a query (§6)             | WordFlower · find in a workspace; Skillet · find anything                     | MVP      | in Current                |
| Grouped queries retaining their source rows (§6)            | Skillet · a folded shopping line one tick buys; Hearth · the same fold        | Post-MVP | —                         |
| Presence (§6)                                               | Skillet · two cooks on one recipe; Wayfare · two planners on one stop         | Post-MVP | —                         |
| Editing: write-through + drafts (§7)                        | WordFlower · title/body editing                                               | MVP      | partially in Current      |
| Draft conflict comparison (§7)                              | Wayfare · stop editing                                                        | Post-MVP | —                         |
| Commands as configured values and generated catalog (§8)    | WordFlower · module-level Finish, workspace save toolbar                      | MVP      | in Current[^9]            |
| Shortcut values and keyboard dispatch (§8)                  | WordFlower · pause focus command and document verbs                           | MVP      | in Current[^11]           |
| Interaction outline, derived row labels, `(title)` (§2, §9) | WordFlower · workspace, draft, and paragraph rows; HNReader · story row       | MVP      | in Current[^10]           |
| Attention reducer and locale-aware narrowing (§9)           | WordFlower · workspace targeting and document-title engagement                | MVP      | in Current[^11]           |
| Command ordering, hiding, and verb surface (§8)             | WordFlower · draft and finished document rows                                 | MVP      | in Current[^11]           |
| Generated interaction surfaces and key allocation (§8, §13) | WordFlower · hints, overview, draft verbs, and command palette                | MVP      | in Current[^12]           |
| Narrowing feedback and off-window targeting (§9)            | WordFlower · subdued nonmatches; virtualized libraries                        | MVP      | partially in Current[^13] |
| Pointer/touch attention parity (§9)                         | WordFlower · contextual verbs and region focus                                | MVP      | partially in Current[^13] |
| Verb-pending chooser and input surfaces (§8–§9)             | WordFlower · commands with open entity and scalar slots                       | MVP      | in Current[^13]           |
| Generated contextual Help (§9, §13)                         | WordFlower · explain the focused region and target                            | MVP      | pending[^13]              |
| Accessibility projection (§9)                               | WordFlower · selectable rows, controls, and generated surfaces                | MVP      | partially in Current[^13] |
| Multi-target interaction (§9)                               | Story 12 · bulk operations                                                    | Post-MVP | pending[^13]              |
| OS menu bar (§8)                                            | WordFlower · command menus                                                    | Post-MVP | —                         |
| Assistant projection (§8)                                   | WordFlower · assistant block                                                  | Post-MVP | —                         |
| Undo derivation (§8)                                        | WordFlower · document edits                                                   | Post-MVP | —                         |
| Declared concurrency: single-flight, latest-pending (§8)    | Hearth · a quick tick-untick settles last; Skillet · one sign-in link         | Post-MVP | —                         |
| Conditionals, ternary, check/guard (§8)                     | WordFlower · everywhere; ternary: focused-writing mode                        | MVP      | in Current[^2]            |
| Ticking clock — @tao/time (§9)                              | **WordFlower · focused-writing mode** (X-minute free write)                   | **MVP**  | in Current                |
| Unified view kind, inferred capabilities (§9)               | WordFlower · everywhere; stateful wrapper: settings details                   | MVP      | in Current[^4]            |
| Scene, host-read chrome slots (§9–§10)                      | WordFlower · reactive workspace title + save; HNReader                        | MVP      | in Current[^5]            |
| Headerless scene, pushed plain view (§9–§10)                | Test Apps · Navigation MVP full-bleed and chromeless pushes                   | MVP      | in Current                |
| Ephemeral non-serializable parameters (§9, §10)             | WordFlower · revert-save toast action                                         | MVP      | in Current                |
| Layout, render, clause lists (§9)                           | WordFlower · all screens                                                      | MVP      | in Current                |
| Conditional styling incl. states (§9)                       | WordFlower · buttons and active focus bar                                     | MVP      | in Current[^11]           |
| Grid over loop, cell min (§9)                               | Skillet · recipe cards; Hearth · the week as seven columns                    | Post-MVP | —                         |
| Pages over loop (§9)                                        | Skillet · cook mode steps                                                     | Post-MVP | —                         |
| Map with a required non-map alternative (§9)                | Hearth · errands near you; Skillet · where to buy these                       | Post-MVP | —                         |
| Navigation: native/basic kits, links, split, windows (§10)  | WordFlower · native stack + deterministic harness                             | MVP      | partially in Current[^5]  |
| Split: compact progression and collapse order (§10)         | Wayfare · a three-pane workspace a phone walks as a stack                     | Post-MVP | —                         |
| Reveal-or-focus and keyed windows (§10)                     | Hearth · one window per item; Skillet · one cook window per recipe            | Post-MVP | —                         |
| Links: parameters, paths, and derived anonymous reads (§10) | Skillet · a shared recipe link that opens signed out                          | Post-MVP | —                         |
| Rendered nav, root view with arguments; frame retired (§10) | WordFlower · shell with persistent focus bar; Test Apps · Shell               | MVP      | in Current                |
| Device-local entities (§2, §11)                             | **WordFlower · focus session as data** (journey smoke)                        | **MVP**  | compiler-proven           |
| Restoration policy (§10)                                    | WordFlower · relaunch                                                         | MVP      | in Current                |
| Project identity and release metadata (§10)                 | WordFlower · a checked-in project id; Skillet · `version`, `DefaultApp`       | MVP      | partially in Current      |
| App composition, variants, providers (§11)                  | WordFlower · app root + test variants                                         | MVP      | partially in Current      |
| InstantDB datasource (§11)                                  | WordFlower · sync                                                             | MVP      | experimental              |
| Datasource membership, bound sets (§6)                      | HNReader · a feed store beside the reader's own bookmarks                     | MVP      | in Current[^14]           |
| Patching a datasource where it is bound (§6)                | HNReader · the shipped bookmarks storage key                                  | MVP      | in Current[^14]           |
| reference across datasources (§6)                           | HNReader · a bookmark naming a story in the feed store                        | MVP      | in Current[^14]           |
| Query-driven Http datasource, descriptor fill (§6)          | HNReader · the story feed                                                     | MVP      | in Current[^15]           |
| Cache-first availability: refreshing, stale (§6)            | HNReader · a failed refresh over cached stories                               | MVP      | in Current[^15]           |
| auth library, Me binding (§11)                              | Skillet · sign in to a kitchen; Hearth · sign in to a home                    | Post-MVP | —                         |
| Files provider (§11)                                        | Wayfare · offline documents                                                   | Post-MVP | —                         |
| Permissions as multi-state values (§11)                     | Hearth · Around without location access                                       | Post-MVP | —                         |
| Places provider, nearby search (§11, §17)                   | Skillet · which shop is nearest; Hearth · errands on a map                    | Post-MVP | —                         |
| Offline closure (§11)                                       | Skillet · a kept kitchen; Wayfare · the map around saved places               | TBD      | —                         |
| Automations, notifications, levels (§12)                    | Skillet · timers, meal reminders                                              | Post-MVP | —                         |
| Design system: blocks, styles, screens (§13)                | Skillet, Hearth, Wayfare · one design each, and WordFlower's own              | MVP      | partially in Current[^17] |
| Container conditions (§13)                                  | **none — for the Developer**                                                  | Post-MVP | —                         |
| Plural phrases (§14)                                        | WordFlower · the outline's paragraph count                                    | MVP      | in Current                |
| Copy extraction, words, `tao words check` (§14)             | WordFlower · all copy + one locale                                            | Post-MVP | —                         |
| Measurement phrases (§14)                                   | Skillet · metric/imperial amounts                                             | Post-MVP | —                         |
| TypeScript boundary: from, fails (§15)                      | WordFlower · build stamp, document export; @tao/text; @tao/time               | MVP      | in Current[^3]            |
| Bridge metadata module (§15)                                | WordFlower · type-checked TypeScript behind `from`                            | MVP      | —                         |
| Foreign views (`accepts content … from ./X.tsx`) (§15)      | **none — for the Developer**                                                  | TBD      | —                         |
| Foreign `runs latest` scheduling (§8, §15)                  | **none — for the Developer**                                                  | TBD      | —                         |
| Render failure containment and recovery (§15)               | **none — for the Developer** (no author surface; it is runtime policy)        | MVP      | —                         |
| Fixtures, tests, query assertions (§16)                     | WordFlower · behavior tests                                                   | MVP      | partially in Current[^18] |
| Fault injection (§16)                                       | Test World Controls · injected save failure; WordFlower · sync failure       | MVP      | in Current; app pending[^1] |
| Foreign action failure stubs by declared case (§16)         | WordFlower · export outcomes; Test Apps · Effect Outcomes check isolation     | MVP      | in Current                |
| Foreign action value-return stubs (§16)                     | Skillet · the import journey's success value                                  | Post-MVP | —                         |
| World controls: network, sync, relaunch (§16)               | Test World Controls · offline queue and reconnect; WordFlower · offline edits | MVP      | in Current; app pending   |
| World controls: clock, collaborators (§16)                  | Skillet · a timer that outlives the window; Wayfare · a live conflict         | Post-MVP | —                         |
| Scenarios, pseudolocale, review gallery (§16)               | WordFlower · scenario set                                                     | TBD      | partially in Current      |
| Sketch placeholders and flexible space (§16)                | WordFlower · the Placeholder journey                                          | MVP      | in Current                |
| Occurrence queries (§17)                                    | **none — for the Developer** (Hearth · dated routines are decided but absent) | Post-MVP | —                         |
| Nearness, distance, places (§17)                            | Hearth · Around                                                               | Post-MVP | —                         |

Rows marked _partially in Current_ have behavior tests for part of the capability; _pending_ means
the capability is decided but not yet implemented or tested; a `—` test status means the capability
is not implemented and has no test yet, which for a Post-MVP row is the expected state until the app
expansion reaches it.

**The Post-MVP rows whose forcing feature is a Tao Future app are written, in the decided dialect,
in `Apps/Tao Future/`.** Those files are `.tao-revolution`, so nothing runs them yet: their test
status becomes real when a tranche graduates the file to `.tao` and its journeys join `tao test`.
The expansion order in `Apps/Tao Future/README.md` is therefore also the order these rows light up —
Skillet first (automations, notifications, timers, measurement, a second shape of sharing), then
Hearth (occurrence queries, nearness) and Wayfare (files, offline documents, draft conflict).

[^2]: `if`, `when` in value and render position, the compact two-outcome `when`, view `guard`, and
    `check` — §8's action-only early exit — are in Current. A `check` may not sit inside an action's
    `if` or `guard` block, where it would stop only that block. `guard` in an action, which §8
    reserves for views, still runs but draws a retirement warning; no app, starter, or tutorial
    uses it.

[^3]: `<expression> from <path>` is in Current and is how both stdlib packages bind their runtimes.
    WordFlower's Markdown export now uses a foreign action with declared failures. `progress` was
    struck on 2026-09-25: no decision ever defined it.

[^4]: The unified view tranche established one renderable family with content acceptance, render
    slots, and `responds` inferred from the body; the later host-read tranche added `scene is view`
    for supplied host slots and the presented-not-composed rule. The `Collapsible` stateful wrapper
    proves the deleted statelessness ladder, and its conditional `@@content` placement proves the
    at-most-once rule. The restoration tranche supplies the serialization boundary and diagnoses
    statically known non-serializable action parameters at each restorable presentation usage site
    (§10).

[^5]: The host-read/nav-kit tranche implements command titles, focused bound commands,
    `Toolbar`, reactive direct-only `Title`, native-default and explicit basic `StackNav`, and
    user-visible title/toolbar journey assertions. WordFlower's Tao journey proves Back uses the
    semantic reducer; browser Back/Forward adds no Tao construct and is covered by focused runtime
    and rendered host tests against that reducer. The runtime-owned target verb menu, palette,
    overview, and hints, plus keyboard dispatch, ship in the interaction tranches below. Authored
    and native menus, window
    orchestration, and links/routes remain at their stated later boundary.

[^9]: The interaction system tranche makes a command a standalone configured value: `Title`,
    `Description`, and `Summary` move off `primitive action` onto `primitive command`, a command is
    declared at module level or in a view body, its slots are its parameters, and
    `do <command>(...)` invokes it with arguments bound exactly as an action's are. WordFlower's
    `Finish` is the module-level command with a `Document` slot; `Save` is the view-body command
    reading its scene's own state. Journeys prove the toolbar label, the reactive `Enabled`, and the
    write a `do Finish(Document)` performs. The later keyboard-attention tranche dispatches
    `shortcut` values, registers only the portable `primary` modifier, and adds mention refinement,
    `Commands { ... }`, `hide`, entity command lists, and key dispatch as described in [^11].

[^10]: The interaction outline tranche derives every node from wiring — collections and items from
    `loop`, action and input controls from `Press`/`Submit` and `Value`+`Change`, regions from what
    a navigator presents — and names each row by one static ranking that prefers the `(title)`
    field. WordFlower's `expect label` journeys prove the ranked label on a workspace row, a draft
    row, and a paragraph row; HNReader's proves a selectable story row whose first text is an
    opaque interpolation. Attention, keyboard dispatch, narrowing, and generated surfaces ship in
    the subsequent interaction tranches described in [^11] and [^12]. The Tao Future apps now carry
    `(title)` on the field that names each row, so the ranking's first candidate is declared rather
    than inferred from render order.

[^11]: The keyboard-attention tranche makes the outline operable through one runtime reducer.
    WordFlower journeys narrow to and activate a workspace, engage and leave the document-title
    input while retaining its target, invoke a view command through `primary+p`, and open the exact
    folded verb list for a draft before invoking its `f` accelerator. The same source forces entity
    `commands` ordering and hiding, view `Commands` promotion and `hide`, control-state and named
    active-region design conditions, plus the `press key`, `narrow`, `expect target`, `expect focus
    region`, and `expect verbs` test vocabulary. Visible palette, hint, overview, and verb layers
    are covered by the generated-surfaces tranche below.

[^12]: The generated-surfaces tranche mounts one host-owned floating layer above app content and
    renders interaction hints, the region overview, the target's tiered verb menu, and the
    always-present command palette from the outline, attention, bindings, and catalog. WordFlower
    journeys prove that hints are absent until requested and toggle off, the draft verb layer shows
    its allocated accelerator, the palette narrows `dup doc` to `Duplicate document`, and Escape
    opens a two-region overview. Allocation is locale-aware, deterministic, stable by identity, and
    excludes reducer keys plus explicit shortcuts. `Hint` and `Overview` are ordinary design element
    defaults; hidden layers do not participate in accessibility traversal. The Tao Future designs
    restyle both without declaring or owning the layers, which is the whole intended author surface.

[^13]: The landed interaction core narrows mounted nodes, routes press/focus/hover through semantic
    operations, presents verb-pending entity and scalar slots, and projects roles, names, and state
    to controls. Required entity slots accept an already-decided candidate or use mounted and
    store-backed choices; scalar slots use inline input. Focused runtime coverage proves displayed
    choices and dispatched values share one canonical resolver.
    Selectable rows additionally feed accessibility focus into Tao attention and expose custom
    actions. The keyboard plan's **Remaining decided implementation** ledger owns subdued
    nonmatches, off-window loop rows and scroll-to-target, long-press/right-click and empty-region
    adapters, the Help layer, multi-target behavior, broader custom actions,
    and real-device assistive-technology validation.

[^1]: The dialect migration tranche retired `data <status>` (Decisions §16). Data MVP now reaches
    snapshot save error through network and fault controls, while Test World Controls exercises the
    granular queue and retry path. Skillet's WordFlower journey remains to be graduated with the
    decided spelling (`datasource fails after create Membership "…"`); the current checks do not
    prove its backend transaction atomicity.

[^14]: HNReader binds a query-driven feed store beside a CloudKit store for bookmarks, and a patch on
    the bound name gives the shipped app its own bookmarks storage key without forking the
    declaration. Journeys prove a bookmark is written to the reader's own store while the story it
    names stays in the feed, that the story screen reads the other store to know a story is kept,
    that reading a bookmark back crosses the boundary, that removing one empties the list, and that
    bookmarks survive a relaunch while the feed fills again. A reference's `loading`, `missing`, and
    `error` readings and its cold fetch are proved at the runtime level; no journey forces them.

[^15]: The HTTP datasource work (`Docs/Roadmap/Multiple datasources/Plan - Multiple datasources.md`'s
    "Http" section) makes a live query's activation the
    fetch trigger: the provider is offered each active query's descriptor, fetches through an app
    adapter, and upserts by the entity's single `(unique)` field, while the store keeps evaluating
    every query locally. `refreshing` and `stale` are advisory cases a guard may skip, so a failed
    refresh over cached rows is never an error and offline stays a non-error. Staleness is declared
    with `CacheFor` and journeys bind a deterministic stub adapter through an ordinary app variant.

[^16]: `required` and the `Incomplete` and `Problems` it derives on rows and projections are in the
    language, with `create … with`, and the Write Rules test app proves them. WordFlower's workspace
    form and document editor use them through the stdlib `Problems(Input.Problems)` view; its MVP
    rules are `required` alone on `Workspace.Name` and `Document.Title`, since `validate` and
    `refuse when` were deferred to Post-MVP on 2026-09-25.

[^17]: Typed design blocks, styles, element defaults, interaction conditions, and `color` view
    parameters are in Current. `screens { }` declares breakpoints, but `when Screen` remains
    unimplemented; parameterized colors and design rules are outside the MVP slice.

[^18]: Test App journeys exercise `on` and `with`, including a fixture split across a bound
    datasource and device-local data. WordFlower document journeys now pin a phone, and its export
    journeys use a fresh StarterWorkspace graph with a seeded document. Device width is observed at
    the harness level because Tao tests cannot select a layout direction. `through` fixture
    bindings remain unexecuted, and the synthetic viewport applies one layout pass. The remaining
    world controls are a separate tranche.
