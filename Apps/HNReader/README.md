# HNReader

A Hacker News reader, and the forcing app for the query-driven `Http` datasource
(`Docs/Roadmap/HTTP Datasource/`) and for binding more than one datasource to an app
(`Docs/Roadmap/Multiple datasources/`). Both are specified in `Docs/Spec/Tao Data.md`.

```text
Apps/HNReader/
  HNReader.tao        entities, design, screens, and both app variants
  HNReader.test.tao   journeys, run against the stub variant
  HNAdapter.ts        the Algolia HN API adapter — every API-specific mapping
  StubAdapter.ts      a deterministic in-repo feed with the same declared shapes
```

## Scope

**Belongs here:** a feed store beside an iCloud bookmark store and a device-local reading-history
store, each stating the collections it holds; an app binding all three and giving a named datasource
its own storage key with a patch where it is bound; a `reference` naming a story across either
boundary and reading as an entity handle with availability;
entities filled from a remote API through declared adapter query shapes; a
relation traversal (`Story.Comments`) filling on demand; upsert by an entity's `(unique)` field;
the query availability cases a remote read produces (`loading`, `empty`, `error`, and the advisory
`refreshing` / `stale`); `limit` on a query; a flattened comment tree rendered with depth rails;
journeys binding a stub adapter through an ordinary app variant; a `Display "toggle"` `SelectionNav`
over two native-default stacks, whose single bottom bar shows reactive scene `Title` and `Toolbar`
slots in place of any header; a Reading feed over locally persisted `ReadingEntry` rows, ordered by
`OpenedAt`; one history row per story, whose timestamp is refreshed on every open; honest
`loading`, `missing`, and `error` states when a history row's Story reference cannot currently
resolve; and the platform-neutral command that opens a story URL.

**Does not belong here:** writes through a remote datasource, authentication, pagination beyond
`limit`, provider or adapter diagnostics (those are package tests in `packages/runtime`), and
WordFlower product behavior.

## Running it

```sh
./tao test "Apps/HNReader"                              # journeys, no network
./tao dev "Apps/HNReader" --app HNReader                # the real Algolia feed
./tao dev "Apps/HNReader" --app HNReaderStub            # the canned feed
```

`HNReader` binds `HackerNews` (the real adapter, `CacheFor 5.min`), `Personal`, and
`ReadingHistory`; `HNReaderStub` swaps the feed for `StubNews` while keeping the same bookmark and
reading-history declarations. That keeps journeys deterministic while still exercising real fill,
cross-store reference, test-registry relaunch, ordering, and update machinery. The test compiler also
validates that both variants bind the Local-backed `ReadingHistory` datasource, but the behavior host
replaces provider persistence with its deterministic registry. Both variants retain the bare
`@tao/nav` import, so they prove the native-default kit. The behavior-test host renders its
deterministic basic fallback. Opening a story URL uses `OpenUrl` from `@tao/linking`; the runtime
skips the external launch while tests run.

## Things to know before extending it

- **`Rank` is the order the API returned, not news.ycombinator.com's ranking.** Algolia's
  `search?tags=front_page` returns the front-page _set_ ordered by points, so the rendered
  numbering approximates HN's rather than matching it. Exact parity needs Firebase's `topstories`
  for the ID order, which costs a request per story. What the field demonstrates either way is the
  rule it exists for: ordering the API owns and no stored field derives is materialized as data.
- **A bookmark resolves its story cold.** A bookmark synced from another device can name a story the
  front page never served, so both adapters declare a by-id shape and the reference asks for the row
  the first time it is read. The bookmark row renders `loading`, `missing`, and `error`, and
  `packages/runtime/TR-tests/TR-data-references.test.ts` proves each of them; no journey forces them,
  because nothing in the reader's own flow creates a bookmark to a story it has not shown.
- **Bookmarks live in CloudKit.** CloudKit is Apple-native, so off a device the bookmarks keep working
  from their local checkpoint and the missing native side shows as a sync error. Checks replace the
  store with an in-memory one.
- **Reading history is device-local.** `ReadingEntry.StoryHnId` is the unique reconciliation key,
  `ReadingEntry.Story` is the cross-store reference, and `OpenedAt` owns recency. Opening a story
  creates the row once and updates that same row thereafter. The HNReader journey proves that rows
  survive a relaunch of the deterministic behavior-test registry; it does not exercise device
  storage. `packages/stdlib/stdlib-tests/data-providers.test.ts` separately holds `Local` to the
  provider conformance contract, including save/load through an injected storage boundary. Real
  device persistence remains device validation, not a claim derived from the journey. A missing or
  failed feed lookup leaves its history row intact and renders that reference state explicitly.
- **Feeds over one entity share its rows.** A second feed over `Stories` must materialize and
  filter on its own field, the way the front page uses `Rank number (default 0)` with
  `where Rank >= 1`. Without that, one feed renders rows another fetched.
