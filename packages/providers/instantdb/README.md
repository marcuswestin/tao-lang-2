# tao-instantdb

The InstantDB client behind `@tao/data/providers/instantdb`: `InstantDBProvider` synchronizes a
datasource's full snapshot through one deterministic keyed row per storage key, using the
`@instantdb/react-native` SDK. `packages/apps/stdlib/@tao/data/providers/instantdb/InstantDB.ts`
stays the sibling of `InstantDB.tao` (a `provider … from ./X.ts` sidecar must live beside its
declaration) and re-exports this package, so the `@tao/...` import path a Tao app writes does not
change.

## Layout

- `instantdb-src/InstantDB.ts` — `InstantDBProvider`, connecting, loading, saving, and subscribing
  through the SDK's core, with one cached core per equivalent init config shared across connections.
- `instantdb-src/provider-configuration.ts` — the text-configuration readers every stdlib provider
  shares; mirrored here rather than imported, since this package cannot depend on `tao-stdlib`
  without a cycle (stdlib's sibling file re-exports this package). Keep the two in step.
