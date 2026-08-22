# Tao Revolution — Coverage

The capability → forcing-feature → test matrix. Enforces `Process.md` principle 2: a capability
exists only if a real feature forces it, and every decided capability names the app feature and Tao
test that prove it. A capability with an empty Forcing feature cell is either not yet mapped
(complete the row during Process step 3) or a red flag to resolve at MVP derivation (step 4).

Tier values: **MVP** (must run for v1), **Post-MVP** (Revolution; activated with the app
expansion), **TBD** (assigned at step 4). Test status is updated as tranches land.

| Capability (Decisions §)                         | Forcing app · feature                                       | Tier     | Test status              |
| ------------------------------------------------ | ----------------------------------------------------------- | -------- | ------------------------ |
| Types, typed slots, unit values (§2)             | WordFlower · everywhere; units: focused-writing mode        | MVP      | in Current               |
| Entities, relations, yes/no poles (§2)           | WordFlower · workspaces, documents, paragraphs              | MVP      | partially in Current     |
| validate / required / refuse (§2)                | WordFlower · document and workspace rules                   | MVP      | partially in Current     |
| Preferences incl. device scope (§2)              | WordFlower · editor preferences                             | MVP      | pending                  |
| Deleted-row / redacted-account refs (§2)         | —                                                           | TBD      | —                        |
| Authority: access, audiences, through (§3)       | — (WordFlower collaboration or app expansion)               | TBD      | —                        |
| Holder-of-secret grants, invites (§3)            | — (same scope question)                                     | TBD      | —                        |
| Public boundary: publish, projections (§4)       | — (same scope question)                                     | TBD      | —                        |
| Transactions, for-caller, write verbs (§5)       | WordFlower · document operations (single-user subset)       | TBD      | —                        |
| Guard default, effect outcomes (§5)              | WordFlower · document availability                          | MVP      | partially in Current     |
| Queries, search, grouping (§6)                   | WordFlower · library search and lists                       | MVP      | partially in Current     |
| Presence (§6)                                    | — (collaboration scope question)                            | Post-MVP | —                        |
| Editing: write-through + drafts (§7)             | WordFlower · title/body editing                             | MVP      | partially in Current     |
| Draft conflict comparison (§7)                   | Wayfare · stop editing                                      | Post-MVP | —                        |
| Intents, commands, surfaces (§8)                 | WordFlower · editor commands, palette                       | MVP      | pending                  |
| Assistant projection (§8)                        | WordFlower · assistant block                                | Post-MVP | —                        |
| Undo derivation (§8)                             | WordFlower · document edits                                 | Post-MVP | —                        |
| Conditionals, ternary, check/guard (§8)          | WordFlower · everywhere; ternary: focused-writing mode      | MVP      | partially in Current[^2] |
| Ticking clock — @tao/time (§9)                   | **WordFlower · focused-writing mode** (X-minute free write) | **MVP**  | in Current               |
| Layout, render, clause lists (§9)                | WordFlower · all screens                                    | MVP      | in Current               |
| Conditional styling incl. states (§9)            | WordFlower · editor chrome                                  | MVP      | pending                  |
| Grid over loop, cell min (§9)                    | Skillet · recipe cards                                      | Post-MVP | —                        |
| Pages over loop (§9)                             | Skillet · cook mode steps                                   | Post-MVP | —                        |
| Navigation: links, split, windows (§10)          | WordFlower · workspace/document navigation                  | MVP      | partially in Current     |
| Restoration policy (§10)                         | WordFlower · relaunch                                       | MVP      | pending                  |
| App composition, variants, providers (§11)       | WordFlower · app root + test variants                       | MVP      | partially in Current     |
| InstantDB datasource (§11)                       | WordFlower · sync                                           | MVP      | pending                  |
| auth library, Me binding (§11)                   | WordFlower · account                                        | MVP      | pending                  |
| Files provider (§11)                             | Wayfare · offline documents                                 | Post-MVP | —                        |
| Offline closure (§11)                            | WordFlower · offline writing                                | TBD      | —                        |
| Automations, notifications, levels (§12)         | Skillet · timers, meal reminders                            | Post-MVP | —                        |
| Design system: blocks, styles, screens (§13)     | WordFlower · SkilletDesign-equivalent                       | MVP      | pending                  |
| Container conditions (§13)                       | —                                                           | Post-MVP | —                        |
| Copy, phrase, words, extraction (§14)            | WordFlower · all copy + one locale                          | MVP      | pending                  |
| Measurement phrases (§14)                        | Skillet · metric/imperial amounts                           | Post-MVP | —                        |
| TypeScript boundary: from, fails, progress (§15) | WordFlower · build stamp; @tao/text; @tao/time              | MVP      | partially in Current[^3] |
| Fixtures, tests, query assertions (§16)          | WordFlower · behavior tests                                 | MVP      | partially in Current     |
| Fault injection (§16)                            | WordFlower · sync failure journey                           | MVP      | pending — regressed[^1]  |
| Scenarios, pseudolocale, review gallery (§16)    | WordFlower · scenario set                                   | TBD      | —                        |
| Occurrence queries (§17)                         | Hearth · routines in Today/Week                             | Post-MVP | —                        |
| Nearness, distance, places (§17)                 | Hearth · Around                                             | Post-MVP | —                        |

Rows marked _partially in Current_ have behavior tests for part of the capability; _pending_ means
the capability is decided but not yet implemented or tested; _open_ names the tranche implementing
it (`Roadmap/Focused writing tranche/`).

[^2]: `if`, `when` in value and render position, the compact two-outcome `when`, and `guard` are in
    Current. `check` — §8's action-only early exit — is not: actions still stop on `guard X empty`.

[^3]: `<expression> from <path>` is in Current and is how both stdlib packages bind their runtimes.
    Declared failures (`fails`), `progress`, and the emitted bridge metadata module are not.

[^1]: The dialect migration tranche retired `data <status>` (Decisions §16) and with it the Data MVP
    check that drove a provider through `loading`, `error`, and `ready`. Nothing replaces it in this
    tranche, so provider-state coverage is lower than before until the world controls — network,
    sync, and datasource fault injection — land.
