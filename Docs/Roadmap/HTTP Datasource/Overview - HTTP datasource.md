# Overview - HTTP datasource

Working draft. The protocol shape, availability cases, adapter contract, and relation handling below
were settled with Ro in conversation while designing the HNReader app; spellings marked _proposed_
are still mine to lose. HNReader (`Apps/HNReader`) is the forcing app.

## The premise (settled)

Remote read-only feeds enter Tao through the datasource seam, not through imperative fetch actions.
Entities are declared with `data` as usual; a datasource translates live queries into HTTP requests.
This keeps the decided reads story intact — "`query` is live and provider-backed; views never poll
or subscribe manually" (Decisions §6) — and it removes the need for a screen-lifecycle fetch hook,
call-site fetch outcome handling, and a bulk import verb: a query subscribing on mount is the fetch
trigger, provider failures surface through the availability cases, and upsert-by-key is provider
machinery keyed by the entity's `(unique)` field.

The imperative half of Decisions §15 (async sidecar actions, `fails`, `when do`) is still real and
still needed someday — Skillet's `FetchRecipe(Link)` is inherently one-shot — but a feed reader is
query-shaped and must not force it.

## The protocol: descriptor-driven fill, local evaluation (settled)

The provider does not own query results. It is _notified that a query descriptor became active_
(entity, filters, order, limit), fetches, and upserts rows into the store; the store keeps
evaluating every query locally over its rows, exactly as it does for `Local` and `Memory`.

- **Fetch-on-demand, superset-fill, local evaluation.** A filter the API cannot express means the
  provider fetches a superset and the query block still filters locally.
- **Upsert by `(unique)`.** A fill addresses rows by the entity's unique field (`HnId`), so a
  refetch updates rather than duplicates. Relation fields in fills are addressed by the target
  entity's unique field value (`Story: { HnId: … }`), resolved to the store row by the provider.
- **API-side ordering is materialized as a row field.** HN's front-page rank is not derivable from
  any field, so the adapter writes `Rank: index` and the query says `order by Rank`. Ordering
  becomes visible, typed data instead of an invisible API side effect.
- Rejected alternative: the provider returning per-query result sets (each query an island; rows
  unshared; the Tao query block reduced to advisory text). TanStack Query's document cache is that
  model, and TanStack built TanStack DB — normalized collections, locally evaluated live queries,
  fetches relegated to collection fillers — to correct it. Their correction is this design.

## Availability: cache-first, per-query (settled)

Fill lifecycle is tracked per descriptor, and the case vocabulary grows two advisory members:

| Case         | Meaning                                                  |
| ------------ | -------------------------------------------------------- |
| `loading`    | first fill in flight, nothing to show yet                |
| `refreshing` | rows are present and renderable; a fill runs behind them |
| `stale`      | rows are present; the latest fill failed                 |
| `error`      | fill failed and there is nothing to show                 |

- **`refreshing` and `stale` are advisory**: a guard that does not name them falls through and
  renders content, and they never route to the app-wide `guard default` net (Decisions §5) — only
  nothing-to-show cases do. Otherwise every screen would blank its cached rows during refresh.
- A case is also a predicate, so the inline form reads beside content:
  `if FrontPage is refreshing { Spinner() }`.
- Offline stays a non-error: a failed refresh over cached rows is `stale`, never `error`.

```tao
query FrontPage from Stories { order by Rank  limit 30 }

guard FrontPage {
   loading -> { Spinner() }
   error -> Message { Text(Message) }
}
render Col() [screen] {
   if FrontPage is refreshing { Spinner() }
   loop FrontPage / Story { StoryRow(Story) }
}
```

## The adapter: declared shapes, loud failures (settled)

An adapter is a list of declared query shapes per entity. A live query matching no declared shape is
a development-time diagnostic at subscription — never a silent non-fetch. The declarations double as
documentation of the API's real capability surface, which for most REST APIs is an enumerable set of
shapes, not a query language. (TanStack Query reaches the same bet by construction: every fetchable
thing is an enumerated query key.)

```ts
// HNAdapter.ts — as landed: entries key by the singular entity name, and a stated `orderBy` or
// `orderDirection` must match the descriptor exactly.
export const HNAdapter = TR.Http.adapter({
  Story: [
    TR.Http.on({ orderBy: 'Rank' }, async (query, { upsert }) => {
      upsert(toStories(await fetchJson(`${API}/search?tags=front_page&hitsPerPage=${query.limit}`)))
    }),
  ],
  Comment: [
    TR.Http.on({ where: 'Story' }, async (query, { upsert }) => {
      upsert(flattenComments(await fetchJson(`${API}/items/${query.where.Story.HnId}`)))
    }),
  ],
})
```

## Relations (settled)

A relation traversal (`query Thread from Story.Comments`) reaches the adapter as an ordinary
filtered descriptor — entity `Comments`, where `Story` is this row — which is what the compiler
already lowers traversals to. One descriptor vocabulary, one matching mechanism; the handler
receives the parent row as a plain snapshot (`where.Story.HnId`). A row-by-unique-key shape covers
deep links whose entity parameter is not yet cached.

## The stdlib/app split (settled in direction; spellings proposed)

`@tao/data` publishes an `Http` datasource type; an app derives from it and supplies the adapter:

```tao
type HNSource is Http with {
   Adapter item is HNAdapter from ./HNAdapter.ts
   CacheFor duration is 5.min
}
```

The stdlib piece is deliberately a thin, honest machine — per-descriptor in-flight dedup, staleness
against the Tao clock (`CacheFor`), upsert-by-unique, fill-state tracking, error mapping to the
cases above. All API-specific truth lives in the app's adapter. The generic "translate any query to
HTTP" datasource is explicitly not the goal.

## TanStack (researched; decided)

Use their model, not their code, for v1. TanStack Query's two-axis state maps exactly onto the four
cases above (`pending`/`fetching` = loading, `success`+`fetching` = refreshing, kept-data-plus-error
= stale), which is strong independent validation. Not depending on it, for now: the deterministic
test clock (Tao holds and `advance`s time; TanStack runs on real timers with no injection seam),
spec ownership (`CacheFor` and the cases are language semantics, not "whatever the installed
version does"), and the v1 subset being small. The provider's internal seam mirrors query-core's
shapes so adopting it later — when retry/backoff/gc/reconnect are wanted — is cheap.

## Testing (settled in direction)

Journeys bind a deterministic datasource through the decided app-variant mechanism rather than
stubbing the network: either `Datasource Memory` with seeded rows, or an `Http`-typed datasource
whose adapter is a canned in-repo stub — the latter exercises the real fill machinery (loading →
ready → refreshing) with no network. The real adapter's descriptor-to-URL mapping gets ordinary
TypeScript unit tests.

## Status

Landed, with `Docs/Spec/Tao Data.md` as the implemented contract:

1. Language core: the `limit` query clause; `(unique)` threaded from grammar to the runtime
   definition; `refreshing` / `stale` as builtin subject cases (grammar, validator, compiler,
   runtime match); a `from`-bridge may be typed in place by its configuration slot
   (`Adapter item is HNAdapter from ./HNAdapter.ts`).
2. Runtime fill machinery: the fill-capable provider protocol (`fill` beside `load`/`persist`),
   per-descriptor state on the schema, upsert-by-unique with relation resolution, per-query
   availability, staleness and dedup on the runtime clock, and `settle` covering fills.
3. Stdlib `Http` datasource; `TR.Http.adapter` / `TR.Http.on`; `withConfiguration` plumbing
   carrying `Adapter` and `CacheFor` from the configured value to the bound provider.
4. `Apps/HNReader`: entities, the Algolia adapter, screens, and journeys running the stub-adapter
   variant through the real fill machinery. The test harness settles data between steps.

## Deferred, deliberately

- Snapshot persistence for an offline cache across launches (the Http provider's base store is
  in-memory; cache-first behavior holds within a session).
- Writes through a remote datasource (HN is read-only; the source rejects writes).
- Per-entity datasource scoping (an app still binds one datasource; local favorites beside remote
  stories waits for it).
- Pull-to-refresh and any user-triggered re-fetch spelling.
- Cache eviction (keep-all) and retry/backoff (where TanStack query-core becomes interesting).
- Entity-handle-level `refreshing`/`stale` (queries only for now).
- Per-feed row provenance in the store. Filled rows land in the entity's shared row set, so
  distinct feeds over one entity own their queryable facts instead: each feed materializes its own
  field (defaulted for rows other feeds fetch) and filters on it — `Rank number (default 0)` with
  `where Rank >= 1`.

The decisions above are recorded in `Decisions.md` §6 under "Amended by the HTTP datasource work".

## Known consequences of the deferrals

Worth stating plainly, because each is visible in the shipped app rather than merely theoretical:

- **The refresh states are not reachable from HNReader today.** A descriptor is offered on query
  mount and on descriptor change only; there is no focus, foreground, or interval re-offer, and
  `FrontPage` is the stack root, so it fills once per launch. `refreshing` and `stale` are real,
  tested at the schema level, and correct the moment a refresh spelling lands — but no journey
  through the app can display their banners now.
- **Rows are never evicted.** A story that falls off the front page keeps its old `Rank`, so a
  refill interleaves it with new rows under duplicate ranks. Eviction is deferred above; this is
  what deferring it looks like on screen.
- **An adapter's own unit tests have no home.** `Apps/` TypeScript sits outside every tsconfig and
  outside the package test suites, so `HNAdapter.ts` is neither typechecked by `./agent check` nor
  unit-testable where it lives. Its behavior is covered only indirectly, through the stub adapter's
  journeys. Giving app sidecars a test and typecheck home is its own piece of work.
