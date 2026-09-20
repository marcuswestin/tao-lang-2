# Tao Revolution — What the Four Designs Agree On

Four independent designs of the post-MVP Tao language were reviewed. Each contains
`Docs/Roadmap/Tao Revolution/` with the same three demo apps (Skillet, Hearth, Wayfare) plus a
`README.md` overview and a `scratchpad/` of working notes.

| Key   | Design                              | Location                                                                       |
| ----- | ----------------------------------- | ------------------------------------------------------------------------------ |
| **A** | `wonderful-agnesi-aad6c8`           | `~/code/tao-lang-2/.claude/worktrees/wonderful-agnesi-aad6c8`                  |
| **B** | `consolidate_tao_revolution_design` | `~/.gemini/antigravity/worktrees/tao-lang-2/consolidate_tao_revolution_design` |
| **C** | `codex 8886`                        | `~/.codex/worktrees/8886/tao-lang-2`                                           |
| **D** | `tao-revolution-synthesis-da6265`   | `~/code/tao-lang-2/.claude/worktrees/tao-revolution-synthesis-da6265`          |

**The headline finding.** The four designs agree on far more than they disagree on. Essentially
the entire _semantic model_ of the language is unanimous — what a store guarantees, where authority
lives, what an effect can answer, how the public boundary works, what a design system must make
checkable. The disagreements are concentrated in _spelling_ and in four or five structural
questions, and they cluster in a predictable way: **A, B and D form one dialect and C is the
consistent outlier**, with D breaking away from A/B on localization specifically. B is best read as
a smaller, more conservative A — it rarely dissents, it mostly just omits.

---

## Part 1 — Unanimous decisions (all four)

### Premise and file organization

- **The demos are the specification.** All four state that the three apps are the artifact and the
  README is only a map, and all four use the `.tao-revolution` extension so today's toolchain
  ignores them. None of the four used the existing `Apps/WordFlower/4 - Revolution` as a template.
- **A folder is one module.** Sibling declarations in the same folder see each other with no import
  ceremony. `use X from @pkg` exists only for genuinely external packages.
- **Two visibility modifiers.** `file` narrows a declaration to its source file; `public` widens it
  past the folder or package boundary. Nothing else.
- **The same file decomposition per app**: data, access, transactions/automations, shared
  chrome, per-feature screens, design, words, scenarios, tests, and TypeScript sidecars — split so
  that the security story is reviewable on one page.

### Data and the store

- **`data Plural / Singular { … }`** declares an entity as both a collection name and a row name, so
  a loop can infer its element.
- **`data Accounts / Account with { … }`** extends the platform's account type rather than
  redefining it.
- **Three distinct correctness words, deliberately not the same word:**
  - `validate <condition> <message>` — a store invariant, enforced on _every_ write path
    (keystroke, draft commit, transaction, sidecar import), which rejects the write.
  - `required <message>` — completeness, which never blocks a write; it derives `Incomplete` and
    `Problems` so a row can be built one field at a time and still know it is unfinished.
  - `refuse when <condition> <message>` — a domain rejection inside a transaction, before any write
    lands.
- **`together A, B`** makes two fields one fact, so an amount never syncs without its unit.
- **`unique`, `index`, `search`, `order by`** are declarative storage facts stated on the entity,
  not preflight checks written in UI code.
- **`(owned)` gives cascade lifetime, `(ordered)` gives store-kept positions.** All four agree that
  an ordered relation means drag-reordering needs no hand-maintained position field and that the
  position reads back on the row.
- **Personal preferences are a first-class, separate concept** — durable, synced per account, and
  explicitly _not_ shared product truth, so "current home" or "units" cannot leak to collaborators.
  All four also allow scoping a preference to one device.
- **`secret` is a capability-grade value type**: unguessable, rotatable, and the thing an
  invitation is built out of. All four reject "a link containing a row id" as the sharing model.
- **Absence is explicit.** An optional field's absence is `none` and must be handled as such.

### Authority

- **Deny by default.** Nothing is readable or writable unless a rule grants it.
- **Four verbs**: `read`, `create`, `change`, `delete`.
- **`audience`** names a reusable set of accounts derived from a durable relation path with a
  filter, and the same named audience is used by both the access rules and the screens.
- **Field-scoped change grants** — a grant may name only certain fields, so everyday edits stay open
  while provenance, lifecycle and sharing fields stay closed.
- **Transaction-only write paths** (`through <Transaction>`) reserve sensitive mutations for one
  named atomic operation even for a caller in the right audience.
- **Holder-of-secret grants** authorize whoever presents a capability, which is how invitations work
  in all four.
- **Inherited policy** — a child entity can take its parent's rule rather than restating it.
- **Authority is store-enforced and screens only _ask_.** All four insist no screen decides
  permission; the UI calls something like `can change X` and the answer comes from the same rule the
  store enforces. Command availability derives from this.
- **A write is checked against the row as it will be**, which is what lets an invitation create the
  very membership that then protects it.

### The public boundary

- **A projection is a distinct read-only type with a closed field allow-list.** A field not listed
  is not in the type, so adding a private field to an entity can never silently publish it.
- **Public links are addressed by a rotating capability.** Revoking is rotation, not hiding a URL —
  every link already handed out stops resolving.
- **A generated preview** shows exactly what the projection ships, so what an author previews cannot
  drift from what crosses the boundary.
- **Public entry points are explicit** — a screen or destination marked public resolves without an
  account and reads only projections.

### Writes, effects and outcomes

- **`transaction`** is an all-or-nothing commit across rows, declares who may call it, and may
  return a value. Access rules still apply to each write inside it.
- **Direct write verbs** (`create`, `update`, `delete`, plus bulk forms) express a single authorized
  mutation without ceremony.
- **One structured outcome vocabulary for every effect**, and critically all four distinguish
  **`queued`** (durably accepted on this device, offline) from **`saved`** (confirmed by the
  provider), alongside rejection, conflict and error. Offline is never modelled as an error.
- **A mandatory app-level safety net** handles unavailability once, app-wide, so a site only names
  the outcomes it treats specially and "unauthorized" can never be accidentally skipped.
- **Availability is a state, not an empty collection.** Loading, missing/unavailable, unauthorized
  and error are distinct from "there are zero rows," and **emptiness is content, not failure**.

### Reads

- **`query Name from <path> { … }`** is live and provider-backed, with filtering, ordering, search,
  grouping and limits declared next to the consumer. Views never poll or subscribe manually.
- **Queries traverse relations** rather than requiring hand-written joins.
- **Multi-field text search** is declared on the entity and consumed by the query.
- **Grouped/aggregate queries retain their contributing source rows**, so a folded total can be
  traced back.
- **`presence`** is ephemeral live collaboration state scoped to a durable subject (who else has
  this row open).

### Editing

- **Two binding targets, one rule.** An input binds either directly to an existing row's field
  (write-through on keystroke, with validate/together/access still holding) or to a **draft**.
- **Drafts come in two flavours**: `for new` (a record that does not exist yet, incomplete creation
  allowed) and `from Row` (a composed multi-field edit of an existing row).
- **A draft carries the entity's own `validate` and `required`** rather than restating rules.
- **Conflicts are a draft concern**, and all four generate a field-by-field comparison component
  from the entity rather than making the author write one.

### Commands, actions, concurrency

- **`command`** unifies a human label, icon, keyboard shortcut, intent, availability rule,
  concurrency policy and behaviour in one declaration, and can be mounted in a toolbar, a navigator,
  an empty state or rendered as its own button without restating any of it.
- **Concurrency is declared, not coded** — a single-flight policy and a supersede-latest policy,
  each keyable to a specific row so locks scope correctly.
- **An action exposes a live in-flight boolean** for busy states.
- **Platform-abstract shortcuts** — the primary modifier is named, never hard-coded to a platform.

### UI

- **Four declaration kinds**: a screen with navigation identity, a reusable leaf visual, a wrapper
  that accepts caller content through named slots, and a modal that returns a typed answer.
- **`render` introduces the visual tree**, and the visible hierarchy is the primary shape of the
  code.
- **A `[ … ]` clause list** after any element carries layout and style, resolved through the design.
- **Layout primitives** — column, row, grid, responsive panes, scroll view, paged view — expressed
  as intent (claim, grow, min, max, gap, alignment), never as device coordinates or flexbox
  mechanics.
- **Events attach in the element's own block**: press, change, submit, select, move.
- **`loop`** repeats content over a collection with the singular row name.
- **Accessibility is part of the model, not an afterthought** — semantic labels on controls and
  non-text media, focus as declared product behaviour, and design checks that reject unnamed
  interactive elements.
- **Maps must name a non-map alternative** over the same rows; location graphics are never the only
  way to use a feature.

### Navigation

- **The same four container kinds**: a back-stack, a replaceable detail pane, an adaptive selection
  container, and a multi-pane split.
- **The selection container is tabs when narrow and a sidebar when wide**, declared once, with no
  device name anywhere.
- **The split declares compact progression and pane collapse priority once**, then the runtime picks
  panes from available width.
- **A live root** — the top-level experience follows account or workspace state as an ordinary
  reactive value; no screen imperatively replaces the app.
- **Reveal-or-focus, never duplicate** — mounting an equal target focuses the existing mount instead
  of stacking a second copy of the same product state.
- **Presentation modes with automatic fallbacks** — sheet, window, root, menu, toast — where a
  window is a window on a laptop and a full-screen sheet elsewhere, and a window carries a semantic
  key so reopening the same subject focuses one window.
- **Typed entry points with stable URL patterns**, including explicit unauthenticated ones.
- **Links wait and win** — a link whose target is not mounted yet runs when it is, so a shared link
  opens after sign-in, and an incoming link supersedes restored state.

### App composition and providers

- **`project { … }`** declares the product envelope: name, targets, languages, licensing.
- **`app { … }`** is the one composition root selecting design, copy, providers, permissions and
  navigator.
- **`app X with { … }`** derives a variant (previews, on-device, tests) by swapping providers,
  without forking any product declaration.
- **Providers are configured values**, not magic globals: datasource, files, notifications, places,
  permissions.
- **Local-first is provider behaviour, not screen code** — optimistic writes, durable queues,
  synchronization and tombstones/retention live in the datasource configuration.
- **An offline block states the closure** of what remains usable with no network, including map
  tiles.
- **Each permission carries the human reason** shown at first use, and a permission is a multi-state
  value a screen can render honestly rather than a boolean.

### Automations

- **`automation`** is provider-owned scheduled work driven by data, which keeps running when every
  screen is closed — explicitly not a timer on one mounted device.
- **All four give it the same clause set**: a schedule derived from the row, a condition that
  cancels it when the row moves on, a semantic deduplication key, an audience of whose devices to
  reach, a notification body, and a target to open.
- **Scheduling names the owning domain time zone**, so reminders survive travel and daylight saving.

### Design system

- **One `design` declaration** holding raw tokens, semantic roles over those tokens, reusable
  bundles, per-control styles with variants and interaction states, patterns with named slots, and a
  rules block.
- **Raw visual values are confined to the design.** Product screens speak in meaning, and a check
  enforces it.
- **`rules { … }` makes accessibility executable** — contrast to WCAG AA, minimum tap targets,
  heading order, 200% text scale, and meaning that survives without colour.
- **Size classes are named words** (narrow / wide), used by screens and navigation; no pixel count
  or device name appears in a screen.
- **Adaptation reads the person's settings first** — reduced motion, high contrast, pointer
  precision, text scale — before guessing from hardware.

### Words and formatting

- **Dates, times, durations, numbers and units format for the reader** at the rendering edge, from
  semantic values.
- **Measurement system follows an account preference, not the language.**
- **Locale catalogs support inheritance**, and a missing translation is a reported gap rather than a
  silent blank.

### The TypeScript boundary

- **A typed contract is declared in Tao and implemented in a `.ts` sidecar**, with the compiler
  checking the join in both directions from an emitted type.
- **Injected code holds no authority.** Validation and durable authority stay in Tao, and the
  result is committed by Tao.
- **Failures return as structured outcomes rather than throwing.**

### Verification

- **`fixture`** builds a named, reusable data graph plus identity state, whose rows are handles that
  tests and scenarios point at.
- **`test` / `check "sentence"`** are journeys at product altitude, run on a named device class,
  with a fresh store, clock and network per check.
- **Store-level and policy-level assertions bypass the UI**, because a hidden button is not proof of
  security.
- **Exactness assertions** catch accidental extra rows, fields, notifications or public data.
- **The world is controllable**: clock and advance, network offline/online, wait for sync, relaunch,
  additional accounts, and collaborators acting concurrently.
- **Sidecars are stubbed by contract** in tests rather than by mocking a network.
- **`scenario`** pins a named, buildable app state — fixture, destination, device, appearance, text
  scale, contrast, motion, network, clock, locale — for screenshots and review.

---

## Part 2 — Majority decisions (three of four), with the dissenter named

In almost every row below the dissenter is **C**. C is internally coherent and often more explicit;
it simply made a different, more conventional-language choice at each of these points.

### Where C is the dissenter

| Decision                           | Majority (A, B, D)                                                                               | C's alternative                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Closed case types                  | `type Course is one of Breakfast, Lunch, Dinner, Snack`                                          | `enum Course { Breakfast Lunch Dinner Snack }`                                                                          |
| Optionality                        | trailing modifier — `Amount number (optional)`                                                   | leading keyword — `optional Amount number`                                                                              |
| Relations                          | inferred from the entity name — `Memberships (owned)`, `Recipe`                                  | explicit cardinality and path — `Members many KitchenMembership (owned)`, `Household one Household`, `many … through …` |
| Preferences                        | their own declaration form — `preference Units is one of Metric, Imperial (default Metric)`      | a field modifier on the account — `MeasurementSystem MeasurementSystem (preference, default Metric)`                    |
| Diagnostic messages in data rules  | inline English sentences, hoisted into the catalog at build time — `required "Name this recipe"` | catalog keys — `required "recipe.title.required"`                                                                       |
| Access shape                       | one `access <Entity> { … }` block per entity                                                     | one app-wide `policy SkilletAccess deny by default { for <Entity> through <path> { allow … } }`                         |
| Public sharing                     | a single `public publish … as … by capability …` declaration                                     | three declarations — `projection … exactly`, `public share … by rotating capability`, and `holder grant`                |
| Read safety net                    | an anonymous, mandatory `guard default { … }`                                                    | a named `recovery SkilletRecovery { … }` selected on the app                                                            |
| Deep links                         | one `link Name "/path/{Row}" -> { mounting }` declaration                                        | `destination` (intent + optional URL) separated from `mount` (policy)                                                   |
| Root navigator gate                | gates on the domain handle — `Navigator when MyKitchen { none -> WelcomeNav … }`                 | gates on the account — `Navigator when Me { signedOut -> WelcomeNav; signedIn -> when Me.CurrentHousehold … }`          |
| Datasource                         | a `Cloud { … }` value with an `Offline { … }` block                                              | `LocalFirst { Device … Cloud … Accounts … }` plus a separate `identity` provider                                        |
| Conflict policy                    | `Conflicts fieldwise latest`                                                                     | `Conflicts revisions`                                                                                                   |
| Parameters                         | inferred from the type name — `ui RecipeScreen(Recipe)` / `ui RecipeScreen Recipe`               | always named and typed — `ui RecipeScreen(Recipe is Recipe)`                                                            |
| Empty argument lists on containers | omitted — `Col [page]`                                                                           | always written — `Col() [page]`                                                                                         |
| Design system structure            | `tokens` → `meaning` → `dark { }` → `style` → `patterns` → `rules`                               | flat `color.tomato #C94F3D`, no meaning layer, `environment scheme dark { … }`, singular `rule`                         |
| Command metadata                   | capitalized — `Label`, `Icon`, `Key`, `Available when`                                           | lowercase — `label`, `icon`, `shortcut`, `available`                                                                    |
| Card collections                   | `Grid [cell min 220, gap md]`                                                                    | a vertical `loop` of card rows                                                                                          |
| Paged content                      | index binding — `Pages(Steps, Page: StepNumber)`                                                 | selection binding plus verbs — `Pages(Steps, Selected: selected Step)`, `next page`                                     |
| Store assertions in tests          | `expect stored exactly one Grocery where …`                                                      | `expect data exactly one Grocery where … { … }`                                                                         |
| Test selectors                     | accessibility roles and names — `press button "New recipe"`                                      | catalog keys — `press label words.household.create`                                                                     |
| Anonymous element handles in tests | `#kitchenName`, `#lines[2]`                                                                      | essentially absent; labels and keys are used instead                                                                    |
| Project identity                   | `project { id "skillet" … }`                                                                     | no `id` field                                                                                                           |
| Desktop target name                | `targets phone, tablet, laptop`                                                                  | `targets phone, tablet, desktop`                                                                                        |
| Scenario device syntax             | `device laptop 1440 x 900`, `appearance dark`                                                    | `device desktop 1280 by 800`, `scheme dark`                                                                             |

### Where the dissenter is someone else

| Decision                                                    | Majority                                                                             | Dissenter                                                                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copy at the use site comes from a keyed catalog             | A/B (`string nav.Plan`) and C (`words.nav.plan`) all key into a catalog              | **D** — the literal _is_ the source copy (`Button("New recipe")`), a `phrase` names copy that has holes or plural/measurement forms, and the words file holds translations only |
| The "kitchen needs an owner" rule is a cross-row `validate` | B, C, D — `validate at least one Memberships where Role is Owner "…"`                | **A** — a dedicated retention invariant in the access file, `keep one where Role is Owner string kitchen.LastOwner`                                                             |
| `design check … across all scenarios` exists                | A, C, D                                                                              | **B** — omits it entirely                                                                                                                                                       |
| An explicit restoration policy is declared                  | A, C, D                                                                              | **B** — no restoration declaration anywhere                                                                                                                                     |
| The app declares delete retention                           | A, C, D                                                                              | **B** — omits `Deletes`                                                                                                                                                         |
| Offline includes map tile closure                           | A, C, D                                                                              | **B** — no tile configuration                                                                                                                                                   |
| Fault injection exists in tests                             | A, C, D                                                                              | **B** — none                                                                                                                                                                    |
| Sidecar stubbing in tests                                   | A, C, D                                                                              | **B** — none                                                                                                                                                                    |
| Navigators and app variants are plain `let` bindings        | A, B (`let WelcomeNav = StackNav { … }`, `let SkilletOnDevice = Skillet with { … }`) | **C and D** both keywordize them — `nav WelcomeNav = …`, `app SkilletPreview = Skillet with { … }`                                                                              |

### A note on B

B's dissents are almost entirely omissions rather than alternatives. It is the same dialect as A
with roughly a third less surface: no `advise`, no `search` index, no touch-on-change, no restore
policy, no design check, no fault injection, no sidecar failure cases, no drag-and-drop across
containers, and a thinner test suite. Where B does state a position it nearly always matches A.
Treated as a vote, B is best read as _agreeing with A by default_, which means the A/B/D majority in
the table above is somewhat weaker than a 3-to-1 count suggests — it is closer to two independent
positions (A/B, and D) against C.
