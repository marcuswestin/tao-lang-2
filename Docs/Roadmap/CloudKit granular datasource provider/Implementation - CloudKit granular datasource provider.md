# CloudKit granular datasource provider

Status: implementation stab, reviewed once. The granular-write family's runtime machinery, its
conformance suite, and a CloudKit provider over `CKSyncEngine` are implemented and covered by
focused tests. Three working assumptions stand in for decisions the multiplayer exploration leaves
open, and no device has run the provider yet. Nothing here is language law;
`Docs/Roadmap/Multiplayer sync.md` owns the design dialogue and `Decisions.md` wins where they
collide.

## What landed, and where it sits in the sequence

`Docs/Roadmap/Multiplayer sync.md` sequences the family as: the change-set ledger, the fold, the
family contract with a simulated provider and conformance suite, the durable queue, and then the
InstantDB granular provider. This stab lands the first four as one contained runtime module and
adds CloudKit — Apple's own granular sync surface — as the first provider, ahead of InstantDB. It
does so without touching the store's commit path or any grammar: the ledger is derived at the
provider boundary by diffing the snapshots the store already saves, and the fold is projected back
into the snapshot the store already loads.

- **`packages/runtime/TaoRuntime-src/TR-data-sync.ts`** is the family. `TaoChangeSet` and
  `TaoSyncOp` are the wire shapes (row upserts carrying stamped field values, and stamped deletes);
  `TaoSyncProvider` / `TaoSyncConnection` / `TaoSyncObserver` are the provider contract (push,
  subscribe to remote change-sets and to acceptance of one's own, optional fetch, an `online`
  signal for transports that refuse pushes while offline, and a `remote` that resolves once the
  change-set is checkpointed so a transport can acknowledge delivery); `snapshotConnectionOverSync`
  is the bridge that mounts a granular provider behind today's snapshot contract;
  `createMemorySyncAuthority` is the in-process authority with a per-provider online switch;
  `testSyncProvider` is the conformance suite. `TR.Sync` publishes the bridge, the authority, the
  suite, and `stampAt`.
- **The bridge** keeps one durable checkpoint per store in the host's key-value storage, scoped by
  provider and container: replica identity, hybrid-logical-clock state, the fold (every row's
  stamped fields and tombstone), and the pending queue. `load` projects the fold; `save` diffs the
  saved snapshot against the rows the store is known to hold — its load, its saves, and the
  publishes it applied, never the fold itself, because a store mid-save buffers a publish and its
  next snapshot predates that remote change — stamps the difference as one change-set, persists
  first and applies only if the persist succeeded, hands back the fold if it holds anything the
  snapshot lacked, and pushes on a chain of its own so a slow transport never holds the fold. A
  remote change-set folds, persists, and republishes the projection only if it changed. Acceptance
  drops a change-set from the queue; a push the transport rejects leaves it queued until `online`;
  a transport failure reaches the store as the recoverable sync error.
- **`@tao/data/providers/cloudkit`** declares `type CloudKit is datasource with { StorageKey
  text?, Container text? }`. `CloudKitProvider` wraps `CloudKitSyncProvider` in the bridge with
  AsyncStorage as checkpoint storage; the sync provider maps each row to one record named
  `<origin>:<Entity>:<id>`. Every record is the one generic `TaoRow` type with a single JSON
  `payload` field holding the row's stamped fields (relations as row identities, booleans and
  times as JSON values) and, for a deleted row, a stamped tombstone rather than a CloudKit
  deletion, so a device that relaunches with an empty record cache cannot re-create a deleted row.
  One record type with one field means the CloudKit schema is deployed to production once and
  never follows a Tao `data` change — production forbids just-in-time schema and promoted fields
  can never be renamed or removed — and nothing is lost, since the fold evaluates queries locally
  and CloudKit indexes are unused. A change-set's records go out as one batch marked atomic by
  zone; a record refused with `batchRequestFailed` because a sibling conflicted is queued again
  behind the resolved conflict. It keeps an
  image of every record it has sent or fetched, so each send is a whole record and a server
  conflict merges fieldwise (server-newer fields land locally as a remote change, the merged record
  goes out again); a change-set counts as accepted only once every record it touched has been saved
  carrying that change-set's stamps, so a later change-set to the same row is never accepted by an
  earlier save. `unknownItem` on a save means the server has no such record (a zone reset or a
  purge) and the local image is re-created whole; a zone reset clears the images; an iCloud account
  change stops pushes until the app relaunches, so one account's queue is never written into
  another's database.
- **`TaoCloudKitModule.swift`** (in `tao-icloud-native`, beside the iCloud Documents module) is
  one `CKSyncEngine` per session over one record zone of the private database. Fetched changes are
  written to an inbox file before the delegate returns and stay there until JavaScript acknowledges
  them after checkpointing, so the engine's change token never advances past records the fold has
  not persisted, and a relaunch replays the inbox first. It persists the engine's state
  serialization under Application Support, caches the server's copy of each record it has seen so a
  later save carries the change tag (copying records so an in-flight batch never sees a later
  send's fields), reports fetched changes, saved records with their fields, `serverRecordChanged`
  conflicts with the server record, failed zone saves, and other failures by error-code name as
  `cloudKitEvent`s, drops pending changes that no longer have a record to send, gives up on a
  missing zone after three retries, and needs iOS 17 (a clear exception below that). `stop` mutes
  the session rather than dropping the engine under in-flight work.
- **Ship**: the manifest's `icloud` section names services as well as containers; the entitlement
  plugin grants `CloudKit` (and `CloudDocuments` for `ICloud`); `tao ship` detects a `CloudKit`
  binding exactly as it detects `ICloud`.

## Working assumptions (open questions in the exploration)

1. **"Latest" is edit order** on a hybrid logical clock: a stamp is wall milliseconds advanced past
   every stamp the replica has seen, a counter, and the origin as tie-break. (Open question 1;
   the exploration's own lean.)
2. **A delete stays a delete.** A tombstone is one more stamped unit; a later field edit merges into
   the tombstoned row without reviving it, so an eventual undo restores the row with the edit
   intact. (Open question 2; the exploration's lean.) The tombstone travels with the record, so
   every device and the server agree.
3. **Wire identity is (origin, local id).** A replica's store shows its own rows under their local
   ids and every other replica's under `<id>~<origin>`; relation values project the same way. This
   answers open question 5 for the bridge without touching the store's id generation, and the
   projected ids are stable for the row's life, so navigation restoration tokens keep working.
4. **A child is hidden until its parent arrives**, and until every schema field of the row has
   been folded, so a transport may deliver in any order and the projected snapshot always
   validates.

## Known limits

- **Push delivery is entitled but unproven.** The plugin grants `aps-environment` and the
  `remote-notification` background mode for a CloudKit binding, the session registers the app for
  remote notifications, and it fetches again whenever the app returns to the foreground; whether
  silent pushes reach the engine on a real device is part of the live acceptance.
- **Tombstones are never purged.** A deleted row's record stays in the zone with its tombstone;
  `Deletes tombstones for 30 days` in the design implies a retention purge that is not written.
- **Whole-record sends.** Every send carries the full record image; CloudKit accepts partial
  updates, but a whole record keeps the conflict path simple. Record size is bounded by CloudKit's
  1 MB field limit per record, which a Tao row will not approach.
- **After a relaunch the native record cache is empty**, so the first save of an existing record
  comes back as a conflict, merges, and resends. Correct, one extra round trip.
- **A zone reset loses what the server had accepted.** Local rows stay in the fold, but they are
  only re-created in the zone when edited again; the person is told through the sync error.
- **An account switch needs a relaunch**, and the previous account's checkpoint stays on the
  device: clearing it, and the engine state, on a switch is not written.
- **One account.** The private database only; `CKShare` and the shared database, which are the
  natural home for the household model, are not modelled. Neither are the authority rules of
  Decisions §3, which CloudKit cannot evaluate server-side.
- **A corrupt checkpoint blocks the mount** with the load error and its retry; the bridge grants
  no `reset`, since a checkpoint also holds the pending queue.
- **The store still saves whole snapshots** to the bridge; the ledger is derived by diffing. When
  the runtime grows a native ledger (the exploration's first slice as written), the diff goes away
  and the family contract, the fold, and the providers stay.
- **Not run on a device.** The Swift compiles (see DEVENV-053 for the build steps); the provider
  is proven only against the fake CloudKit zone in `packages/stdlib/stdlib-tests`, which stores
  numbers as the server does, versions records, answers conflicts with the server's copy, plays an
  offline session's queue against the server on reconnect, and counts acknowledgements — but has
  no real engine, no push, and no account.

## Validation

- `packages/runtime/TR-tests/TR-data-sync.test.ts`: the conformance suite over the memory
  authority (which now also proves both pending queues drain); concurrent edits to different fields
  both survive and a same-field race resolves by stamp under a real partition; offline change-sets
  survive a relaunch and push once online; a child delivered before its parent is hidden and then
  shown; a deleted row stays deleted under a later edit; a remote row a save predates is neither
  deleted nor lost; transport-minted stamps order below later local edits; an echo of the replica's
  own change-set republishes nothing.
- `packages/stdlib/stdlib-tests/data-providers.test.ts`: the CloudKit sync provider passes the
  conformance suite over the fake zone; records carry stamped fields, encoded booleans, relation
  identities, and a tombstone on delete; a server conflict merges fieldwise, both devices converge,
  and every fetched batch is acknowledged; configuration is validated before the native side loads.
- `packages/icloud-native/icloud-native-tests`: the zone boundary starts one session per zone,
  routes fetched, sent, zone-reset, account-change, and failure events by session, acknowledges a
  batch, classifies native rejections, and the plugin grants CloudKit without the Documents-only
  ubiquity container.

## Live acceptance still required

1. Two devices on one iCloud account with a CloudKit-entitled development build: create, update,
   delete, relaunch, and conflict scenarios against the real `CKSyncEngine`, including a kill
   between fetch and acknowledgement to prove the inbox replays.
2. Settle open questions 1, 2, and 5 with Ro and adjust the fold if the answers differ from the
   assumptions above; decide the tombstone retention and purge.
3. Decide whether CloudKit or InstantDB carries the household demos, which need sharing and
   server-side rules the private database cannot provide.
