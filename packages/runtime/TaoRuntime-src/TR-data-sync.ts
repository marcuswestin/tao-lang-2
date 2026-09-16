import { RuntimeAssert } from './TR-assert'
import type {
  TaoDataConnection,
  TaoDataConnectionObserver,
  TaoDataProviderContext,
  TaoDataSchemaDefinition,
  TaoKeyValueStorage,
} from './TR-data'
import { emptyData, envelope, parseEnvelope, type StoredData, type StoredRow } from './TR-data-persistence'
import { memoryKeyValueStorage } from './TR-data-provider'
import { HostEnvironmentError, UserInputError, warnContainedFailure } from './TR-errors'

/**
 * The granular-write family: typed change-sets in both directions, one authority per store.
 *
 * Where the snapshot family exchanges whole stores, this family exchanges what changed: each
 * commit becomes one change-set of row upserts and deletes, every field value carries the stamp
 * of the edit that set it, and replicas converge by folding change-sets — per field the greatest
 * stamp wins, whatever order the change-sets arrive in. The runtime owns the fold, the durable
 * pending queue, and the projection of the folded state into the snapshot the store mounts; a
 * provider owns transport and the authority's acceptance. `snapshotConnectionOverSync` is the
 * bridge that lets a granular provider satisfy today's snapshot mount, so the store, queries, and
 * writes need no change while the family grows.
 *
 * Working assumptions the multiplayer exploration leaves open, taken here so the machinery can be
 * exercised and revisited once decided: "latest" is edit order on a hybrid logical clock (wall
 * time advanced past every stamp seen, replica identity as tie-break); a deleted row stays deleted
 * while later field edits merge into its tombstone; and row identity on the wire is the pair
 * (origin replica, local id), projected into a replica's store as the local id for its own rows
 * and `<id>~<origin>` for every other replica's, so sequential local ids never collide.
 */

/** TaoSyncRowId identifies a row across replicas: the replica that created it and its local id. */
export type TaoSyncRowId = Readonly<{ id: string; origin: string }>

/** TaoSyncStamp orders edits: a fixed-width hybrid logical clock reading followed by the origin. */
export type TaoSyncStamp = string

/** TaoSyncValue is one field value on the wire; a relation travels as the related row's identity. */
export type TaoSyncValue = boolean | null | number | string | TaoSyncRowId

export type TaoSyncStampedValue = Readonly<{ stamp: TaoSyncStamp; value: TaoSyncValue }>

/** TaoSyncOp is one row-level operation; an upsert carries only the field groups the edit set. */
export type TaoSyncOp =
  | Readonly<{
    entity: string
    fields: Readonly<Record<string, TaoSyncStampedValue>>
    kind: 'upsert'
    row: TaoSyncRowId
  }>
  | Readonly<{ entity: string; kind: 'delete'; row: TaoSyncRowId; stamp: TaoSyncStamp }>

/** TaoChangeSet is one commit as it travels: atomic wherever it lands, identified by its stamp. */
export type TaoChangeSet = Readonly<{
  id: string
  ops: readonly TaoSyncOp[]
  origin: string
  stamp: TaoSyncStamp
}>

/** TaoSyncObserver receives the authority's events for one connection. */
export type TaoSyncObserver = Readonly<{
  /** accepted reports that the authority durably holds this replica's change-set: queued → saved. */
  accepted(changeSetId: string): void
  /** failed reports a transport failure the person should see; queued change-sets stay queued. */
  failed(error: unknown): void
  /** online reports that a transport which refused pushes can take them again. */
  online(): void
  /**
   * remote delivers a change-set the authority holds, in whatever order the transport yields. The
   * returned promise settles once the change-set is folded and durably checkpointed, so a
   * transport that must acknowledge delivery before advancing its own position can wait for it.
   */
  remote(changeSet: TaoChangeSet): Promise<void> | void
}>

/** TaoSyncConnection is one transport binding of a store to its authority. */
export type TaoSyncConnection = {
  close?(): void
  /** fetch asks the transport to pull whatever the authority holds now. */
  fetch?(): Promise<void> | void
  /** push hands the transport one change-set; rejection means it was not taken and stays queued. */
  push(changeSet: TaoChangeSet): Promise<void> | void
  subscribe(observer: TaoSyncObserver): () => void
}

/** TaoSyncProviderContext adds this replica's identity to the provider-neutral mount. */
export type TaoSyncProviderContext = TaoDataProviderContext & Readonly<{ origin: string }>

/** TaoSyncProvider is the package boundary a granular datasource implements. */
export type TaoSyncProvider = {
  connect(context: TaoSyncProviderContext): TaoSyncConnection
}

type StoredField = { stamp: TaoSyncStamp; value: TaoSyncValue }

type StoredSyncRow = {
  deleted?: TaoSyncStamp
  fields: Record<string, StoredField>
}

/** SyncCheckpoint is what one replica keeps durable: its identity, clock, fold, and pending queue. */
type SyncCheckpoint = {
  clock: { counter: number; wall: number }
  formatVersion: 1
  nextId: number
  origin: string
  pending: TaoChangeSet[]
  rows: Record<string, Record<string, StoredSyncRow>>
}

const checkpointFormatVersion = 1
const checkpointKeyPrefix = 'tao-sync'
const remoteIdSeparator = '~'
const originLength = 8
const maxClockCounter = 0xffff

type SnapshotOverSyncOptions = Readonly<{
  now?: () => number
  /** origin fixes the replica identity; omitted, a fresh checkpoint draws a random one. */
  origin?: string
  /** scope separates the checkpoints of providers or containers that share a schema and key. */
  scope?: string
  storage: TaoKeyValueStorage
}>

/**
 * snapshotConnectionOverSync mounts a granular provider behind the snapshot contract. The
 * connection folds the authority's change-sets into a durable checkpoint, projects the fold as the
 * snapshot the store loads, diffs every saved snapshot into the change-set it pushes, and publishes
 * the fold again whenever it holds something the store does not.
 *
 * The diff runs against the snapshot the store actually holds — what it loaded, saved, or applied
 * from a publish — never against the fold: the store may still be saving when a remote change-set
 * lands, in which case it buffers the publish and its next save predates the change, and a diff
 * against the fold would read that as the store deleting the remote rows.
 */
export function snapshotConnectionOverSync(
  provider: TaoSyncProvider,
  context: TaoDataProviderContext,
  options: SnapshotOverSyncOptions,
): TaoDataConnection {
  const state = new SyncState(context.schema, options)
  // The provider scope and configured storage key are the durable identity of one mounted source.
  // The schema name used to include the collection list, so adding a collection silently abandoned
  // the pending queue. JSON's structural spelling also keeps delimiter-bearing names distinct.
  const checkpointKey = `${checkpointKeyPrefix}:${
    JSON.stringify([
      options.scope ?? 'default',
      context.storageKey,
    ])
  }`
  let connection: TaoSyncConnection | undefined
  let observer: TaoDataConnectionObserver | undefined
  let stopTransport: (() => void) | undefined
  let lastProjected: string | undefined
  // The rows the store holds, as far as the bridge can know: its load, its saves, and the
  // publishes it applied. While a save is in flight the store buffers a publish and applies the
  // latest one once the save settles, which is when `pendingView` becomes the store view.
  let storeView: StoredData | undefined
  let pendingView: string | undefined
  let savesInFlight = 0
  let loaded = false
  // Every mutation of the checkpoint goes through one queue so persists never interleave; pushes
  // run on their own chain so a slow transport never holds the fold.
  let work: Promise<void> = Promise.resolve()
  let pushes: Promise<void> = Promise.resolve()

  const report = (error: unknown): void => {
    if (observer !== undefined) {
      observer.error(error)
    } else {
      warnContainedFailure('The sync bridge could not complete a step.', error)
    }
  }

  const enqueue = <T>(step: () => Promise<T>): Promise<T> => {
    const result = work.then(step)
    work = result.then(() => undefined, () => undefined)
    return result
  }

  const run = (step: () => Promise<void>): void => {
    enqueue(step).catch(report)
  }

  const persist = async (): Promise<void> => {
    await options.storage.setItem(checkpointKey, JSON.stringify(state.checkpoint()))
  }

  const transport = (): TaoSyncConnection => {
    if (connection === undefined) {
      connection = provider.connect({ ...context, origin: state.origin })
    }
    return connection
  }

  // A push the transport rejects is the contract's "not taken": that change-set stays queued. Keep
  // trying the independent later commits, because a transport such as CloudKit can reject one
  // malformed/conflicted record without ever producing a separate online transition.
  const pushPending = (): void => {
    pushes = pushes.then(async () => {
      for (const changeSet of [...state.pending()]) {
        try {
          await transport().push(changeSet)
        } catch {
          continue
        }
      }
    })
  }

  const publishIfChanged = (): void => {
    const projected = state.projectedSnapshot()
    if (projected === lastProjected || observer === undefined) {
      return
    }
    lastProjected = projected
    if (savesInFlight > 0) {
      pendingView = projected
    } else {
      storeView = parseEnvelope(projected, context.schema)
    }
    observer.snapshot(projected)
  }

  const receiveRemote = (changeSet: TaoChangeSet): Promise<void> =>
    enqueue(async () => {
      const before = JSON.stringify(state.checkpoint())
      if (!state.fold(changeSet)) {
        return
      }
      try {
        await persist()
      } catch (error) {
        // A remote fold is acknowledged only after its checkpoint is durable. Restore the exact
        // pre-fold clock and rows too, or a later local diff can turn the unapplied remote rows into
        // deletes and push those deletes back to the authority.
        state.restore(before)
        throw error
      }
      publishIfChanged()
    })

  return {
    close: () => {
      stopTransport?.()
      stopTransport = undefined
      connection?.close?.()
      connection = undefined
    },
    load: () =>
      enqueue(async () => {
        const stored = await options.storage.getItem(checkpointKey)
        if (stored !== null) {
          state.restore(stored)
        }
        loaded = true
        lastProjected = state.projectedSnapshot()
        storeView = parseEnvelope(lastProjected, context.schema)
        return lastProjected
      }),
    // Store ids round-trip: a replica's own rows keep their local ids and remote rows their
    // projected `<id>~<origin>` form, both stable for as long as the row exists.
    referenceToken: reference => reference.id,
    resolveReference: reference => reference.token,
    save: snapshot => {
      savesInFlight += 1
      return enqueue(async () => {
        try {
          RuntimeAssert(loaded, 'Expected: a sync-backed store loads before it saves')
          const before = JSON.stringify(state.checkpoint())
          const previousView = storeView
          const changeSet = state.diff(snapshot, storeView)
          storeView = parseEnvelope(snapshot, context.schema)
          // What the store just saved is what it holds; only a fold that differs from it is news.
          lastProjected = state.normalized(storeView)
          try {
            await persist()
          } catch (error) {
            // The commit is not durable here, so neither the fold nor the queue may keep it; the
            // store keeps the write visible under its save error and retries.
            state.restore(before)
            storeView = previousView
            throw error
          }
          if (changeSet !== undefined) {
            pushPending()
          }
          // The fold may hold remote rows the store's snapshot predates; hand them back now.
          publishIfChanged()
        } finally {
          savesInFlight -= 1
          if (savesInFlight === 0 && pendingView !== undefined) {
            storeView = parseEnvelope(pendingView, context.schema)
            pendingView = undefined
          }
        }
      })
    },
    subscribe: next => {
      observer = next
      stopTransport?.()
      const stop = transport().subscribe({
        accepted: changeSetId => {
          run(async () => {
            if (state.accept(changeSetId)) {
              await persist()
            }
          })
        },
        failed: error => {
          report(error)
        },
        online: () => {
          pushPending()
        },
        remote: changeSet => {
          const folded = receiveRemote(changeSet)
          folded.catch(report)
          return folded
        },
      })
      stopTransport = stop
      pushPending()
      run(async () => {
        await transport().fetch?.()
      })
      return () => {
        if (observer === next) {
          observer = undefined
        }
        if (stopTransport === stop) {
          stopTransport = undefined
        }
        stop()
      }
    },
  }
}

/** SyncState is one replica's fold, clock, and queue, with the store projection derived from it. */
class SyncState {
  origin: string
  private clock: { counter: number; wall: number } = { counter: 0, wall: 0 }
  private nextId = 1
  private rows: Record<string, Record<string, StoredSyncRow>>
  private queue: TaoChangeSet[] = []
  private readonly now: () => number

  constructor(private readonly schema: TaoDataSchemaDefinition, options: SnapshotOverSyncOptions) {
    this.origin = options.origin ?? randomOrigin()
    RuntimeAssert(
      /^[0-9a-z]+$/u.test(this.origin) && !this.origin.includes(remoteIdSeparator),
      'Expected: a sync origin is a plain alphanumeric identifier',
      { origin: this.origin },
    )
    this.now = options.now ?? Date.now
    this.rows = Object.fromEntries(Object.keys(schema.entities).map(entity => [entity, {}]))
  }

  checkpoint(): SyncCheckpoint {
    return {
      clock: { ...this.clock },
      formatVersion: checkpointFormatVersion,
      nextId: this.nextId,
      origin: this.origin,
      pending: [...this.queue],
      rows: this.rows,
    }
  }

  restore(serialized: string): void {
    const value = JSON.parse(serialized) as Partial<SyncCheckpoint>
    RuntimeAssert.input(
      value.formatVersion === checkpointFormatVersion && typeof value.origin === 'string',
      'Persisted sync state is not a checkpoint this runtime understands.',
    )
    const rows = value.rows ?? {}
    RuntimeAssert.input(
      typeof rows === 'object' && !Array.isArray(rows)
        && Object.values(rows).every(entityRows =>
          typeof entityRows === 'object' && entityRows !== null && !Array.isArray(entityRows)
          && Object.values(entityRows).every(row =>
            typeof row === 'object' && row !== null && typeof row.fields === 'object' && row.fields !== null
          )
        ),
      'Persisted sync state is corrupt: its folded rows are not in the shape this runtime writes.',
    )
    this.origin = value.origin
    this.clock = { counter: value.clock?.counter ?? 0, wall: value.clock?.wall ?? 0 }
    this.nextId = value.nextId ?? 1
    this.queue = Array.isArray(value.pending) ? value.pending : []
    this.rows = Object.fromEntries(Object.keys(this.schema.entities).map(entity => [entity, rows[entity] ?? {}]))
  }

  pending(): readonly TaoChangeSet[] {
    return this.queue
  }

  accept(changeSetId: string): boolean {
    const before = this.queue.length
    this.queue = this.queue.filter(changeSet => changeSet.id !== changeSetId)
    return this.queue.length !== before
  }

  /**
   * diff turns a saved snapshot into the change-set of what the store changed since the view it
   * held, applied locally with fresh stamps. Rows absent from the snapshot but present in that view
   * are deletes; rows the view never held are creates.
   */
  diff(snapshot: string, storeView: StoredData | undefined): TaoChangeSet | undefined {
    const data = parseEnvelope(snapshot, this.schema)
    this.nextId = data.nextId
    const stamp = this.tick()
    const ops: TaoSyncOp[] = []
    for (const [entity, definition] of Object.entries(this.schema.entities)) {
      const held = new Map((storeView?.rows[entity] ?? []).map(row => [wireKeyOf(rowIdOf(row.Id, this.origin)), row]))
      const seen = new Set<string>()
      for (const row of data.rows[entity] ?? []) {
        const key = wireKeyOf(rowIdOf(row.Id, this.origin))
        seen.add(key)
        const previous = held.get(key)
        const fields: Record<string, TaoSyncStampedValue> = {}
        for (const [name, field] of Object.entries(definition.fields)) {
          const value = field.kind === 'relation'
            ? rowIdOf(row[name] as string, this.origin)
            : row[name] as boolean | null | number | string
          if (previous === undefined || !Object.is(previous[name], row[name])) {
            fields[name] = { stamp, value }
          }
        }
        if (Object.keys(fields).length > 0) {
          ops.push({ entity, fields, kind: 'upsert', row: rowIdOf(row.Id, this.origin) })
        }
      }
      for (const key of held.keys()) {
        if (!seen.has(key)) {
          ops.push({ entity, kind: 'delete', row: rowIdFromKey(key), stamp })
        }
      }
    }
    if (ops.length === 0) {
      return undefined
    }
    const changeSet: TaoChangeSet = { id: stamp, ops, origin: this.origin, stamp }
    this.apply(changeSet)
    this.queue.push(changeSet)
    return changeSet
  }

  /** fold merges a remote change-set; it reports whether anything in the store changed. */
  fold(changeSet: TaoChangeSet): boolean {
    this.observe(changeSet.stamp)
    return this.apply(changeSet)
  }

  /** projectedSnapshot renders the visible fold as the envelope the store mounts. */
  projectedSnapshot(): string {
    const data: StoredData = emptyData(this.schema)
    data.nextId = this.nextId
    const visible = this.visibleRows()
    for (const [entity, definition] of Object.entries(this.schema.entities)) {
      const rows: StoredRow[] = []
      for (const key of visible[entity] ?? []) {
        const stored = this.rows[entity]![key]!
        const row: StoredRow = { Id: storeIdOf(rowIdFromKey(key), this.origin) }
        for (const [name, field] of Object.entries(definition.fields)) {
          const value = stored.fields[name]!.value
          row[name] = field.kind === 'relation' ? storeIdOf(value as TaoSyncRowId, this.origin) : value
        }
        rows.push(row)
      }
      data.rows[entity] = rows
    }
    return this.normalized(data)
  }

  /** normalized serializes stored data the one way the bridge compares snapshots by. */
  normalized(data: StoredData): string {
    const ordered: StoredData = { nextId: data.nextId, rows: {} }
    for (const entity of Object.keys(this.schema.entities)) {
      // Numeric-aware, so `Note-2` stays before `Note-10` and an unordered query keeps its shape.
      ordered.rows[entity] = [...(data.rows[entity] ?? [])].sort((left, right) =>
        left.Id.localeCompare(right.Id, undefined, { numeric: true })
      )
    }
    return JSON.stringify(envelope(ordered, this.schema))
  }

  private apply(changeSet: TaoChangeSet): boolean {
    let changed = false
    for (const op of changeSet.ops) {
      const entityRows = this.rows[op.entity]
      if (entityRows === undefined) {
        // An entity this schema version does not know: nothing to fold it into.
        continue
      }
      const key = wireKeyOf(op.row)
      const row: StoredSyncRow = entityRows[key] ?? { fields: {} }
      entityRows[key] = row
      if (op.kind === 'delete') {
        // A tombstone is one more stamped unit: the later delete stands, and a later field edit
        // merges into the tombstoned row without reviving it.
        if (row.deleted === undefined || row.deleted < op.stamp) {
          row.deleted = op.stamp
          changed = true
        }
        continue
      }
      for (const [name, incoming] of Object.entries(op.fields)) {
        const current = row.fields[name]
        if (current === undefined || current.stamp < incoming.stamp) {
          row.fields[name] = { stamp: incoming.stamp, value: incoming.value }
          changed = true
        }
      }
    }
    return changed
  }

  /**
   * visibleRows is the fixpoint of rows the store may see: not deleted, carrying every schema
   * field, and referring only to rows that are themselves visible. A child that arrived before
   * its parent, or whose parent was deleted, stays folded but hidden until the fold completes.
   */
  private visibleRows(): Record<string, Set<string>> {
    const visible: Record<string, Set<string>> = {}
    for (const [entity, definition] of Object.entries(this.schema.entities)) {
      const keys = new Set<string>()
      for (const [key, row] of Object.entries(this.rows[entity] ?? {})) {
        if (
          row.deleted === undefined
          && Object.keys(definition.fields).every(name => row.fields[name] !== undefined)
        ) {
          keys.add(key)
        }
      }
      visible[entity] = keys
    }
    let settled = false
    while (!settled) {
      settled = true
      for (const [entity, definition] of Object.entries(this.schema.entities)) {
        for (const key of visible[entity]!) {
          const row = this.rows[entity]![key]!
          for (const [name, field] of Object.entries(definition.fields)) {
            if (field.kind !== 'relation') {
              continue
            }
            const target = row.fields[name]!.value as TaoSyncRowId
            if (!visible[field.relation ?? '']?.has(wireKeyOf(target))) {
              visible[entity]!.delete(key)
              settled = false
              break
            }
          }
        }
      }
    }
    return visible
  }

  private tick(): TaoSyncStamp {
    let wall = Math.max(this.now(), this.clock.wall)
    let counter = wall === this.clock.wall ? this.clock.counter + 1 : 0
    if (counter > maxClockCounter) {
      // The counter saturating means the wall clock stood still for 65,536 edits: move it on.
      wall += 1
      counter = 0
    }
    this.clock = { counter, wall }
    return formatStamp(wall, counter, this.origin)
  }

  private observe(stamp: TaoSyncStamp): void {
    const wall = Number.parseInt(stamp.slice(0, 12), 16)
    const counter = Number.parseInt(stamp.slice(12, 16), 16)
    if (!Number.isFinite(wall) || !Number.isFinite(counter)) {
      return
    }
    if (wall > this.clock.wall || (wall === this.clock.wall && counter > this.clock.counter)) {
      this.clock = { counter, wall }
    }
  }
}

function formatStamp(wall: number, counter: number, origin: string): TaoSyncStamp {
  return `${wall.toString(16).padStart(12, '0')}${counter.toString(16).padStart(4, '0')}${origin}`
}

function randomOrigin(): string {
  let origin = ''
  while (origin.length < originLength) {
    origin += Math.floor(Math.random() * 16).toString(16)
  }
  return origin
}

function wireKeyOf(row: TaoSyncRowId): string {
  return `${row.origin}${remoteIdSeparator}${row.id}`
}

function rowIdFromKey(key: string): TaoSyncRowId {
  const separator = key.indexOf(remoteIdSeparator)
  return { id: key.slice(separator + 1), origin: key.slice(0, separator) }
}

/** rowIdOf reads a store id back into its wire identity relative to this replica. */
function rowIdOf(storeId: string, self: string): TaoSyncRowId {
  const separator = storeId.lastIndexOf(remoteIdSeparator)
  return separator < 0
    ? { id: storeId, origin: self }
    : { id: storeId.slice(0, separator), origin: storeId.slice(separator + 1) }
}

/** storeIdOf projects a wire identity into this replica's store: own rows keep their local id. */
function storeIdOf(row: TaoSyncRowId, self: string): string {
  return row.origin === self ? row.id : `${row.id}${remoteIdSeparator}${row.origin}`
}

/**
 * createMemorySyncAuthority is the in-process authority: one totally ordered history shared by
 * every provider it hands out, delivered to online connections at once and to a reconnecting one
 * on `online`. It is the deterministic seam for runtime tests and the conformance suite.
 */
export function createMemorySyncAuthority(): {
  history: readonly TaoChangeSet[]
  provider(options?: { online?: boolean }): TaoSyncProvider & { setOnline(online: boolean): void }
} {
  const history: TaoChangeSet[] = []
  const known = new Set<string>()
  type Member = { delivered: number; observer?: TaoSyncObserver; online: boolean }
  const members = new Set<Member>()

  const deliver = (member: Member): void => {
    if (!member.online || member.observer === undefined) {
      return
    }
    while (member.delivered < history.length) {
      const changeSet = history[member.delivered]!
      member.delivered += 1
      void member.observer.remote(changeSet)
    }
  }

  return {
    get history() {
      return history
    },
    provider: (options = {}) => {
      const own = new Set<Member>()
      return {
        connect: () => {
          const member: Member = { delivered: 0, online: options.online ?? true }
          members.add(member)
          own.add(member)
          return {
            close: () => {
              members.delete(member)
              own.delete(member)
            },
            fetch: () => deliver(member),
            push: changeSet => {
              if (!member.online) {
                throw new HostEnvironmentError('The sync authority is unreachable while offline.')
              }
              if (!known.has(changeSet.id)) {
                known.add(changeSet.id)
                history.push(changeSet)
              }
              member.observer?.accepted(changeSet.id)
              for (const other of members) {
                deliver(other)
              }
            },
            subscribe: observer => {
              member.observer = observer
              return () => {
                if (member.observer === observer) {
                  member.observer = undefined
                }
              }
            },
          }
        },
        setOnline: online => {
          for (const member of own) {
            const was = member.online
            member.online = online
            if (online && !was) {
              member.observer?.online()
              deliver(member)
            }
          }
        },
      }
    },
  }
}

const conformanceSchema: TaoDataSchemaDefinition = {
  entities: {
    Note: {
      collection: 'Notes',
      fields: {
        Pinned: { kind: 'boolean' },
        Title: { kind: 'text' },
      },
    },
    Paragraph: {
      collection: 'Paragraphs',
      fields: {
        Note: { kind: 'relation', relation: 'Note' },
        Text: { kind: 'text' },
      },
    },
  },
  name: 'SyncConformance',
}

/**
 * testSyncProvider checks a granular provider through the snapshot bridge: two replicas over one
 * authority converge on creates, updates, and deletes in both directions; a later edit to the same
 * field wins on both sides; a child created against a remote parent projects its relation into
 * local ids; a relaunch reloads the fold from its checkpoint; a delete propagates together with
 * the rows that referred to the deleted one; and every change-set is eventually accepted, so both
 * pending queues drain. Concurrency under partition is the memory authority's own coverage, since
 * only it can hold deliveries. `createProvider` must hand every call a provider over the same
 * authority.
 */
export async function testSyncProvider(createProvider: () => TaoSyncProvider): Promise<void> {
  const run = ++syncConformanceRun
  const storageKey = `tao-sync-conformance-${run}`
  const replica = (name: string, storage: TaoKeyValueStorage, now: () => number): TaoDataConnection =>
    snapshotConnectionOverSync(createProvider(), { configuration: {}, schema: conformanceSchema, storageKey }, {
      now,
      origin: name,
      storage,
    })
  let clock = 1_000
  const now = (): number => clock++
  const storageA = memoryKeyValueStorage()
  const storageB = memoryKeyValueStorage()
  const a = replica('aaaaaaaa', storageA, now)
  const b = replica('bbbbbbbb', storageB, now)
  const seenA: Array<string | undefined> = []
  const seenB: Array<string | undefined> = []
  assertSyncConformance(await a.load() === emptySnapshot(), 'a fresh replica loads the empty store.')
  await b.load()
  a.subscribe!({ error: () => undefined, snapshot: value => seenA.push(value) })
  b.subscribe!({ error: () => undefined, snapshot: value => seenB.push(value) })
  await settle()

  await a.save(snapshotOf({ Note: [{ Id: 'Note-1', Pinned: false, Title: 'Hello' }] }, 2))
  await settle()
  const onB = latest(seenB)
  assertSyncConformance(
    onB !== undefined && rowsOf(onB).Note?.[0]?.Id === 'Note-1~aaaaaaaa' && rowsOf(onB).Note?.[0]?.Title === 'Hello',
    'a create reaches the other replica with its id projected by origin.',
  )

  await b.save(snapshotOf({ Note: [{ Id: 'Note-1~aaaaaaaa', Pinned: true, Title: 'Hello' }] }, 1))
  await settle()
  const onA = latest(seenA)
  assertSyncConformance(
    onA !== undefined && rowsOf(onA).Note?.[0]?.Id === 'Note-1' && rowsOf(onA).Note?.[0]?.Pinned === true,
    'a remote update lands on the creating replica under its local id.',
  )

  await a.save(snapshotOf({ Note: [{ Id: 'Note-1', Pinned: true, Title: 'From A' }] }, 2))
  await settle()
  await b.save(snapshotOf({ Note: [{ Id: 'Note-1~aaaaaaaa', Pinned: true, Title: 'From B' }] }, 1))
  await settle()
  // B's own edit won, so B republishes nothing; its projection is read as a fresh mount would.
  assertSyncConformance(
    rowsOf(latest(seenA)!).Note?.[0]?.Title === 'From B' && rowsOf((await b.load())!).Note?.[0]?.Title === 'From B',
    'the later edit to one field wins on both replicas.',
  )

  await b.save(snapshotOf({
    Note: [{ Id: 'Note-1~aaaaaaaa', Pinned: true, Title: 'From B' }],
    Paragraph: [{ Id: 'Paragraph-1', Note: 'Note-1~aaaaaaaa', Text: 'Body' }],
  }, 2))
  await settle()
  const paragraphOnA = rowsOf(latest(seenA)!).Paragraph?.[0]
  assertSyncConformance(
    paragraphOnA?.Id === 'Paragraph-1~bbbbbbbb' && paragraphOnA?.Note === 'Note-1',
    'a child created against a remote parent projects its relation into local ids.',
  )

  a.close?.()
  const relaunched = replica('aaaaaaaa', storageA, now)
  const reloaded = await relaunched.load()
  assertSyncConformance(
    reloaded !== undefined && rowsOf(reloaded).Paragraph?.[0]?.Id === 'Paragraph-1~bbbbbbbb',
    'a relaunch reloads the folded store from the checkpoint.',
  )
  relaunched.subscribe!({ error: () => undefined, snapshot: () => undefined })
  await settle()

  await relaunched.save(snapshotOf({ Note: [], Paragraph: [] }, 2))
  await settle()
  const afterDelete = latest(seenB)
  assertSyncConformance(
    afterDelete !== undefined && (rowsOf(afterDelete).Note?.length ?? 0) === 0
      && (rowsOf(afterDelete).Paragraph?.length ?? 0) === 0,
    'a delete propagates and hides the rows that referred to the deleted one.',
  )
  assertSyncConformance(
    await pendingCount(storageA) === 0 && await pendingCount(storageB) === 0,
    'every change-set is accepted, so both pending queues drain.',
  )
  relaunched.close?.()
  b.close?.()
}

let syncConformanceRun = 0

function emptySnapshot(): string {
  return JSON.stringify(envelope(emptyData(conformanceSchema), conformanceSchema))
}

function snapshotOf(rows: Record<string, StoredRow[]>, nextId: number): string {
  const data = emptyData(conformanceSchema)
  data.nextId = nextId
  for (const [entity, entityRows] of Object.entries(rows)) {
    data.rows[entity] = entityRows
  }
  return JSON.stringify(envelope(data, conformanceSchema))
}

type ConformanceRows = {
  Note?: Array<{ Id: string; Pinned: boolean; Title: string }>
  Paragraph?: Array<{ Id: string; Note: string; Text: string }>
}

function rowsOf(snapshot: string): ConformanceRows {
  return (JSON.parse(snapshot) as { rows: ConformanceRows }).rows
}

function latest<T>(values: readonly T[]): T | undefined {
  return values[values.length - 1]
}

async function pendingCount(storage: TaoKeyValueStorage & { values: Map<string, string> }): Promise<number> {
  const checkpoint = [...storage.values.values()][0]
  return checkpoint === undefined ? 0 : (JSON.parse(checkpoint) as { pending: unknown[] }).pending.length
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
}

function assertSyncConformance(condition: boolean, message: string): void {
  if (!condition) {
    throw new UserInputError(`Sync provider conformance failed: ${message}`)
  }
}

/**
 * stampAt spells a stamp for an edit a transport learned about without one — a deletion CloudKit
 * reports, say — at the given wall-clock millisecond and origin, ordered like every other stamp.
 */
export function stampAt(wall: number, origin: string): TaoSyncStamp {
  return formatStamp(Math.max(0, Math.floor(wall)), 0, origin)
}

/** SyncControls is the surface `TR.Sync` publishes to granular datasource sidecars and tests. */
export const SyncControls = {
  memoryAuthority: createMemorySyncAuthority,
  overSnapshot: snapshotConnectionOverSync,
  stampAt,
  testProvider: testSyncProvider,
} as const
