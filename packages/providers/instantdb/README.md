# tao-instantdb

The InstantDB client behind `@tao/data/providers/instantdb`: `InstantDBProvider` stores each Tao row
as an InstantDB entity, each field as an attribute, and each relation as a link, using the
`@instantdb/react-native` SDK. `packages/apps/stdlib/@tao/data/providers/instantdb/InstantDB.ts`
stays the sibling of `InstantDB.tao` (a `provider … from ./X.ts` sidecar must live beside its
declaration) and re-exports this package, so the `@tao/...` import path a Tao app writes does not
change.

InstantDB is the authority. A save turns the difference from the runtime's previous snapshot into one
InstantDB transaction; the subscription projects the server's rows back into the runtime's snapshot.
Rows the app creates get InstantDB ids (UUIDs), and the connection remembers the Tao id it minted
them from for as long as it lives. An `Account` row's id is its InstantDB `$users` id.

## Layout

- `instantdb-src/instant-schema.ts` — `instantMapping`: the deterministic, reversible mapping from a
  compiled data schema (for a push, the compiler's `TaoDataSchema.json`) to InstantDB namespaces,
  attributes, and links, and the InstantDB schema JSON. It refuses what InstantDB cannot enforce,
  naming the Tao declaration.
- `instantdb-src/instant-rules.ts` — `instantRules`: permission rules from the mapping and the
  compiled data policy (`TaoDataPolicy.json`). Grant paths become CEL through `accounts.$user`;
  without a policy every namespace is public.
- `instantdb-src/instant-push.ts` — `pushInstantSchema`: plans, checks, and applies the schema over
  HTTP, then applies the rules, pushing only additive changes and reporting each endpoint and token.
- `instantdb-src/instant-rows.ts` — snapshot diffs to row operations, and query results back to
  snapshots.
- `instantdb-src/instant-clients.ts` — one shared SDK client per (AppId, ApiURI, WebsocketURI), leased
  by every datasource (and later the InstantDB auth provider) at that address.
- `instantdb-src/InstantDB.ts` — `InstantDBProvider`: connecting, loading, saving, and subscribing,
  and signing in with an InstantAuth session or a Clerk token exchanged through `ClerkClientName`.
- `instantdb-src/provider-configuration.ts` — the text-configuration readers every stdlib provider
  shares; mirrored here rather than imported, since this package cannot depend on `tao-stdlib`
  without a cycle (stdlib's sibling file re-exports this package). Keep the two in step.

Generated schema and rules are build output; never commit them.

## Live tests

The `instantdb-tests/*-live.test.ts` files run against the machine's local InstantDB, in an
ephemeral app per test, and skip unless `TAO_INSTANT_LIVE_API_URL` is set.
`auth-review-live.test.ts` pushes Auth Review's own source and runs a journey it writes for the
InstantAuth variant under
`tao test`, minting the email code through the admin API.

```sh
./agent unsandboxed local-instantdb start
TAO_INSTANT_LIVE_API_URL=http://localhost:9020 ./agent test-file packages/providers/instantdb/instantdb-tests/instantdb-live.test.ts
```
