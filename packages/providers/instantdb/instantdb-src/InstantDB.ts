import type TR from '@runtime/TR'
import { Errors, Switch } from '@shared/core'
import { acquireInstantClient, type InstantClientLease, type InstantSDK } from './instant-clients'
import {
  instantQuery,
  type InstantQueryResult,
  type InstantRowOperation,
  projectSnapshot,
  RowIdentities,
  rowOperations,
  snapshotNextId,
} from './instant-rows'
import { instantMapping } from './instant-schema'
import { optionalConfigurationText, requiredConfigurationText } from './provider-configuration'

export { InstantAuthProvider } from './InstantAuth'

const providerName = 'InstantDB'

type TransactionChunk = Exclude<Parameters<InstantClientLease['db']['core']['transact']>[0], readonly unknown[]>
type SubscriptionResult = Readonly<{ data?: InstantQueryResult; error?: unknown }>
type InstantCleanupFailure = Readonly<{ error: unknown; operation: 'shutdown' | 'unsubscribe' }>

/**
 * InstantDBProvider stores each Tao entity as an InstantDB namespace, one InstantDB row per Tao
 * row. It subscribes to every namespace of its schema and projects the rows into the store's
 * snapshot; each save becomes one atomic transaction of the rows the commit created, changed,
 * relinked, or deleted. The app's schema and permission rules come from the same mapping and are
 * pushed ahead of time (`pushInstantSchema`), never by a running client.
 *
 * `StorageKey` is still accepted, but namespaces are app-wide: two datasources on one app that
 * declare the same collection share its rows.
 */
export function InstantDBProvider(loadSDK: () => InstantSDK = instantSDK): TR.DataProvider {
  return {
    testNetwork: 'remote',
    connect: context => {
      const appId = requiredConfigurationText(providerName, context, 'AppId')
      const apiURI = optionalConfigurationText(providerName, context, 'ApiURI')
      const websocketURI = optionalConfigurationText(providerName, context, 'WebsocketURI')
      const mapping = instantMapping(context.schema)
      let sdk: InstantSDK
      let lease: InstantClientLease
      try {
        sdk = loadSDK()
        lease = acquireInstantClient(sdk, { apiURI, appId, websocketURI }, mapping.schema)
      } catch (error) {
        throw instantFailure('initialization', error)
      }
      const core = lease.db.core
      const identities = new RowIdentities(() => sdk.id())
      const query = instantQuery(mapping)
      // An authenticated store may hold rows whose related rows this account cannot read.
      const allowAbsentRelations = context.auth !== undefined
      let closed = false
      let observer: TR.DataConnectionObserver | undefined
      let missedResult: { error: unknown } | { snapshot: string } | undefined
      let rejectPendingLoad: ((error: Error) => void) | undefined
      let stopQuery: (() => void) | undefined
      // The last snapshot the store holds as far as this connection knows: what it saved, or what
      // this connection last projected. It orders projected rows and serves as the diff baseline
      // when a caller omits one.
      let storeView: string | undefined
      let nextId = 1
      let lastPublished: string | undefined

      const project = (result: SubscriptionResult): { error: unknown } | { snapshot: string } => {
        if (result.error !== undefined) {
          return { error: result.error }
        }
        try {
          const snapshot = projectSnapshot(mapping, context.schema, result.data ?? {}, identities, {
            allowAbsentRelations,
            nextId,
            order: storeView,
          })
          return { snapshot }
        } catch (error) {
          return { error }
        }
      }
      const stopActiveQuery = (): InstantCleanupFailure | undefined => {
        const stop = stopQuery
        stopQuery = undefined
        try {
          stop?.()
          return undefined
        } catch (error) {
          return { error, operation: 'unsubscribe' }
        }
      }
      const publish = (projected: { error: unknown } | { snapshot: string }): void => {
        if ('error' in projected) {
          observer?.error(instantFailure('subscription', projected.error))
          return
        }
        if (projected.snapshot === lastPublished) {
          return
        }
        lastPublished = projected.snapshot
        storeView = projected.snapshot
        observer?.snapshot(projected.snapshot)
      }

      return {
        close: () => {
          if (closed) {
            return
          }
          closed = true
          const failures: InstantCleanupFailure[] = []
          const unsubscribeFailure = stopActiveQuery()
          if (unsubscribeFailure !== undefined) {
            failures.push(unsubscribeFailure)
          }
          rejectPendingLoad?.(
            new Errors.HostEnvironmentError('The InstantDB connection closed before its load settled.'),
          )
          rejectPendingLoad = undefined
          try {
            lease.release()
          } catch (error) {
            failures.push({ error, operation: 'shutdown' })
          }
          throwCleanupFailures(failures)
        },
        // The load resolves from the first subscription result and the subscription stays alive for
        // the connection's lifetime: it serves the SDK's local cache when the device launches
        // offline, and the runtime's own subscribe then reuses the same stream.
        load: () =>
          new Promise<string | undefined>((resolve, reject) => {
            let settled = false
            const unsubscribeFailure = stopActiveQuery()
            rejectPendingLoad?.(new Errors.HostEnvironmentError('The InstantDB connection restarted its load.'))
            rejectPendingLoad = undefined
            if (unsubscribeFailure !== undefined) {
              reject(instantFailure(unsubscribeFailure.operation, unsubscribeFailure.error))
              return
            }
            rejectPendingLoad = error => {
              if (!settled) {
                settled = true
                reject(error)
              }
            }
            try {
              stopQuery = core.subscribeQuery(query as never, (result: SubscriptionResult) => {
                const projected = project(result)
                if (!settled) {
                  settled = true
                  rejectPendingLoad = undefined
                  if ('error' in projected) {
                    reject(instantFailure('load', projected.error))
                    return
                  }
                  lastPublished = projected.snapshot
                  storeView = projected.snapshot
                  resolve(projected.snapshot)
                  return
                }
                if (observer === undefined) {
                  // The runtime subscribes one microtask after load resolves; keep the latest result
                  // from that gap, an error included, so subscribe can replay it.
                  missedResult = projected
                  return
                }
                publish(projected)
              })
            } catch (error) {
              rejectPendingLoad = undefined
              reject(instantFailure('subscription', error))
            }
          }),
        // A row's token is its InstantDB id, which survives a relaunch; within a session it
        // resolves back to the store id the row was created under.
        referenceToken: reference => identities.remote(reference.id),
        resolveReference: reference => identities.local(reference.token),
        save: async (snapshot, intents = [], writeContext) => {
          const operations = rowOperations(
            mapping,
            context.schema,
            writeContext?.previousSnapshot ?? storeView,
            snapshot,
            intents,
            identities,
          )
          nextId = Math.max(nextId, snapshotNextId(snapshot))
          storeView = snapshot
          if (operations.length === 0) {
            return
          }
          try {
            // 'enqueued' is success too: the SDK holds the transaction durably until it reconnects.
            await core.transact(operations.map(operation => chunkOf(sdk, operation)))
          } catch (error) {
            throw saveFailure(error)
          }
        },
        subscribe: next => {
          observer = next
          const replay = missedResult
          missedResult = undefined
          if (replay !== undefined) {
            publish(replay)
          }
          return () => {
            if (observer === next) {
              observer = undefined
            }
          }
        },
      }
    },
  }
}

function chunkOf(sdk: InstantSDK, operation: InstantRowOperation): TransactionChunk {
  const row = sdk.tx[operation.namespace]![operation.id]!
  return Switch.on(operation, 'kind', {
    delete: () => row.delete(),
    link: link => row.link({ [link.label]: link.target }),
    unlink: unlink => row.unlink({ [unlink.label]: unlink.target }),
    update: update => row.update(update.attributes),
  })
}

/**
 * A refusal from the server names its kind (`permission-denied`, `record-not-unique`) so a person
 * can tell a rule from a conflict; the server's own message may echo data and stays in the cause.
 */
function saveFailure(error: unknown): Error {
  if (Errors.isTaoError(error)) {
    return error
  }
  const type = typeof error === 'object' && error !== null
    ? (error as { body?: { type?: unknown } }).body?.type
    : undefined
  const reason = typeof type === 'string' && /^[a-z][a-z-]{0,63}$/.test(type) ? ` (${type})` : ''
  return new Errors.HostEnvironmentError(`InstantDB save failed${reason}.`, { cause: error })
}

function instantFailure(operation: string, error: unknown): Error {
  if (Errors.isTaoError(error)) {
    return error
  }
  return new Errors.HostEnvironmentError(`InstantDB ${operation} failed.`, { cause: error })
}

function throwCleanupFailures(failures: readonly InstantCleanupFailure[]): void {
  if (failures.length === 0) {
    return
  }
  if (failures.length === 1) {
    const [failure] = failures
    throw instantFailure(failure!.operation, failure!.error)
  }
  const operations = failures.map(failure => failure.operation).join(' and ')
  Errors.throwHostEnvironment(`InstantDB cleanup failed during ${operations}.`, { cause: failures })
}

function instantSDK(): InstantSDK {
  return require('@instantdb/react-native') as InstantSDK
}
