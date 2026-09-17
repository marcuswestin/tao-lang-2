import { Errors } from '@shared/core'

/** CloudKitFieldValue is what one record field holds on the wire; relations and stamps are text. */
export type CloudKitFieldValue = number | string

/** CloudKitRecord is one record as the native module describes it: name, type, plain fields. */
export type CloudKitRecord = Readonly<{
  fields: Readonly<Record<string, CloudKitFieldValue>>
  name: string
  type: string
}>

/** CloudKitConflict is a save the server refused because its copy moved; `server` is that copy. */
export type CloudKitConflict = Readonly<{ name: string; server: CloudKitRecord }>

/** CloudKitFailure is a save the server refused for another reason; `reason` is the error code's name. */
export type CloudKitFailure = Readonly<{ name: string; reason: string }>

/** CloudKitEvent is one native `cloudKitEvent`. */
export type CloudKitEvent = {
  /** batchId identifies a fetched batch the native inbox keeps until JavaScript acknowledges it. */
  batchId?: string
  conflicts?: CloudKitConflict[]
  deletions?: string[]
  failures?: CloudKitFailure[]
  kind: 'accountChanged' | 'failed' | 'fetched' | 'sent' | 'zoneDeleted'
  message?: string
  modifications?: CloudKitRecord[]
  savedRecords?: CloudKitRecord[]
  sessionId: string
}

/** TaoCloudKitNativeModule is the JavaScript face of the Swift `TaoCloudKit` module. */
export type TaoCloudKitNativeModule = {
  acknowledgeFetched(sessionId: string, batchId: string): Promise<void>
  addListener(event: 'cloudKitEvent', listener: (event: CloudKitEvent) => void): { remove(): void }
  fetchChanges(sessionId: string): Promise<void>
  replayInbox(sessionId: string): Promise<void>
  sendChanges(sessionId: string, records: readonly CloudKitRecord[]): Promise<void>
  start(sessionId: string, container: string | null, zoneName: string, stateFileName: string): Promise<void>
  stop(sessionId: string): Promise<void>
}

/** CloudKitZoneObserver receives what the sync engine fetched, sent, or could not send. */
export type CloudKitZoneObserver = Readonly<{
  /** accountChanged reports the iCloud account signing out or switching; sync must stop. */
  accountChanged(message: string): void
  failed(message: string): void
  /**
   * fetched delivers a batch the native side holds durably until `acknowledge` resolves, so the
   * engine's position never advances past records the fold has not persisted.
   */
  fetched(
    modifications: readonly CloudKitRecord[],
    deletions: readonly string[],
    acknowledge: () => Promise<void>,
  ): void
  sent(
    savedRecords: readonly CloudKitRecord[],
    conflicts: readonly CloudKitConflict[],
    failures: readonly CloudKitFailure[],
  ): void
  zoneReset(): void
}>

/**
 * CloudKitZone is one record zone of the private database, driven by a `CKSyncEngine` on the
 * native side: whole records go out, fetched changes and send outcomes come back as events.
 */
export type CloudKitZone = {
  close(): void
  fetch(): Promise<void>
  send(records: readonly CloudKitRecord[]): Promise<void>
  subscribe(observer: CloudKitZoneObserver): () => void
}

/** CloudKitZones opens a zone by container (undefined for the app's default) and zone name. */
export type CloudKitZones = (container: string | undefined, zoneName: string) => CloudKitZone

const nativeModuleName = 'TaoCloudKit'

let nextSessionId = 0

/** cloudKitZonesOver adapts one native module instance to the zone boundary. */
export function cloudKitZonesOver(native: TaoCloudKitNativeModule): CloudKitZones {
  return (container, zoneName) => {
    nextSessionId += 1
    const sessionId = `zone-${nextSessionId}`
    const stateFileName = cloudKitStateFileName(container, zoneName)
    let closed = false
    let observer: CloudKitZoneObserver | undefined
    const queued: CloudKitEvent[] = []
    const dispatch = (event: CloudKitEvent): void => {
      if (closed || event.sessionId !== sessionId) {
        return
      }
      if (observer === undefined) {
        queued.push(event)
        return
      }
      if (event.kind === 'fetched') {
        const batchId = event.batchId
        observer.fetched(
          event.modifications ?? [],
          event.deletions ?? [],
          () => (batchId === undefined
            ? Promise.resolve()
            : hostCall(native.acknowledgeFetched(sessionId, batchId))),
        )
      } else if (event.kind === 'sent') {
        observer.sent(event.savedRecords ?? [], event.conflicts ?? [], event.failures ?? [])
      } else if (event.kind === 'zoneDeleted') {
        observer.zoneReset()
      } else if (event.kind === 'accountChanged') {
        observer.accountChanged(event.message ?? 'The iCloud account changed.')
      } else {
        observer.failed(event.message ?? 'CloudKit reported a failure.')
      }
    }
    // Listen before start: CKSyncEngine may report live work immediately, and replay is explicitly
    // requested only after the JavaScript observer is attached below.
    const subscription = native.addListener('cloudKitEvent', dispatch)
    const started = hostCall(native.start(sessionId, container ?? null, zoneName, stateFileName))
    void started.catch(() => undefined)
    return {
      close: () => {
        if (closed) {
          return
        }
        closed = true
        observer = undefined
        queued.length = 0
        subscription.remove()
        void started.then(() => native.stop(sessionId), () => undefined)
      },
      fetch: async () => {
        await started
        await hostCall(native.fetchChanges(sessionId))
      },
      send: async records => {
        await started
        await hostCall(native.sendChanges(sessionId, records))
      },
      subscribe: next => {
        observer = next
        for (const event of queued.splice(0)) {
          dispatch(event)
        }
        void started.then(
          () => hostCall(native.replayInbox(sessionId)),
          (error: unknown) => Promise.reject(error),
        ).catch((error: unknown) => {
          if (!closed && observer === next) {
            next.failed(Errors.messageOf(error))
          }
        })
        return () => {
          if (observer === next) {
            observer = undefined
          }
        }
      },
    }
  }
}

/** cloudKitStateFileName structurally identifies a container/zone pair without delimiter aliases. */
export function cloudKitStateFileName(container: string | undefined, zoneName: string): string {
  const encodedContainer = encodeURIComponent(container ?? 'default')
  const encodedZone = encodeURIComponent(zoneName)
  return `v1-c${encodedContainer.length}-${encodedContainer}-z${encodedZone.length}-${encodedZone}.state`
}

/**
 * loadCloudKitZones binds the Swift module lazily, so a bundle that never mounts a CloudKit
 * datasource never touches the native side and a platform without it fails at the mount.
 */
export function loadCloudKitZones(): CloudKitZones {
  let native: TaoCloudKitNativeModule | undefined
  let failure: unknown
  try {
    const expo = require('expo') as { requireNativeModule(name: string): TaoCloudKitNativeModule }
    native = expo.requireNativeModule(nativeModuleName)
  } catch (error) {
    failure = error
  }
  if (native === undefined) {
    Errors.throwHostEnvironment(
      'CloudKit sync needs the Tao iCloud native module, which this build does not include: build the app for iOS 17 or later with tao-icloud-native linked, or bind another datasource for this platform.',
      { cause: failure },
    )
  }
  return cloudKitZonesOver(native)
}

/** hostCall classifies a rejected native call as the host-environment failure it is. */
async function hostCall<T>(call: Promise<T>): Promise<T> {
  try {
    return await call
  } catch (error) {
    return Errors.throwHostEnvironment(Errors.messageOf(error), { cause: error })
  }
}
