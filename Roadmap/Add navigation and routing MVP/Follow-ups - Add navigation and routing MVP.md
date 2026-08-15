# Follow-ups - Add navigation and routing MVP

This is the live record of navigation work that is still unimplemented. The implemented contract
lives in `Spec/Tao Presentation and Navigation.md`; the research record and its ledgers are archived
under `Roadmap/Archive/Add navigation and routing MVP/`. Rationale for the families below survives
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
directional delegation, pane reveal, and occurrence-key behavior. Next's `Panes()` is a responsive
visual layout container, not a navigation kind and not an implicit `SplitNav` decision.

### FOLLOW-NAV-002: Window Auxiliaries And Toast Delivery

App auxiliary registration and keyed toasts as an app-level presentation mode ship in Current.
Still open here: `WindowHost`/`Window` as keyed auxiliaries, deterministic test-clock control for
toast expiry, native dismissal and close events, key-based focus,
safe stacking, and platform-support diagnostics. `DEF-NAV-017` blocks interactive toasts and must be
settled while toasts are implemented.

### FOLLOW-NAV-003: Restoration, Routes, Entity Recovery, And Project Identity

Implement the versioned presentation-state schema, round-trip restoration, invalid-state fallback,
stable public route declarations, and deep-link transactions that do not expose internal mount
paths. Loading, missing, and unauthorized entity-reference guards ship in Current. Settle the
source-facing restoration API under
`DEF-NAV-013` before implementation planning.

Restorable descriptor identity depends on a checked-in project ID, whose contract is settled:

- Every project forming restorable UI or nav descriptors has one opaque immutable `id` in its
  project metadata; Tao never generates identity.
- `tao create <id>` uses the new project's directory name as the checked-in ID, and
  `tao project id <id> [path]` migrates an existing project as a deliberate, reviewable command.
- Clones and published artifacts retain the ID; an independent fork supplies a replacement with
  `--replace`.
- A missing ID produces a diagnostic naming the migration command. It never falls back to a
  filesystem path, remote URL, lockfile key, or per-run value.

### FOLLOW-NAV-004: Dialogue Scheduling

`dialogue … responds`, `ask`, and `respond` with optional results ship in Current. Still open here:
exactly-once completion guarantees, platform cancellation, concurrent-ask
policy, and native-dismiss races. Durable continuations remain out of scope under `DEF-NAV-005`.

### FOLLOW-NAV-005: Repository Conformance (absorbed)

The absorbed WordFlower tranche migrated executable sources to `let`, retired the former binding and
visibility spellings, removed obsolete source navigation APIs, and added Current/Test App coverage.
Future work adds source actions only where a later migration is semantically mechanical.

## Deferred Design

### DEF-NAV-001: Exact Route Declaration Syntax

Choose route declaration spelling after descriptor, target, and restoration IR exist. Public routes map stable names and restorable parameters to semantic transactions, never raw internal paths.

### DEF-NAV-002: Custom Restoration Migration Syntax

The first restoration implementation stores a schema version and falls back on incompatible state. Custom application-authored migrations wait for real versioning pressure.

### DEF-NAV-003: Multiple Scenes And Spatial Presentation

Scene addressing, scene-local roots, spatial/immersive presentation, widgets, and complications wait for additional runtime targets. Current target types reserve app/scene identity without exposing scene syntax.

### DEF-NAV-004: Advanced Window And Popover Geometry

Persisted geometry, platform placement constraints, detached panels, popover anchor geometry, and advanced native chrome wait for auxiliary navigation to work end to end.

### DEF-NAV-005: Durable Suspended Workflows

Serializing or reconstructing suspended actions is not part of `ask`. Durable workflows must use explicit application state until a separate continuation model is designed.

### DEF-NAV-006: Navigation Guard And Lifecycle Syntax

The semantic reducer must reserve interception and lifecycle events, but exact source syntax for unsaved-change guards, appear/disappear/focus/blur, queueing, and cancellation waits for the core reducer and native event loop.

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

### DEF-NAV-013: Restoration Ownership And Source API

Decide whether restoration is entirely app-host-managed or also exposes explicit `serialize presentation`, `deserialize presentation`, and app-restore hooks. The runtime schema and fallback semantics are settled, but the deleted exploration's exact source syntax was only a sketch and must not become an API accidentally.

### DEF-NAV-014: Auxiliary Restoration Policy

Toasts and active dialogues are never restored. Decide whether overlays and windows restore automatically, opt in per host or occurrence, or always start empty before implementing persisted auxiliary state.

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
