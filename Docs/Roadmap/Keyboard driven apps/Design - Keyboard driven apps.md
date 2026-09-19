# Keyboard driven apps — design

The design record for the interaction system (`Roadmap.md`, Toward v1: "Implement the interaction
system"). `Docs/Roadmap/Tao Revolution/Decisions.md` is authoritative; the design summary records
the rationale and the discovery record beneath it preserves the investigation, terminology, question
set, and story sweep. A live contradiction is reconciled into `Decisions.md` and the executable
specification rather than allowing this dated design record to outrank them. The archive stays frozen
unless Ro asks.

Status: **discovery closed** (KEY-D1–D14); **the T1–T5 core is implemented and absorbed, including
T3½** (2026-09-03). The implementation plan owns a complete ledger of decided behavior still to
land around that core. T6 is deferred for lack of a tracked native build path and T7 is complete.
Two decisions were revised under review — the shell and the command shape, above. Deferred design
questions: Q14 (authority), Q18 (deep links).

Note on evidence: the codebase investigation ran on 2026-09-01 against a working tree carrying the
then-unmerged repository-simplification content, which has since landed on `main` (merged into
this branch 2026-09-01), so cited paths — `Apps/Test Apps/` reorganization included — match `main`
again. The simplification was re-reviewed after the merge: every seam file this ledger cites
survives, intent `Title`/`Description`/`Summary` metadata was explicitly kept, and
`tests.langium` gained `RelaunchStep` — further evidence the test-step seam extends the way KEY-Q26
assumes. The formerly latent `do <command>` parsing defect is fixed; this paragraph records the
historical investigation, not a current defect. Line numbers still drift; symbols are the stable
reference.

---

## Objective / north star

Applications written in Tao are keyboard-driven by default, with high-quality behavior derived
automatically from the ordinary structure and semantics of the app, and minimal explicit developer
intervention. Substantially richer than Tab-cycling:

- rapidly move cognitive attention between meaningful parts of the application;
- identify things on the visible screen efficiently, including by typing part of their visible label;
- distinguish pointing at something from selecting it from activating it;
- discover what actions are available for a thing (noun-first) and what things an action applies to
  (verb-first);
- contextual single-key or short-sequence interaction where appropriate;
- discover the current possibilities visually through generated overlays/help;
- navigate both the rendered UI structure and the application's actual navigation/data structure;
- keep ordinary text editing, search fields, and application filtering untouched by and clearly
  distinguished from the targeting machinery.

The result is a language/runtime design — what Tao means, what it derives, what developers may
express — not per-app shortcut tables.

**Framing (decided, KEY-D1):** one derived semantic model with many consumers — keyboard first,
the same derived information feeding accessibility, the palette, the `Assistant` projection,
generated overlays, and test selectors, so keyboard interaction is one reader of a semantic layer
rather than a parallel model.

---

## The design — summary of KEY-D1–D14

### One interaction system

**The interaction system** (`TR.Interaction`) has two halves, the way "navigation" has a reducer, a
registry, and hosts. **The interaction outline** is a derived, strictly read-only model of the running
app: regions, collections, collection items, action controls, input controls — each with identity,
label, and provenance. **The attention reducer** owns attention state — region focus, candidates,
target, engagement — and interprets every interaction, in every modality, into semantic operations
dispatched to commands and the navigation reducer. Keyboard interaction is the first consumer; the
same outline feeds accessibility, the palette, the assistant boundary (Apple App Intents), generated
overlays, and tests. Consumers read the outline and dispatch through commands and the navigation reducer; nothing mutates
through it.

### Language constructs (amendments to Decisions §2, §8–§11, §13, §15, §16, §18)

- **`scene is view`** — the one home for host-facing chrome: `Title`, `Toolbar`, and later LANG-035
  slots. Scenes are presented, never composed inline. A plain `view` may still be pushed or
  presented anywhere; a pushed plain view shows Back-only header chrome. Sheets read neither
  `Title` nor `Toolbar`.
  `nav is scene`. A presented scene is a region.
- **The shell is a view** (revised 2026-09-02, superseding the frame nav kind decided under KEY-D7
  and briefly implemented). A render site may name a nav — `nav is scene is view`, and the grammar
  agrees — so persistent chrome around navigated content is ordinary layout: a `Col` holding the
  navigator and a bar. The app is rooted in that view with arguments (`view Shell(Navigator)`), and
  a nav-typed parameter renders like any other view. Three invariants, diagnosed at the render site:
  a nav renders at most once, never in a loop, never in a conditional branch. A conditional sibling
  is fine, and that is what the focus bar is. Back reaches a rendered nav through its enclosing
  presentation. SplitNav keeps its job; the rail retires into ordinary layout. The `@name` sigil
  stays with named render slots, which a shell's edges never were. WordFlower's focus bar is the
  forcing feature, its session held as `local only` data.
- **`command`** — a configured value (the `app`/`nav`/`design` family) that **declares its slots in
  a parameter list, exactly as an action does** (revised 2026-09-02: `command Like(Track Song) { … }`;
  the block holds only member fills and one `do`, so juxtaposition means one thing inside it — bind).
  Metadata members are `Title` (static), `Description`, `Summary` (with holes), `Label` (reactive),
  `Icon`, `Key` (a `shortcut` value, e.g. `primary + "n"`), `Enabled`; the behavior is exactly one
  `do` of a named or inline action. `do Like(Track)` invokes, mirroring `do SaveWorkspace()`;
  `Like with { Track: Selected }` derives a bound command value for surfaces, and `with { Key "k" }`
  overrides affordances (never `Title`). `do X with { … }` is retired. `action` is private: no `Title`, never surfaced.
  Commands are declared at module level (entity verbs, app-wide commands) or in a view body (closing
  over the view's scope, exactly as `action` may). Retired: `Title` on `action`, "an action is an
  intent", `command X = Y(args) with { … }`, the in-view `menu Name { … }` surface (the per-view
  `Commands` slot is the ordering mechanism), and `present … as palette` (the palette is runtime-owned);
  `present … as menu` stays.
- **Entity policy** in the `data` block: `Name text (title)` names the display title (one per
  entity); `commands Play, AddToQueue` is the default surface in order; `commands hide Delete`
  surfaces only where a view lists it.
- **View mentions**: a scene's `Toolbar { AddToQueue, Like with { Key "l" } }` (chrome; the braced
  reference block is grandfathered from §9); any view's `Commands { … }` (item prominence) and `hide X`. Mentions are unfilled; the surface fills slots
  from the target by type at invocation.
- **App**: `view` (the root view, which may be a nav or a shell rendering one), `Menus list of Menu` (typed literal with required brackets;
  derived from entity `commands` lists plus app-wide commands when absent), and
  `Assistant { Entities { Track as documents.document (…) }  Commands { … } }` with inline schema
  conformance. `Palette all` retires — the palette is always present.
- **Unchanged**: `loop` / `on select` (activation), `Key primary + "n"`, links (deferred: a titled
  link will be a navigation command and an Apple `OpenIntent`).
- **Test steps**: `press key "…"` and `narrow "…"` (`narrow` replaces KEY-D13's colliding `type`
  spelling), with target, focused-region, and verb assertions through the existing step seam.

### What is derived, never declared

Regions (selection items, split panes, presented occurrences — scene or view — and the coalesced
non-nav sibling subtree of a view that renders a nav). Collections (loops) and their
items (row identity). Controls from event wiring (`Press`/`Submit` → action control; `Value:` +
`Change` → input control). Labels: statically ranked from the row's rendered text — the first
row-bound text, preferring the `(title)` field when the row renders it — one computation shared by
the outline and selectable-row accessibility projection. Provenance tiers 1–2 (entity + handle per
item; loop identity + entity per collection), never query semantics. Activation = the control's own
wiring. Verbs = every command whose slots the target's type can fill, anywhere in the app. Apple's
View Annotations, `NSUserActivity`, and Spotlight indexing from the outline, presentation, and
`(search)`. Default menus. Key allocation.

### Runtime behavior

- **Targeting is free**: committing a target has no effect; only activation and verbs do. So
  targeting is eager — arrows move the target, one remaining candidate auto-targets.
- **State**: one region focus; per region a remembered target (one for now), narrowing text with
  derived candidates, engagement. Modes (navigating, narrowing, engaged, verb-pending, overview,
  hints) are derived, never stored. Runtime-owned, condition-observable, never `set`, never restored.
- **Modality-neutral**: tap = target + activate; click into an input = focus region + target +
  engage; long-press/right-click = target + verbs (the context menu is the verb menu); click empty
  space = region focus; hover = `hovered` only; drag = target then a verb on drop; scroll = nothing.
  The platform adapter projects Tao attention outward with web focus and React Native accessibility
  focus requests. Platform focus enters Tao controls and selectable rows where React Native emits a
  focus event; screen-reader cursor movement is not generally synchronized back into Tao attention.
- **Narrowing**: letters narrow by default; case-insensitive, locale-aware word-prefix matching over
  the node's full rendered text, a space starting a further prefix that matches the first later word
  (`d w` → Discover Weekly); candidates are the region's items and controls; non-matches are
  subdued, not removed; the domain is mounted nodes first, the loop's rows as a later stage; never a
  store query.
- **Verbs**: the verb key on a target lists commands in tiers — view `Commands`, rendered inner
  controls, the entity's `commands` list, the rest alphabetically, folding; bare single-letter `Key`s
  are accelerators inside this layer; modifier chords act directly. Verb-first: a command with an
  open slot enters verb-pending — candidates across the whole screen, a store-backed `(search)`
  picker as fallback, inline input for text/duration slots, required slots in declaration order.
- **Precedence, nearest wins**: engaged input → modal occurrence → targeted item → focused scene →
  app-wide → reducer keys. Duplicate chords in one scope are a diagnostic.
- **Engagement**: platform text-editing chords win; Escape disengages keeping the target; palette
  and non-colliding app chords pass through; Enter submits or newlines by control; Tab disengages to
  the next control.
- **Descending**: a collection item's inner controls are reached by descending into it; Escape
  ascends; no flat order. **Re-aim**: unmounted or collapsed region → primary content region; modal
  occurrence traps focus, dismissal returns via a focus stack that is not Back history; movement
  with no targets scrolls.
- **Surfaces**: hints, overview, verb menu, palette, help are renderings of outline + attention +
  bindings as floating anchored layers (the LANG-018 concept, floating only), on demand, outside
  Back and hidden from a11y traversal when not shown. Keyboard affordances appear after the first
  hardware keypress.
- **Performance**: existence is always registered (cheap), evaluation and subscriptions run only
  while a consumer is attached; staged behind one stable read surface.

### Boundaries

`TR` is handwritten only; generated outline metadata lives in generated modules and is passed into
`TR.Interaction.Register(…)`. The outline is read-only. Navigation operations dispatch the navigation
reducer, never mutate mounts. Provenance is never a test selector. Exposure: in-app surfaces are
broad by default with explicit exclusions; the OS/agent boundary is allow-listed.

### Deferred and dependencies

The implementation plan's **Remaining decided implementation** ledger is authoritative for every
unlanded part of KEY-D1–D14. It includes authority gating, titled links and app-structure navigation,
multi-target interaction, ordered movement, broader datasource scoping, key-allocation overrides,
LANG-035 scene slots, App Intents, native menus and keys, and the adapter and generated-surface tail.

---

## Where this sits among existing decisions

This effort has far more decided substrate than a fresh feature. `Decisions.md` already owns:

| Decided (§)       | What it gives this effort                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §8 Intents        | `action`/`transaction` with `Title`/`Description`/`Summary` **is** the discoverable verb; entity-typed parameters are "the disambiguation policy… a noun a surface can resolve"; availability answered by authority (`can change Recipe`). |
| §8 Commands       | `command X = Intent(args) with { Label, Icon, Key, Enabled }`; **"Commands scope to focus"** — enabled while the nearest presented instance of the declaring view holds focus; app-level commands.                                         |
| §8 Surfaces       | `Toolbar`, `menu Name { … }`, `Menu` (OS), `Rail`, `Palette all`, `present … as menu / as palette`; "surfaces list commands; a command never names its surface".                                                                           |
| §8 Shortcuts      | `Key primary + "n"` — platform-abstract, never `cmd`.                                                                                                                                                                                      |
| §9 Collections    | `loop` is the one iterator and keys by row id; `on select` is the collection-owned selection; `Grid`/`Pages` wrap loops.                                                                                                                   |
| §9 Accessibility  | "part of the model": semantic labels, focus as declared product behaviour, design `rules { }` rejecting unnamed interactive elements.                                                                                                      |
| §9/§13 Conditions | `pressed`, `focused`, `hovered` are ordinary `when` condition vocabulary.                                                                                                                                                                  |
| §10 Navigation    | `StackNav`/`SlotNav`/`SelectionNav`(`TabNav`)/`SplitNav`; `focus @slot` in link bodies; reveal-or-focus; Back is a semantic reducer Tao owns on every platform.                                                                            |
| §16 Testing       | steps select by visible text or `#tag`; the world is controllable.                                                                                                                                                                         |

Deferred/reserved items this design will touch, and should resolve or consciously leave reserved:

- `DEF-NAV-006` — focus/blur/appear/disappear lifecycle syntax (reserved in the reducer). The
  `DEF-NAV-*` items live in `Docs/Roadmap/Add navigation and routing MVP/Follow-ups - Add navigation
  and routing MVP.md`; the `LANG-*` items in `Docs/Roadmap/Deferred Tao language decisions.md`.
- `DEF-NAV-007` — public occurrence handles/results for presentations.
- `DEF-NAV-012` — conditional chrome tied to active selection, "without making presentation state
  directly mutable".
- `DEF-NAV-016` — addressing a particular occurrence (window/toast/selection) by runtime key.
- `LANG-018` — overlay families ("action, input, form, menu, and mode" overlays preserved as cases).
- `LANG-020` — events and lifecycle (only `press`/`change`/`submit` exist).
- `LANG-023` — accessibility and localization metadata shape.

---

## What the implementation has today

Condensed from a four-track codebase investigation (UI/rendering, actions/state, data/entity,
navigation/runtime). Line numbers are as of 2026-09-01 and will drift; symbols are the stable
reference.

### Statically known at compile time

- The exact `EntityDataField` behind any member-path binding — `Type.dataFieldOfMemberAccess`
  (`packages/ast-utils/ast-utils-src/Type.ts`). "Which entity field does this `Text` display" is
  already answerable.
- The entity behind any query, loop collection, or view parameter — `Type.queryEntity`,
  `Type.entityOfReference`, `Type.ofExpression`.
- Full query plans (entity, filters, order, limit) — materialized as literals by `DataCompiler`,
  then discarded at runtime.
- Loop occurrences: collection expression, item binder, owning view name + exact source span —
  already emitted **unconditionally** to the runtime as the error-boundary frame
  (`FunctionalCoreCompiler.ForStatement`).
- Which view parameters are event slots (`Press`/`Change`/`Submit` typed `action(…)`), whether an
  argument is a literal label or a data expression, `#tag` attachment, layout clause structure,
  containment (enclosing loop/when/guard/view).
- Command metadata (`Label`, `Icon`, `Key`, `Enabled`) and intent `Title`/`Description`/`Summary`.

### Known at runtime

- Tao owns the entire navigation reducer — no React Navigation/Expo Router anywhere. Occurrence
  state is plain data (`TR-navigation-state.ts`); every Back source (visible affordance, Android
  hardware, browser popstate, sheet swipe, test step) funnels through one reducer entry
  (`TR-navigation-value.ts`, `TR-navigation-app.ts`).
- `TaoProps.navigationHostActive` — an existing, crude "which region owns input" bit: the focused
  auxiliary/selection item propagates it, and the basic stack host already **disables commands when
  not observable** (`TR-navigation-basic-stack.tsx`). The only focus concept in the system.
- `RuntimeHostReadChannel` publishes the directly presented view's `Title` + commands as data —
  labelled, enabled, invokable, with stable identity and a diffing snapshot
  (`TR-navigation-host-slots.tsx`). The one place semantic affordances already exist as data.
- Entity handles are interned per (entity, id) with a stable enumerable `.Id`; `stableListKey`
  already derives React keys from `Id`/`id`. Entity-name introspection exists but is
  package-private (`metadataOf` in `TR-data-entity.ts`); `TR.Data` exposes no schema introspection.
- Intent metadata is runtime-readable per invocation (`TR.ActionTitle`/`Description`/`Summary` —
  reactive closures over the action's own arguments, built for palettes/Siri; `Title` is the toolbar's
  label fallback and is required before an action can be bound as a command, while `Description` and
  `Summary` are consumed by nothing).
- `TR.Capture` registered domains give any subsystem serializable, versioned state participation.
- Test harness reset boundaries (`beginTest`/`beginLaunch`) and the `observable`-gated
  private-testID pattern for making a host surface assertable.

### Absent — would be invented by this design

- Any keyboard event surface: no key listener, dispatcher, registry, or `primary` modifier.
  `command … Key` is parsed, compiled, stored on the runtime command — and read by nothing.
- Any focus model in language or runtime beyond `navigationHostActive`: no `focus` keyword, no
  `on focus`/`on blur`, no focus order, ring, or trap. (On web, react-native-web makes Pressables
  tab-reachable _by accident_, with no Tao model behind it.)
- Any element↔label map: visible strings exist only as React children of `RN.Text`; plain `Text`
  renders `accessible: false`. No entity display-label concept (`Title` is a view/intent slot, not
  a schema fact).
- Any runtime enumeration of actions or commands (registries exist for navs/apps/presentables, not
  actions); no app-level commands implemented (validator rejects them); no `menu`/`Menu`/`Rail`/
  `Palette` grammar; no `as menu`/`as palette` modes.
- Any data-provenance channel to rendered elements: `TaoProps` carries `testTag`, layout, and
  (Studio-gated) source identity — no entity, no collection, no query.
- Any selection state: `on select` fires a callback; nothing holds "the selected row".
- Test steps for keys or focus; `fireEvent` keyboard dispatch.
- Positioning/z-order vocabulary in Tao layout (overlay layers are runtime-owned only).
- A desktop app target (iOS/Android/web today; desktop packaging exists only for Studio).

### Seams the design should exploit

| Need                                      | Existing seam                                                                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-element Tao metadata channel          | `TaoProps`/`__tao` lowering — the single choke point where every native root gets Tao metadata (`TR-TaoProps.ts`)                            |
| Per-occurrence source identity at runtime | the Studio identity mechanism (proves the channel works); the unconditional loop frame                                                       |
| "Labelled invokable affordance as data"   | `RuntimeHostReadChannel` + `TaoNavigationCommand`                                                                                            |
| Global platform-input attachment          | `usePlatformBack` / `activeBackTarget` (`TR-navigation-app-host.ts`, `TR-navigation-registry.ts`) — a key dispatcher is their exact analogue |
| Region activity                           | `navigationHostActive` propagation                                                                                                           |
| App-scoped layer above all content        | the toast layer sibling (`TR-navigation-app-host.ts`) — the natural home for a generated hint overlay                                        |
| State-preserving hide + a11y removal      | `NavigationLevel` (`TR-navigation-surfaces.tsx`)                                                                                             |
| Serializable subsystem state              | `TR.Capture.register`                                                                                                                        |
| New test step shape                       | `surface=ID` + literal validation (`tests.langium`, `tests-validator.ts`)                                                                    |
| Platform-abstract `primary` modifier      | Studio's `isStudioSaveShortcut` (`metaKey \|\| ctrlKey`)                                                                                     |
| Palette index/filter model                | `StudioCommandPalette` (pure, testable)                                                                                                      |

One ownership rule any new subsystem must respect (`Docs/Spec/Tao Presentation and
Navigation.md`): the reducer owns occurrence identity, history, overlay precedence, and Back — a
keyboard resolution that lands on a navigation operation must dispatch through
`NavigationControls`, never mutate mounts.

---

## Terminology (settled — KEY-D3)

The vocabulary, settled through three naming iterations (the option space and rejections are
preserved under KEY-Q27). One domain; _interaction_ qualifies structure, _attention_ qualifies
state; _intention_ and _navigation_ are banned as qualifiers. Each term's qualified full form
serves isolated contexts; the bare short form serves in-context prose.

| Term                                                 | Meaning                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **the interaction system** (interaction)             | The subsystem as a whole — one conceptual home for both halves, facade `TR.Interaction`, precedent "navigation". Owns the internal two-way flow: input → reducer → outline consult → dispatch; mount/unmount → outline → state revalidation.                                 |
| **interaction outline** (the outline)                | The derived, strictly read-only semantic model every consumer reads: regions, collections, collection items, controls — with identity, labels, applicable verbs. Consumers read it and dispatch through commands and the navigation reducer, never mutate through it.        |
| **attention reducer**                                | The runtime state machine owning attention state (region focus, candidates, target, engagement) and interpreting input into semantic operations. "Back dispatches the navigation reducer; keys dispatch the attention reducer."                                              |
| **interaction region** (region)                      | A part of the screen a person can direct attention to as a unit: a nav pane, a presented view, persistent chrome like a player bar.                                                                                                                                          |
| **interaction collection** (collection)              | A `loop` occurrence's node: repeated content over rows, knowing its data collection, ordering, and currently represented members.                                                                                                                                            |
| **collection item**                                  | One member of a rendered collection, carrying entity identity and visible label; what is narrowed to, targeted, and given verbs.                                                                                                                                             |
| **control** — **action control** / **input control** | Anything interactable. An action control activates (button, link, a row's select); an input control accepts values or text (field, stepper, slider).                                                                                                                         |
| **region focus** (focus)                             | Which region input is aimed at. Cheap, reversible, outside Back history. Anchors decided `focus @slot`.                                                                                                                                                                      |
| **candidates**                                       | The set of things still consistent with what has been typed/navigated toward; shrinks under narrowing; one remaining candidate becomes the target (targeting is free — KEY-D8).                                                                                              |
| **narrowing**                                        | Typing part of a visible label to shrink the candidates. Operates only on what the UI represents — never a data query, never app filtering.                                                                                                                                  |
| **target** (isolated: attention target)              | The committed thing(s) — "that one" — which verbs apply to; noun and verb; exists before any verb is chosen.                                                                                                                                                                 |
| **activation**                                       | Running a control's own wired operation — derived from ordinary event wiring (`on press`, `on select`, toggle, submit; activating an input control begins engagement). Never a declared "primary" mark; a collection item without `on select` has no activation, only verbs. |
| **engagement** (engaged)                             | An input control owning input across modalities: "an engaged input control captures input." Leaving it restores targeting.                                                                                                                                                   |
| **verb**                                             | An applicable command (KEY-D10) for a target — or verb-first, a command with an open entity slot seeking its target.                                                                                                                                                         |
| **interaction hints** (hints)                        | The generated what-can-I-do layer; **key hints** is its keyboard-specific flavor.                                                                                                                                                                                            |
| **interaction overview** (overview)                  | The generated areas-of-this-screen mode: regions highlighted, a key to enter each.                                                                                                                                                                                           |

Boundary rules riding the vocabulary: `TR` contains only handwritten code (authorship, not
audience, is the line) — generated metadata is emitted into generated modules and passed into
`TR.Interaction.Register(…)`, never attached to `TR`. The former `on select` collision is
resolved by this vocabulary: `on select` wires a collection item's _activation_; _target_ names
commitment, which `on select` never meant.

---

## Working model (the first sketch — superseded by the design summary)

The decomposition the exploration produced, restated against Tao:

1. _"I want to work with Your Library"_ → region focus changes (nav pane / presented occurrence).
2. _"I mean one of these playlists"_ → the candidate domain is the collection(s) rendered in the
   focused region — Tao already knows the loop, its entity, its rows, and (statically) which field
   each row's text displays.
3. Typing/moving narrows candidates → pure function of the rendered semantic tree; no store query.
4. _"That one"_ → a target is committed (entity handle identity).
5. _"Play it"_ → verb chosen from the intents applicable to the target's type in this scope.
6. `Play(target)` → ordinary intent invocation; application state changes; Back history is the
   navigation reducer's, untouched by steps 1–4.

The candidate state machine: region focus × candidate set × committed target(s) × input mode
(navigate / narrow / engaged-editing), with mode transitions owning which keys mean what. All of
it policy-shaped; none of it settled.

---

## Discovery record — design questions

Numbered for reference; ordered by dependency, not importance alone. Leans are noted where the
investigation already suggests an answer; a lean is not a decision.

### A. Framing and architecture

- **KEY-Q1 — One semantic layer or a keyboard subsystem?** Answered by **KEY-D1** below.
- **KEY-Q2 — Does Tao get a runtime interaction tree?** Answered by **KEY-D2** below. The
  assessment that produced it is kept here as rationale — the downsides (each now a requirement
  the decision carries) and the two approaches Ro asked to have evaluated:
  1. _Cost when unused_ — every app would pay tree maintenance even with no keyboard attached.
     Mitigation requirement: compile-time metadata is near-free; live registration activates only
     when a consumer subscribes (keyboard engaged, screen reader on, palette open, test harness).
  2. _Two trees to reconcile_ — the React tree and the interaction tree can drift (unmount races,
     FlashList recycling makes "rendered" fuzzy — KEY-Q16). Requirement: registration rides the
     same mount lifecycle as host channels; windowed collections represent their window honestly.
  3. _Codegen surface growth_ — per-occurrence metadata inflates emitted code. Requirement:
     compact per-module static tables, occurrence refs into them, not inline objects everywhere.
  4. _Identity stability_ — nodes need identity across renders. Rows have it (entity handles);
     other occurrences need the studio-identity mechanism generalized out of its Studio gate.
  5. _A second source of truth temptation_ — consumers must read the tree and dispatch through
     intents/reducers, never mutate through it. Already a standing constraint (Rejected list).
  6. _User data flows into an introspectable structure_ — irrelevant in-process; matters the day
     agent/OS consumers arrive, where the `Assistant` allow-list precedent governs exposure.

  **Approaches assessed (2026-09-01), refining the lean:**
  - _Just-in-time inspection instead of continuous maintenance_ — adopted in refined form. The
    split that makes it work: **existence is always registered, evaluation is on demand.**
    Generated code registers a static occurrence descriptor on mount and removes it on unmount
    (a map insert — the unconditional loop diagnostics frame proves this class of cost is
    acceptable today); everything reactive and expensive — labels, `Enabled`, applicability,
    subscriptions — is computed only while a consumer is attached (keyboard engaged, screen
    reader on, palette open, test). Pure walk-on-keypress without registration was assessed and
    not adopted: production has no sanctioned way to walk the mounted tree (the harness's
    testing-library traversal does not exist there), a displayed consumer (hints, `Enabled`) needs
    invalidation anyway — which is a subscription, i.e. live maintenance — and the interaction
    state machine (focus, target) is retained state regardless. So: skeleton always, flesh on
    demand, everything dropped when the last consumer detaches.
  - _Hooking React internals (fiber walking, monkey-patching, or a fork)_ — rejected. The
    decisive fact: **Tao owns codegen, which is a strictly better hook than anything React
    exposes or could be patched to expose.** Anything a patch or fiber walk could observe about
    Tao-emitted elements, the compiler can emit first-class, typed, and versioned; internals add
    version-coupling (Fabric vs. web fibers differ, private APIs churn) for information we already
    control at the source. A fork additionally taxes every RN/Expo upgrade and breaks ecosystem
    tooling for zero unique capability. Two narrow exceptions where the platform is the right
    source, via public APIs only: **geometry** for spatial navigation (`onLayout`/measure — no tree
    hook provides boxes anyway) and **future platform focus/a11y interop** (UIFocusSystem, web
    focus, screen-reader focus), which the outline can project onto rather than reimplement.
    Current adapter support projects outward through web focus and React Native accessibility focus
    requests; focus enters Tao only where React Native emits a focus event. Foreign views and
    `render inject` stay opaque leaves with declared metadata — consistent with `__tao` deliberately
    not crossing the inject fence — rather than being fiber-walked.
- **KEY-Q3 — Where is the boundary between language semantics and runtime policy?** Answered by **KEY-D13** (consolidated). Which parts
  are language contract (what a region _is_, what selection _means_, test observability) and which
  are runtime/host policy (key allocation, hint rendering, timing)? The §13 precedent: policy in
  the prelude/design, contract in the language.
- **KEY-Q27 — Naming structure.** Answered by **KEY-D3**; kept as the option-space record. The
  naming system (iteration 3): every term has a
  bare short form used in context and a qualified full form for isolated contexts (diagnostics,
  titles, first mentions). **One domain, two qualifier words, each with one job**: _interaction_
  names the subsystem as a whole ("the interaction system" — the umbrella containing both halves,
  the way "navigation" names that whole subsystem) and qualifies its structure side (the outline
  and its nodes); _attention_ qualifies the state side (the reducer and its states). Two words are
  excluded as qualifiers outright: _intention_ (collides with §8 intents — "an action or
  transaction is an intent") and _navigation_ (means application navigation only; the boundary
  this design must keep crisp).

  | #  | Thing to name                                                                                     | Recommendation                                                                                          | Notes / rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
  | -- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 0  | The subsystem as a whole — one conceptual home for both halves                                    | **interaction** ("the interaction system"), facade **`TR.Interaction`**                                 | Adopted per Ro: one domain contains the outline (structure) and the attention reducer (state) and owns the internal flow in both directions — input → reducer → outline consult → dispatch; mount/unmount → outline → state revalidation. The umbrella does not change the external contract: outline reads stay read-only, mutation only through semantic operations. _Orchestrator_ as its name rejected (jargon; the domain word carries it, as "navigation" does) — the _function_ Ro asked for is exactly this umbrella plus the reducer. Facade style follows `TR.Navigation`: `TR.Interaction.Outline` (reads), `.Attention` (state), `.Register` (codegen entry).                                                                                             |
  | 1  | The derived read-only semantic model every consumer reads                                         | **interaction outline** / the outline                                                                   | Strictly read-only (KEY-D2): consumers read it and dispatch through intents/reducers. _interaction model_ generic; _scene_ is the visible composition and DEF-NAV-003 reserves scene identity; _atlas/chart/frame_ weaker.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
  | 1b | The runtime state machine that owns attention state and interprets input into semantic operations | **attention reducer**                                                                                   | New item. Exactly parallels the decided navigation vocabulary ("Back dispatches the navigation reducer; keys dispatch the attention reducer"). _Orchestrator_ rejected: jargon, and implies imperative control over components rather than Tao's established reducer shape.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
  | 2  | Attention-area node                                                                               | **interaction region** / region                                                                         | _attention region_ rejected as the node name: regions exist in the structure whether or not attention occupies one — "the region attention occupies" is state, and that state is #7. _attention target_ rejected: target is #10. _landmark_ ARIA jargon; _pane_ stays SplitNav-specific.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
  | 3  | Repeated-content node (a `loop` occurrence)                                                       | **interaction collection** / collection                                                                 | _entity collection_ rejected: loops over literals have no entity. _navigation collection/group_ rejected: protected word. Bare _collection_ deliberately echoes the data vocabulary — the node represents a collection's rendering.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
  | 4  | One repeated thing                                                                                | **collection item**                                                                                     | Adopts Ro's direction; _row_ dropped (reads as horizontally-presented — cards, grids). The `item` keyword adjacency is judged acceptable inside the compound; fallback if it bites in practice: _collection member_. _interaction entity_ rejected (literal loops); three-word forms too long.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
  | 5  | Activatable node                                                                                  | **action control** (kind: **control**)                                                                  | Controls split into two subtypes, absorbing #5/#6 into one small taxonomy. _action node / interaction node_ rejected: "node" is graph-speak for spec prose.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
  | 6  | Value/text-accepting node                                                                         | **input control** (kind: **control**)                                                                   | Sibling of action control. _keyboard node_ rejected: modality-bound (voice fills inputs too). _text input node_ too narrow (steppers, sliders). _field_ unavailable (entity fields).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
  | 7  | Which region input is aimed at                                                                    | **region focus** / focus                                                                                | Anchors to decided `focus @slot` and "commands scope to focus". _attention focus_ rejected as redundant (focus **of** attention); _focus area / attention area_ name the place, not the state. Lives inside the attention reducer's state, so it needs no _attention_ prefix of its own.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
  | 8  | The might-be-meant set                                                                            | **candidates** (isolated: attention candidates)                                                         | Already unambiguous; plural by nature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
  | 9  | Typing to shrink the candidates                                                                   | **narrowing** (isolated: attention narrowing)                                                           | _funnel / attention funnel / focus funnel_ rejected: names a shape not an act, and carries sales-funnel connotation. _filtering_ reserved forever for application/query filtering.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
  | 10 | The committed thing, and committing it                                                            | **target** (isolated: attention target; noun and verb)                                                  | _action target / action selection / command selection_ rejected: they presume a chosen action, but in the noun-first flow a target exists before any verb is picked — targeting is attention-side, not action-side. _intention target_ excluded (intents); _action subject_ — subject is taken (`when`/`guard`) and the target is grammatically the object.                                                                                                                                                                                                                                                                                                                                                                                                           |
  | 11 | Running a thing's own wired operation                                                             | **activation**                                                                                          | No developer marking exists or is needed: activation is derived — it is whatever the control's ordinary event wiring already declares (a button's `on press`, a row's `on select`, a checkbox's toggle, a form's submit; activating an input control begins engagement). A collection item with no `on select` simply has no activation, only verbs. _invoke_ stays reserved for intents/commands per §8.                                                                                                                                                                                                                                                                                                                                                             |
  | 12 | An input control owning input                                                                     | **engagement / engaged**                                                                                | Modality-neutral (keys, voice, Vision-style gesture all route as content while engaged); defined by capture: "an engaged input control captures input." _capture_ kept as the defining mechanism verb, not the state name. _editing_ rejected: text-bound (Ro's Vision/voice point). _entered_ weak as a noun; _composing_ IME-specific.                                                                                                                                                                                                                                                                                                                                                                                                                              |
  | 13 | Generated what-can-I-do layer                                                                     | **interaction hints** / hints                                                                           | Content is modality-general (keys now, voice phrases later), so the system qualifier fits; **key hints** survives as the keyboard-specific flavor. _intention hints_ excluded; _navigation hints_ protected; _focus hints / action hints_ each cover only part of what hints show.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
  | 14 | Generated areas-of-the-screen mode                                                                | **interaction overview** / overview                                                                     | _guide_ implies tutorial; _interaction/intention map_ rejected (`Map` view, banned qualifier, and "map" already used metaphorically in Decisions prose).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
  | 15 | Runtime surfaces, and the handwritten/generated boundary                                          | **`TR.Interaction`** (handwritten facade); generated metadata lives in generated modules, never on `TR` | Boundary rule per Ro: **`TR` contains only handwritten code — authorship, not audience, is the line.** Nothing generated is ever attached to the `TR` object. Generated outline metadata (KEY-D2's static tables) is emitted into the generated modules themselves — module-local constants, or sibling metadata modules per the §15 bridge-module precedent (`Recipe.tao.ts`) — and passed _into_ handwritten registration (`TR.Interaction.Register(…)`), exactly as generated code already passes descriptors to `TR.Navigation.Configure`. The earlier `TR.Gen` idea (an audience-based namespace) is retracted as superseded by this authorship boundary; the TR-cleanup suggestion becomes "state the authorship rule in the TR package docs", not a migration. |
  | 16 | The workstream                                                                                    | keyboard driven apps                                                                                    | Unchanged; documentation adopts the unified vocabulary above so the wording reflects the one-layer-many-consumers picture, with keyboard as the forcing feature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

  Collision-checked and excluded: `item` (bare), `field`, `subject`, `selection`, `filtering`,
  `list`, `Map`, _intention_, _navigation_ (as qualifier). Node kinds finalize with KEY-Q5,
  attention states with KEY-Q4; this scheme is the frame they land in.

- **KEY-Q28 — A presented-view kind (`scene`)?** Answered by **KEY-D11**. Raised by Ro 2026-09-02 after `Toolbar`'s
  reader question. Substantively the `ui` kind the unified-view tranche retired ("every distinction
  is read off the body or belongs to the call site; no marker, no modifier"). What a presented view
  may want to say about itself, sorted by owner — _self-description_ (decided `Title`, `Toolbar`;
  LANG-035's deferred `Subtitle`/`Icon`/`Badge`/`Status`; candidates: preferred/minimum size,
  initial attention target, header search); _presentation policy_ (call-site per §9/§10: mode,
  window `Key`, detents, transitions, `Restore`, geometry); _derived_ (region-ness, restorability,
  primary onscreen entity, landmark role, Back). Options: (1) **keep one `view`** and diagnose a
  host-facing slot filled on a view no host presents — recommended; (2) a grouped
  `presented { … }` block — legibility, no semantics; (3) `scene is view` refinement carrying the
  host-slot vocabulary, `nav is scene`, StackNav entries must be scenes — its one body-inexpressible
  semantic is "a scene may not be composed inline", which also forbids the composition freedom the
  unified tranche kept; a §9 amendment via the tranche process if wanted. Consequence regardless:
  `Toolbar` is presented-view chrome only (round-7 generalization withdrawn); item prominence =
  entity `commands` default list + optional per-view `Commands { … }` slot.
  **2026-09-02 — recommendation reversed to option 3.** Ro's stated goal is preventing dead chrome
  (host-facing fills on a view that is only ever composed). Shown in code: today one declaration
  serves as a pushed screen and as inline content, with `Title`/`Toolbar` silently dead in the
  latter; under `scene is view` the content is factored into a view and the scene wraps it — the
  loss is one extra declaration where a screen's content is also wanted inline. Option 2 (a grouped
  `presented { … }` block) organizes fills but does not prevent the dead case unless it carries the
  rule "not composable", at which point it is option 3 spelled as a block. Precise shape: `scene is
  view`; host-facing slot vocabulary moves from `view` to `scene` (a plain view cannot fill it —
  the dead case is unrepresentable); scenes are presented, never composed inline (diagnosed at the
  render site); slot-reading hosts (StackNav entries, windows) require a scene, slot-less modes
  (sheet, toast, menu, SlotNav, pane content) accept view or scene — settle in the tranche whether
  sheets start reading `Title`; `nav is scene`; scenarios' `render` accepts scenes; a presented scene
  is a region, so the outline's region set is fully declared-or-structural; the per-view `Commands`
  slot stays on `view`. A §9 amendment via the tranche process, reversing part of the unified-view
  decision with a stated reason: `scene` carries the one fact the body cannot — never composed.
  Naming: `scene` collides with Apple's `UIScene` and DEF-NAV-003's reserved word (reword that item
  to "windows and spaces"); `screen` collides with the `Screen` environment value; `page` with
  `Pages`. Lean: keep `scene`. Ro: yes on the Toolbar reversal.

### B. The semantic model

- **KEY-Q5 — What are the node kinds, and what derives each?** Answered (KEY-D3, D4, D7). Node names settled by KEY-D3;
  control derivation settled by KEY-D4 (wiring-derived, no marks). Remaining: region derivation
  (KEY-Q6) and label derivation (KEY-Q7).
- **KEY-Q6 — What makes a region?** Answered by **KEY-D7** — kept as the discovery record of how the
  answer was reached. Nav panes, selection items, and presented occurrences are
  derivable from the navigation registry today. The gap is persistent non-navigation chrome — and
  per Ro (2026-09-01), that gap is **forced now through a real app feature** rather than deferred:
  **promote WordFlower's `FocusSession` to a persistent focus bar** — start a focused-writing
  session in the document editor, then move to Home or Settings with the timer still visible and
  Pause/Resume/Stop still reachable. Honest product value on its own (today the session is view
  state inside `DocumentEditor` and dies on navigation), and it is WordFlower's exact analogue of
  the Spotify player (stories 10–11). What the feature forces, discovered against the source:
  1. **A mounting mechanism for app chrome.** WordFlower.tao states the current rule: "An app
     mounts navs, it does not render content directly." Persistent chrome has no home. Options:
     (a) an app-level content surface beside `Menu`/`Rail` (§8 already puts surfaces on the app);
     (b) a root view that renders chrome siblings around the mounted navigator (`nav is view`
     suggests a nav can be composed); (c) a chrome pane on the root navigator. Undecided.
  2. **Region-ness of that chrome.** If (b), a derivation rule is candidate: non-nav siblings of
     the mounted navigator containing controls are regions — no mark needed (LANG-032's
     derived-property preference). If (a), the surface declaration itself is the region fact.
  3. **App-scoped ephemeral state.** The session must outlive the editor, but app-level `state`
     currently requires `(persist)` (`StateValidator`); a timer must not persist. The feature
     forces app-scoped non-persisted state or a session modeled as data.
     This slice is language work and goes through the tranche process when implementation starts;
     the mechanism choice (a/b/c) is the open decision.
     **Generalization (2026-09-01, per Ro's push):** the bar is one member of a class — app-scoped
     presentation that is not navigation. Other members: status banners (offline, sync, "recording"),
     upload/progress trays, floating action buttons (DEF-NAV-012's conditional creation control),
     picture-in-picture mini-players, call bars, update/consent banners, dev overlays — and this
     design's own interaction hints and interaction overview, which will ride the same runtime layer.
     The class varies on three axes: **layout participation** (in-layout, reserving space, vs.
     floating above content), **reducer participation** (an overlay is an occurrence — Back dismisses
     it, restoration considers it; chrome is neither dismissible nor in Back), and **presence model**
     (occurrences are presented imperatively from actions; chrome presence is reactive — "while
     Session is not none", the live-root precedent). A bar is therefore _not_ just a permanent
     overlay: it shares the layering seam but differs on all three axes. Whatever mechanism wins
     should be the first member of a chrome-surface family, not a bar-only special case.
     **Principle (proposed):** everything interactive is attention-addressable — every region
     (chrome included) is enterable, every control and collection item targetable; exclusion from a
     nav's own selection model (a tab rotation) never implies exclusion from attention. Static
     content is perceivable (in the outline, for accessibility and the narrowing corpus) without
     being a target, because no operation applies to it — revisitable if a consumer needs content
     targeting (copy, agent reading).
     **Mechanism candidate (d), proposed by Ro 2026-09-01 — anchored layers.** Any view (and a nav)
     may render content that floats above its own rendered box, positioned semantically — an anchor
     (edge, corner, or center), an offset from it, inside or outside the box, stretched along a side
     or point-anchored — with presence reactive like any render content. One mechanism then covers
     the whole chrome class: a bar is a layer stretched along the top, a sidebar along the left, a
     loading indicator centered, a floating action button at a corner, a view-tied toast anchored
     outside the top edge. Assessment: a coherent answer to LANG-018 (layers, portals, popovers,
     overlay families) and to this design's own needs — interaction hints are point-anchored layers
     on controls and the interaction overview is stretched layers on regions, so the design consumes
     its own mechanism. Anchor kind also yields a region derivation: an edge-stretched layer with
     controls is a region; a point-anchored one belongs to its parent's region. Open before it can
     close KEY-Q6: (1) it must not reuse the word _overlay_ — `present … as overlay` is a reducer
     occurrence (imperative, Back-dismissible, restorable) while a layer is render content (reactive,
     no Back, no restoration); (2) docked vs. floating — a persistent bar usually _reserves_ space,
     which is ordinary layout today (a `Col` child), while floating layers portal into the nearest
     overlay lane, so the anchor vocabulary must say which; (3) outside offsets and stretched edges
     escape the view's box, so the runtime shape is portal-to-nearest-layer plus measured anchor
     geometry (`onLayout` — the same public seam spatial navigation will use); (4) hit-testing and
     modality (does a centered spinner block input?) — LANG-018's "one Modal abstraction"; (5) navs
     have no render body today, so root chrome needs a nav-level layer slot or (b)'s nav-inside-a-view
     composition. Spelling is deliberately undecided; a render form (`render above X`) and a clause
     form (`X() [float top]`, since brackets carry presentation) are both on the table.
     **State-home finding (item 3, 2026-09-01):** app state is referenced only inside the app body
     (its actions and navigator configuration) and reaches views by explicit parameter passing —
     `Content Sidebar(Width: SidebarWidth, Widen: WidenSidebar)` in the Resizable Split test app.
     There is no module-level `state`, and no visibility applies because nothing outside the app body
     ever names it. Tao's shared mutable state is the store, not `state`. So the two shapes are:
     (i) ephemeral app state passed down — explicit, but the editor sits three nav levels deep, and
     nav values take no parameters today, so this is real drilling; or (ii) session-as-data, queried
     from any view with no plumbing — the language's intended shape for shared state, whose one
     missing piece is device-local/ephemeral scoping for an entity (already a listed datasource
     deferral). Lean shifts toward (ii) plus that scoping.
     **Reframing (2026-09-01, from Ro's challenge "why isn't a docked bar ordinary layout?"):** it is.
     Docked chrome needs nothing new in layout — a `Col` with the bar and the content does it. The only
     unique fact is that the bar sits _beside content a nav manages_, and today the app root is a nav
     mounted by the host, not an author-owned render tree: a render tree may only name views
     (`RenderStatement`/`ViewRender` cross-reference `[ViewDeclaration:ID]`), while `nav X = …` is a
     configuration declaration — so `Col { WordFlowerNavigator(); FocusBar() }` does not parse, and
     WordFlower.tao's "an app mounts navs, it does not render content directly" states the wall. The
     whole chrome question therefore reduces to **one capability: a view may render a nav as an
     ordinary child** (the Prelude already says `nav is view`). With it: the docked bar is plain layout
     (option b, now the principled answer); option (a)'s `Bar` surface is unnecessary sugar; (c) is
     moot; anchored layers (d) shrink to a pure _floating_ concept — toasts, FABs, spinners, menus,
     tooltips, i.e. LANG-018 — no longer carrying docking. Runtime implications are contained: a nav
     mounted inside a `Col` still owns its occurrences, Back, restoration, and host chrome; Back already
     routes through the registry regardless of placement; snapshots key by nav identity. Region rule
     candidate without heuristics: **a view that directly contains a nav contributes its non-nav
     content as a region**, beside the nav's structural regions. Open wrinkle: a root with a top and a
     bottom bar — one region or two (split by contiguous sibling groups).
     **Downsides of nav-as-render-child (assessed 2026-09-01)** — each an invariant that today comes
     free from navs being host-mounted roots, and must become a rule: (1) _identity_ — navs are
     singletons by declaration identity (registry, snapshots, Back); a render child could mount twice
     or per loop row → one mounted occurrence per declaration, validator-rejected inside loops;
     (2) _conditional render drops history_ — a nav's stack lives on its mount → navs render
     unconditionally (validator), unlike the deliberate live-root swap; (3) _root semantics_ —
     `present … as root` must be defined as replacing the nav the shell renders, shell surviving
     (a §10 amendment); (4) _Back precedence_ among mounted navs → by region focus, falling back to
     app order (couples the two reducers, arguably an improvement); (5) _restoration timing_ for
     view-mounted navs → "restore when mounted", the links-wait-and-win shape; (6) _native safe
     areas_ — a docked bar under a native tab bar takes the inset; (7) the app composition root is a
     less complete one-page map. Option (a) avoids all seven at the cost of a closed surface
     vocabulary and no answer for chrome around a nested nav. **Recommendation at the time: constrained (b)** (retired by KEY-D7 — the frame) —
     nav renders allowed only unconditionally and outside loops, one occurrence per declaration,
     Back by region focus, root replacement targets the shell's nav; (a) remains the low-risk
     fallback.
     **Step-back reframing (2026-09-01, after Ro judged constrained-(b) too costly): the frame is a
     nav kind.** The underlying reality: an app screen is a frame of persistent regions around
     navigated content, and at the shell level region layout and navigation structure are one tree
     (a tab bar is chrome and the tab control at once; a sidebar is a region and a navigation source).
     Misfit assumptions exposed: (1) shell layout is content layout — reaching for `Col` is what hit
     the nav-as-child wall, and every constrained-(b) hazard exists because a `Col` knows nothing of
     navigation lifecycle; (2) chrome is host-owned decoration — some chrome is _shell-supplied author
     content_, distinct from the decided _presentation-supplied_ `Title`/`Toolbar`; (3) a bar sits
     outside navigation — it is a region inside the shell's tree. Tao already holds the answer in
     `SplitNav`: a nav kind whose panes hold views or navs, with widths, collapse order, compact
     progression, and its own Back rule — a layout of regions inside the nav family. Missing only the
     edge-docked case. **Proposal:** a frame nav kind (new kind or SplitNav generalized to edges) with
     slots such as `@top/@bottom/@left/@right/@center` holding views or navs; the app still mounts a
     nav. Consequences: all seven (b) hazards vanish with no new rules (slots are nav-configured, not
     render children; Back and restoration are the frame's, as SplitNav's are; safe areas find their
     natural owner); regions become purely structural (frame slots, selection items, split panes,
     presented occurrences — zero heuristics); docked = frame slot, floating = anchored layers
     (LANG-018, now a pure concept); nesting is free and the root is not special; options (a), (b),
     (c) were all approximations of the frame. To decide via the tranche process (a §10 amendment):
     fifth kind vs. SplitNav generalization, slot vocabulary (mostly inherited), the empty-slot rule
     (content rendering nothing reserves no space — reactive presence with no lifecycle code), and
     native mapping (iOS tab bar + toolbar, macOS sidebar/toolbar/inspector, web shells).
- **KEY-Q7 — What is an item's label?** Answered by **KEY-D5**; the derivation below is the
  adopted specification (one computation, shared verbatim
  with accessibility — it also becomes the row's `accessibilityLabel`, fixing `SelectableRow`'s
  current empty label):
  1. _Static ranking (compiler)._ For each loop, classify the row's text-bearing occurrences in
     render order: `Text` expressions reading the row binder (entity-field bindings resolvable via
     `Type.dataFieldOfMemberAccess`), interpolations, literal copy, `Image` `Description`, control
     labels. The **primary label** is the first unconditional text occurrence whose expression
     reads the row binder.
  2. _Runtime value (demand-driven, KEY-D2)._ The label is the primary occurrence's rendered
     string, read when a consumer is attached. Conditional branches contribute whichever branch is
     actually mounted (registration-based, so only the live branch exists in the outline).
  3. _Narrowing corpus vs. display._ Narrowing matches against the item's **full rendered text**
     (same semantics as the test harness's text queries — you can type anything you see); hints
     and the palette **display** the primary label.
  4. _Fallbacks, in order:_ any row-derived text → any text → `Image` `Description` → a contained
     control's `Label`/`Title` → none (the item stays structurally targetable; a design `rules {}`
     check can flag label-less items exactly as it flags unnamed controls).
     No schema-level `(label)` trait unless real apps prove the derivation wrong — inference over
     declaration, and narrowing and screen readers can never disagree about what a thing is called.
     Examples: `WorkspaceRow` → `Workspace.Name` (its first row-derived Text); HNReader's story row →
     `Story.Title` primary, with "{ Score } points by { Author }" in the narrowing corpus.
- **KEY-Q8 — Which provenance rides the outline?** Answered by **KEY-D6** (tiers 1–2 in, tier 3
  out). Explained as tiers; each tier is what a consumer can and cannot do:
  - _Tier 0 — none:_ narrowing by text, structural movement, activation all work. Noun-first verbs
    do not (the outline cannot know a row is a `Story`); verb-first eligibility does not; a target
    held during a live reorder drifts (index, not identity).
  - _Tier 1 — entity identity per collection item_ (entity name + interned handle): noun-first
    verbs attach by parameter type; verb-first eligibility is a type match; targets survive
    reorders and refreshes. **In.**
  - _Tier 2 — collection identity_ (the loop's declaration identity + its entity): the overview
    can name and enumerate collections; two loops over the same entity in one region (WordFlower's
    Drafts and Finished) are distinct narrowing scopes; structural next/previous-collection jumps.
    **In.**
  - _Tier 3 — query semantics_ (filters, order, limit): would let a consumer explain "top 30 by
    rank" or an agent reason about unrendered rows. No keyboard/a11y/palette consumer needs it,
    filter values are reactive (serialization cost), and it is recoverable later — `DataCompiler`
    already materializes the plan. **Out for now.**
    Provenance is `TR.Interaction`-internal: it never becomes a test selector (entity-ID selection
    stays retired per `Docs/Spec/Tao Testing.md`).

### C. Focus, candidates, target — the state machine

- **KEY-Q4 — The vocabulary and the state machine.** Answered by KEY-D3 (vocabulary) and **KEY-D8** (states and transitions). Exact states and transitions for region focus
  / candidate set / committed target / engagement, including: does a candidate set narrowed to one
  auto-commit (the exploration says not necessarily); is target commitment per-region or global;
  do multiple targets exist now or later (story 12 wants bulk operations eventually). Resolve the
  `on select`-vs-selection collision here.
- **KEY-Q9 — Is interaction state app state?** Answered by **KEY-D8** (runtime-owned, modality-neutral, condition-observable). Is region focus / target observable to product code
  (`focused` conditions, `when Target …` chrome — DEF-NAV-012's use case), drivable by it
  (`focus @slot` in link bodies is decided), testable, restorable? _Lean:_ runtime-owned like the
  navigation reducer — observable through condition vocabulary and host/test surfaces, mutated
  only through semantic operations, never directly settable. Restoration probably excluded
  (matches "responding presentations never restore" spirit); undecided.
- **KEY-Q10 — Focus lifecycle.** Answered by **KEY-D8** (re-aim rules, no author syntax). DEF-NAV-006 reserved appear/disappear/focus/blur. Does this
  design finally force it, and in what shape (events? conditions only)? What re-aims region focus
  when the focused region unmounts, collapses (SplitNav width), or is covered by an overlay?
- **KEY-Q11 — How do nested actionable descendants participate?** Answered by **KEY-D8** (descending). Story 6: a track row's artist
  link / save button / menu without one giant flat order. Row = target, descendants = a second-level
  scope? Does the item/actionable ontology recurse, and does narrowing apply within a row?

**Proposal for group C (2026-09-01) — adopted by KEY-D8 with rulings A–F:**

- _State held by the attention reducer:_ one **region focus**; per region, a remembered **target**
  (zero or one now; multiple deferred to a forcing story such as queue bulk operations), a
  **narrowing text** with **candidates** derived from it, and **engagement** (the target is an
  input control that has captured input). Modes are derived from this state, not stored:
  navigating, narrowing (text non-empty), engaged, verb-pending (a chosen intent awaiting a target),
  plus the transient overview and hints surfaces.
- _Principle — targeting is free:_ committing a target has no application effect; only activation
  and verbs do. So the reducer is eager: arrows move the target directly, and narrowing to exactly
  one candidate makes it the target with nothing happening — the person keeps typing or acts. This
  dissolves the exploration's auto-commit worry: exploratory typing stays exploratory because
  commitment is inert.
- _Transitions:_ (1) launch/after navigation → region focus = the primary content region (the
  frame center's presented occurrence), no target; (2) enter a region (overview + region hint, or
  region cycling) → focus it, restore its remembered target; (3) move → target steps among the
  current candidates (all targetable nodes of the region unless narrowing); (4) narrowing →
  printable keys while not engaged append text, candidates = nodes whose full rendered text
  matches, target = the sole candidate when exactly one, Escape clears the text and keeps the
  target; (5) activation (Enter) → the target's wiring-derived activation, an input control
  engaging; (6) verbs → noun-first on a target lists intents applicable by parameter type,
  authority, and `Enabled`; verb-first (palette, or a command with an unbound entity parameter)
  enters verb-pending with candidates = eligible nodes of that type across the whole screen, not
  only the focused region, then narrowing/movement/Enter binds and runs, Escape cancels;
  (7) engagement → the engaged control captures all input except a reserved set (Escape
  disengages and keeps the target; the palette key; primary-modifier commands), submit follows the
  control's `on submit`, in-text arrows are the control's own; (8) region focus never enters Back
  history; presenting from a region keeps focus there unless the new occurrence is modal or covers
  it; `focus @slot` in link bodies sets it explicitly.
- _KEY-Q9 lean:_ attention state is runtime-owned (a second reducer beside navigation), observable
  to product code only through condition vocabulary (`focused` exists; a target-styling condition
  is a naming question), drivable only by semantic operations (keys, `focus @slot`, test steps),
  never `set`, and not restored across relaunch (session-ephemeral, like responding presentations).
  DEF-NAV-012's conditional chrome reads it through conditions.
- _KEY-Q10 lean:_ re-aim rules, no author syntax: the focused region unmounting or collapsing →
  the primary content region; a modal occurrence (ask, sheet) appearing → it takes region focus
  and traps (Escape is its Back where dismissible); its dismissal → the region focused before it,
  via a small focus stack that is not Back history. DEF-NAV-006 lifecycle syntax stays reserved
  until a feature forces it.
- _KEY-Q11 lean — descending:_ a collection item is one target with one activation; its inner
  controls (artist link, save, menu) are reached by descending into it, which makes the item a
  temporary scope — candidates become its controls, narrowing and movement work within, Escape
  ascends. No flat order; nesting recurses. Declared verbs (intents on the item's entity) and
  rendered inner controls coexist: descend for what is rendered, verbs for what is declared.

### D. Verbs and applicability

- **KEY-Q12 — Where do per-item verbs live?** Answered by **KEY-D10**. Commands scope to presentations; a row is not a
  presentation. Spotify needs many verbs per row (Play / Queue / Go to artist…). Options: commands
  declared in the row view scope to the _targeted item_; intents with a matching entity-typed
  parameter are applicable to any target of that type (Assistant-style, possibly allow-listed);
  the decided `present ActionsMenu(Recipe) as menu` as the explicit form. This is the noun-first
  half of the objective and likely the biggest genuine language question.
- **KEY-Q13 — Verb-first resolution.** Answered by **KEY-D10** (verb-pending fills open slots from targets). `Add to Queue` chosen first: the intent's unresolved
  entity parameter defines an eligibility predicate over visible items (type match + availability
  - `Enabled`). Is this purely derived from §8 parameter typing? What happens with multi-entity
    parameters (story 9: `AddSongToPlaylist(Song, Playlist)` — one bound from target, one prompted)?
    Note the shipped binder rejects two parameters of the same entity type — fine for binding, but
    the prompt order/UX needs a rule.
- **KEY-Q14 — Applicability vs. availability vs. enablement.** **Deferred by Ro (2026-09-01)** to the authority workstream (`Docs/Roadmap/Authority.md`): login, who may do what, under what conditions — gating is decided there. Three gates exist in the decisions:
  type applicability, authority (`can change` — hides), `Enabled` (disables). Confirm the keyboard
  surfaces consume exactly these and add no fourth.

### E. Narrowing

- **KEY-Q15 — Narrowing semantics.** Answered by **KEY-D9**. Matching rule (prefix per word? fuzzy? locale-aware),
  candidate survival, what a narrowed-out item looks like, when narrowing resets. Interaction with
  structural movement (arrows during narrowing). Confirm the hard rule: narrowing consumes the
  rendered candidate set only — never the store, never app filters (stories 3, 14).
- **KEY-Q16 — Narrowing vs. virtualization.** Answered by **KEY-D9** (stage 1 mounted nodes; stage 2 the loop's rows). Grid bridges FlashList (§9); rendered ≠ mounted.
  Is the candidate domain "currently rendered", "in the loop's current data window", or "in the
  collection"? The objective says "represented by the current UI/scope" — define that precisely
  for virtualized lists and `limit`ed queries.

**Proposal for groups D and E (2026-09-01) — group E adopted by KEY-D9; group D superseded by the rounds below and KEY-D10:**

- _KEY-Q12 — where per-item verbs live:_ §8 already answers most of it. "Intents are the verbs;
  commands are the affordances a surface adds", and `Palette all` "lists every intent with a
  `Title`, resolved against what is on screen". So: **a target's verbs are all titled intents
  applicable to it** — parameter type satisfied by the target (remaining required entity
  parameters promptable via verb-pending), authority permits, `Enabled` allows. **Commands declared
  in the item's own view decorate them**: `view TrackRow(Track) { command Queue = AddToQueue(Track)
  with { Icon "…", Key "q" } }` gives that intent its label, icon, and — the objective's contextual
  single-key interaction — a key that fires while the item is targeted. This requires one §8
  amendment: "commands scope to focus" generalizes to "a command declared in a view is enabled
  while that view's occurrence is the focused presentation **or contains the target**". An authored
  `menu Name { … }` / `present … as menu` remains the curated form and, when present, orders the
  generated verb surface; otherwise the surface is generated. Lean on breadth: show all applicable
  titled intents (Spotify's context menu shape), authored/commanded ones first; an intent without a
  `Title` stays invisible, and `Assistant`-style allow-listing is available if an app must hide
  more.
- _KEY-Q13 — verb-first:_ the verb-pending state (KEY-D8). Multi-entity intents bind what the
  target satisfies, then prompt the remaining required entity parameters in declaration order, one
  verb-pending round each; optional (`?`) parameters are never prompted. Two parameters of one
  entity type are already a compile error, so binding is never ambiguous.
- _KEY-Q14 — gates:_ exactly the decided four, no fifth: a `Title` (discoverable at all), parameter
  applicability, authority (hides), `Enabled` (disables, stays visible).
- _KEY-Q15 — narrowing rule:_ case-insensitive, locale-aware prefix match on each word of the
  item's full rendered text (so "disc" matches "Discover Weekly" and "Disco Favorites"; "weekly"
  matches too), narrowing text accumulating across keystrokes with Backspace; non-matching items
  visibly subdued, not removed (the region keeps its shape); reset on Escape, region change, or a
  mutation of the collection that empties the candidates. Movement operates over candidates.
- _KEY-Q16 — the candidate domain:_ **mounted nodes** — what the outline has registered, which
  for a virtualized collection is its rendered window plus whatever the bridge keeps mounted. Items
  outside the window are not candidates: narrowing never queries the store, and the app's own
  search is the tool for the rest. The overview and hints state the domain honestly ("12 of 340
  shown"), and `limit`ed queries behave the same way.

_Option space recorded for Ro (2026-09-01):_ **KEY-Q12** — seven candidate sources of a target's
verbs: (1) titled intents applicable by parameter type (derived, uniform per noun, unordered);
(2) commands in the item's view (curated, keys and icons, but uncommanded intents become
undiscoverable and verbs vary by row view); (3) a `verbs` list on the entity (single source per
noun, but UI vocabulary in `Data.tao` against the §1 decomposition — and `access` already lists
per-entity verbs); (4) a typed `menu TrackMenu(Track) { … }` (ordering and grouping per noun);
(5) the row's rendered inner controls (covered by descending); (6) `link`s as derived navigation
verbs by parameter type or one to-one relation hop (story 13 without bespoke intents); (7) ad-hoc
row events — rejected. **Recommendation: a layered union** — authored menu (ordering) → item-view
commands (affordances) → applicable titled intents → applicable links; duplicates collapse onto the
commanded entry. **KEY-Q13/Q14** need only confirmation (§8 text). **KEY-Q15** options: word-prefix
(recommended), substring, fuzzy subsequence (a later expert mode), first-word-only. **KEY-Q16
revised:** candidate domain = **the loop's rows** (everything the collection iterates, mounted or
not; targeting an unmounted row scrolls it into view; still no store query) — made possible by
KEY-D5's static label ranking — with mounted-only as the first implementation stage; rows beyond a
`limit` are not candidates. **KEY-Q14 fifth-gate option** (hide by product state) noted and left to
a forcing feature per §8's "not permitted hides; not yet disables".

**Merged Q12 proposal (2026-09-01) — superseded by rounds 4–7 and KEY-D10 (only `command`; `commands …` in the `data` block; `given` dropped); kept as the option space:**

- _Three declaration kinds, one job each_ (amends §8's "an action is an intent" and moves `Title`
  off `action`): **`action`** — private procedure, never surfaced, no Title, no derived name;
  **`intent`** — the user-facing verb, an action plus metadata (`Title`, `Description`,
  `Summary`), entity-parameterized, declared with a body (`intent AddToQueue(Track) { Title "…"
  do Enqueue(Track) }`) or by reference (`intent Share = ShareTrack(Track) with { Title "Share" }`);
  **`command`** — unchanged §8 view-scoped listing of an intent with bound arguments and
  affordances (`Key`, `Icon`, `Label`, `Enabled`) — prominence and keys.
- _Universe:_ a target's verbs are **every intent its type satisfies, anywhere in the app** — not
  what the developer mentioned at that location. Surfacing is deterministic tiers: (1) commands
  listed in the rendering view, prominent, with keys; (2) the item's rendered inner controls under
  their own authored labels (the descend set); (3) the entity's declared default set in declared
  order; (4) everything else applicable, alphabetical by Title, folding after N (a recency or
  learned heuristic may slot into tier 4 later without changing the contract).
- _Exclusions, explicit at two places:_ on the entity (`intents Play, AddToQueue, GoToArtist` as
  the default surface; `intents hide DeleteTrack` = only where a view commands it) and at the
  render location (`hide GoToArtist` in a view). Placement of the entity-level policy is open:
  Ro's placement inside the `data` block vs. a small per-entity declaration beside `access` rules
  (the §1 decomposition keeps `Data.tao` to storage facts).
- _Links:_ auto-derived "Go to …" verbs dropped (derived names rejected); a `link` may carry a
  `Title`, and titled links are navigation intents; untitled links stay private.
- _Apple App Intents mapping:_ `intent` ↔ `AppIntent`, entities ↔ `AppEntity`, `Assistant { }`
  ↔ OS exposure allow-list (broad-with-exclusions in-app vs. allow-listed for OS/agents, per §4),
  the interaction outline ↔ on-screen entity awareness. Flag: `AppEntity` needs a per-instance
  display representation — an entity-level label KEY-D5 declined unless forced; Apple Intelligence
  may be that forcing feature (the `Assistant` block's first listed field is a candidate).
- _Dropped from Ro's version:_ a relevance heuristic as the primary order (replaced by fixed tiers
  and a deterministic tail); reference-only intents (body form added to avoid two declarations per
  verb). _Dropped from the earlier proposal:_ untitled link derivation; the objection to
  entity-level verb declarations (withdrawn — as surfacing policy it is right); gating as part of
  this decision (deferred, KEY-Q14).

_Comparison recorded for Ro (2026-09-01):_ **decided now** — entity-level surfacing policy lives
inside the `data` block (`intents Play, AddToQueue, GoToArtist`; `intents hide DeleteTrack`).
**One declaration kind or two:** variant 1 keeps `intent` + named view-scoped `command`
(§8 today; surfaces list commands by name, the OS menu names `View.Command`); variant 2 keeps only
`intent` — affordance defaults (`Icon`, `Key`) live on the intent, `Title` stays constant
extractable copy while a reactive `Label` joins it, views _mention_ bound intents in surface blocks
(`Toolbar { AddToQueue(Track) }`, `Button(Like(Track))`) with inline `with { … }` overrides, and app
surfaces list intents unbound, bound by type against the focused presentation or target; variant 3
is variant 2 with the word `command` — structurally identical, differing only in connotation
(person-issued vs. system-fulfilled; Apple's `AppIntent` speaks "intent"). **Lean: variant 2.**
**Reference form:** `intent X = Action(args) with { Title }` is subsumed by the body form
(`intent X(T) { Title "…"  do Action(args) }`) — **lean: drop it**, one spelling per meaning (§2's
discipline). **AppEntity need:** the OS protocol requires a per-instance `displayRepresentation` to
show and speak entities and to disambiguate ("Discover Weekly or Discover Daily?"), plus an
`EntityStringQuery`; KEY-D5's row-derived label cannot serve because a query result is not rendered
anywhere. **Lean:** no new trait — the `Assistant { Playlist { Name, Owner } }` block's first listed
field is the display title, `Find … by` fields (already `(search)`) drive the string query, and the
interaction outline supplies on-screen entity identity. **Titled links (decision 5):** apply by
exact parameter type; relation hops are explicit intents (`intent GoToArtist(Track) { Title "Go to
artist"  open ArtistLink(Track.Artist) }`); automatic one-hop derivation remains a later opt-in.

_Round 4 (2026-09-01):_ **Only-`command`, body form only** exercised on a minimal Tunes app covering
every use (private `action` vs. `command`; entity-typed and app-wide commands; `Icon`/`Key`
defaults on the command; constant `Title` beside reactive `Label`; `Summary` for verb-first; entity
default surface `commands …` and `commands hide …` in the `data` block; view mentions with inline
`with { … }` overrides and view-level `hide`; `Button(Like(Track))`; unbound `Menu`/`Rail`;
`Palette all`; `do` invocation; `on select` as activation) — reads cleanly, so only-`command`
holds. **Apple research (WWDC26 / iOS 27):** App Schemas = system-defined entity schemas
(message, contact, document, event, photo, album, book …) and intent schemas (`.books.openBook`,
`.messages.sendMessage`); conformance is opt-in and cannot be invented; conforming entities supply
the schema's named properties, a `displayRepresentation`, and a string query; `IndexedEntity` +
`indexingKey` feed the Spotlight semantic index; onscreen awareness via `NSUserActivity` (one primary
item) or the **View Annotations API** (`.appEntityIdentifier(EntityIdentifier(for:identifier:))`
per rendered row); an App Intents Testing framework exercises real system pathways. No music/playback
schema confirmed (SiriKit media intents historically). **Three things become automatic from decisions
taken:** View Annotations ↔ the outline's per-item entity identity (KEY-D6); `NSUserActivity` ↔ the
presented view's entity parameter; Spotlight indexing ↔ `(search)`. **Display title:** never
order-based; for schema-conforming entities it is the field mapped to the schema's title property;
otherwise derived from how the app's own row views display the entity (KEY-D5 static primary labels
agreeing across views), with a diagnostic on disagreement or an unrendered entity, and an explicit
`Shown as` override. **Assistant block spellings** compared on WordFlower: §8 positional (unreadable
without comments); A labeled sections (`Entities`/`Commands`/`Searches`); B noun-centric blocks with
optional `as <schema> (field mapping)`, `Shown as`, `Find by`, `Commands` — **recommended**; C
`publish … to assistant` projections (purest, scatters review). Domain schemas are covered as B's
optional `as <schema>`. **Titled links: deferred** — `link` is unimplemented and "Deep links and
navigation persistence" is undesigned; navigation verbs are ordinary commands with `open`/`reveal`
bodies for now; requirement recorded for the deep-link workstream: a titled link is a navigation
command and maps to Apple's `OpenIntent`. Sources: Apple WWDC26 Apple Intelligence guide and
sessions 240/343/295; developer write-ups of session 240; Apple's assistant-schema documentation.

_Round 5 (2026-09-01), Ro's modifications and the answers:_ **`do` is the single behavior
clause** of a command — the block is declarative members plus exactly one `do`, of a named action
(`do Enqueue(Track)`) or an inline one (`do -> { create Playlist { Name } }`); body form and
reference form unify. **`Toolbar` is not compiler magic:** a prelude-declared supplied slot on the
`view` primitive (`Toolbar list of action() is []`), read by the nav kit; the mechanism is
compiler-known, the vocabulary prelude-owned (§9, LANG-034). **Binding vs. invocation:** Tao's
existing rule is that `do` is the only invocation word and parentheses bind (§8's
`command X = Y(Recipe)`), but call-shaped binding reads as a call; options compared — (A) status
quo, (B) `with` binding (rejected: a fourth `with`, and arguments mixed with member fills in one
list), (C) **unbound mention with arguments bound from scope by type**, parentheses only to
disambiguate or pass a non-scope value (`Toolbar { AddToQueue, Like with { Key "l" } }`,
`Button(Like)`, `Menu { "Track" { Play, Like } }` bound against the target) — **recommended**; two
same-typed values in scope is a diagnostic. **App surfaces:** `Menu`, `Rail`, `Palette` are §8
supplied slots on the `app` primitive, not yet in the Prelude; with KEY-D7 a rail is a frame slot
holding a view, so **`Rail` retires**; under "every titled command is available" the palette is
always all, so **`Palette all` retires** and the palette is an always-present runtime surface;
**`Menu` stays** (OS menu bar: app-level, authored grouping). **`(title)` field trait adopted**
(one per entity; Apple's display representation and Ro's explicitness force the trait KEY-D5
declined; also the preferred primary row label in KEY-D5's derivation; `Shown as` disappears).
**Assistant block: option A** (`Entities { … }`, `Commands { … }`), schema conformance inline on
entries (`Document as documents.document (title Title, content Body)`); `Searches` dropped — an
exposed entity's string query follows from its `(search)` fields; nothing meaningful lost versus
B once `(title)` and `(search)` carry the per-noun facts. Titled links remain deferred.

_Round 6 (2026-09-02):_ **`Toolbar` rendering** — native host: commands in the stack header's
trailing view (iOS navigation-bar trailing items; Android top-app-bar actions), first two direct,
rest behind More; basic host (web today): Tao-styled header row, title + two icon-and-label buttons +
More popover; intended web = the same, with the header a control-bearing part of the presented
view's region and key hints on demand. Unchanged by KEY-D7: `Toolbar` is presentation-supplied
chrome, frame slots are shell-supplied chrome. **Partial application** (uniform for commands,
views, functions; application still runs under `do` / render position / expression position):
(1) status quo parens-bind; (2) **`given`** — `Like given Track`, curried
`AddToPlaylist given Track`, `RecipeCard given Recipe`; (3) `with` rejected (fourth meaning,
arguments mixed with fills); (4) `of` weak (audience precedent but possessive reading); (5) `for`
weak (caller/automation binding already); (6) braces rejected (`Col { … }` renders with children —
position-dependent meaning); (7) `_` placeholder weak; (8) **scope binding by type, no syntax** —
`Button(Like)`, `Toolbar { AddToQueue, Like }`, diagnostic on two same-typed values; (9) inline
`-> { do … }` stays. **Recommendation 8 + 2.** **Single root:** agreed — the app carries no UI
surfaces; the root frame maps to all UI; a rail is a frame slot. **OS menu bar:** options — on the
app (the one exception), on the root frame, or **derived by default** (one menu per exposed noun
from its `commands` list plus one for app-wide commands) with an authored `Menus` on the root frame
as override — recommended. **Palette:** the declaration `Palette all` retires; the palette itself is
an always-present runtime surface over the outline. **`Menus` type:** `type Separator is one of
Separator`; `type MenuItem is action | Menu | Separator`; `type Menu is { Title text, Items list of
MenuItem }`; `Menus list of Menu is []` as a supplied slot on `nav`, honored on the root frame;
literal `Menu { "Track" { Play, Like, separator, Delete } }` is sugar; native menu bar on desktop and
iPadOS (Studio's Electrobun `ApplicationMenu` is the precedent), nothing rendered on phones and web
by default; no desktop target for Tao apps exists yet. **Ro's rulings this round:** `do` clause —
yes; `(title)` trait — yes; Rail/`Palette all` retire — yes (Menu to be typed, done above); binding
and Assistant option A held until partial application is decided.

_Round 7 (2026-09-02):_ **`Toolbar` readers:** any view may fill it; only the directly presenting
host reads it (StackNav header, decided `as window`); SlotNav/SelectionNav/SplitNav — and the
frame — read nothing; fills never bubble; a fill on a never-presented view is silently unread
(validator checks only foreign/duplicate commands). Multiple toolbars at once = one per presented
occurrence, each read by its own host. Resolution proposed here, **withdrawn 2026-09-02** (KEY-D10 §4 and KEY-D11 keep `Toolbar` as presentation
chrome and give item prominence the per-view `Commands` slot): generalize `Toolbar` to "the
commands this view puts forward"** — read by a stack header for a presented view and by the
attention surfaces (verb menu tier 1, long-press context menu, key hints) for a targeted item's view;
one slot, never merged (alternative: a separate `Commands` slot — cleaner but duplicative).
**Partial application resolved by Ro's configured-value command model:** a command's parameters are
_slots_ (`command Delete { Track  Title "Delete"  Summary "Delete { Track }"  Key "d"  do -> { delete
Track } }`), binding and affordance override are the existing `Value with { … }` derivation
(`Button(Like with { Key "k" })`, `do Delete with { Track: Selected }`), and an unfilled slot on a
surface is filled from the target by type at invocation — the verb-pending mechanism with no compiler
inference; `given` and general partial application are unnecessary (no forcing case remains).
Downsides accepted: commands are the one declaration with slots not parens (they are configured, never
called — the `nav`/`app`/`design` family); `Title` stays static and `Summary` carries holes (Apple's
`title` / `ParameterSummary`); use-site overrides limited to `Label`/`Icon`/`Key`/`Enabled`; `do` on an
unfilled slot in code is a diagnostic, on a surface a prompt; a `command` primitive type with supplied
slots, `Toolbar list of command`. `Like with Track` (unbraced) parses but is ambiguous in lists.
**Menu bar:** on the `app` (Ro), derived when absent. **Literal:** the §8 `Menu { "File" { New } }`
sugar is not in the language; the typed form is `Menus [ Menu { Title: "Track", Items: [Play, Like,
Separator, Delete] } ]` — list brackets, `:` in literals, juxtaposition for the slot fill; no new
sugar recommended.

### F. Regions, navigation, history

- **KEY-Q17 — Region focus vs. application navigation.** Answered by **KEY-D8/D12**. Region focus is not in Back history;
  `song → artist → album` is. Confirm and specify: which keyboard operations dispatch reducer
  operations (activate a row with `on select -> present …`) vs. pure interaction-state changes
  (focus a region). What does Back do to region focus as a side effect of popping content?
- **KEY-Q18 — Navigating the app's structure, not the screen.** **Deferred** with titled links to the deep-link workstream (KEY-D10/D12). Story 13: traverse entity/nav
  relationships (`link`s, reveal targets) from the keyboard. Are decided `link` declarations the
  verb set for this ("Go to Artist" is a link, not a bespoke intent)?

### G. Scope layering and conflicts

- **KEY-Q19 — Binding scopes and precedence.** Answered by **KEY-D12**. App commands, focused-presentation commands,
  targeted-item verbs, region-entry keys, narrowing keys: one precedence order, and the conflict
  rule when a `Key` collides across scopes. §8 decided app menus enable per focused view; the
  keyboard needs the general rule.
- **KEY-Q20 — Global operations.** Answered by **KEY-D12** (nothing new: entity-slot-free commands with chords are global). Story 10: pause/skip/volume from anywhere. Are these just
  app-level commands with `Key`s (§8 decided), or is there a per-region command exported globally
  (`RecipeScreen.Favorite` in the app `Menu` is the decided precedent)? Probably mostly settled;
  confirm nothing more is needed.
- **KEY-Q21 — Modes.** Answered by **KEY-D12** (runtime states only). The exploration's transient scopes (overview mode, hint mode, verb-pending
  mode). Are modes runtime policy (like the palette presentation) or language-visible? LANG-018
  preserved "mode overlays" as a future case.

**Proposal for groups F–H (2026-09-02) — adopted by KEY-D12:**

- _The one genuine conflict — single-key verbs vs. typed narrowing:_ options (1) **letters narrow by
  default; bare single-letter `Key`s are accelerators inside the verb layer** (open the target's
  verbs, then `q` queues — menu mnemonics; modifier chords act directly anywhere their scope is
  active; the hints layer shows the letters) — recommended; (2) letters act, narrowing needs an entry
  key (`/`, Gmail/Vim) — demotes "type what you see"; (3) context-dependent (narrow while plural,
  act once targeted) — unpredictable. One rule: typing finds, chords act, single letters act inside
  the verb layer.
- _KEY-Q19 precedence, nearest wins:_ engaged input → modal occurrence → targeted item's commands →
  focused scene's commands → app-wide commands (no entity slot) → reducer keys (arrows, Enter,
  Escape, verb key, region keys). Same chord at two levels: nearer shadows, hints show the shadowed;
  same chord twice in one scope: diagnostic.
- _KEY-Q20 global operations:_ solved by KEY-D10 — a command with no entity slot and a chord is
  available everywhere by definition; the player bar merely mentions it.
- _KEY-Q21 modes:_ runtime states of the attention reducer (overview, hints, verb-pending), never
  language-visible; LANG-018's mode overlays need no construct.
- _KEY-Q17:_ settled by KEY-D8 (region focus outside Back; activation dispatches navigation; re-aim
  rules). _KEY-Q18:_ deferred with titled links (KEY-D10).
- _KEY-Q22 engagement contract:_ platform text-editing chords win while engaged (`primary +
  x/c/v/a/z`, arrows, selection, word movement; validator warns on commands declaring them);
  pass-throughs: Escape (disengage, keep target), the palette chord, non-colliding app-wide chords;
  Enter submits on single-line (`on submit`) and inserts a newline on multiline; Tab disengages and
  targets the next control; engagement enters via activation or pointer focus (both ways per KEY-D8);
  write-through binding unchanged — engagement changes who receives keys, not what a key means.

### H. Editing and input ownership

- **KEY-Q22 — Engagement contract.** Answered by **KEY-D12**. Entering/leaving an editable: which keys leak through while
  engaged (palette key? Escape?), does engagement follow targeting automatically for inputs, and
  how does `submit` interact with commit. Story 14 is the acceptance test. Write-through binding
  (§7) means keystrokes are writes — engagement must not blur that contract.

### I. Generated surfaces and policy

- **KEY-Q23 — What do overlays/help consume?** Answered by **KEY-D13**. Hint layers, area overviews, "what can I do here"
  — presumably pure renderings of the interaction tree + current bindings. Defines the tree's
  minimum content. The toast-layer seam is the natural host; hints must not enter Back or a11y
  traversal while hidden.
- **KEY-Q24 — Key allocation policy.** Answered by **KEY-D13**. Derived single-key hints (letters from labels), collision
  handling, stability across renders, determinism for tests. Pure runtime policy? Overridable
  where (`design`? app? command `Key` only)?

**Proposal for groups I–J and KEY-Q3 (2026-09-02) — adopted by KEY-D13:**

- _KEY-Q23 surfaces:_ hints, overview, the target's verb menu, the palette, and help are pure
  renderings of the outline + attention state + current bindings; floating anchored layers in the
  app-host layer, outside Back, removed from a11y traversal while hidden (`NavigationLevel`
  precedent); hints on demand, not always-on.
- _KEY-Q24 key allocation:_ runtime policy, no language surface; label-derived (first free letter,
  then next distinctive, then two-letter sequences), locale-aware, never a reducer key, assigned by
  identity so reorders do not reshuffle, deterministic for tests; author overrides deferred.
- _KEY-Q25 platforms:_ universal = outline, attention reducer (pointer/touch dispatch it), a11y
  projection (selectable-row names from the outline, regions as accessibility groups), and
  adapter-mediated focus projection (web focus and React Native accessibility focus requests
  outward; focus enters Tao only where React Native emits it); keyboard-specific = hardware-key
  dispatch, hints/overview layers, chords; affordances appear after the first hardware keypress
  rather than by device detection; voice/agents consume the same data.
- _KEY-Q26 testing:_ steps via the `surface=ID` seam — `press key "q"`, `type "disc"` (attention
  reducer, distinct from `enter … into`), `expect target "…"`, `expect focus region "…"`, `expect
  verbs "…"`; determinism from KEY-D9 and the allocation policy; `beginTest` resets attention;
  existing `press "…"` steps update attention (KEY-D8); App Intents Testing for `as assistant do`.
- _KEY-Q3 consolidated:_ language contract = scene/view/frame/command semantics, outline kinds and
  provenance, attention semantics, narrowing rule, test steps; runtime policy = allocation, hint
  rendering/timing, tier ordering details, keyboard-presence detection, platform focus projection
  and focus-event intake;
  prelude/design = slot vocabulary and appearance.

### J. Platform and accessibility integration

- **KEY-Q25 — One model, which consumers on which platforms?** Answered by **KEY-D13**. What is universal (semantic tree,
  focus semantics, a11y derivation — phone included) vs. keyboard-specific (hardware-key dispatch:
  web, iPad+keyboard, future desktop)? How does Tao focus interoperate with the platform's own
  focus/screen-reader focus instead of fighting it (RNW's incidental tabindex today)? Per KEY-D1,
  the consumer set held in view — constraining direction, not designed now — additionally
  includes voice control, command-driven access beyond the palette (agents, CLIs, OS automation
  such as Shortcuts/AppleScript-class integration), and AI-agent awareness of the running app.
- **KEY-Q26 — Testing.** Answered by **KEY-D13**. `.test.tao` step vocabulary for keys, focus, narrowing, targets;
  determinism (allocation, timing); the `beginTest` reset for interaction state. The
  `surface=ID` step pattern and `observable`-gated testIDs are the established seams.

Dependencies in brief: Q1 → Q2 → (Q5–Q8) → (Q4, Q9–Q11) → (Q12–Q14) and (Q15–Q16); Q17–Q18 ride
Q4/Q9; Q19–Q21 ride Q12; Q22 rides Q4; Q23–Q24 ride Q5/Q19; Q25–Q26 constrain all of it and
should be checked at each decision.

---

## Discovery record — decisions

> **KEY-D1 — One unified semantic layer, keyboard first** (answers KEY-Q1; 2026-09-01)
> The design is a derived semantic model of the running app with many consumers, and keyboard
> interaction is the first and primary one. The consumer set held in view for direction — not
> designed or optimized for now — is: accessibility (with internationalization), voice control,
> command-driven access (the palette, and later agents, CLIs, OS automation), and AI-agent
> integration/awareness. The best version of Tao likely addresses this whole set from the same
> semantic source, so decisions here must not foreclose it, while the keyboard experience remains
> the forcing feature and the scope discipline: other consumers constrain, they do not expand the
> first tranche.
> _Why:_ §9 already declares accessibility part of the model; the Assistant block and `Palette
> all` need the same nouns and verbs; intent metadata (`Title`/`Summary`) already exists at
> runtime unconsumed; the test harness already re-derives "what is actionable" heuristically —
> four signs the information wants to be one derived layer. A keyboard-only design would create
> exactly the parallel incompatible model the objective forbids.
> _Opened/reshaped:_ KEY-Q25 now carries the enlarged consumer set; KEY-Q27 (naming) opened.

> **KEY-D2 — A runtime interaction tree: simplest shape first, performance staged behind a stable
> surface** (answers KEY-Q2; 2026-09-01)
> Tao's runtime maintains an interaction tree (the interaction outline, named by KEY-D3).
> Decision criterion set by Ro: **simplicity of implementation, provided a clear pathway to
> improved performance if and when needed.** The chosen shape:
>
> 1. Generated code registers a static occurrence descriptor on mount and removes it on unmount —
>    the registry generalizes `TR-navigation-registry`. This skeleton is always present and its
>    cost class is already paid today (the unconditional loop diagnostics frame).
> 2. While no consumer is attached, nothing else runs: no evaluation, no subscriptions.
> 3. While a consumer is attached (keyboard engaged, screen reader, palette, test), reactive
>    members — labels, `Enabled`, applicability — resolve by render-time read plus snapshot
>    diffing, generalizing the existing `RuntimeHostReadChannel` pattern rather than inventing
>    reactive machinery.
> 4. No React-internals dependency, ever: fiber walking, monkey-patching, and forking are
>    rejected — Tao owns codegen, which is the strictly better hook. Geometry (spatial navigation)
>    and broader platform focus/screen-reader interop come through public APIs
>    (`onLayout`/measure, platform focus systems) as those features land. The implemented adapter
>    can request web focus or React Native accessibility focus and receives focus only where React
>    Native emits it.
>
> The performance pathway is staged, each stage invisible behind the same consumer-facing read
> surface: activation gating (built in from day one) → snapshot fingerprint diffing (already in
> the codebase) → per-module static metadata tables if emitted-code size bites → finer-grained
> subscriptions if render-time reads become hot → windowing that follows the collection's own
> virtualization. The consumer contract never changes across stages, which is what makes the
> simple version safe to ship first.
> _Why:_ every ingredient has a shipped precedent (loop frame for cost, nav registry for
> registration, host channel for read-and-diff), so the first implementation is mostly
> generalization, not invention — and the rejected alternatives buy no capability codegen lacks.
> _Reshaped:_ KEY-Q16 ("what counts as rendered") inherits the windowing stage; KEY-Q23's
> overlays read the same surface; KEY-Q26's determinism applies to snapshots, not internals.

> **KEY-D3 — The vocabulary** (answers KEY-Q27; 2026-09-01)
> The settled naming system and terms are recorded in the Terminology section, which this decision
> makes authoritative. The load-bearing choices: one domain (**the interaction system**,
> `TR.Interaction`) containing the read-only **interaction outline** and the **attention
> reducer**; _interaction_ qualifies structure, _attention_ qualifies state; _intention_ and
> _navigation_ are banned as qualifiers; controls split into **action controls** and **input
> controls**; **activation** is derived from ordinary event wiring, never declared; **engagement**
> is the modality-neutral input-capture state; `TR` stays handwritten-only, with generated
> metadata emitted into generated modules and passed into registration. The full option space and
> rejection reasons are preserved under KEY-Q27.
> _Reshaped:_ the Terminology collision note is resolved (`on select` wires activation; target
> names commitment); KEY-Q4 narrows to pure state-machine semantics; KEY-Q5's node kinds and
> KEY-Q23's surfaces now have their names in advance.

> **KEY-D4 — Controls are derived from event wiring, never marked** (answers the control half of
> KEY-Q5; 2026-09-01)
> An element is an **action control** iff it binds a `Press`/`Submit`-typed action parameter or is
> a collection item with `on select`; an **input control** iff it binds `Value:` (with `Change`).
> No new author-facing marks. This turns what the test harness currently discovers by prop-sniffing
> into declared outline data, and gives the design rule "every interactive element has a name" its
> interactive-element set from the same source.
> _Reshaped:_ KEY-Q5 reduces to region derivation (KEY-Q6) and label derivation (KEY-Q7).

> **KEY-D5 — Item labels are derived, one computation shared with accessibility** (answers
> KEY-Q7; 2026-09-01)
> The derivation specified under KEY-Q7 is adopted: static primary-label ranking by the compiler
> (first unconditional row-derived text occurrence), demand-driven runtime value, narrowing over
> the full rendered row text with the primary label as the display form, the stated fallback
> chain, and no schema-level `(label)` trait unless real apps force one. The same computation
> supplies the row's `accessibilityLabel`, closing `SelectableRow`'s empty-label gap.
> _Amended with KEY-D10 (2026-09-02):_ the `(title)` field is preferred as the primary label **when
> the row renders it**; a `(title)` field the row does not show never becomes its label, so the label
> and the screen never disagree.

> **KEY-D6 — Outline provenance: entity and collection identity in; query semantics out**
> (answers KEY-Q8; 2026-09-01)
> Tiers 1 and 2 ride the outline: per collection item, the entity name and interned handle; per
> collection, the loop's declaration identity and entity. Tier 3 (filters, order, limit) stays out
> — no current consumer needs it, filter values are reactive, and it is recoverable later since
> `DataCompiler` already materializes every plan. Provenance is `TR.Interaction`-internal and
> never becomes a test selector; entity-ID selection stays retired.

> **KEY-D7 — The ontology: frame nav kind, structural regions, floating layers, addressability,
> session as data** (answers KEY-Q5, KEY-Q6; 2026-09-01)
>
> 1. **The frame is a new nav kind**, not a SplitNav generalization. Needs tested: edge bars (height,
>    full-width), side regions, a navigated center, reactive presence, narrow-width behavior (bars
>    stay; panes fold/progress), Back routing (bars never take it), a corner rule, safe-area/native
>    mapping, nesting. SplitNav's defining semantics — navigational peers with dividers,
>    `CollapseOrder`, and `Compact { Progression; Back reverse }` — would need four exclusions plus
>    two new concepts to host bars, and "declare a SplitNav to get a status strip" is forced.
>    Division of labor: **SplitNav = navigational peers that progress and fold; frame = fixed chrome
>    edges around a center**; a sidebar is a split pane if it progresses/folds as a peer, a frame
>    edge if it stays as chrome; hybrids compose (a frame's center holding a split). Whether the
>    frame owns all four edges or only top/bottom is settled in the tranche (lean: all four).
> 2. **Regions are purely structural**: frame slots, selection items, split panes, presented
>    occurrences. No marks, no heuristics. The focus bar is a frame slot.
> 3. **Anchored layers are a floating-only concept** (toasts, FABs, spinners, menus, tooltips —
>    LANG-018), decoupled from docking; spelling deferred.
> 4. **Addressability principle**: everything interactive is attention-addressable, chrome included;
>    static content is perceivable but not a target.
> 5. **Session state home**: session-as-data with device-local entity scoping; ephemeral app state
>    remains the fallback.
> 6. The frame's exact shape (slot vocabulary, empty-slot rule — a slot whose `Content` is `none` reserves
>    no space — corner rule, native mapping) is a §10 amendment decided via the tranche process
>    against Skillet and Wayfare, not here.
>    _Why:_ an app screen is a frame of persistent regions around navigated content, and at the shell
>    level region layout and navigation structure are one tree; Tao already models that in the nav
>    family (SplitNav), so chrome belongs there too. Retired: options (a) app `Bar` surface, (b)
>    nav-as-render-child (seven invariant hazards), (c) chrome pane on SelectionNav.
>    _Reshaped:_ KEY-Q16 (what counts as rendered) and KEY-Q23 (overlays) now assume frame slots and
>    floating layers; the WordFlower focus-bar feature is the forcing app slice for the frame tranche.

> **KEY-D8 — The attention state machine** (answers KEY-Q4, Q9, Q10, Q11; 2026-09-01)
> The group C proposal is adopted as specified above (state, "targeting is free", transitions 1–8,
> descending, re-aim rules), with rulings: **A** eager targeting — one remaining candidate
> auto-targets; **B** one target now, remembered per region, multi-target deferred to a forcing
> story; **C** verb-first eligibility spans the whole screen; **D** attention state is runtime-owned,
> condition-observable, never `set`, never restored — **and modality-neutral**; **E** modal
> occurrences trap focus and dismissal returns to the prior region via a focus stack distinct from
> Back; **F** descending for nested controls, no lifecycle syntax now.
> _Ruling D, refined by Ro:_ **every interaction in every modality dispatches the attention
> reducer** — pointer, touch, and keys are inputs today; voice and screen-reader focus become inputs
> where a platform adapter emits them, exactly as every available Back source dispatches the
> navigation reducer — so attention state remains separate from OS-level interaction state, and app
> code reads one modality-neutral projection of the events Tao receives. Pointer mapping: tap/click
> a row or button = target + activate; click
> into an input = focus its region + target + engage (and engaging via keyboard focuses the native
> input, so the soft keyboard appears); long-press/right-click = target + verbs, which makes the
> context menu and the noun-first verb menu one surface; click empty region space = region focus,
> no target; hover = the `hovered` condition only, never moves the target; text selection inside an
> engaged input = the control's own state, the reducer knowing only engagement; drag = target on
> start, verb on drop (the drag-and-drop example app will stress this); scroll = nothing. Platform
> focus support is adapter-mediated: attention projects outward through web focus and React Native
> accessibility focus requests, while platform focus updates attention only where React Native emits
> a focus event. General screen-reader cursor movement is not an incoming Tao event. `press "…"`
> test steps are pointer activations, so journeys stay honest.
> _Why:_ without modality neutrality, `focused` lies for pointer users, keyboard-after-mouse
> resumes from a stale place, and screen-reader focus diverges from Tao focus — the parallel model
> KEY-D1 forbids.
> _Reshaped:_ KEY-Q13 (verb-first) is now mostly the verb-pending state; KEY-Q22 (engagement
> contract) inherits the reserved-key set; the runtime's press handlers must route through the
> reducer rather than invoke directly.

> **KEY-D9 — Narrowing rule and candidate domain** (answers KEY-Q15, KEY-Q16; 2026-09-01)
> **Rule:** case-insensitive, locale-aware **word-prefix matching over the item's full rendered
> text**, where a space in the narrowing text starts a further prefix and **each subsequent prefix
> matches the first later word after the previously matched word** (greedy leftmost — complete for
> ordered-subsequence matching): `d w` reaches Discover Weekly past Discover Daily; words 2, 4, 7
> may match in that order, never 2, 7, 4. The first prefix may match any word. Non-matching items
> are subdued, not removed; the typed text shows in the hints; reset on Escape, region change, or a
> collection mutation that empties the candidates. Substring and fuzzy-subsequence matching are
> recorded as possible later modes, not the default.
> **Domain:** stage 1 — **mounted nodes** (what the outline has registered); stage 2, when wanted —
> the loop's rows (mounted or not, targeting scrolls into view; made possible by KEY-D5's static
> label ranking), under KEY-D2's staged pathway. Narrowing never queries the store; rows beyond a
> `limit` are never candidates; the overview states the domain honestly.

> **KEY-D10 — The verb model** (answers KEY-Q12, Q13; 2026-09-02)
>
> 1. **Three kinds, one job each.** `action` — private procedure, no `Title`, never surfaced.
>    **`command`** — a configured value (the `app`/`nav`/`design` family): its parameters are
>    _slots_, its metadata members are `Title` (static; palette and Siri name), `Description`,
>    `Summary` (the sentence with holes), `Label` (reactive display), `Icon`, `Key` (a `shortcut`
>    value), `Enabled`, and its behavior
>    is exactly one `do` of a named or inline action. `Title` leaves `action`; §8's "an action is an
>    intent" is retired; §8's view-scoped `command … = Intent(args) with { … }` is retired.
> 2. **Binding is derivation.** `Like with { Track: Selected }` fills slots; `Like with { Key "k" }`
>    overrides affordances; both are the existing `Value with { … }`. Use-site overrides may touch
>    `Label`/`Icon`/`Key`/`Enabled`, never `Title`. `do` invokes (`do Delete with { Track }`); `do`
>    on an unfilled slot in code is a diagnostic. No general partial application; `given` dropped.
> 3. **Universe and surfacing.** A target's verbs are every command whose slots its type can fill,
>    anywhere in the app; unfilled slots on a surface are filled from the target(s) by type at
>    invocation (verb-first = a command with a still-open slot). Tiers: per-view `Commands` slot →
>    rendered inner controls → the entity's `commands` default list (in the `data` block) → the rest
>    alphabetically, folding; `commands hide X` on the entity and `hide X` in a view exclude.
>    Command scope amends §8: enabled while the declaring view's occurrence is the focused
>    presentation **or contains the target**.
> 4. **Surfaces.** `Toolbar` = presented-view chrome (unchanged). `Rail` retired (a frame slot).
>    `Palette all` retired — the palette is always present. `Menus list of Menu` on the `app`,
>    derived from entity `commands` lists plus app-wide commands when absent; typed literal form
>    with required list brackets (`Menus [ Menu { Title: "Track", Items: [Play, Like, Separator,
>    Delete] } ]`), no sugar; native menu bar on desktop and iPadOS, nothing on phones/web by default.
> 5. **`(title)` field trait** (one per entity) is the display title for palettes and the OS.
> 6. **Assistant block, option A**: `Entities { Track as documents.document (…) }` and
>    `Commands { … }`, inline schema conformance; string queries follow from `(search)`; View
>    Annotations, `NSUserActivity`, and Spotlight indexing derive from the outline, presentation,
>    and `(search)`. Titled links deferred to the deep-link workstream (a titled link = a navigation
>    command = Apple `OpenIntent`).
>    _Why:_ everything a person can do to an entity is available wherever the entity is targeted, with
>    explicit exclusions rather than explicit inclusions; commands are configured values so binding,
>    affordance, and prompting are one mechanism; the OS/agent mapping (`AppIntent`, `AppEntity`,
>    onscreen awareness) falls out of the same declarations.
>    _Opened:_ KEY-Q28 (presented-view kind). _Deferred:_ KEY-Q14 gating (authority workstream).

> **KEY-D11 — `scene`: the one home for host-facing chrome; plain views stay presentable**
> (answers KEY-Q28; 2026-09-02)
> `scene is view`. The host-facing slot vocabulary — `Title`, `Toolbar`, and LANG-035's future
> `Subtitle`/`Icon`/`Badge`/preferred size/initial attention target — lives on `scene` only; a plain
> `view` cannot fill it, so dead chrome is unrepresentable. Scenes are presented, never composed
> inline (diagnosed at the render site). **Ro's modification:** a plain view may still be pushed or
> presented anywhere — a scene is the way to _add_ chrome, not a requirement for presentation.
> Consequences: StackNav's "requires `Title`" relaxes to "a pushed scene must fill `Title`; a pushed
> plain view shows Back-only header chrome" (look settled in the tranche); **sheets read neither
> `Title` nor `Toolbar`**, so sheet-only declarations remain plain views with no dead fill;
> `nav is scene`; scenarios' `render` accepts scenes;
> a presented scene is a region, so the outline's region set is fully declared-or-structural; the
> per-view `Commands { … }` slot stays on `view`. Word: **`scene`** (Ro); reword DEF-NAV-003's
> reserved "scene" to "windows and spaces". This also supersedes the archived ruling in
> `Docs/Roadmap/Archive/Repository simplification/Plan - Repository simplification.md` (item 13,
> "Rename UI to Scene — dropped; do not introduce `scene`"), which concerned renaming the `@tao/ui`
> package path, not a presented-view kind; the archive stays frozen, so this entry is the pointer. A §9
> amendment via the tranche process, reversing part
> of the unified-view decision for a stated reason: `scene` carries the one fact a body cannot —
> never composed — and that fact makes chrome dead code impossible.
> _Why:_ Ro's goal is that a developer never writes `Title`/`Toolbar` on something that is only
> ever composed; option 2 (a grouped block) cannot prevent that without becoming option 3.

> **KEY-D12 — Scope layering, global operations, modes, engagement** (answers KEY-Q17, Q19–Q22;
> defers Q18; 2026-09-02)
> The groups F–H proposal is adopted. **Letters narrow by default** (Ro); bare single-letter `Key`s
> are accelerators inside the verb layer; modifier chords act directly wherever their scope is
> active — one rule: typing finds, chords act, single letters act inside the verb layer.
> Precedence, nearest wins: engaged input → modal occurrence → targeted item's commands → focused
> scene's commands → app-wide commands → reducer keys; duplicate chords in one scope are a
> diagnostic, shadowing across scopes is shown by the hints. Global operations need nothing new:
> a command with no entity slot and a chord is global by construction, and a frame-slot view merely
> mentions it. Modes (overview, hints, verb-pending) are attention-reducer states, never
> language-visible. Engagement: platform text-editing chords win (validator warns on commands
> declaring them); Escape disengages keeping the target; the palette chord and non-colliding
> app-wide chords pass through; Enter submits on single-line and newlines on multiline; Tab
> disengages to the next control; engagement enters by activation or pointer focus; write-through
> binding is unchanged. KEY-Q17 closes via KEY-D8's rules; KEY-Q18 stays deferred with links.

> **KEY-D13 — Surfaces, key allocation, platform reach, testing, and the language/policy boundary**
> (answers KEY-Q3, Q23–Q26; 2026-09-02)
> The groups I–J proposal is adopted as specified: generated surfaces (hints, overview, verb menu,
> palette, help) are pure renderings of outline + attention + bindings as floating layers, hints on
> demand; key allocation is runtime policy — label-derived, locale-aware, identity-stable,
> deterministic, no author overrides yet; universal = outline, attention reducer, accessibility
> projection, and adapter-mediated focus projection (web focus and React Native accessibility focus
> requests outward; focus enters Tao only where React Native emits it), keyboard-specific =
> dispatch, hint layers, chords, affordances appearing after the first hardware keypress; test steps
> `press key`, `narrow`, `expect target`,
> `expect focus region`, `expect verbs` through the existing step seam, `beginTest` resetting
> attention. Language contract: scene/view/frame/command semantics, outline node kinds and
> provenance, attention semantics (targeting is free, engagement, modality neutrality, precedence),
> the narrowing rule, the test steps. Runtime policy: allocation, hint rendering and timing, tier
> ordering details, keyboard-presence detection, platform focus projection and focus-event intake.
> Prelude/design: slot
> vocabulary and appearance. **Discovery closes with this decision**; remaining: story sweep,
> consolidation, implementation plan.

> **KEY-D14 — Story-sweep gaps** (answers G3, G4, G7; 2026-09-02)
> **G3:** a verb-pending prompt for an entity slot offers on-screen candidates first and falls back
> to a store-backed picker over the entity's `(search)` fields — argument resolution for a chosen
> command, not application search. **G4:** when no candidate movement applies, movement keys scroll
> the focused region's scroll container. **G7:** verb-pending for a text or duration slot is an
> inline input prompt; preset commands remain the ergonomic alternative. G1 (frame slot `Label`) and
> G2 (controls participate in narrowing) are clarifications folded into KEY-D7 and KEY-D8/D9; G5
> (ordered move primitive) is a dependency on the drag-and-drop work; G6 (multi-target) stays
> deferred with story 12 as its forcing case.

Format for future entries:

> **KEY-Dn — <title>** (answers KEY-Qm; date)
> The decision, the reasoning, the alternatives rejected and why, and the questions it opened,
> closed, or reshaped.

---

## Rejected and superseded so far

- **Per-app shortcut tables as the primary mechanism** — rejected by the objective itself; the
  point is derivation from app semantics. Developer keyboard declarations remain the override for
  policy, not the source of behavior.
- **Inheriting the browser/DOM tab-order model** — what web builds get today via react-native-web
  is incidental (auto tabindex on Pressables), unordered, invisible to Tao, and untestable; it is
  evidence for the problem, not a base to extend.
- **A second navigation state owner** — any keyboard resolution landing on navigation dispatches
  through the reducer (`NavigationControls`); this is a standing constraint, not an open choice.

---

## Story corpus

Spotify's desktop UI is the design corpus — it exercises persistent sidebars, main content, Now
Playing, player controls, shelves, grids, tables, nested row contents, menus, filters, sort
controls, editable fields, queues, reorder semantics, app navigation, and multiple entity types.
The stories are a test corpus, not a requirement to model Spotify.

1. Reveal/understand the major areas; switch region focus directly to Your Library.
2. Identify a visible Library playlist efficiently (typing part of its name), select it, play it.
3. Use Spotify's own controls (Podcasts & Shows filter, Recently Updated sort) — application
   operations, distinct from local narrowing.
4. On Home, jump among content shelves, then identify a card within one — no per-control traversal.
5. In a long playlist, reach one song by movement or visible-text narrowing; select without playing.
6. Refine a targeted track row to an actionable descendant (artist link, album link, save, menu)
   without one flat navigation order.
7. Ask what actions are available for the selected song (noun-first).
8. Invoke Add to Queue first, then identify the eligible visible entity (verb-first).
9. Invoke an operation with an entity-valued argument (Add Song to Playlist → choose playlist).
10. Control persistent playback without leaving the current region.
11. Jump to Now Playing, navigate within it, invoke something that changes another region.
12. Manage the queue: groups, remove, reorder; eventually multi-selection/bulk.
13. Navigate song → artist → album → song, then traverse application Back history.
14. Select the Search field and type — text input owns the keyboard; narrowing stops applying.
15. Podcast/audiobook structures (episodes, chapters, transcripts) — not everything is a song list.
16. Creation/editing: create/rename/reorder playlists and folders — text editing, trees,
    direct manipulation.

The simplest story's decomposition is the Working model above.

### Story-corpus sweep (2026-09-02)

Every story and WordFlower's focus bar walked through KEY-D1–D13. Thirteen of sixteen pass with no
new decision; stories 9, 15, and 16 needed KEY-D14. The findings, gaps only:

- **G1 — frame slot labels.** The interaction overview needs a human label per region; scenes have
  `Title` and selection items `Label`, but frame slots have only code names (`@bottom`). Frame slots
  need a `Label` — a tranche detail for the frame kind, no design change.
- **G2 — narrowing candidates include controls.** Story 3 (target the "Podcasts & Shows" filter by
  typing "pod") requires that action and input controls in the region participate in narrowing by
  their labels, not only collection items. KEY-D8/D9 wording clarified: candidates are the region's
  targetable nodes — items and controls.
- **G3 — verb-pending for an entity that is not on screen** (story 9: "Add to playlist" when the
  destination playlist is not visible). Decided (KEY-D14): a prompt for an entity slot
  offers the on-screen candidates first and falls back to a **store-backed picker over the entity's
  `(search)` fields** — the same query the Assistant's string resolution uses. This is not
  application search; it is argument resolution for a command the person already chose.
- **G4 — movement in regions without targets** (story 15: a transcript). Decided (KEY-D14): when no candidate
  movement applies, movement keys scroll the focused region's scroll container. Small addition to
  KEY-D8's transitions.
- **G5 — keyboard reordering** (stories 12, 16) needs a "move to position" write over `(ordered)`
  relations. That primitive belongs to the drag-and-drop example app's work (`on move`, decided
  roadmap item); the keyboard exposes it as ordinary commands (Move up / Move down). A dependency,
  not a keyboard decision.
- **G6 — multi-target.** Story 12's bulk operations are the forcing case KEY-D8 ruling B deferred to;
  it stays deferred, now with its forcing story named.
- **G7 — non-entity slot prompting** (story 16's `NewPlaylist(Name text)`, the focus bar's duration).
  Verb-pending for a text or duration slot is an inline input prompt rather than a candidate set;
  preset commands (`Focus for 5 min`) remain the ergonomic alternative. Decided (KEY-D14).

Everything else — overview and region entry (1), typed identification and target-without-activation
(2, 5), shelf jumps and cards (4), descending (6), noun-first and verb-first (7, 8), global playback
(10), cross-region invocation with `focus @slot` (11), navigation graph and Back (13), the search
field's engagement (14), podcasts as non-song structures (15), trees as nested collections (16),
and the focus bar as a frame slot over session data — fits the model as decided.

---

## Feasibility constraints from the current architecture

- **Semantic erasure at codegen** is the central obstacle: everything the compiler knows (entity,
  field, query plan, label provenance) is currently discarded before the runtime. The `TaoProps`
  choke point and the unconditional loop frame prove the delivery channel exists and is cheap.
- **Item identity** is solid (interned handles, `.Id`), but list keys are a duck-typed `Id`/`id`
  heuristic and non-entity loops fall back to index — targeting stability over reorder needs the
  entity-backed case, and a story for literal collections.
- **Test-harness element resolution is heuristic** (prop-sniffing innermost `onPress`) — evidence
  that "what is actionable" needs to become derived data rather than inference.
- **Platform focus reality:** RN native focus APIs are thin (TV-centric); web focus via RNW is
  real but unmanaged; there is no desktop target yet. The design must define Tao-owned focus that
  _projects onto_ platform focus/a11y rather than assuming any platform's engine. The implemented
  adapter seam can request web focus or React Native accessibility focus; focus comes back into Tao
  only where React Native emits a focus event, not for general screen-reader cursor movement.
- **Latent defect found in passing:** `do <command>()` compiles to `invokeJoined` on a command
  value that only exposes `invoke` — programmatic command invocation (exactly what a dispatcher
  wants) likely throws today. The plan's T2 closes it.
