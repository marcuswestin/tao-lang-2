# Wayfare — in Tao Revolution

A collaborative trip planner. A few people shape days and stops together on a laptop, carry the same live
plan on a phone, and keep working when the network disappears. Notes and reservations stay private; the
itinerary can be shared as exactly what the projection says.

Files use `.tao-revolution`, so Tao's discovery leaves them alone; the language they are written in is
described in [`../README.md`](../README.md).

## Reading order

| File                          | What it holds                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `Wayfare.tao-revolution`      | project, capabilities, the three-pane workspace, links, the app, settings        |
| `Data.tao-revolution`         | trips, days, stops, seats, documents, and their invariants                       |
| `Access.tao-revolution`       | audiences, per-verb access, the private-document rule, two projections           |
| `Rules.tao-revolution`        | transactions, and the stop reminder the provider owns                            |
| `Shared.tao-revolution`       | the open trip, `guard default`, frames, the stop card, sign-in, the one question |
| `Trips.tao-revolution`        | the library, a new trip, the overview, travelers, invitations, joining, sharing  |
| `Itinerary.tao-revolution`    | one day, the stop editor as a draft, the conflict conversation, Today            |
| `Documents.tao-revolution`    | travel documents, some private to one traveler                                   |
| `Design.tao-revolution`       | sizes, tokens, meaning, dark, the stop-kind palette, bundles, styles, patterns   |
| `Words.tao-revolution`        | Spanish                                                                          |
| `Scenarios.tao-revolution`    | the states this app is reviewed and audited in, and the design check             |
| `Wayfare.test.tao-revolution` | the journeys                                                                     |
| `Justfile`                    | the developer loop                                                               |

## What this app leans on hardest

- **A three-pane `SplitNav`** with one authored `Compact` progression: `@trip -> @day -> @details`.
- **A draft from a live row** — `draft Mine = Stop from Stop`, `save` answering `conflict`, `ConflictComparison(Mine)`, a durable draft with no discard dialogue.
- **The two never overlap** — a day's title and a visited mark write through under `Conflicts fieldwise latest`; the composed stop edit goes through the draft.
- **A seat and an invitation are one row** — `Member` starts invited and becomes a person on join; the owner invariant covers both.
- **A conditional grant** — `read to TripFolk of Trip where PrivateTo is none; read, change, delete to PrivateTo`.
- **`today in Trip.HomeZone`** — Today shows the day you are standing in.
- **`Offline { … MapTiles around Trip.Days.Stops.Place within 8 km }`** — the map works where the network does not.
- **A nested projection** — `Days { Date, Title, Stops { … } }`.
