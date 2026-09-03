# Tao Revolution — Coverage

The capability → forcing-feature → test matrix. Enforces `Process.md` principle 2: a capability
exists only if a real feature forces it, and every decided capability names the app feature and Tao
test that prove it. A capability with an empty Forcing feature cell is either not yet mapped
(complete the row during Process step 3) or a red flag to resolve at MVP derivation (step 4).

Tier values: **MVP** (must run for v1), **Post-MVP** (Revolution; activated with the app
expansion), **TBD** (assigned at step 4). Test status is updated as tranches land.

| Capability (Decisions §)                                    | Forcing app · feature                                                   | Tier     | Test status              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- | -------- | ------------------------ |
| Types, typed slots, unit values (§2)                        | WordFlower · everywhere; units: focused-writing mode                    | MVP      | in Current               |
| Entities, relations, yes/no poles (§2)                      | WordFlower · workspaces, documents, paragraphs                          | MVP      | partially in Current     |
| validate / required / refuse (§2)                           | WordFlower · document and workspace rules                               | MVP      | partially in Current     |
| Preferences incl. device scope (§2)                         | WordFlower · editor preferences                                         | MVP      | pending                  |
| Deleted-row / redacted-account refs (§2)                    | —                                                                       | TBD      | —                        |
| Authority: access, audiences, through (§3)                  | — (WordFlower collaboration or app expansion)                           | TBD      | —                        |
| Holder-of-secret grants, invites (§3)                       | — (same scope question)                                                 | TBD      | —                        |
| Public boundary: publish, projections (§4)                  | — (same scope question)                                                 | TBD      | —                        |
| Transactions, for-caller, write verbs (§5)                  | WordFlower · document operations (single-user subset)                   | TBD      | —                        |
| Guard default, effect outcomes (§5)                         | WordFlower · document availability                                      | MVP      | partially in Current     |
| Queries, search, grouping (§6)                              | WordFlower · library search and lists                                   | MVP      | partially in Current     |
| Presence (§6)                                               | — (collaboration scope question)                                        | Post-MVP | —                        |
| Editing: write-through + drafts (§7)                        | WordFlower · title/body editing                                         | MVP      | partially in Current     |
| Draft conflict comparison (§7)                              | Wayfare · stop editing                                                  | Post-MVP | —                        |
| Commands as configured values (§8)                          | WordFlower · module-level Finish, workspace save toolbar                | MVP      | in Current[^9]           |
| Shortcut values and keyboard dispatch (§8)                  | WordFlower · pause focus command and document verbs                     | MVP      | in Current[^11]          |
| Interaction outline, derived row labels, `(title)` (§2, §9) | WordFlower · workspace, draft, and paragraph rows; HNReader · story row | MVP      | in Current[^10]          |
| Command ordering, hiding, and verb surface (§8)             | WordFlower · draft and finished document rows                           | MVP      | in Current[^11]          |
| Generated interaction surfaces and key allocation (§8, §13) | WordFlower · hints, overview, draft verbs, and command palette          | MVP      | in Current[^12]          |
| OS menu bar (§8)                                            | WordFlower · command menus                                              | Post-MVP | —                        |
| Assistant projection (§8)                                   | WordFlower · assistant block                                            | Post-MVP | —                        |
| Undo derivation (§8)                                        | WordFlower · document edits                                             | Post-MVP | —                        |
| Conditionals, ternary, check/guard (§8)                     | WordFlower · everywhere; ternary: focused-writing mode                  | MVP      | partially in Current[^2] |
| Ticking clock — @tao/time (§9)                              | **WordFlower · focused-writing mode** (X-minute free write)             | **MVP**  | in Current               |
| Unified view kind, inferred capabilities (§9)               | WordFlower · everywhere; stateful wrapper: settings details             | MVP      | in Current[^4]           |
| Scene, host-read chrome slots (§9–§10)                      | WordFlower · reactive workspace title + save; HNReader                  | MVP      | in Current[^5]           |
| Headerless scene, pushed plain view (§9–§10)                | Test Apps · Navigation MVP full-bleed and chromeless pushes             | MVP      | in Current               |
| Ephemeral non-serializable parameters (§9, §10)             | WordFlower · revert-save toast action                                   | MVP      | in Current               |
| Layout, render, clause lists (§9)                           | WordFlower · all screens                                                | MVP      | in Current               |
| Conditional styling incl. states (§9)                       | WordFlower · buttons and active focus bar                               | MVP      | in Current[^11]          |
| Grid over loop, cell min (§9)                               | Skillet · recipe cards                                                  | Post-MVP | —                        |
| Pages over loop (§9)                                        | Skillet · cook mode steps                                               | Post-MVP | —                        |
| Navigation: native/basic kits, links, split, windows (§10)  | WordFlower · native stack + deterministic harness                       | MVP      | partially in Current[^5] |
| Rendered nav, root view with arguments (§10)                | WordFlower · shell with persistent focus bar; Test Apps · Shell         | MVP      | in Current               |
| Device-local entities (§2, §11)                             | **WordFlower · focus session as data** (survives relaunch)              | **MVP**  | in Current               |
| Restoration policy (§10)                                    | WordFlower · relaunch                                                   | MVP      | in Current               |
| App composition, variants, providers (§11)                  | WordFlower · app root + test variants                                   | MVP      | partially in Current     |
| InstantDB datasource (§11)                                  | WordFlower · sync                                                       | MVP      | experimental             |
| auth library, Me binding (§11)                              | WordFlower · account                                                    | MVP      | pending                  |
| Files provider (§11)                                        | Wayfare · offline documents                                             | Post-MVP | —                        |
| Offline closure (§11)                                       | WordFlower · offline writing                                            | TBD      | —                        |
| Automations, notifications, levels (§12)                    | Skillet · timers, meal reminders                                        | Post-MVP | —                        |
| Design system: blocks, styles, screens (§13)                | WordFlower · SkilletDesign-equivalent                                   | MVP      | pending                  |
| Container conditions (§13)                                  | —                                                                       | Post-MVP | —                        |
| Copy, phrase, words, extraction (§14)                       | WordFlower · all copy + one locale                                      | MVP      | pending                  |
| Measurement phrases (§14)                                   | Skillet · metric/imperial amounts                                       | Post-MVP | —                        |
| TypeScript boundary: from, fails, progress (§15)            | WordFlower · build stamp; @tao/text; @tao/time                          | MVP      | partially in Current[^3] |
| Fixtures, tests, query assertions (§16)                     | WordFlower · behavior tests                                             | MVP      | partially in Current     |
| Fault injection (§16)                                       | WordFlower · sync failure journey                                       | MVP      | pending — regressed[^1]  |
| Scenarios, pseudolocale, review gallery (§16)               | WordFlower · scenario set                                               | TBD      | —                        |
| Occurrence queries (§17)                                    | Hearth · routines in Today/Week                                         | Post-MVP | —                        |
| Nearness, distance, places (§17)                            | Hearth · Around                                                         | Post-MVP | —                        |

Rows marked _partially in Current_ have behavior tests for part of the capability; _pending_ means
the capability is decided but not yet implemented or tested; _open_ names the tranche implementing
it (`Docs/Roadmap/Focused writing tranche/`).

[^2]: `if`, `when` in value and render position, the compact two-outcome `when`, and `guard` are in
    Current. `check` — §8's action-only early exit — is not: actions still stop on `guard X empty`.

[^3]: `<expression> from <path>` is in Current and is how both stdlib packages bind their runtimes.
    Declared failures (`fails`), `progress`, and the emitted bridge metadata module are not.

[^4]: The unified view tranche: one `view` kind with content acceptance, slots, and `responds`
    inferred from the declaration; the `Collapsible` stateful wrapper proves the deleted
    statelessness ladder, and its conditional `@@content` placement proves the at-most-once rule.
    The restoration tranche supplies the serialization boundary and diagnoses statically known
    non-serializable action parameters at each restorable presentation usage site (§10).

[^5]: The host-read/nav-kit tranche implements action intent titles, focused bound commands,
    `Toolbar`, reactive direct-only `Title`, native-default and explicit basic `StackNav`, and
    user-visible title/toolbar journey assertions. WordFlower's Tao journey proves Back uses the
    semantic reducer; browser Back/Forward adds no Tao construct and is covered by focused runtime
    and rendered host tests against that reducer. Broader menus, rails, palettes, SplitNav, window
    orchestration, and links/routes remain at their stated later boundary.

[^9]: The interaction system tranche makes a command a standalone configured value: `Title`,
    `Description`, and `Summary` move off `primitive action` onto `primitive command`, a command is
    declared at module level or in a view body, its slots are its parameters, and
    `do <command>(...)` invokes it with arguments bound exactly as an action's are. WordFlower's
    `Finish` is the module-level command with a `Document` slot; `Save` is the view-body command
    reading its scene's own state. Journeys prove the toolbar label, the reactive `Enabled`, and the
    write a `do Finish(Document)` performs. `shortcut` is carried and published but not dispatched:
    only the `primary` modifier is registered, and mention refinement, `Commands { ... }`, `hide`,
    entity command lists, and key dispatch remain at their stated later boundary.

[^10]: The interaction outline tranche derives every node from wiring — collections and items from
    `loop`, action and input controls from `Press`/`Submit` and `Value`+`Change`, regions from what
    a navigator presents — and names each row by one static ranking that prefers the `(title)`
    field. WordFlower's `expect label` journeys prove the ranked label on a workspace row, a draft
    row, and a paragraph row; HNReader's proves a selectable story row whose first text is an
    opaque interpolation. Attention, keyboard dispatch, narrowing, and the surfaces remain at their
    stated later boundary.

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
    defaults; hidden layers do not participate in accessibility traversal.

[^1]: The dialect migration tranche retired `data <status>` (Decisions §16) and with it the Data MVP
    check that drove a provider through `loading`, `error`, and `ready`. Nothing replaces it in this
    tranche, so provider-state coverage is lower than before until the world controls — network,
    sync, and datasource fault injection — land.
