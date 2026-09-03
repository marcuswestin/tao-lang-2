# Skillet — in Tao Revolution

A household kitchen. Plan the week's meals, cook them one step at a time with the recipe's own timers,
and shop a list that adds itself up. Everyone who cooks there sees the same thing on whatever they are
holding: tabs and a thumb-sized checkbox on a phone in the shop; one big step and a running timer on a
tablet propped against the counter; the week across a laptop on Sunday, with the library beside the
recipe and the command palette for anything.

There is one source. Nothing in it names a device. Files use `.tao-revolution`, so Tao's discovery
leaves them alone; the language they are written in is described in [`../README.md`](../README.md).

## Reading order

| File                          | What it holds                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `Skillet.tao-revolution`      | project, capabilities, navigation, the live root, links, variants                     |
| `Data.tao-revolution`         | the entities, their fields, and their invariants                                      |
| `Access.tao-revolution`       | audiences, per-verb access, and the two public projections                            |
| `Rules.tao-revolution`        | transactions, and the automations the provider owns                                   |
| `Shared.tao-revolution`       | the kitchen handles, `guard default`, frames, `Status`, `Measure`, `Confirm`, find    |
| `Household.tao-revolution`    | getting in, who cooks here, roles, invitations, preferences, leaving, deleting        |
| `Recipes.tao-revolution`      | the library, a recipe, its editor, sharing, the public recipe                         |
| `Import.tao-revolution`       | reading a recipe off a web page — the one thing Tao does not own                      |
| `Plan.tao-revolution`         | the week, meal commands, planning a meal                                              |
| `Shop.tao-revolution`         | the folded list, by aisle, with a map                                                 |
| `Cook.tao-revolution`         | cooking, with timers that outlive the window                                          |
| `Design.tao-revolution`       | sizes, tokens, meaning, dark, palette, bundles, styles, patterns, rules, environments |
| `Words.tao-revolution`        | Spanish — the copy itself lives where it is used                                      |
| `Scenarios.tao-revolution`    | the states this app is reviewed and audited in, and the design check                  |
| `Skillet.test.tao-revolution` | the journeys                                                                          |
| `FetchRecipe.ts`              | the typed sidecar                                                                     |
| `Justfile`                    | the developer loop                                                                    |

Read `Skillet.tao-revolution` first, then `Data` and `Access` together, then `Recipes`.

## What this app leans on hardest

- **A writable folded shopping row** — `group by … sum Amount`; one tick buys a week of eggs.
- **`(ordered)` with a readable `Position`** — "step 3 of 8", `Pages`, drag to reorder.
- **A live root** — `Navigator when MyKitchen`; starting, joining, and leaving are writes.
- **Timers as rows and an `automation`** — the alert outlives the window and reaches the cook.
- **`validate` on the data, `required` for completeness** — one sentence, every write path.
- **`command` mounted on the navigator** — primary+N from any tab; a text field keeps its own keys.
- **A projection behind a rotating capability** — the public recipe is a different type.
- **Literal copy** — every button reads as what it says; `Words` only translates.
