# Multiplayer sync in Tao apps — design exploration

Status: **exploration, dialogue open**. The body is a thousand-mile overview of live collaboration as a runtime capability: the sync architecture, the granular-write provider family, offline and conflict machinery on the decided policies, and presence. Dated "Direction settled" sections will record what dialogue with Ro settles as working direction for the first implementation slices. Nothing here is language law until it reaches `Tao Revolution/Decisions.md`, which wins wherever the two collide. The authority direction (`Decisions.md` §3–§4, restated in `Docs/Spec - Revolution/Authority and Sharing.md`) is decided upstream input throughout: the refusal contract, sharing semantics, and the household model are consumed here, never reopened.

> Implementation note (2026-09-05): the family's runtime machinery — change-sets, the fold, a
> snapshot bridge, the in-process authority, and the conformance suite — and a CloudKit provider
> over `CKSyncEngine` landed as a stab under stated working assumptions for open questions 1, 2,
> and 5. `Docs/Roadmap/Multiple datasources/Plan - Multiple datasources.md`'s "CloudKit" provider
> section records what was built and what those assumptions are; the dialogue below is unchanged
> by it.

## Framing

Live collaboration enters a Tao app in four ways, and they are in very different states of decidedness:

1. **Reading together.** Another cook renames Shakshuka and the name changes on my screen. The language surface is fully decided — `query` is live and provider-backed, views never poll or subscribe manually (§6) — and the snapshot provider family even ships a last-snapshot-wins version of it today. What is open is the machinery: entity-level sync instead of a whole-datasource snapshot, so two writers stop overwriting each other's unrelated edits.
2. **Writing together.** Two people edit the same row. The policy is decided — `Conflicts fieldwise latest` for ordinary writes, no dialogue owed (§11); composed edits opt out through a draft whose `save` answers `conflict` with a generated comparison (§7); `together A, B` fact-pairs never sync half (§2). Open: the merge machinery that makes those three sentences true and _deterministic_ — what "latest" measures, what the atomic unit on the wire is, how a draft detects that the row moved.
3. **Working apart.** The plane door closes. Decided: offline is never an error; the outcome vocabulary separates `queued` (durably accepted on this device) from `saved` (confirmed by the provider) (§5); the `Offline { }` block declares the full closure of what stays usable (§11); local-first — optimistic writes, durable queues, tombstones — is provider behaviour, never screen code. Open: the queue's semantics — replay order, rebasing under fieldwise-latest, and above all where a _late_ refusal lands when the calling site is gone (the revoked member's queued write).
4. **Being there.** `presence Viewers on Recipe` — `Viewers.Others` lists the other accounts with this row open now (§6). That one sentence is the entire ruling. Open: everything underneath — transport, visibility, identity, whether presence is a query-family declaration or something environment-shaped, and the separate question of the `Connection` value the demo apps already read (`if Connection is Offline`).

Out of scope here: authority itself (decided; §3–§4 lower to provider-enforced rules and this program consumes that lowering), collaborative _text_ (character-merged editing inside one field is a different machine — see Deferred ideas), and schema migrations (the option space belongs to `Docs/Roadmap/Tao ship/Plan - Beta distribution in one command.md`'s "Schema migration" section; this program only states what sync requires of it).

> **Every write in a Tao app flows through a typed, declared construct the compiler sees — so a Tao sync engine is never told "bytes changed, go diff": it is handed the change in units the language already made meaningful — a field, a `together` pair, a draft commit, a transaction.**

That is the through-line. Sync engines elsewhere spend their complexity recovering intent from state: diffing snapshots, guessing at units of atomicity, bolting merge annotations onto schemas after the fact. Tao's write surface is closed — `create` / `update` / `delete` / `toggle`, write-through fields, draft `save`, `transaction` bodies — and every one of them is schema-typed and store-checked. The exploration leans on decided principles throughout: deny-by-default authority enforced by the store with screens only asking (§3); honest multi-state values rather than booleans (`queued`/`saved`/`rejected`, availability cases); providers as swappable keywordized bindings under one contract (§11, §15); and the controllable test world — network offline and online, wait for sync, collaborators acting concurrently (§16).

The deeper claim, argued by the sketches below: because the compiler sees the schema _and_ the write constructs _and_ the policies (`Conflicts`, `Deletes`, `Offline`), the whole sync apparatus is **derivable**. The merge unit table falls out of field declarations and `together` groups. Tombstone rows, retention purges, and undo-restore fall out of `Deletes tombstones for 30 days`. The offline subscription closure falls out of `Offline { Keep Household where Me in Family of Household }` walked over the relation graph. Per-operation provider rules fall out of `access` blocks and cross-row validates (§2). None of it is screen code, and none of it is per-app engine code — which is exactly the local-first ruling ("provider behaviour, not screen code") taken seriously as a compiler obligation.

## The sync architecture

### The write ledger

Today the runtime already funnels every mutation through one commit path and then serializes the whole store (`TR-data-schema.ts`, `commit()`); the snapshot family's contract deliberately says "incremental change or sync protocols belong to a future provider family" (`TR-data.ts:98-112`). This program is that family. The architectural move: keep the single commit path, but make each commit emit a **typed change-set** alongside (eventually instead of) the whole snapshot:

```
ChangeSet
  id          — unique per commit on this replica
  origin      — replica identity (device/install), account
  stamp       — the commit's clock stamp (see Convergence)
  ops         — ordered typed operations:
                  create  (entity, row id, field values)
                  update  (entity, row id, field-group values)
                  delete  (entity, row id)            — a tombstone write, not an erasure
  atomic      — always: a change-set applies all-or-nothing at any store it reaches
```

The granularity is not "the field" uniformly — it is the **field-group**: a singleton field, or a `together` group, or a case-named boolean with its aliases. A `together CompletedBy, CompletedAt` is one value in every op, one merge unit, one thing that wins or loses whole. This is the first place the derivation claim bites: the merge-unit table is compiled from the entity declaration, not configured.

Atomic application is distinct from atomic survival. A transaction's change-set lands all-or-nothing wherever it arrives (the provider's atomic multi-write is what makes `create through StartKitchen` satisfy a cross-row validate in one commit, §2) — but once landed, its field-groups still merge fieldwise against _concurrent_ change-sets, which is the decided policy. Fieldwise latest is a statement about merging histories, not about tearing transactions.

### Convergence, and what "latest" measures

The model each replica runs:

- an **authoritative history** — the totally-ordered sequence of change-sets the authority has accepted; every replica that has seen the same prefix folds it to the same store state;
- a **pending queue** — this replica's durably persisted, not-yet-accepted change-sets, applied optimistically on top.

Store state is `fold(history) + fold(pending)`. Reconnect is: pull the missed history suffix, re-fold, replay pending on top (optimistic state is unchanged unless a merge or refusal says otherwise), push pending for acceptance. `queued → saved` is exactly a change-set moving from the pending queue into the authoritative history. Determinism of convergence then reduces to one question: **what orders the history, per field-group?**

Two candidate meanings of "latest":

- **Acceptance order** — the authority's sequence is the order. Simple, no clocks, but a Tuesday edit reconnecting on Thursday overwrites Wednesday's online edit: the _stalest_ write wins the reconnect race.
- **Edit order** — each change-set is stamped when the person committed it (a hybrid logical clock: wall time advanced past every stamp the replica has seen, replica id as tiebreak), and per field-group the greatest stamp wins regardless of arrival. "Latest" means when the person edited, not when their device reconnected. Deterministic (total order, no skew dependence beyond HLC's bounded correction), and it matches the sentence a person would say out loud.

This is Open question 1; the exploration leans edit-order. Either way the invariant the family must guarantee is the same: **replicas that have received the same set of change-sets hold identical stores, independent of arrival order** — per field-group, the winner is a pure function of the competing stamps. That invariant is what the conformance suite and the simulated world both check.

### What Tao derives, what providers own

The runtime/provider boundary keeps its existing shape — "the runtime owns schema validation, queries, identity, defaults, relationships, status, and notifications; providers own persistence and transport only" — extended one level down:

**The runtime (compiled from declarations):** the change-set ledger and its field-group units; the fold (fieldwise-latest merge, together atomicity, tombstone semantics, transaction application); the durable pending queue and its outcome transitions; the offline closure walk; draft base-stamps and conflict detection; presence subjects; the refusal surface (sentences, `rejected` outcomes, guard cases).

**The provider (per binding):** durable storage for history, queue, and offline closure; transport and its reconnection; the authoritative acceptance point — ordering, authority checks (the lowered `access` rules), refusals; presence transport; auth session.

This split is also the deterministic-simulation seam: a simulated provider implementing the same connection contract with an in-process authority and an injectable network (latency, partition, reorder, refusal) gives `network offline`, `wait for sync`, `collaborators acting concurrently`, and `datasource fails after create Membership "…"` one harness, not two.

## The granular-write provider family

A sketch of the contract, sitting beside today's snapshot family in `TR-data.ts` (shapes illustrative; names to be settled at implementation):

```ts
/** The granular family: typed change-sets in both directions, one authority. */
type TaoSyncConnection = {
  /** Load locally persisted state: history position, folded store, pending queue. */
  load(): Promise<TaoSyncCheckpoint | undefined>
  /** Durably queue a locally committed change-set (returns once it will survive relaunch). */
  queue(change: TaoChangeSet): Promise<void>
  /** Subscribe to authority events: acceptance of own change-sets (queued→saved),
   *  remote change-sets in authoritative order, and refusals carrying Case + Sentence. */
  subscribe(observer: TaoSyncObserver): () => void
  /** Declare the offline closure the connection must keep durable locally. */
  keep(closure: TaoOfflineClosure): void
  /** Join a presence subject; publish own presence; observe others'. */
  presence?(subject: TaoPresenceSubject, observer: TaoPresenceObserver): () => void
  close?(): void
}
```

Points of contract, mirroring the snapshot family's discipline:

- **Refusals speak `Case + Sentence`**, never bare errors — a remote authority rejection (a lowered `refuse when` or `validate`, an `access` denial) arrives in exactly the shape a local one has, which is what lets the calling site's `rejected ->` arm and a late datasource-level surface read the same value. Transport failures are not refusals; they are the queue staying queued.
- **The conformance suite is part of the family**, as `testProvider` is for snapshots: two connections to one authority; convergence under reorder and partition; queue durability across relaunch; refusal delivery for a queued write; tombstone retention. A provider is not "done" until it passes.
- **Providers may implement natively where the mapping is faithful** — but the semantics are Tao's, proven by conformance, not the provider's defaults taken on faith.

**The InstantDB mapping** (the shipped provider graduating from its whole-snapshot row): Tao entities project to Instant entities (schema provisioning derived from the Tao schema); a change-set becomes one `transact` (atomic multi-write); lowered access rules become Instant's per-operation CEL rules, which is precisely the lowering §2 already decided for cross-row validates. Two places Instant's native semantics fall short of the decided policies and need Tao-side machinery regardless of architecture: per-attribute LWW can tear a `together` pair across two concurrent transactions (each attribute picks its own winner), so together groups must travel as one attribute or merge Tao-side; and deletion is real deletion, so `Deletes tombstones for 30 days` compiles to a derived tombstone field, query filtering, undo-restore, and a retention purge rather than to Instant's delete.

## Offline

- **The queue is committed writes' residue, not a job system.** Screens never see it; its only surfaces are the outcome vocabulary (`queued` at the site, transitions observable to whatever the datasource-level policy names) and, perhaps, a derived "waiting to sync" count for an app that wants to show one (deferred).
- **The closure is compiled.** `Offline { Enabled Me.KeepOffline; Keep Household where Me in Family of Household }` (the demo apps' shape) is a set of root queries plus the relation walk that makes their rows renderable — owned children, to-one targets, the fields every screen of them reads. The compiler emits the closure; the connection's `keep` makes it durable. Note the demo shape gates offline on a preference and scopes it by an _audience_ — offline scope is already authority-shaped, for free.
- **Replay is rebase, not re-execution.** Pending change-sets rejoin the history under the same fold as everything else; fieldwise latest decides survival. Direct writes need no re-validation locally on reconnect — the authority re-checks them at acceptance, which is where the revoked member is caught. Queued _transactions_ are the sharp case: their `refuse when` guards were evaluated against the offline store, and the authority re-evaluates at acceptance — accepting that a queued transaction can be refused later is the price of offline transactions, paid in the same refusal shape.
- **The late refusal needs a declared home.** While the site lives, `rejected ->` catches everything, including a same-session reconnect refusal. When the site is gone — the revoked member's write refused three days later — the decided rules say outcomes belong to the calling site and there is no second net. The seam already agreed across programs: **sync-failure policy lives on the datasource declaration, not per-action**, and speaks `Case + Sentence`. The default worth having without any declaration: the refused change-set is unwound from the store (its optimistic effect reverts), and a system notice carries the refusal sentence — the person learns in the app's own voice ("Only a cook can invite someone.") rather than by silent disappearance. What a datasource-level `when sync { rejected -> … }` spelling adds beyond that default, and what it may bind (the refused values? the entity?), is Open question 3.

## Conflicts, on the decided policies

- **Fieldwise latest is the fold**, not a special path: per field-group, greatest stamp wins; no `conflict` case exists for ordinary writes anywhere in the app (§5) because the store leaves nothing to arbitrate.
- **Drafts detect divergence by base-stamp.** `draft Mine = Stop from Stop` records, per field-group, the stamp it forked from. At `save`, a field-group whose store stamp moved past the base is a genuine composed-edit conflict: `save` answers `conflict`, `Edit.Conflicted` holds, and the generated comparison (§7) shows mine/theirs field by field. Resolution re-saves with fresh bases. The same base-stamps power `RecipeConflict(Edit)` with no authored diff code.
- **Delete crosses fields.** A tombstone is a write to the row's _existence_, one more merge unit with a stamp. Concurrent update-vs-delete resolves by the same rule — but what the loser means is Open question 2: the lean is that a later delete wins over an earlier concurrent update, and updates landing on a live tombstone merge _into_ it, so an undo within retention restores the row with the concurrent edit intact rather than resurrecting a stale copy.
- **Undo rides the ledger.** The store already knows every inverse (§8); with a change-set ledger the inverses are literal — an undo emits a compensating change-set (restoring prior stamped values), which syncs like any write. One command, one undo step, collaborative-safe by construction: undoing my edit after yours landed reverts only the field-groups where mine still holds.

## Presence

- **Structurally, presence is a query-family declaration, not an environment value.** The §13 environment table is closed, device-resolved, and app-global (`Scheme`, `Motion`, `Platform`…); `presence Viewers on Recipe` is per-subject, account-valued, server-derived — it reads like `query`, lives beside queries in §6, and every demo call site binds it locally in a screen (`presence Others on Recipe`, `presence Planners on Trip`). The environment-shaped thing in this program is **`Connection`** — the demo apps already read `if Connection is Offline` in a shared `OfflineNotice()` view — a read-only reactive value (`Online / Offline`, possibly a syncing case) that does belong in the §13 table. Splitting these two is a decision to record.
- **Machinery**: a presence subject is (datasource, entity, row id). Entering a screen that declares presence joins the subject; leaving departs; the provider transports join/leave/heartbeat (Instant: rooms). `Viewers.Others` is a live list of _account_ handles — the same account on two devices is one entry, and self is excluded by account. Presence state is ephemeral by contract: never stored, never in the history, gone when the connection is.
- **Visibility inherits read authority** — proposed, currently unwritten anywhere: you appear present on a row only to accounts that can `read` that row, and you can only join subjects you can read. No presence declaration ever grows its own visibility clause; the access block already answers it. This keeps presence inside deny-by-default instead of beside it.
- Deliberately absent for now: cursors, per-field focus, typing indicators, ephemeral payloads on presence (see Deferred ideas). `Viewers.Others` is the whole surface, per the ruling.

## Testing, and the simulated world

Tier 1 is deterministic and in-process: the simulated provider — same connection contract, in-process authority, virtual network — under the world controls the decisions already name. The driving journeys read like the demo apps' checks:

```swift
check "two cooks converge" on phone with HomeKitchen {
   as Sam update Shakshuka { Title: "Shakshuka for six" }     // a collaborator acting concurrently
   expect text "Shakshuka for six"                            // live query, no poll

   network offline
   update Shakshuka { Servings: 6 }
   expect status "Offline — your changes are safe on this device"
   as Sam update Shakshuka { Title: "Weekend shakshuka" }     // meanwhile, online
   network online
   wait for sync current within 5 seconds
   expect text "Weekend shakshuka"                            // their field-group won its merge
   expect stored Shakshuka.Servings is 6                      // mine won mine — fieldwise, not last-writer
}
```

The revoked-member journey is the refusal contract end to end: `network offline`, the member queues a write, an owner deletes their membership, `network online`, `wait for sync`, and the assertion is the refusal sentence on screen plus `expect stored no …` — the same shape as the decided fault injection (`datasource fails after create Membership "…"`), which this family finally gives a home after the `data <status>` regression noted in `Coverage.md`. `wait for sync` gets its provider-addressed spelling here (§16 explicitly deferred it until one exists). Presence is testable the same way: `as Sam open Shakshuka` … `expect Viewers.Others contains Sam`. Tier 2 stays what it is everywhere in Tao: a thin live line against the real provider (the two-client InstantDB acceptance the provider's implementation notes already call for).

The seam with the deterministic-simulation program is deliberate: this program defines the connection contract and requires virtualizability; that program owns the virtual network's controls (latency, reorder, partition schedules). One harness.

## Platform and implementation plan

| Piece                                                       | Home                       | When                     |
| ----------------------------------------------------------- | -------------------------- | ------------------------ |
| Change-set ledger + field-group merge units                 | runtime (`TR-data`)        | first slice              |
| Deterministic fold: fieldwise latest, together, tombstones  | runtime                    | first slices             |
| Simulated sync provider + conformance suite                 | runtime test surface       | with the family          |
| Durable pending queue, offline closure                      | runtime + provider storage | after the fold           |
| InstantDB granular provider (entity-level, rules, presence) | `@tao/data` providers      | after conformance exists |
| `Connection` environment value; presence declaration        | language + runtime         | with their decisions     |
| Datasource-level sync policy spelling                       | language                   | after Open question 3    |

The compiler surface is deliberately thin at first: `Conflicts` / `Deletes` / `Offline` already parse in the demo dialect, drafts and transactions are decided constructs, and the early slices are runtime machinery under existing spellings. Language work concentrates in presence, `Connection`, and the sync-policy net.

## Driving use case: the household, live

Three scenes, one kitchen (`Apps/Tao Future/Skillet`), stating what each forces:

1. **Two cooks, one recipe.** Ro and Sam both have Shakshuka open — `presence Others on Recipe` shows each the other ("Two cooks in one kitchen is the ordinary case, not an edge case"). Sam retitles; Ro's screen updates live; Ro's servings edit and Sam's title edit interleave and both survive. Forces: entity-level sync, the fold, presence, live queries over remote change-sets.
2. **The plane.** Ro edits the plan offline — `queued`, the offline banner, the closure keeping the household renderable. On reconnect the pending queue rejoins history; Sam's meanwhile-edits and Ro's merge fieldwise; a `together`-paired completion fact lands whole or not at all. Forces: durable queue, closure compilation, rebase, `wait for sync`.
3. **The revoked member.** A former member queued a write before an owner removed their membership. On reconnect the authority refuses it under the lowered access rules; the change unwinds locally and the refusal sentence surfaces in the validate/refuse shape — the person is told, in copy the app authored, not ghosted. Forces: authority at the acceptance point, late-refusal policy, the refusal contract surviving the queue.

## Sequence (promptable slices)

1. **The change-set ledger** (the driver; needs no unsettled decisions). Emit typed change-sets with field-group units from the existing commit path, alongside the snapshot; an in-process harness folds two replicas' ledgers and asserts convergence under reorder. Pure runtime, no provider or grammar change, and every later slice consumes it — under either answer to Open question 1, the ledger's shape is the same (the stamp is opaque to it).
2. **The fold** — fieldwise latest per the settled "latest", together atomicity, tombstones with retention; the convergence invariant becomes a property-style test (random interleavings, equal stores).
3. **The family + simulated provider** — the connection contract, the in-process authority, the conformance suite; `network offline/online` and `wait for sync` become real world controls against it; the fault-injection journey regains coverage.
4. **Queue + closure + late refusal default** — durability across relaunch, the offline closure walk, unwind-and-notice on late refusal.
5. **InstantDB granular provider** — entity projection, rules lowering, presence transport; the Tier 2 two-client acceptance.
6. **Presence + `Connection` surfaces** — grammar, validator, runtime values, test spellings; behavior tests in Tao throughout, per tranche discipline.

## Deferred ideas (liked, not scheduled)

- **Collaborative text.** Character-level merge inside one `text` field (a shared shopping note edited simultaneously) is a per-field CRDT, opted into at the field — `Body text (merged)` or similar. The field-group architecture leaves the slot open: a merge unit whose fold is not LWW.
- **Presence payloads.** Cursors, field focus, "Sam is editing Ingredients" — ephemeral typed values on a presence subject. Attractive once presence exists; the subject machinery is the hard part and it ships first.
- **A visible queue.** A derived "3 changes waiting to sync" surface for apps that want one; the ledger makes it a query, not a feature.
- **Selective sync windows.** Beyond the offline closure: history depth, archived-row eviction, `MapTiles around … within 8 km`-style resource closures.
- **Cross-device undo.** Undo-as-compensating-change-set naturally extends to "undo from my other device"; wants product thought before machinery.
- **Server-side schema/rule provisioning as a ship step.** Deriving and pushing Instant schema + rules belongs with `Tao ship`'s deploy pipeline; this program only defines what must be provisioned.

## Open questions, gathered

1. **What does "latest" measure** — authority acceptance order, or edit-time hybrid-logical-clock order? Leaning edit-order: it matches the sentence a person would say, and stays deterministic.
2. **Update vs delete under concurrency** — does a later concurrent update revive a tombstoned row or merge into the tombstone awaiting undo? Leaning merge-into-tombstone with faithful restore.
3. **The datasource-level sync net** — what does a declared `when sync { … }` add over the unwind-and-notice default, and what does a `rejected` arm bind? (Cross-program seam: policy on the declaration, `Case + Sentence`.)
4. **Presence visibility inheriting read authority** — proposed above as a ruling; needs Ro's yes, and Authority's, since it binds the access block to a new consumer.
5. **Multi-writer `nextId`** — the snapshot family's sequential row ids collide across replicas; the granular family needs replica-scoped ids (provider tokens already being opaque makes this invisible to apps). Mechanical, but it touches restoration identity (§10).
6. **Queued transactions** — is late refusal the whole answer, or do some transactions (`JoinWithInvite`?) refuse to queue at all and demand liveness? Leaning: queueable by default, with the authority re-check as the safety.
7. **The §5 vocabulary tension** — `conflict` appears in the outcome vocabulary sentence (§5, "alongside rejection, conflict, and error") while §5 also rules no `conflict` case exists in the net; the demo apps use `conflict ->` arms on draft `save`. Reading: `conflict` is a draft-save outcome only, never a net case — worth recording explicitly.
8. **Demo spellings not in Decisions §8** — `runs latest per Item` and `runs queued` appear in Tao Future apps; they intersect this program (per-key write coalescing) but the concurrency vocabulary is §8's to extend, not sync's.
