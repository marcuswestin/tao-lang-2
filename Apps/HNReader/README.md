# HNReader

A read-only Hacker News reader, and the forcing app for the query-driven `Http` datasource
(`Docs/Roadmap/HTTP Datasource/`, specified in `Docs/Spec/Tao Data.md`).

```text
Apps/HNReader/
  HNReader.tao        entities, design, screens, and both app variants
  HNReader.test.tao   journeys, run against the stub variant
  HNAdapter.ts        the Algolia HN API adapter — every API-specific mapping
  StubAdapter.ts      a deterministic in-repo feed with the same declared shapes
  OpenStoryLink.ts    the React Native external-URL bridge used by the story command
```

## Scope

**Belongs here:** entities filled from a remote API through declared adapter query shapes; a
relation traversal (`Story.Comments`) filling on demand; upsert by an entity's `(unique)` field;
the query availability cases a remote read produces (`loading`, `empty`, `error`, and the advisory
`refreshing` / `stale`); `limit` on a query; a flattened comment tree rendered with depth rails;
journeys binding a stub adapter through an ordinary app variant; native-default `StackNav` reading
reactive screen `Title` and `Toolbar` slots; and the platform-neutral command that opens a story URL.

**Does not belong here:** writes through a remote datasource, authentication, pagination beyond
`limit`, provider or adapter diagnostics (those are package tests in `packages/runtime`), and
WordFlower product behavior.

## Running it

```sh
./tao test "Apps/HNReader"                              # journeys, no network
./tao dev "Apps/HNReader" --app HNReader                # the real Algolia feed
./tao dev "Apps/HNReader" --app HNReaderStub            # the canned feed
```

`HNReader` binds `HNSource` (the real adapter, `CacheFor 5.min`); `HNReaderStub` swaps in
`StubSource` and changes nothing else, which is what keeps journeys deterministic while still
exercising the real fill machinery. Both variants retain the bare `@tao/nav` import, so they prove
the native-default kit. The behavior-test host renders its deterministic basic fallback, and the URL
bridge suppresses the external application launch while tests run. Tao imports it
through the generic ascribed-action sidecar boundary (`let OpenUrl is action(text) = …`); no
URL-specific language or runtime primitive is introduced.

## Two things to know before extending it

- **`Rank` is the order the API returned, not news.ycombinator.com's ranking.** Algolia's
  `search?tags=front_page` returns the front-page _set_ ordered by points, so the rendered
  numbering approximates HN's rather than matching it. Exact parity needs Firebase's `topstories`
  for the ID order, which costs a request per story. What the field demonstrates either way is the
  rule it exists for: ordering the API owns and no stored field derives is materialized as data.
- **Feeds over one entity share its rows.** A second feed over `Stories` must materialize and
  filter on its own field, the way the front page uses `Rank number (default 0)` with
  `where Rank >= 1`. Without that, one feed renders rows another fetched.
