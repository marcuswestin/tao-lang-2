# Research - Add navigation and routing MVP

Status: archived research record. The implemented contract is `Spec/Tao Presentation and Navigation.md`; unimplemented work lives in `Roadmap/Add navigation and routing MVP/Follow-ups - Add navigation and routing MVP.md`. Its decisions predate the WordFlower tranches, which reversed the overlay/toast host model in favour of presentation modes.

## Status And Authority

This record consolidates the presentation and navigation exploration into a planning-ready contract. It records rationale and implementation scope; normative language behavior belongs in `Spec/`.

Authority, from highest to lowest:

1. `Spec/Tao Presentation and Navigation.md` and the other active specifications.
2. This research record.
3. `Apps/WordFlower/2 - Next/WordFlower.tao-next`, the settled upcoming product syntax.
4. `Apps/WordFlower/3 - MVP/WordFlower.tao-mvp`, the complete intended product envelope.
5. `.tao-future/tao-navs.tao`, the proposed standard-library surface.
6. `Roadmap/Archive/`, which preserves history but does not define current behavior.

The syntax remains future Tao until its corresponding implementation slice lands. Current implementation status must be stated separately from intended behavior.

## Glossary

- **Definition**: a callable `view`, `ui`, `nav`, action, function, or other declaration.
- **Configured value**: a definition with every required public property bound.
- **Presentable**: a configured `ui` or `nav` value that may enter the active presentation tree.
- **Semantic identity**: definition identity plus normalized bound properties that participate in identity.
- **Occurrence identity**: one presentation of a semantic value; distinct occurrences may share semantic identity.
- **Mount identity**: an occurrence at a stable path in one app or scene instance.
- **Navigation target**: a rooted, uniquely located, or relative path to an active nav mount.
- **Auxiliary nav**: an app-registered overlay, toast, or window host outside the primary root tree.
- **Provider**: a native adapter that reconciles the Tao-owned semantic tree and reports native events back to it.

## Settled Decisions

### DEC-NAV-001: Immutable bindings use `let`

`let Name = Expression` creates a real immutable binding, not textual substitution or a macro. A binding cannot be reassigned. Declarative scopes reevaluate their derived expressions when their dependencies update; an action-local `let` captures the value for that action execution. Reusable code belongs in functions or specialized declarations.

The intended language removes `alias`. Existing implementation support and executable code migrate in the first foundation project rather than being treated as already implemented.

### DEC-NAV-002: `with` derives configured values

`Base with { ... }` creates a new value by replacing named public properties. It never mutates `Base`. Internal `let` bindings are implementation details and cannot be patched. Initial list and keyed-collection behavior is whole-property replacement.

### DEC-NAV-003: Declaration properties are owner-qualified slots

A declaration-body property such as `IdealSize number` defines a distinct slot accepting `number`. Binding precedence is explicit property name, exact owner-qualified slot type, then unique compatible type. Duplicate accepted source types are valid because slot identities differ. Ambiguous elision is an error.

Omitted optional properties have value `none`. Explicit `none` is equivalent at runtime. Defaults are normalized into configured descriptor values so identity and restoration do not depend silently on a later package default.

### DEC-NAV-004: Properties and render children remain distinct

Explicit property entries and keyed entries may fill properties. Ordinary render expressions inside a caller block are children and are never consumed as properties solely because their types match. Named render slots remain a separate typed render-surface concept.

`@name` is the common syntax for an owner-scoped name, while the receiving declaration determines whether that name is a render slot or keyed entry. Direct names share one namespace per configured owner. There is no slot-or-key precedence: duplicates and multi-channel or multi-property matches are validation errors, and an explicit property block resolves keyed-property ambiguity. Only targetable keyed entries form paths such as `WordFlower@home`; render slots never do.

### DEC-NAV-005: `ui` and `nav` are distinct presentables

`ui` is visible presentation content. `nav` is a native-backed or Tao-composed container. `presentable = ui | nav` allows either to enter the semantic presentation tree without making nav a subtype of UI.

### DEC-NAV-006: Nav placement is restricted

A nav may be mounted as an app root, app auxiliary, or child of another nav. Ordinary `view` or `ui` render content cannot mount a nav. A Tao-defined nav renders exactly one root nav descriptor; conditional branches must each produce a valid root rather than mixing fallback UI into another nav's property block.

### DEC-NAV-007: Identity has three layers

Semantic identity, occurrence identity, and mount identity are separate. Stack presentations normally create occurrences. Selection and window hosts may focus an existing semantic identity. An explicit placement key creates independently addressable occurrences of the same semantic value.

### DEC-NAV-008: Explicit targets are strict

Rooted and uniquely located targets resolve through the active mounted tree. Missing, incompatible, zero-match, and multi-match targets produce structured diagnostics and never fall back. Omitted targets delegate from the nearest enclosing nav outward. `in @slot` resolves the nearest unique relative slot and errors on ambiguity.

### DEC-NAV-009: `let` names are not locator identities

Using a configured nav binding as a target evaluates its canonical descriptor, including presentation metadata, and requires exactly one equal active mount. Chained or equivalent bindings locate the same descriptor. This is full descriptor equality, not semantic-content identity. Multiple equal mounts require a rooted or relative path.

### DEC-NAV-010: Presentation and activation share `present`

`present Value in Target` delivers a presentable value to a nav. `present TargetPath` activates or reveals an existing selection item or pane without changing its content. `replace NewRoot in App` replaces the implicit root host and resets prior navigation history.

### DEC-NAV-011: Auxiliaries are explicitly app-owned

Apps register auxiliary navs as direct `@key` entries that bind to the underlying `Auxiliaries { @ nav }` property; the explicit property form remains available. Merely declaring or importing a binding has no mounting side effect. Scene-local auxiliaries may later be registered by scene roots using the same model.

### DEC-NAV-012: Windows use host and occurrence descriptors

`Nav.WindowHost` owns native windows. `Nav.Window { Content, Key, ... }` describes one window occurrence. Ordinary content may be accepted as shorthand and implicitly wrapped. Reusing a key focuses or updates the matching window; distinct keys permit multiple occurrences with the same semantic content.

### DEC-NAV-013: Base nav transition policies are deterministic

- Slot: optional initial content; present/replace set active content; dismiss restores initial or clears, then delegates when already initial/empty.
- Stack: required initial content; present pushes; replace replaces top; dismiss pops, then delegates at root.
- Static Selection: targeting an item activates it; untargeted operations delegate into the active item.
- Dynamic Selection: presentation focuses semantic identity by default; explicit keys distinguish occurrences.
- Split: targeting reveals ancestors and the pane, then delegates to its child nav.
- Overlay: presentations stack; replace changes the top; dismiss removes the top.
- Window host: presentation opens or focuses according to semantic identity and key; dismiss closes the addressed window.
- Toast host: presentation shows or refreshes a transient occurrence; replace updates the addressed toast; dismiss hides the addressed or latest toast.

### DEC-NAV-014: Tao owns one semantic reducer

All Tao navigation statements in one event update the semantic tree synchronously and in source order. Each successful operation advances the revision; an error in a later statement does not roll back earlier effects. Providers reconcile one resulting snapshot. Native back, selection, overlay dismissal, pane collapse, and window close dispatch user-intent envelopes into the same reducer. Provider acknowledgements are a separate idempotent protocol. Provider state is never independently authoritative.

### DEC-NAV-015: Presentation values are restorable

Configured UI and nav properties must be restorable. Entity values are references by default; IDs, cached values, and explicit snapshots remain available. Action and function values are non-restorable even when named. Restored live references may be loading, available, missing, unauthorized, or failed, and UI must handle those states rather than assuming dereference always succeeds.

Persisted state reserves stable declaration IDs, normalized properties, static keys, occurrence keys, mounted paths, and a schema version. Invalid state falls back to the valid initial tree with a structured diagnostic.

### DEC-NAV-016: Dialogue is separate and process-local initially

`present` never suspends. `ask Dialogue ...` suspends one action until `respond Value`, bare `respond`, or platform cancellation. Every ask result is optional. The first implementation is process-local: termination abandons the continuation and active dialogue rather than serializing code execution.

### DEC-NAV-017: Failure behavior is observable

Static ambiguity, incompatible property binding, non-restorable properties, invalid nav placement, and statically impossible targets are validation errors. Dynamic target failures, invalid restored state, and provider failures are structured runtime diagnostics available to tests and Studio. Explicit operations do not silently no-op or fall back.

### DEC-NAV-018: Visibility vocabulary is uniform

The intended visibility names are `file` (default), `package`, `workspace`, and `public`. `public` controls API availability when a workspace is published with `tao publish`; `workspace` remains internal even after publishing.

### DEC-NAV-019: Keyed placement wrappers are compiler-created

Selection items and split panes are targetable forwarding navs, but callers declare only stable keyed entries. The compiler derives wrapper identity, mount path, and forwarding behavior from the owning descriptor and key. A bare relative key is valid only when resolution proves it unique.

### DEC-NAV-020: Provider injections are isolated

Native provider injections receive the canonical descriptor/public properties, mounted semantic subtree, revision and operation IDs, and only the callbacks for native intent, acknowledgement, and rejection. They have no ambient Tao scope and do not receive unresolved references. Unsafe native code is separately visible to validation and tooling and cannot prove restoration or reducer guarantees by itself.

### DEC-NAV-021: Navigation operations have no public result initially

`present`, `replace`, and `dismiss` update the semantic tree and return no user value. Internal occurrence IDs and provider acknowledgements support reconciliation and diagnostics but are not public handles. A later status/handle API requires demonstrated use cases.

### DEC-NAV-022: Reducer operations carry occurrence context

Source operations enter the reducer with an event ID, origin mount, ordered operation number, configured value, optional target, and current semantic revision. Native user intents use their own event ID, affected mount, and observed revision; they are deduplicated and revalidated against current state rather than discarded merely for observing an older revision. Provider acknowledgements separately identify the provider operation and snapshot revision, so stale or duplicate acknowledgements are idempotently ignored. Compiler output calls shared TR navigation APIs rather than emitting reducer helpers.

### DEC-NAV-023: The app root is a typed host

An app requires `Name text` and `Navigator nav`; optional `Auxiliaries` defaults empty. `run` accepts a complete configured app value. The root host accepts only `replace <nav> in <App>`, retains the originating app declaration ID across `with`, and handles exhausted native Back with the platform root-back effect. It does not accept present, UI replacement, or user-authored dismissal.

### DEC-NAV-024: Provider rejection preserves semantic truth

Provider injections receive canonical descriptor data, mounted semantic state, revision/operation IDs, and only the callbacks needed to dispatch native intent, acknowledge, or reject. Runtime rejection leaves committed Tao operations in place, marks the affected mount unrealized, emits a structured diagnostic, and renders the host's recoverable provider-error surface until reconciliation succeeds or semantic state changes.

### DEC-NAV-025: Target-only activation is syntactically path-shaped

`present WordFlower@workspace`, `present @inspector`, and other target-only activation forms require at least one `@` segment. A bare configured nav after `present` is always delivered as content; its parse and type never change with mount count. Configured nav descriptors remain valid targets after `in`.

### DEC-NAV-026: Presentable is a closed sum

`Presentable is ui | nav`. Closed-union branch assignability is lower priority than exact and nominal property matching. This admits configured UI and nav values while rejecting views and dialogues without inventing a second navigation-only argument system.

### DEC-NAV-027: Zero-required declarations apply contextually

A declaration name denotes its callable definition. When a configured-value context expects it and it has no required properties, Tao applies it with zero arguments. Callable-definition contexts retain the definition, and an unconstrained `let` binds the definition unless explicit `{}` application is used.

### DEC-NAV-028: Contextual origin follows surviving ancestry

An event captures its origin nav ancestry. If an earlier operation removes the origin, later omitted-target operations resume from the nearest surviving captured ancestor and never adopt replacement content accidentally. Explicit targets resolve against the current tree.

### DEC-NAV-029: Occurrence replacement never reuses identity

Content replacement retires the prior child and allocates a new occurrence/mount identity. Reveal and focus preserve existing identities. Stable keyed wrapper occurrences may survive content changes while their replaced children receive new IDs. IDs are never reused within an app instance, and provider/native callbacks identify the exact occurrence generation they observed.

### DEC-NAV-030: Delegation and relative search are directional

Delegation tracks visited mounts and never re-enters a child that already returned unhandled. Relative keys search directly owned wrappers one ancestor layer at a time, nearest first, including inactive configured items and collapsed panes; remaining segments then resolve strictly downward.

### DEC-NAV-031: Toast expiry is semantic input

The runtime schedules toast expiration into the reducer using host, occurrence, and generation identity. Keyed refresh increments generation and invalidates older timers. Providers report early native dismissal rather than removing local state independently.

### DEC-NAV-032: Stable declaration identity is deferred

The current tranche uses process-local semantic and occurrence identities. A checked-in project ID,
stable declaration-ID algorithm, persistence, restoration, and routes remain explicit follow-ups and
must not be prerequisites for StackNav, SlotNav, OverlayNav, or app-root operation semantics.

### DEC-NAV-033: Targetable keys use one owner namespace

Literal `@key` entries may appear directly in a configured declaration and bind by owner-qualified entry type to its unique compatible keyed-collection property. Every targetable key owned by that configured declaration must be unique across its targetable keyed properties, whether supplied directly or through an explicit property. Nested configured declarations begin new namespaces, while ordinary non-targetable keyed data remains property-scoped. Structural property names such as `Items`, `Panes`, and `Auxiliaries` remain in descriptor data but never appear in navigation target paths. Explicit property wrappers remain available for empty, computed, prebuilt, or ambiguous collections. Direct entries under `with` replace the complete matched collection and do not merge keys.

## Rejected Alternatives

- Separate `screen`, `overlay`, `toast`, and `window` destination declarations duplicated presentation semantics and were replaced by UI plus nav policy.
- `present ... as overlay` exposed native placement at the call site and was replaced by targeting an overlay host.
- Best-effort explicit target fallback made refactors silently change behavior and was replaced by strict target diagnostics.
- Configurable presentation strictness was removed; development and production share semantics.
- `WindowNav { Host ... }` and declaration side effects were replaced by explicit app auxiliary registration.
- Public nav state and assignment into a definition were rejected; reducer state is private to mounted occurrences.
- Macro-like `alias` was rejected in favor of immutable real `let` bindings and functions.

## First Implementation Scope

The full target MVP retains its `Design` and `Datasource` capabilities. They are intentionally absent from the in-between `WordFlowerFoundationTest` app so navigation foundations can become executable without pulling either capability implementation into this slice.

The next implementation project contains only:

- Add immutable `let` and retire `alias`. Migrate only semantically equivalent bindings required by this slice; do not blindly rewrite declaration-like or cycle-sensitive aliases.
- Owner-qualified declaration properties, optional/default normalization, zero-required contextual application, invocation binding, configured-value `with`, and the minimal closed-union grammar/assignability required by `Presentable`.
- Core UI/nav descriptor and extensible target IR.
- Process-local semantic and occurrence identities, canonical configured descriptors, and structural descriptor equality sufficient for one app run. Stable project-derived IDs, restorability validation, and persistence remain deferred.
- The configured app schema, `run` of configured app values, root hosting and root-operation compatibility, SlotNav, and StackNav. Existing executable root-view apps must migrate atomically or use an explicitly temporary compatibility bridge with removal criteria.
- `present`, `replace`, and `dismiss` with contextual delivery, configured-descriptor targets, and the active app root target. Keyed path segments, relative keyed targets, and target-only activation land with Selection and Split.
- A pure semantic reducer, source/native intent envelopes, separate revisioned provider acknowledgements, the provider payload/rejection contract, and native back reconciliation.
- The `file`/`package`/`workspace`/`public` vocabulary for declarations needed by this slice, with the former visibility words retired. Unrelated repository-wide migration remains follow-up work.
- Focused parser, formatter, resolver, validator, compiler, runtime, source-action, Test App, and WordFlower migration work required by that slice.

Keyed collection syntax/scoping beyond app-owned auxiliaries, compiler-created keyed wrappers, Selection, Split, Window, Toast, persisted restoration/routes, stable project IDs, and Dialogue remain documented target behavior but are follow-up implementation projects. The WordFlower Next tranche includes app-owned OverlayNav auxiliaries, strict configured and `App@key` targets, and process-local identities.

## Traceability

| Capability                                  | Decision                                                     | Normative spec                                   | Intended example                                     | Planned executable coverage                                                         |
| ------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `let`, properties, `with`, zero-application | DEC-NAV-001..004, DEC-NAV-027                                | Tao Type System                                  | MVP-Writer bindings and configured navs              | Foundation parser/type/formatter fixtures                                           |
| UI/nav roles, placement, and sum type       | DEC-NAV-005..006, DEC-NAV-026                                | Tao Presentation and Navigation                  | WordFlower root and composed navs                    | Union and placement validator fixtures                                              |
| Identity and targeting                      | DEC-NAV-007..010, DEC-NAV-025, DEC-NAV-028..030, DEC-NAV-032 | Tao Presentation and Navigation; Tao Packages    | WordFlower duplicate editors and inspector paths     | Reducer, lifecycle, and target-resolution tests                                     |
| App root, auxiliaries, and windows          | DEC-NAV-011..012, DEC-NAV-023                                | Tao Presentation and Navigation                  | WordFlower app/root and overlay/toast/window hosts   | Root tests plus follow-up auxiliary-provider tests                                  |
| Transition and provider semantics           | DEC-NAV-013..014, DEC-NAV-022, DEC-NAV-024, DEC-NAV-029..031 | Tao Presentation and Navigation                  | WordFlower navigation actions and foundation harness | Pure reducer, identity-generation, timer, provider rejection, and native-back tests |
| Restoration and entities                    | DEC-NAV-015                                                  | Tao Presentation and Navigation                  | WordFlower restorable document UI                    | Follow-up round-trip and missing-entity tests                                       |
| Dialogue                                    | DEC-NAV-016                                                  | Tao Presentation and Navigation                  | WordFlower confirm-close dialogue                    | Follow-up suspension/cancellation tests                                             |
| Diagnostics                                 | DEC-NAV-017                                                  | Tao Presentation and Navigation; Tao Testing     | WordFlower invalid examples as comments              | Validator/runtime diagnostic fixtures                                               |
| Visibility                                  | DEC-NAV-018                                                  | Tao Packages                                     | Target package examples                              | Package discovery and visibility tests                                              |
| Keyed forwarding wrappers                   | DEC-NAV-019, DEC-NAV-033                                     | Tao Presentation and Navigation; Tao Type System | WordFlower selection items and split panes           | Follow-up keyed-target and owner-namespace tests                                    |
| Provider isolation                          | DEC-NAV-020                                                  | Tao Presentation and Navigation                  | Nav stdlib injection contracts                       | Provider boundary tests                                                             |
| Operation result surface                    | DEC-NAV-021                                                  | Tao Presentation and Navigation                  | WordFlower fire-and-forget actions                   | Type and reducer tests                                                              |

The per-provider behavior suites must cover at least Slot initial/restore/delegation, equal-identity Stack pushes and top replacement, static and dynamic Selection focus, Split reveal/forwarding, Overlay stacking/replacement, keyed Toast refresh plus stale expiry, same-key Window focus/content update, wrapper incompatibility, retired-occurrence callbacks, and exhausted native Back.

## Preservation Ledger

Before cleanup, unique material was classified as follows:

| Removed source                             | Preserved destination                                                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `MVP-Writer-2.tao`                         | DEC-NAV-001..033, the presentation spec, WordFlower, and the nav stdlib stub                                                                 |
| `Decided/001-core-presentation-intent.tao` | Presentation roles, restorability, entity references, and dialogue sections in the presentation spec                                         |
| `@ToBeDecided/002..007`                    | `Deferred syntax explorations.md`, `DEF-NAV-002`, `DEF-NAV-007..011`, `DEF-NAV-013`, strict diagnostics, provider isolation, and restoration |
| `@ToBeDecided/MVP-triage/001..030`         | `Roadmap/Deferred Tao language decisions.md`; navigation-specific routes moved to `DEF-NAV-001`                                              |
| Former `@ui/ui.tao` presentation lab       | Authoritative WordFlower coverage, `DEF-NAV-008..011`, and the canonical app family in `Apps/WordFlower/`                                    |
| Orphaned `Apps/MVP/`                       | `Roadmap/Deferred Tao language decisions.md`, including conditional chrome as `DEF-NAV-012`                                                  |

Committed historical alternatives remain recoverable from Git history. Material that existed only in staged or uncommitted sketches is preserved by the active records above; the removed Tao files no longer compete with the specifications.

## Review Outcome

Context-free architecture and stringent reviews found and resolved gaps in app-root compatibility, native-intent versus provider-acknowledgement envelopes, provider rejection, stable descriptor construction, closed-union assignability, zero-required application, dependent keyed types, occurrence lifecycles, directional delegation, relative targeting, toast expiry, visibility scope, deterministic foundation tests, and preservation detail.

The repo-owned external reviewer wave produced no usable third-party result because providers were unavailable or stalled; its evidence remains under `.artifacts/skills/subagents-review/20260721-165248.865-ijivcb-mvp4-nav-architecture/`. Independent read-only Codex reviewers supplied the substantive findings, which were verified against live files before incorporation. The one intentionally unresolved review warning concerns the pre-existing Git index: this preparation is forbidden from changing it, so a direct commit of the current index is unsafe until Ro explicitly stages the final worktree state and separates any unrelated staged changes.

## Planning Conclusion

The WordFlower Next tranche absorbed the executable process-local foundation: configured apps,
StackNav, SlotNav, OverlayNav auxiliaries, strict targets, contextual presentation, dismiss,
replacement, and unified Back. Selection, Split, Window, Toast, stable IDs, restoration, routes, and
dialogues remain in the ordered follow-ups above.
