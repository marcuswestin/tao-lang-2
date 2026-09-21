import TR from '@runtime/TR'
import { Assert, Errors } from '@shared/core'
import type {
  CloudKitConflict,
  CloudKitFailure,
  CloudKitRecord,
  CloudKitZone,
  CloudKitZones,
} from 'tao-icloud/cloudkit'
import { optionalConfigurationText } from '../provider-configuration'

const providerName = 'CloudKit'
/** Every row is a `TaoRow` record with one `payload` field, so the CloudKit schema never changes. */
const recordType = 'TaoRow'
const payloadField = 'payload'
const deletedField = '__deleted'
const transportOrigin = 'cloudkit'

/** Payload is the JSON a record's one field carries: the row's stamped fields and tombstone. */
type Payload = {
  deleted?: TR.SyncStamp
  entity: string
  fields: Record<string, TR.SyncStampedValue>
  row: TR.SyncRowId
}

/**
 * CloudKitProvider is the granular-write family's CloudKit member. Each Tao row is one record in a
 * record zone of the account's private database, named by the row's origin replica, entity, and
 * local id; each field is stored beside the stamp of the edit that set it, and a deleted row keeps
 * its record with a stamped tombstone, so no relaunch can resurrect it. The runtime's sync layer
 * folds fetched records into its checkpoint and diffs saved snapshots into the records it sends,
 * so two devices editing different fields of one row both keep their edits, and a same-field race
 * resolves to the later edit on every device. `CKSyncEngine` owns batching, retries, and the
 * offline queue on the native side; a server-side conflict comes back with the server's copy and
 * is merged fieldwise here before the record is sent again.
 */
export function CloudKitProvider(
  loadZones: () => CloudKitZones = nativeZones,
  loadStorage: () => TR.KeyValueStorage = asyncStorage,
): TR.DataProvider {
  return {
    connect: context => {
      // Validate before touching the native side, as the sibling providers do.
      const container = optionalConfigurationText(providerName, context, 'Container')
      return TR.Sync.overSnapshot(CloudKitSyncProvider(loadZones), context, {
        scope: `cloudkit:${container ?? 'default'}`,
        storage: loadStorage(),
      })
    },
  }
}

/** CloudKitSyncProvider is the transport half: change-sets out as records, records in as change-sets. */
export function CloudKitSyncProvider(loadZones: () => CloudKitZones = nativeZones): TR.SyncProvider {
  return {
    connect: context => {
      const container = optionalConfigurationText(providerName, context, 'Container')
      const zones = loadZones()
      return cloudKitSyncConnection(zones(container, context.storageKey), context)
    },
  }
}

type RowImage = {
  deleted?: TR.SyncStamp
  entity: string
  fields: Record<string, TR.SyncStampedValue>
  row: TR.SyncRowId
}

/** RequiredStamps is what a saved record must carry before a change-set counts as accepted. */
type RequiredStamps = Record<string, TR.SyncStamp>

function cloudKitSyncConnection(zone: CloudKitZone, context: TR.SyncProviderContext): TR.SyncConnection {
  const schema = context.schema
  // The latest field values, stamps, and tombstone this connection knows per record, from its
  // own sends and from fetched records, so every send carries a whole record and a conflict can
  // merge fieldwise.
  const images = new Map<string, RowImage>()
  // Which change-sets still wait on which records, and the stamps a saved record must carry for
  // that change-set: a later change-set to the same record is not accepted by an earlier save.
  const outstanding = new Map<string, Map<string, RequiredStamps>>()
  let observer: TR.SyncObserver | undefined
  let fetchCounter = 0
  let accountChanged = false

  const recordNameOf = (entity: string, row: TR.SyncRowId): string => `${row.origin}:${entity}:${row.id}`

  const parseRecordName = (name: string): { entity: string; row: TR.SyncRowId } | undefined => {
    const [origin, entity, ...rest] = name.split(':')
    if (origin === undefined || entity === undefined || rest.length === 0) {
      return undefined
    }
    return { entity, row: { id: rest.join(':'), origin } }
  }

  const valueMatches = (entity: string, field: string, value: unknown): value is TR.SyncValue => {
    const definition = schema.entities[entity]?.fields[field]
    if (definition === undefined) {
      return false
    }
    if (definition.kind === 'relation') {
      return typeof value === 'object' && value !== null
        && typeof (value as TR.SyncRowId).id === 'string' && typeof (value as TR.SyncRowId).origin === 'string'
    }
    if (definition.kind === 'reference') {
      // A cross-store reference persists the target's unique scalar, including null when cleared.
      // Its target store owns the primitive type, so this schema intentionally accepts both unique
      // scalar families rather than guessing from a relation declaration it does not contain.
      return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
    }
    return definition.kind === 'boolean'
      ? typeof value === 'boolean'
      : definition.kind === 'text'
      ? typeof value === 'string'
      : typeof value === 'number' && Number.isFinite(value)
  }

  /**
   * recordOf spells an image as one generic record whose only field is a JSON payload. One record
   * type with one field means the CloudKit schema is deployed to production once and never follows
   * a Tao `data` change; CloudKit indexes and queries are unused since the fold evaluates locally.
   */
  const recordOf = (image: RowImage): CloudKitRecord => {
    const payload: Payload = { entity: image.entity, fields: image.fields, row: image.row }
    if (image.deleted !== undefined) {
      payload.deleted = image.deleted
    }
    return {
      fields: { [payloadField]: JSON.stringify(payload) },
      name: recordNameOf(image.entity, image.row),
      type: recordType,
    }
  }

  /** imageOf reads a fetched record into an image; unknown entities and fields are dropped. */
  const imageOf = (record: CloudKitRecord): RowImage | undefined => {
    const parsed = parseRecordName(record.name)
    const raw = record.fields[payloadField]
    if (parsed === undefined || schema.entities[parsed.entity] === undefined || typeof raw !== 'string') {
      return undefined
    }
    let payload: Partial<Payload>
    try {
      payload = JSON.parse(raw) as Partial<Payload>
    } catch {
      return undefined
    }
    const fields: Record<string, TR.SyncStampedValue> = {}
    for (const [key, stamped] of Object.entries(payload.fields ?? {})) {
      const candidate = stamped as Partial<TR.SyncStampedValue> | undefined
      if (typeof candidate?.stamp === 'string' && valueMatches(parsed.entity, key, candidate.value)) {
        fields[key] = { stamp: candidate.stamp, value: candidate.value }
      }
    }
    return {
      ...(typeof payload.deleted === 'string' ? { deleted: payload.deleted } : {}),
      entity: parsed.entity,
      fields,
      row: parsed.row,
    }
  }

  /** mergeInto folds newer stamped fields and a newer tombstone into an image. */
  const mergeInto = (image: RowImage, incoming: Pick<RowImage, 'deleted' | 'fields'>): void => {
    for (const [name, field] of Object.entries(incoming.fields)) {
      const current = image.fields[name]
      if (current === undefined || current.stamp < field.stamp) {
        image.fields[name] = field
      }
    }
    if (incoming.deleted !== undefined && (image.deleted === undefined || image.deleted < incoming.deleted)) {
      image.deleted = incoming.deleted
    }
  }

  /** opsOf turns an image's stamped state into the change-set ops the fold understands. */
  const opsOf = (image: Pick<RowImage, 'deleted' | 'entity' | 'fields' | 'row'>): TR.SyncOp[] => {
    const ops: TR.SyncOp[] = []
    if (Object.keys(image.fields).length > 0) {
      ops.push({ entity: image.entity, fields: image.fields, kind: 'upsert', row: image.row })
    }
    if (image.deleted !== undefined) {
      ops.push({ entity: image.entity, kind: 'delete', row: image.row, stamp: image.deleted })
    }
    return ops
  }

  const track = (changeSetId: string, recordName: string, required: RequiredStamps): void => {
    const records = outstanding.get(changeSetId) ?? new Map<string, RequiredStamps>()
    records.set(recordName, { ...records.get(recordName), ...required })
    outstanding.set(changeSetId, records)
  }

  /** settle marks a record saved with the stamps it carries; a change-set without records left is accepted. */
  const settle = (recordName: string, saved: RequiredStamps | undefined): void => {
    for (const [changeSetId, records] of [...outstanding]) {
      const required = records.get(recordName)
      if (required === undefined) {
        continue
      }
      const satisfied = saved === undefined
        || Object.entries(required).every(([field, stamp]) => (saved[field] ?? '') >= stamp)
      if (!satisfied) {
        continue
      }
      records.delete(recordName)
      if (records.size === 0) {
        outstanding.delete(changeSetId)
        observer?.accepted(changeSetId)
      }
    }
  }

  const stampsOf = (record: CloudKitRecord): RequiredStamps => {
    const image = imageOf(record)
    if (image === undefined) {
      return {}
    }
    const stamps: RequiredStamps = Object.fromEntries(
      Object.entries(image.fields).map(([field, { stamp }]) => [field, stamp]),
    )
    if (image.deleted !== undefined) {
      stamps[deletedField] = image.deleted
    }
    return stamps
  }

  const deliver = (ops: TR.SyncOp[]): Promise<void> => {
    if (ops.length === 0 || observer === undefined) {
      return Promise.resolve()
    }
    fetchCounter += 1
    const stamp = ops.reduce((latest, op) => {
      const own = op.kind === 'delete'
        ? op.stamp
        : Object.values(op.fields).reduce((a, b) => (a > b.stamp ? a : b.stamp), '')
      return own > latest ? own : latest
    }, '')
    return Promise.resolve(
      observer.remote({ id: `${transportOrigin}-${fetchCounter}`, ops, origin: transportOrigin, stamp }),
    )
  }

  const sendRecords = (records: readonly CloudKitRecord[]): void => {
    if (records.length === 0) {
      return
    }
    zone.send(records).catch((error: unknown) => observer?.failed(error))
  }

  const onFetched = (
    modifications: readonly CloudKitRecord[],
    deletions: readonly string[],
    acknowledge: () => Promise<void>,
  ): void => {
    const ops: TR.SyncOp[] = []
    for (const record of modifications) {
      const fetched = imageOf(record)
      if (fetched === undefined) {
        continue
      }
      const image = images.get(record.name) ?? { entity: fetched.entity, fields: {}, row: fetched.row }
      images.set(record.name, image)
      mergeInto(image, fetched)
      ops.push(...opsOf(fetched))
    }
    for (const name of deletions) {
      // A record gone from the server outright (a purge) is a delete the fold has no stamp for.
      const parsed = parseRecordName(name)
      images.delete(name)
      if (parsed !== undefined && schema.entities[parsed.entity] !== undefined) {
        ops.push({
          entity: parsed.entity,
          kind: 'delete',
          row: parsed.row,
          stamp: TR.Sync.stampAt(Date.now(), transportOrigin),
        })
      }
    }
    deliver(ops).then(acknowledge).catch((error: unknown) => observer?.failed(error))
  }

  const onSent = (
    savedRecords: readonly CloudKitRecord[],
    conflicts: readonly CloudKitConflict[],
    failures: readonly CloudKitFailure[],
  ): void => {
    for (const record of savedRecords) {
      settle(record.name, stampsOf(record))
    }
    const remoteOps: TR.SyncOp[] = []
    const resend: CloudKitRecord[] = []
    for (const conflict of conflicts) {
      const server = imageOf(conflict.server)
      const image = images.get(conflict.name)
      if (server === undefined || image === undefined) {
        // A malformed conflict proves neither that our record was saved nor what the authority
        // holds. Keep every tracked change-set pending and surface the native/protocol failure.
        observer?.failed(
          new Errors.HostEnvironmentError(`CloudKit returned an unreadable conflict for '${conflict.name}'.`),
        )
        continue
      }
      // The server's copy moved under our save: what it holds newer than ours lands locally as a
      // remote change, and the merged record — ours where ours is newer — goes out again.
      const serverWon: RowImage = { entity: image.entity, fields: {}, row: image.row }
      for (const [name, incoming] of Object.entries(server.fields)) {
        const current = image.fields[name]
        if (current === undefined || current.stamp < incoming.stamp) {
          serverWon.fields[name] = incoming
        }
      }
      if (server.deleted !== undefined && (image.deleted === undefined || image.deleted < server.deleted)) {
        serverWon.deleted = server.deleted
      }
      mergeInto(image, server)
      remoteOps.push(...opsOf(serverWon))
      resend.push(recordOf(image))
    }
    for (const failure of failures) {
      const image = images.get(failure.name)
      if (failure.reason === 'unknownItem' && image !== undefined) {
        // The server has no such record — the zone was reset, or the record purged — so the local
        // image is re-created whole; the native side dropped its stale change tag.
        resend.push(recordOf(image))
        continue
      }
      observer?.failed(new Errors.HostEnvironmentError(`CloudKit could not save '${failure.name}': ${failure.reason}`))
    }
    deliver(remoteOps).catch((error: unknown) => observer?.failed(error))
    sendRecords(resend)
  }

  return {
    close: () => {
      zone.close()
    },
    fetch: () => zone.fetch(),
    push: async changeSet => {
      if (accountChanged) {
        Errors.throwHostEnvironment('The iCloud account changed; CloudKit sync resumes after the app relaunches.')
      }
      const records: CloudKitRecord[] = []
      for (const op of changeSet.ops) {
        Assert(schema.entities[op.entity] !== undefined, 'a change-set names entities of its own schema', {
          entity: op.entity,
        })
        const name = recordNameOf(op.entity, op.row)
        const image = images.get(name) ?? { entity: op.entity, fields: {}, row: op.row }
        images.set(name, image)
        if (op.kind === 'delete') {
          mergeInto(image, { deleted: op.stamp, fields: {} })
          track(changeSet.id, name, { [deletedField]: op.stamp })
        } else {
          mergeInto(image, { fields: op.fields })
          track(
            changeSet.id,
            name,
            Object.fromEntries(Object.entries(op.fields).map(([field, { stamp }]) => [field, stamp])),
          )
        }
        records.push(recordOf(image))
      }
      await zone.send(dedupe(records))
    },
    subscribe: next => {
      observer = next
      const stop = zone.subscribe({
        accountChanged: message => {
          accountChanged = true
          next.failed(
            new Errors.HostEnvironmentError(
              `${message} CloudKit sync stopped so this account's edits are not written into another account; relaunch the app to continue.`,
            ),
          )
        },
        failed: message => next.failed(new Errors.HostEnvironmentError(message)),
        fetched: onFetched,
        sent: onSent,
        zoneReset: () => {
          images.clear()
          next.failed(
            new Errors.HostEnvironmentError(
              'The CloudKit record zone was deleted; rows accepted before that are gone from iCloud until they are edited again.',
            ),
          )
        },
      })
      return () => {
        if (observer === next) {
          observer = undefined
        }
        stop()
      }
    },
  }
}

/** dedupe keeps the last record per name, so one change-set touching a row twice sends it once. */
function dedupe(records: readonly CloudKitRecord[]): CloudKitRecord[] {
  const byName = new Map<string, CloudKitRecord>()
  for (const record of records) {
    byName.set(record.name, record)
  }
  return [...byName.values()]
}

function nativeZones(): CloudKitZones {
  const native = require('tao-icloud/cloudkit') as { loadCloudKitZones(): CloudKitZones }
  return native.loadCloudKitZones()
}

function asyncStorage(): TR.KeyValueStorage {
  const required = require('@react-native-async-storage/async-storage') as
    | TR.KeyValueStorage
    | { default: TR.KeyValueStorage }
  return 'default' in required ? required.default : required
}
