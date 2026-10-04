# Hearth — in Tao Revolution

A calm, private place for the people who share a home to remember what matters: chores, shopping,
small plans, errands, and who is taking care of what. One person captures a chore from the hallway,
another finishes it from the sofa; the week is seven columns on a laptop and one on a phone; the errands
sit on a map in the order you would walk them, and in a list that says the same thing.

Files use `.tao-revolution`, so Tao's discovery leaves them alone; the language they are written in is
described in [`../README.md`](../README.md).

## Reading order

| File                         | What it holds                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `Hearth.tao-revolution`      | project, capabilities, navigation, the live root, links, variants, app read net         |
| `Data.tao-revolution`        | the entities, their fields, and their invariants                                        |
| `Access.tao-revolution`      | audiences, per-verb access, the shared-list and invitation projections                  |
| `Rules.tao-revolution`       | transactions, and the reminder automation the provider owns                             |
| `Shared.tao-revolution`      | the home handles, frames, the item row, capture, find                                   |
| `Home.tao-revolution`        | getting in, choosing a home, Today, who lives here, settings                            |
| `Lists.tao-revolution`       | lists, the shopping fold, one item (write-through, comments, photos, a window), sharing |
| `Week.tao-revolution`        | the week grid, dragging plans between days                                              |
| `Around.tao-revolution`      | errands near you, on a map and in a list                                                |
| `Design.tao-revolution`      | colors, sizes, shadows, text, screens, styles, and the rules that check them            |
| `Words.tao-revolution`       | Spanish                                                                                 |
| `Scenarios.tao-revolution`   | the states this app is reviewed, screenshotted, and audited in                          |
| `Hearth.test.tao-revolution` | the journeys                                                                            |
| `Justfile`                   | the developer loop                                                                      |

## What this app leans on hardest

- **A preference as the root** — `Me.CurrentHome`; a person with two homes switches by a write.
- **A draft for capture, write-through for the item** — the one rule about where inputs bind, both halves.
- **`SetDone` with `runs latest per Item`** — a quick tick-untick settles on the last state.
- **A grid over generated days with drops between them** — `Grid [columns 1 when narrow, 7 when wide] { loop WeekOf(WeekStart) / Day { … } }`, a container that `Accepts: HearthItem` and answers `on drop`.
- **`order by distance from Here`** and a `Map` over the same rows as the list beside it.
- **A shopping fold** — `group by Title, Unit` with `Quantity = sum(Quantity)`; one tick, every source row.
- **A projection with a filtered relation** — `Items where is Open { … Place { Name, Coordinate } }`.
- **A reminder to the assignee, otherwise the adults** — `to HearthItem.Assignee otherwise Stewards of HearthItem.HearthList.Home`.
