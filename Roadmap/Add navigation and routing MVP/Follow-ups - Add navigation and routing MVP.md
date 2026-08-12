# Follow-ups - Add navigation and routing MVP

Minimal non-normative examples for syntax ideas preserved from the deleted exploration live in `Deferred syntax explorations.md`.

## Ordered Implementation Projects

### FOLLOW-NAV-001: Selection, Split, And Keyed Navigation

Implement typed keyed objects including direct owner-scoped entries, owner-wide target-key uniqueness, explicit keyed-property fallback, `key of Items`, compiler-created selection/split items, static and dynamic SelectionNav, SplitNav, keyed and relative path segments, directional delegation, pane reveal, programmatic target activation, adaptive display including drawer, and occurrence-key behavior.

### FOLLOW-NAV-002: Overlay, Window, And Toast Auxiliaries

Implement app auxiliary registration, OverlayNav, WindowHost/Window, ToastHost/Toast, reducer-owned toast expiration, native dismissal/close events, key-based focus, safe stacking, and platform support diagnostics. Settle refreshed Toast child-occurrence behavior under `DEF-NAV-017` before interactive toasts are admitted.

### FOLLOW-NAV-003: Restoration, Routes, And Entity Recovery

Implement the versioned presentation-state schema, round-trip restoration, invalid-state fallback, loading/missing/unauthorized entity references, stable public route declarations, and deep-link transactions that do not expose internal mount paths. Settle the source-facing restoration API under `DEF-NAV-013` before implementation planning.

### FOLLOW-NAV-004: Dialogue Scheduling

Implement process-local `ask`/`respond`, exactly-once completion, platform cancellation, concurrent ask policy, native-dismiss races, and optional result typing. Durable continuations remain out of scope.

### FOLLOW-NAV-005: Repository Conformance

Complete repository-wide migration from deprecated `alias` to `let`, remove compatibility after cycle and initialization audits pass, finish the visibility-vocabulary migration and remove transitional `project`/`publish` compatibility, remove obsolete push/pop/tab APIs, add source actions only where migration is semantically mechanical, add implemented coverage to WordFlower/1 - Current and Test Apps, and move target/example files out of `.tao-future` only as each becomes executable.

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

Decide whether live entity references crossing `ask` are revalidated automatically, exposed through an explicit availability guard, or restricted to IDs and snapshots. This is separate from presentation-parameter restorability because the suspended action resumes in a changed world.

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

## Post-Implementation Audit

After each project:

1. Search active specifications, roadmap tasks, apps, tests, stdlib, and prompts for superseded syntax.
2. Migrate executable code only when the replacement feature is implemented.
3. Add behavior coverage to focused Test Apps and WordFlower/1 - Current.
4. Update source actions for mechanical migrations such as `alias` to `let`.
5. Re-enable discovery for individual future-syntax folders only when every discovered file parses, validates, formats, compiles, and tests.
6. Run a targeted stale-reference audit and `./agent verify` before handoff.
