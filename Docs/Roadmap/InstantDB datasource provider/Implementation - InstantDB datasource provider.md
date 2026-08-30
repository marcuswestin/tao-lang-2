# InstantDB datasource provider

Status: semi-experimental implementation. The package and runtime boundary are implemented; live
two-client acceptance remains before this can be treated as the production sync model.

## Implemented boundary

- Datasource implementations are Tao packages: `@tao/data/providers/local`,
  `@tao/data/providers/memory`, and `@tao/data/providers/instantdb`. The runtime no longer owns or
  names concrete providers.
- A package provider connects with an evaluated configuration, the compiled Tao data schema, and a
  stable storage key. A connection loads and saves full serialized snapshots, may publish live
  snapshots, may opt into destructive reset recovery, and may release connection-owned resources.
- Runtime queries, entity handles, defaults, relationships, validation, and serialized write ordering
  remain provider-neutral.
- `StorageKey` defaults to the mounted Tao data schema name. Local requires an explicit key in its Tao
  contract; InstantDB makes it optional so app variants can normally configure only `AppId`.

## Experimental InstantDB adapter

The adapter stores one `taoSnapshots` entity per `AppId` and storage key. Its deterministic entity ID
does not require a unique attribute or an Instant schema-push step. Initial state resolves from the
first `subscribeQuery` result — so an offline launch serves the SDK's local cache — and the same
subscription then feeds live changes; writes use `transact`. `ApiURI` and `WebsocketURI` are optional
configuration for local Instant development.

The previous repository supplied the proven client operations and a test app ID:
`9faf89c0-c15c-49b4-bf3f-3b5b2cd9a19f`. Its local endpoints were
`http://localhost:9020` and `ws://localhost:9020/runtime/session`. No admin token or other secret is
copied into this repository. The previous provider-specific query and row-write engine is not ported:
this slice preserves the current Tao runtime's data semantics behind the new connection boundary.

Local development now uses InstantDB's published self-hosted images through a small adaptation of
its official `self-hosting/docker-compose.local.yml`. `just start-local-instantdb` starts and waits
for the stack, then idempotently provisions the stable WordFlower app; `just stop-local-instantdb`
stops it without deleting data. Compared with the previous repository, this removes the InstantDB
source checkout, pinned development-server build, custom Dockerfile, and dependency-cache volumes.

## Known limits

- Sync is a whole-datasource snapshot, not entity-level InstantDB storage. Concurrent writers are
  last-snapshot-wins and can overwrite unrelated edits. A local commit wins over subscription
  snapshots observed while its ordered save queue is pending, avoiding a transient remote/local
  flip-flop without pretending to provide conflict resolution.
- Authentication, permissions, presence, schema provisioning, migrations, conflict resolution, and
  offline reconciliation are not yet modeled by the Tao provider protocol.
- A remote provider load failure offers a safe retry. It cannot opt into the reset action used by
  Local and Memory, so a transient network or malformed remote snapshot cannot silently erase remote
  data.
- A subscription error preserves the last usable data and appears through query error state rather
  than replacing the app with the initial-load recovery overlay. A later valid snapshot recovers it.
- The SDK is initially pinned to the previous implementation's `@instantdb/react-native` 1.0.22 while
  the interface settles.
- Copied provider sidecars resolve native dependencies from the runtime host, so that host installs
  the InstantDB SDK and its React Native peers. Metro includes the SDK only when the compiled module
  graph reaches the InstantDB sidecar; a Tao file containing both Local and InstantDB app variants,
  such as WordFlower, keeps it reachable even when the Local variant is selected.

## Validation

Before the final provider-package refinements, `./agent verify` passed all 15 suites: 1,002 tests,
1,002 passed. Package-owned focused coverage now exercises Local and Memory conformance plus
InstantDB configuration, deterministic snapshot identity, reads, writes, live subscriptions, and
native-SDK lazy loading and reference-counted shutdown. Focused compiler coverage also compiles the
InstantDB import and copied sidecar, while runtime coverage applies live snapshots, releases outgoing
connections, preserves usable data through subscription errors, and keeps pending local saves stable.

A temporary Current configuration mounted `DeviceStore` from InstantDB with the previous local app
ID and endpoints. All four WordFlower Current Tao test files passed, and Current was then restored
byte-identical to Next. This proves provider package loading and app integration under the Tao test
harness; the harness deliberately substitutes an isolated test connection, so it is not evidence of
network-backed InstantDB behavior.

## Live acceptance still required

1. With `just start-local-instantdb` running, mount two app clients using the test app ID and
   confirm create, update, delete, restart hydration, and subscription propagation.
2. Decide whether the next InstantDB slice should keep snapshot sync or introduce an explicit
   entity/change protocol before calling the provider production-ready.
