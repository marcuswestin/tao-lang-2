# Plan - Keyboard driven apps

The implementation plan for the interaction system decided in `Design - Keyboard driven apps.md`
(KEY-D1–D14). Read that document's **design summary** first; this plan assumes it and does not
restate rationale. It is written to hand to an implementation agent who has not seen the discovery.

## Ground rules

- Every tranche follows `Docs/Roadmap/Tao Revolution/Process.md`: contract in `Apps/WordFlower/2 -
  Next`, implement slice by slice into `1 - Current` across parser, validator, formatter, source
  actions, compiler, runtime, stdlib (`packages/AGENTS.md` owns those boundaries), prove with
  behavior tests written in Tao, graduate, reconcile `Decisions.md` / `Docs/Spec/` / `Coverage.md` in
  the same change, absorb byte-identical. A tranche that amends a decision updates `Decisions.md`
  in the same change — the amendments are listed per tranche.
- `TR` stays handwritten. Generated outline metadata is emitted into generated modules
  (module-local tables, or sibling metadata modules per Decisions §15) and passed into
  `TR.Interaction.Register(…)`. Nothing generated attaches to the `TR` object.
- The interaction outline is read-only; the attention reducer dispatches navigation through
  `NavigationControls`, never by mutating mounts.
- New behavior coverage lands as `.test.tao` journeys; jest/TR tests only where a native or module
  override, generated-code shape, or the harness itself is under test. A construct a tranche
  introduces is proven by a Tao test in that tranche — grammar with no observable behavior waits
  for the tranche that makes it observable.
- Each tranche's **Open before starting** list is settled by Ro in `2 - Next` before the tranche
  begins; nothing in it is for the implementer to guess.
- **The decisions are authoritative with respect to every markdown document in the repository**
  (Ro, 2026-09-02). Where a live document — `Decisions.md` included — disagrees with the design
  summary, the document is updated; the tranche that touches an area reconciles that area, and T7
  sweeps everything at the end. `Docs/Spec/` describes the implemented contract and follows
  implementation rather than leading it; `Docs/Roadmap/Archive/` stays frozen unless Ro asks.

## Sequence

| #  | Tranche                                         | Forcing feature                                                                   | Depends on                       | Size     |
| -- | ----------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------- | -------- |
| T1 | `scene`, the frame nav kind, device-local data  | WordFlower persistent focus bar                                                   | —                                | L        |
| T2 | Commands as configured values, command catalog  | WordFlower workspace save; HNReader open-story; Basic Navigation                  | —                                | L        |
| T3 | The interaction outline and `(title)`           | Accessibility names on every row; Studio inspection                               | T1, T2                           | L        |
| T4 | Attention reducer, keyboard dispatch, narrowing | WordFlower: narrow the workspace list, engage the editor, global focus-bar chords | T3                               | XL       |
| T5 | Generated surfaces and key allocation           | Interaction hints and overview over WordFlower                                    | T4                               | M        |
| T6 | Assistant boundary, menus, native keys          | Apple App Intents from the `Assistant` block; iPadOS menu bar and hardware keys   | T3, T4; an iOS native build path | L, later |
| T7 | Documentation reconciliation sweep              | Every live markdown document agrees with KEY-D1–D14                               | T1–T5 (T6 when it lands)         | M        |

T1 and T2 may run in parallel worktrees. Their one seam is `Toolbar`: T1 moves it from `view` to
`scene` unchanged (`list of action()`); T2 retypes it to `list of command`. Whichever lands second
touches that one Prelude line, and the WordFlower screens both tranches edit are migrated once if
they land together. T3 waits for both.

---

## T1 — `scene`, the frame nav kind, device-local data

**Goal.** Host-facing chrome has exactly one home (`scene`), shell chrome has a container (the
frame), and WordFlower's focus session survives navigation as a bar in that container without ever
syncing.

**Forcing feature.** Promote `FocusSession` (`Apps/WordFlower/1 - Current/@ui/Focus.tao`, mounted
inline in `Documents.tao`) to a `FocusBar` view in the frame's `@bottom` slot. The session becomes
device-local data:

```
data FocusSessions / FocusSession {
   EndsAt time                 // absolute, so a running session survives relaunch correctly
   PausedAt time?              // set while paused; Resume: EndsAt = now + (EndsAt - PausedAt), PausedAt = none
   store device                // spelling settled in 2 - Next: an entity-level storage fact beside index / order by
}
```

`store device` is the narrow form of the deferred "per-entity datasource scoping": the entity lives in
the device store regardless of the app's `Datasource`, so the InstantDB variant never syncs it. The
bar's slot content is `when CurrentSession { empty -> none, otherwise -> FocusBar }`; an expired
session is deleted at launch. Journeys: start a session in the editor, move to Home, the timer is
visible and Pause/Resume/Stop work; pause, advance the clock, resume, the remaining time is
unchanged; relaunch mid-session, the timer continues; stop, the slot disappears and content grows
back. Fallback if `store device` proves heavier than expected: ephemeral app state (KEY-D7).

**Language.**

- `packages/parser/parser-grammar/views.langium`: `SceneDeclaration` mirroring `ViewDeclaration`
  (parameters, optional `responds`, body or foreign implementation); shares the view body grammar.
- `packages/stdlib/@tao/Prelude.tao`: `primitive scene is view with { Title text is "", Toolbar list
  of action() is [] }` — both slots move off `view`; `primitive nav is scene with { implement }`.
- Validator (`views-validator.ts`, `declaration-slots-validator.ts`, navigation validators): a scene
  may not appear in render position ("a scene is presented, never composed", at the render site);
  host-facing fills on a `view` are rejected at the declaration; a scene pushed on a StackNav or
  presented `as window` must fill `Title`; a pushed plain view is legal (Back-only header); sheets
  read `Title`.
- Formatter and source actions: `scene` formats as `view`; a source action "convert view to scene"
  for views that fill `Title`/`Toolbar`.
- Frame kind: `packages/stdlib/@tao/nav/native/Navigation.tao` and `basic/Navigation.tao` gain
  `FrameNav` (follows `StackNav`/`SlotNav`/`SelectionNav`/`SplitNav`; the retired `frame` view keyword
  is unrelated and the §10 amendment says so) with keyed edge slots, each `{ Label text, Content view?
  , Width?/Height?, Resizable? }`; `native/NavKinds.ts` exports `FrameNavKind = () =>
  TR.NavKind.Frame()`, `basic/NavKinds.ts` exports the same name mapped to `TR.NavKind.Basic.Frame()`.
- `data.langium`: the entity-level storage fact for the device store (`store device` or the settled
  spelling) as a trailing group entry beside `index` / `order by`.

**Runtime.** `TR-navigation-kinds.ts`: frame profile reads no host slots (like SplitNav); mounts its
slot contents in a flex layout (`TR-navigation-mounts.tsx`); **empty-slot rule is semantic**: a
slot whose `Content` evaluates to `none` reserves no space — reactive, deterministic, journey-testable;
no layout measurement. Back routes to the `@center` content's nav, never to edge slots; safe-area
insets are owned by edge slots (basic host: `SafeAreaView` padding; native host: coordinate with the
native tab bar's inset in `TR-navigation-native-*`). Restoration: frame state = each slot's nav state
(`TR-navigation-restoration-state.ts` gains a `frame` profile). Data: the catalog binds a
`store device` entity to the device provider (`Local`) regardless of the app datasource
(`TR-data-registry.ts` / `TR-data.ts` per-entity provider binding). Region hook for T3: frame slots
register as regions with their `Label`.

**Tests.** `Apps/Test Apps/Navigation/`: a frame test app (slot rendering, `Content none` collapse,
Back routing to center, Title-less pushed view header, sheet showing a scene's `Title`); a data test
app proving a `store device` entity is absent from a second datasource variant. WordFlower Current
journeys above. TR tests for the frame profile's restoration round-trip.

**Reconcile.** `Decisions.md` §9 (scene; slots move to scene), §10 (fifth nav kind; rail is a frame
slot; host read-sets: sheets read `Title`, a pushed scene must fill `Title`, a pushed plain view shows
Back-only chrome), §2 (entity-level `store device` beside `index` / `order by`), §11 (device store
alongside the app datasource), §18 table; `Docs/Spec/Tao Presentation and Navigation.md` host
read-sets; `Docs/Spec/Tao Data.md`; `Deferred Tao language decisions.md` (LANG-032 note);
`Add navigation and routing MVP/Follow-ups - Add navigation and routing MVP.md` (DEF-NAV-003
reworded to "windows and spaces"); `Coverage.md` rows for scene, frame, device-local data.

**Open before starting.** The frame kind's name (`FrameNav` proposed); the edge set (all four vs.
top/bottom only — lean all four); the corner rule (bars span full width by default); whether
`Width`/`Height` are per-slot or content-derived; the `store device` spelling; the Back-only header's
look for a pushed plain view.

---

## T2 — Commands as configured values, and the command catalog

**Goal.** `command` is a configured value with slots and one `do`; `action` is private; every
command in the app is enumerable; `Toolbar` holds commands; `do <command>` works.

**Forcing feature.** Rewrite WordFlower's `SaveWorkspace`/`Save` (`@ui/Workspaces.tao`), HNReader's
open-story command, and `Apps/Test Apps/Navigation/Basic Navigation.tao`. `Save` is the worked
example of a **view-body command**: `SaveWorkspace` reads and resets view state, so the command is
declared in the view, closes over it, and its `Title "Save workspace"` moves from the action to the
command — the journeys asserting `toolbar command "Save workspace"` stay green. `Documents.tao` has
no commands today; the document commands T4's journeys need (e.g. a `Finish` command) are added here.

**Language.**

- `packages/parser/parser-grammar/blocks.langium` (where `CommandDeclaration` lives today):
  `CommandDeclaration: 'command' name=ID block=CommandBlock`. **Placement:** module level or a view
  body — the same rule as `action`; a view-body command closes over the view's parameters, state,
  and actions. The block holds slot declarations, member fills, and exactly one `DoClause: 'do'
  (ActionExpression | named action call)`.
- **Slot/fill disambiguation.** `Track  Title "Delete"` lexes as `ID ID STRING`, so grammar alone
  cannot tell a typed slot from a fill. Rule: an entry `ID` alone is a bare slot; `ID <expression>`
  is a fill unless the expression is a bare name that resolves to a **type**, in which case it is a
  typed slot (`Name text`, `Author Person`) — the same namespace classification §2 uses for a
  capitalized name in call position. A name that is both a type and a value is a diagnostic asking
  for the explicit fill form `Name: value` (`:` is already the literal binding symbol). Fills accept
  full expressions (`Label when …`, `Key primary + "n"`); the `with { … }` refinement block gains the
  same expression fills. Alternative for `2 - Next`: colon fills only.
- Prelude: remove `Title`/`Description`/`Summary` from `primitive action`; add `primitive command
  with { Title text, Description text is "", Summary text is "", Label text is Title, Icon text is "",
  Key shortcut is none, Enabled boolean is yes }`. **`shortcut`** is the new value type (`key` is
  taken: it is the slot-key type in `SelectionNav { Initial key }` and a reserved parameter name);
  `primary + "n"` is a shortcut value, and a bare string literal in `Key` position is a shortcut
  literal (the §2 precedent of a bare number in size position). `packages/ast-utils` `Type.ts` and
  `Units.ts` gain `shortcut`; the validator rejects platform-named modifiers.
- `Value with { … }` on a command fills slots and overrides `Label`/`Icon`/`Key`/`Enabled`;
  overriding `Title` is a diagnostic. `do <command> [with { … }]` invokes; `do` with an unfilled
  slot is a diagnostic.
- Prelude: scene's `Toolbar list of command is []`; mentions are unfilled command values, and the
  braced reference block `Toolbar { Save }` keeps its spelling.
- Retire `command X = Action(args) with { … }`; delete the `commands-validator.ts` rule requiring
  an action to fill `Title` before binding (the command carries `Title` now). Source action:
  mechanical rewrite of the old command form and of `Title` inside actions.

**Compiler.** `ActionsCompiler.ts`: emit `TR.Command({ name, slots, title, description, summary,
label, icon, key, enabled, do })` — module-scope values for module-level commands, view-scope values
for view-body commands; `with { … }` → `TR.Derive(command, fills)`; `do` → `TR.Do(command, fills)`.
**Command catalog:** every module emits a table of its commands (identity, slot types, metadata
refs) and registers it at load via `TR.Interaction.RegisterCommands(table)`; view-body commands
register when their view mounts. The catalog is what "every command whose slots the target's type
can fill, anywhere in the app" is computed over — without it the verb universe and the palette
cannot exist.

**Runtime.** `TR.ts`: `RuntimeCommand` (slots, metadata closures, `invoke(fills)`, `invokeJoined`),
`TR.Derive`, `TR.Do` accepting commands — this closes the `do <command>` latent defect
(`RuntimeNavigationCommand.jsValue` lacking `invokeJoined`). `TR-interaction-catalog.ts`:
`CommandCatalog` with `applicable(entityType)` and `global()` (entity-slot-free). `TR-navigation-
host-slots.tsx`: the toolbar snapshot carries command values with fills resolved against the
presented scene's parameters by type (`argument-bindings.ts` is the reference).

**Tests.** Journeys: `press toolbar command "Save workspace"` unchanged; `expect toolbar command …
enabled|disabled`; a `do <command>` from an action; a view-body command reading view state. TR tests:
`CommandCatalog.applicable` over a module table; validator tests for every diagnostic (two same-typed
slots, `Title` override, unfilled `do`, ambiguous slot/fill name).

**Reconcile.** `Decisions.md` §8 rewritten: commands as configured values, placement, slots and fills,
`shortcut`, `Description` kept, `intent` retired as a word, `Rail`/`Palette all`/in-view `menu Name
{ … }`/`present … as palette` retired, `present … as menu` kept; §9 "one body grammar" (commands
stay legal in view bodies); §18 rows; `Docs/Spec/Tao Actions.md`; `Coverage.md`.

**Open before starting.** Slot/fill rule (namespace classification vs. colon-only fills); the
`shortcut` type name; whether `Description` stays (lean: yes — Apple's `AppIntent` has one).

---

## T3 — The interaction outline and `(title)`

**Goal.** `TR.Interaction.Outline` exists — registered skeleton always, evaluation on demand — with
kinds, labels, and provenance, and it already improves accessibility.

**Compiler.** For every render occurrence that becomes an outline node, emit a static descriptor
into a module-local table: kind (region is runtime-derived; collection for `loop`; collection item
per loop row; action control when a `Press`/`Submit` parameter is bound or the row has `on select`;
input control when `Value:` is bound with `Change`), source identity (the studio identity mechanism
generalized into the static table — **without** ungating the `dataSet.taoStudio` DOM lowering in
`TR-TaoProps.ts`, which stays Studio-only), owning view/scene, label ranking (the first unconditional
text occurrence reading the row binder; the `(title)` field preferred **when the row renders it**;
the fallback chain), provenance (loop entity; item handle read at runtime). Emit
`TR.Interaction.Register(descriptorRef, liveArgs)` through the `TaoProps` choke point. Inject fences
and foreign views register as opaque leaves. `types.langium` (where the `Trait` alternation lives):
trait `title`, validator at most one per entity; `DataCompiler.ts` emits it into the entity definition.

**Per-item registration.** A loop row has no guaranteed native root: `ForEachItem` (`TR.ts`) wraps
only selectable rows in a `Pressable`, and a row body may render several roots. Registration
therefore hangs on `ForEachItem` itself — which exists for every row, selectable or not — carrying
the row's handle. Native-root attachment (the row's `accessibilityLabel`, geometry) applies when the
body has a single root render; a multi-root body registers with its first native root as anchor and
no row-level accessibility label (a validator hint suggests a single root).

**Runtime.** `TR-interaction-outline.ts` generalizes `TR-navigation-registry.ts` and
`RuntimeHostReadChannel` (`TR-navigation-host-slots.tsx`) — one registry and one
subscribe/snapshot/fingerprint mechanism, not a parallel copy. `TR-interaction-labels.ts`: the
**primary label is always-on** (one statically ranked string per row, needed synchronously as an
accessibility prop); the full narrowing corpus and everything else evaluate only while a consumer is
attached. `TR-interaction-regions.ts`: regions from the navigation registry — frame slots, split
panes, selection items, presented occurrences. Accessibility projection: rows get
`accessibilityLabel` (fixing `TR-selectable-row.tsx`), regions get `accessibilityRole` groups.
Provenance is never exposed as a test selector.

**Tests.** TR tests: registry lifecycle for selectable, non-selectable, and multi-root rows; label
ranking cases (WorkspaceRow, HNReader story row, image-only card, conditional branch, `(title)`
rendered vs. not rendered); provenance identity across a reorder; zero corpus evaluation without a
subscriber. Journeys: `expect label "…"` on rows passes where it could not before. Studio: an
inspector panel listing the outline (optional).

**Reconcile.** `Decisions.md` §2 trait table gains `title`; §9 accessibility paragraph gains the
derivation; §15 gains the generated outline tables beside the bridge module; `Docs/Spec/Tao Layout
and UI.md` (accessible names derived); `Docs/Spec/Tao Data.md`; `Coverage.md`.

---

## T4 — Attention reducer, keyboard dispatch, narrowing, surfacing policy

**Goal.** Keyboard-driven WordFlower: regions, targeting, narrowing, activation, verbs, engagement —
all modality-neutral, all testable.

**Language.** Entity surfacing policy in the `data` block (`commands Play, AddToQueue`; `commands
hide Delete` — `EntityDataDeclarationBlock` in `data.langium`), the view slot `Commands list of
command is []` and the `hide <commands>` statement — all observable here through `expect verbs`.
Test steps through the `surface=ID` seam in `tests.langium`: `press key "<shortcut>"`, `narrow
"<text>"` (KEY-D13 spelled it `type "…"`; `type` is the type-declaration keyword, so `narrow` is
proposed), `expect target "<label>"`, `expect focus region "<label>"`, `expect verbs "<a>", "<b>"`;
runner support in `test-runner.tsx` dispatching through the reducer, not synthetic DOM events.
Condition vocabulary: `focused` (decided) applies to the targeted control; the region-focus condition
name is open. Validator: duplicate shortcuts within one **static scope** — one `Toolbar`/`Commands`
mention list, one entity's `commands` list, or the entity-slot-free set — and a warning on commands
declaring platform editing chords.

**Runtime.** `TR-interaction-attention.ts` — the reducer: state (region focus; per region: target,
narrowing text, candidates, engagement; focus stack), transitions 1–8 of KEY-D8, re-aim rules,
descending, scrolling fallback, verb-pending (candidates across the screen; store-backed `(search)`
picker fallback; inline input prompt for text/duration slots; required slots in declaration order),
precedence (engaged → modal → item → scene → app → reducer keys), the verb layer with single-letter
accelerators, the engagement contract (platform editing chords win; Escape; Tab moves to the next
control in the current scope's render order; Enter by control). **Reserved reducer keys** (proposed,
settled in `2 - Next`): arrows, Enter, Escape, Tab, Backspace, Space (narrowing word separator),
`.` (verbs), `?` (hints), Escape with nothing to clear (overview), `primary + K` (palette — Studio's
precedent); reserved punctuation never narrows. `TR-interaction-keys.ts`: hardware key dispatch
beside `usePlatformBack` in `TR-navigation-app-host.ts` — web (`keydown` on the app host root via
react-native-web's forwarded handler) and the test harness in this tranche; native hardware keys are
a T6 deliverable. `shortcut` parsing (`primary` → meta/ctrl by platform). **Modality neutrality
covers every control**: one helper `TR.Interaction.Activate(node, invoke)` used by `TR.Views.*`
(Pressable, TextInput, Checkbox, …), `SelectableRow`, and both stdlib tiers — `@tao/ui/native/
Native.tao` (Button, FormButton, Switch, Slider, Picker, SegmentedControl, DatePicker) and
`@tao/ui/basic/Basic.tao` — so no control invokes an action without the reducer seeing it. Platform
focus sync both ways. Narrowing per KEY-D9 (locale-aware word-prefix subsequence, greedy leftmost;
domain = mounted nodes; controls participate). Verb surface tiers read the T2 catalog. `beginTest`
resets attention. Capture domain `interaction` via `TR.Capture` for Studio.

**Forcing journeys (WordFlower).** Enter the workspace region, narrow the workspace list, target
without activating, activate; engage the document title field, type, Escape keeps the target; press
the focus bar's Pause shortcut from the editor; open the verb menu on a document row and run a
command by accelerator; a hidden command is absent from `expect verbs`; Back never changes region
focus.

**Reconcile.** `Decisions.md` §16 test steps; §9 conditions; §8 surfacing policy and `Commands`;
`Docs/Spec/Tao Testing.md`; `Coverage.md`.

**Open before starting.** The region-focus condition name; the reserved key set; the `narrow` step
name.

---

## T5 — Generated surfaces and key allocation

**Goal.** Interaction hints, overview, verb menu, and palette render from the outline; keys for
regions and items are allocated deterministically.

**Runtime.** Anchored floating layers (`TR-interaction-layers.tsx`) in the app host above content
(sibling of the toast layer), outside Back, `accessibilityElementsHidden` when hidden; hints
(point-anchored on controls and items, stretched on regions), overview (regions with labels and
keys), verb menu (tiers, accelerators, shadowed shortcuts shown), palette (all titled commands and
entities from the catalog, KEY-D9 narrowing over labels). Allocation
(`TR-interaction-allocation.ts`): label-derived first free letter → next distinctive → two-letter
sequences; locale-aware; never a reserved key; assigned by identity; deterministic. Keyboard-presence
gate: affordances after the first hardware keypress. Design: element defaults `Hint` and `Overview`
in the design's `styles { }`. Studio's `StudioCommandPalette.filter` (`packages/studio/studio-src/
client/StudioProductPanels.ts`) adopts the same narrowing rule in a later Studio slice; until then
the two knowingly differ.

**Tests.** TR tests: allocation determinism and stability across reorders; journeys: `press key "?"`
then `expect text` on hint labels; overview region listing.

**Reconcile.** `Decisions.md` §13 (element defaults `Hint`, `Overview`); LANG-018 direction recorded
(floating layers); `Coverage.md`.

---

## T6 — Assistant boundary, menus, native keys (later; needs an iOS native build path)

**Goal.** The `Assistant` block compiles to App Intents; onscreen awareness comes from the outline;
the menu bar and native hardware keys exist where the platform has them.

**Language.** `app.langium` / Prelude `app`: `Menus list of Menu is []` with `type Separator is one
of Separator`, `type MenuItem is command | Menu | Separator`, `type Menu is { Title text, Items list
of MenuItem }` — verify the cyclic-type validator (`types-validator.ts`) permits recursion through
`list of`, or flatten to one submenu level; typed literal form with required brackets, no sugar. The
`Assistant` slot: `Entities { <Entity> [as <schema> (<field mapping>)] … }` and `Commands { <command>
[as <schema>] … }`.

**Compiler/runtime.** Generate Swift `AppEntity` (id, `displayRepresentation` from `(title)`,
`EntityStringQuery` over `(search)` fields, `IndexedEntity` with `indexingKey`), `AppIntent` per
exposed command (title, description, typed parameters), schema conformance via `@AppEntity(schema:)`
and `@AppIntent(schema:)` (the 2024 `@AssistantEntity(schema:)`/`@AssistantIntent(schema:)` macros
are deprecated) from inline `as <schema>` with field mapping, View Annotations
(`.appEntityIdentifier`) from the outline for exposed entities, `NSUserActivity` from the presented
occurrence's entity parameter. **Native-to-JavaScript bridge:** an Expo native module exposing
`perform(commandId, fills)` that boots the JavaScript runtime headless when the app is not running,
awaits `TR.Do` through the ordinary action transaction (so store writes commit before returning), and
maps the §5 outcome vocabulary to `IntentResult` / `IntentError` (rejected, error, queued). Menu bar
on iPadOS and desktop from `Menus`, derived (`TR.Menus.derive(app)`: one menu per exposed noun from
its `commands` list plus entity-slot-free commands) when absent. Native hardware keys: `UIKeyCommand`
/ hardware-keyboard events bridged into `TR-interaction-keys.ts`. Validate with Apple's App Intents
Testing framework; `as assistant do …` test step per Decisions §8.

**Reconcile.** `Decisions.md` §8 Assistant paragraph and `Menus`; `Coverage.md`.

---

## Cross-cutting

- **Migration** (owned by T2): `command X = Action(args) with { … }` and `Title` inside actions are
  rewritten by a source action across every Test App, WordFlower tier, and HNReader; `Toolbar { Save }`
  keeps its spelling. T1's scene conversion touches the same screens; land the two migrations
  together when possible.
- **Performance staging** (KEY-D2): registration always; the primary label always-on; corpus and
  subscriptions on attachment; fingerprint diffing (exists); static tables (T3); finer subscriptions
  and windowing only if measured.

## T7 — Documentation reconciliation sweep

**Goal.** Every live markdown document in the repository agrees with the decided design; nothing
still describes the retired spellings or the pre-design model.

**Scope.** `Docs/Roadmap/Tao Revolution/Decisions.md`, `Process.md`, `Coverage.md`; every live
`Docs/Roadmap/` document (`Deferred Tao language decisions.md`, the navigation follow-ups, the
exploration ledgers that mention intents, palettes, rails, or focus); `Docs/Spec/*` (the implemented
contract — updated to what T1–T6 shipped, never ahead of it); `Docs/Tutorials/`; `Docs/README.md`;
`Roadmap.md`; `Apps/WordFlower/README.md`, `Apps/Tao Future/README.md`, and the `.tao-revolution`
sources' comments where they state command or navigation vocabulary; every `AGENTS.md` and
`agents/skills/*/SKILL.md`; the design document itself (its discovery record moves to
`Docs/Roadmap/Archive/` only if Ro asks).

**Method.** Search for the retired and renamed vocabulary — `intent` as a declaration or concept
word, `Palette all`, `Rail`, `menu Name { … }` in views, `present … as palette`, `Title` on
`action`, `command X = Y(args) with`, `Key "cmd+…"`, `ui`/`frame` as kinds, "an app mounts navs, it
does not render content directly" — and for every statement about focus, selection, commands,
toolbars, navigation containers, or accessibility; compare each against the design summary; update
or delete. Each `Decisions.md` amendment names the KEY-D entry that decided it. `Coverage.md` gains
rows for scene, frame, device-local data, commands and the catalog, the outline, the attention
reducer, narrowing, surfaces, and the Assistant boundary.

**Done when** `just words check` and `./agent verify` are green and a repository-wide search for
each retired spelling finds only archived or explicitly historical text.

## Deferred hand-offs

The authoritative list is the design summary's _Deferred and dependencies_. Implementation notes:
nothing in T1–T5 depends on `link` (titled links become navigation commands and Apple `OpenIntent`
when the deep-link workstream lands); keyboard reordering reuses the drag-and-drop work's ordered
"move to position" write as ordinary commands; the loop's rows as the narrowing domain is KEY-D9's
stage 2 behind the same read surface.
