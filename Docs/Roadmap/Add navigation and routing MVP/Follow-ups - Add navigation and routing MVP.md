# Follow-ups - Add navigation and routing MVP

This is the live record of navigation work that is still unimplemented. The implemented contract
lives in `Docs/Spec/Tao Presentation and Navigation.md`; the research record and its ledgers are archived
under `Docs/Roadmap/Archive/Add navigation and routing MVP/`. Rationale for the families below survives
there, but this file owns what remains to be decided or built.

**Presentation modes replaced overlay and toast hosts.** The research record settled on targeting a
named `@overlays` / `@toasts` host and explicitly rejected call-site placement. The WordFlower
tranche after the navigation MVP reversed that: overlay hosting is a capability of every nav, so
`present X() as overlay` layers above the nearest enclosing nav (with `in <target>` still overriding
scope) and `present X() as toast (Key: "…", Duration: 3.seconds)` is always app-level and transient.
Keyed app auxiliaries remain in the language for app-specific hosts such as windows. Entries below
are written against the current model.

## Ordered Implementation Projects

### FOLLOW-NAV-001: Selection, Split, And Keyed Navigation

Static `SelectionNav` with keyed items, `Initial @key`, `Display`, adaptive drawer display, and
target-only activation (`present App@key`) ship in Current. Still open here: `SplitNav`, dynamic selection, `key of Items` typing,
compiler-created selection/split items, keyed and relative path segments beyond app auxiliaries,
directional delegation, pane reveal, and occurrence-key behavior. `Panes()` now in Current is a
responsive visual layout container, not a navigation kind and not an implicit `SplitNav` decision.

### FOLLOW-NAV-002: Window Auxiliaries And Toast Delivery

App auxiliary registration and keyed toasts as an app-level presentation mode ship in Current.
Still open here: `WindowHost`/`Window` as keyed auxiliaries, deterministic test-clock control for
toast expiry, native dismissal and close events, key-based focus,
safe stacking, and platform-support diagnostics. `DEF-NAV-017` blocks interactive toasts and must be
settled while toasts are implemented.

### FOLLOW-NAV-003: Restoration, Routes, Entity Recovery, And Project Identity

The versioned presentation-state schema, round-trip restoration, invalid-state fallback, and project
identity are implemented. Remaining work is the decided `link` declaration and arrival pipeline,
whose authored addresses do not expose internal mount paths. Loading, missing, and unauthorized
entity-reference guards ship in Current.

Restorable descriptor identity depends on a checked-in project ID, whose contract is settled:

- Every project forming restorable UI or nav descriptors has one opaque immutable `id` in its
  project metadata; Tao never generates identity.
- `tao create` writes the new project's directory name as the checked-in ID (from `--id` or a
  confirmed suggestion), and
  `tao project id <id> [path]` migrates an existing project as a deliberate, reviewable command.
- Clones and published artifacts retain the ID; an independent fork supplies a replacement with
  `--replace`, which explicitly severs persisted-state compatibility.
- A missing ID produces a diagnostic naming the migration command. It never falls back to a
  filesystem path, remote URL, lockfile key, or per-run value.
- The owning project's checked-in `@folder` names are package IDs; `@workspace` is the reserved root
  marker. Consumer installation names never participate.
- Distinct dependencies with the same project ID are a local hard error; first publish claims an ID
  in the registry.

### FOLLOW-NAV-004: Dialogue Scheduling

`dialogue … responds`, `ask`, and `respond` with optional results ship in Current. Still open here:
exactly-once completion guarantees, platform cancellation, concurrent-ask
policy, and native-dismiss races. Durable continuations remain out of scope under `DEF-NAV-005`.

### FOLLOW-NAV-005: Repository Conformance (absorbed)

The absorbed WordFlower tranche migrated executable sources to `let`, retired the former binding and
visibility spellings, removed obsolete source navigation APIs, and added Current/Test App coverage.
Future work adds source actions only where a later migration is semantically mechanical.

## Deferred Design

### DEF-NAV-001: Exact Route Declaration Syntax (superseded)

Superseded by `Docs/Roadmap/Tao Revolution/Decisions.md` §10. `link` declarations own their address,
head parameters, optional derived path, semantic transaction body, and `.Url`; mounted paths never
become public URLs.

### DEF-NAV-002: Custom Restoration Migration Syntax

The first restoration implementation stores a schema version and falls back on incompatible state. Custom application-authored migrations wait for real versioning pressure.

### DEF-NAV-003: Multiple Windows And Spatial Presentation

Window addressing, window-local roots, spatial/immersive presentation, widgets, and complications wait for additional runtime targets. Current target types reserve app/window identity without exposing that syntax.

Reworded from "scenes" per KEY-D11: `scene` is now a declaration kind — a view that is presented rather than composed — so the word cannot also mean a window or a space.

### DEF-NAV-004: Advanced Window And Popover Geometry

Persisted geometry, platform placement constraints, detached panels, popover anchor geometry, and advanced native chrome wait for auxiliary navigation to work end to end.

### DEF-NAV-005: Durable Suspended Workflows

Serializing or reconstructing suspended actions is not part of `ask`. Durable workflows must use explicit application state until a separate continuation model is designed.

### DEF-NAV-006: Navigation Guard And Lifecycle Syntax

The semantic navigation and attention reducers now reserve interception and focus behavior. Exact
source syntax for unsaved-change guards, appear/disappear/focus/blur lifecycle hooks, queueing, and
cancellation still waits for the native event loop and a forcing product journey.

### DEF-NAV-007: Presentation Results And Handles

`present`, `replace`, and `dismiss` return no user value initially. Internal occurrence IDs exist for reducer correctness, but public status/results/handles wait for demonstrated use cases.

### DEF-NAV-008: Target-Specific Declaration Syntax

Choose syntax for platform- and capability-specific definitions as a language-wide availability project. Navigation call sites remain semantic; target selection must resolve before descriptor lowering, and disabled definitions are unavailable rather than silently substituted.

### DEF-NAV-009: Values Across Suspension

Partly settled: entity availability guards are the explicit-guard answer, and `snapshot` is the
frozen-copy escape hatch. Still open: whether a live reference crossing `ask` is revalidated
automatically before the action resumes, or whether the resumed action must guard it itself.

### DEF-NAV-010: Unsafe Native Boundaries

Choose syntax and tooling for unsafe injected functions. Provider injections receive only explicit inputs and no ambient Tao scope; unsafe code must remain visible to validation, Studio, and diagnostics and cannot prove restoration or completion guarantees by itself.

### DEF-NAV-011: Concurrent Event Policy

Define whether actions can opt into queue, single-flight, cancel-previous, exclusive, or unrestricted execution. The initial navigation reducer preserves source order within one event but does not settle scheduling between concurrent events.

### DEF-NAV-012: Conditional Navigation Chrome

Design conditional app chrome and auxiliary activation after Selection and auxiliary hosts exist. Preserve the Meny exploration use case of showing a floating creation control only while a particular selection item is active without making presentation state directly mutable.

### DEF-NAV-013: Restoration Ownership And Source API (resolved)

Resolved as entirely host managed. Tao exposes only the default-on policy deviations
`Restore automatic { Exclude ... }` and `Restore fresh`; there is no serialize, deserialize,
migration, restore hook, diagnostic observer, or named fallback API.

### DEF-NAV-014: Auxiliary Restoration Policy (resolved)

Resolved by `Decisions.md` §10. Restorable navigation, overlays, and windows restore automatically;
toasts and asked/responding occurrences never do. `Exclude sheets, menus, toasts` is semantic
policy vocabulary applied while snapshotting. Any failure falls back as one whole app rather than
partially restoring auxiliaries.

### DEF-NAV-015: User-Defined Semantic Identity Metadata

User-defined UI and nav properties participate in semantic identity by default. Decide whether declarations may later mark cosmetic or placement-only properties as non-semantic without weakening full descriptor equality or restoration.

### DEF-NAV-016: Dynamic Occurrence Target Syntax

Host-only replace/dismiss initially acts on the focused or latest dynamic occurrence, while contextual operations act on their origin. Choose explicit source syntax for addressing a particular Window, Toast, or Dynamic Selection occurrence by runtime key before external keyed close/update workflows are implemented.

### DEF-NAV-017: Refreshed Toast Child Occurrences

Reusing a Toast key preserves the wrapper occurrence and refreshes its timer. Before interactive toasts are implemented, decide whether changed content retires and recreates the child UI occurrence, or whether Toast content must be non-interactive and safely reusable. An old callback must never inherit the refreshed wrapper's mount identity accidentally.

### DEF-NAV-018: Cross-Module App Variants

App variants are currently confined to the entry file. Before apps can cross module boundaries,
generated variants must derive declaration identity, navigator, and datasource lazily from the
immediate base variant's runtime value rather than emitting references to module-local root symbols.

## Post-Implementation Audit

After each project:

1. Search active specifications, roadmap tasks, apps, tests, stdlib, and prompts for superseded syntax.
2. Migrate executable code only when the replacement feature is implemented.
3. Add behavior coverage to focused Test Apps and WordFlower/1 - Current.
4. Update source actions only for future migrations that are semantically mechanical.
5. Re-enable discovery for individual future-syntax folders only when every discovered file parses, validates, formats, compiles, and tests.
6. Run a targeted stale-reference audit and `./agent verify` before handoff.
