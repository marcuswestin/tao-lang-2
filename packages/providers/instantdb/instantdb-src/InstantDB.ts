import type TR from '@runtime/TR'
import { Assert, Errors, Switch } from '@shared/core'
import {
  acquireInstantClient,
  type InstantClientAddress,
  type InstantClientLease,
  type InstantSDK,
} from './instant-clients'
import {
  instantQuery,
  type InstantQueryResult,
  type InstantRowOperation,
  projectSnapshot,
  RowIdentities,
  rowOperations,
  snapshotNextId,
} from './instant-rows'
import { accountNamespace, accountUserLabel, instantMapping } from './instant-schema'
import { optionalConfigurationText, requiredConfigurationText } from './provider-configuration'

export { InstantAuthProvider } from './InstantAuth'

const providerName = 'InstantDB'

type InstantCore = InstantClientLease['db']['core']
type TransactionChunk = Exclude<Parameters<InstantCore['transact']>[0], readonly unknown[]>
type SubscriptionResult = Readonly<{ data?: InstantQueryResult; error?: unknown }>
type InstantCleanupFailure = Readonly<{ error: unknown; operation: 'shutdown' | 'unsubscribe' }>
/** InstantSession is the value of InstantAuth's `Session` proof. */
type InstantSession = Readonly<{
  apiURI?: string | undefined
  appId: string
  refreshToken: string
  websocketURI?: string | undefined
}>

/**
 * InstantDBProvider stores each Tao entity as an InstantDB namespace, one InstantDB row per Tao
 * row. It subscribes to every namespace of its schema and projects the rows into the store's
 * snapshot; each save becomes one atomic transaction of the rows the commit created, changed,
 * relinked, or deleted. The app's schema and permission rules come from the same mapping and are
 * pushed ahead of time (`pushInstantSchema`), never by a running client.
 *
 * `StorageKey` is still accepted, but namespaces are app-wide: two datasources on one app that
 * declare the same collection share its rows.
 *
 * It accepts InstantAuth's `Session` proof for the same InstantDB address. The account is the
 * InstantDB user: `authenticate` makes sure the shared client is signed in as that user and that
 * the user's `accounts` row exists, creating it on first sign-in, and resolves the account id to
 * the user id. The row starts with no fields, so a Tao account with required fields reads as
 * incomplete until the person completes it.
 */
export function InstantDBProvider(loadSDK: () => InstantSDK = instantSDK): TR.DataProvider {
  return {
    testNetwork: 'remote',
    authenticate: async context => {
      const address = instantAddress({ configuration: context.configuration, schema: context.schema, storageKey: '' })
      const mapping = instantMapping(context.schema)
      Assert.input(
        mapping.entities[mapping.accountEntity] !== undefined,
        `${providerName} signs in to an ${mapping.accountEntity}; declare it in this datasource's data.`,
      )
      const proof = await context.proof('Session', context.signal)
      const session = sessionOf(proof.value)
      if (
        session.appId !== address.appId || session.apiURI !== address.apiURI
        || session.websocketURI !== address.websocketURI
      ) {
        Errors.throwUserInput(
          `Auth ${context.provider} and Datasource ${providerName} name different InstantDB apps. Give both the same AppId, ApiURI, and WebsocketURI.`,
        )
      }
      throwIfCancelled(context.signal)
      let sdk: InstantSDK
      let lease: InstantClientLease
      try {
        sdk = loadSDK()
        lease = acquireInstantClient(sdk, address, mapping.schema)
      } catch (error) {
        throw instantFailure('initialization', error)
      }
      try {
        const core = lease.db.core
        // With one address the auth provider signed this very client in; the token covers a client
        // that has not caught up with it.
        const user = await core.getAuth()
        throwIfCancelled(context.signal)
        if (user?.id !== proof.subject) {
          await signInWithToken(core, session.refreshToken, proof.subject)
          throwIfCancelled(context.signal)
        }
        await ensureAccount(sdk, core, proof.subject, context.signal)
        throwIfCancelled(context.signal)
      } catch (error) {
        lease.release()
        throw error
      }
      return {
        accountId: proof.subject,
        // Signing out of InstantDB is the auth provider's; this drops only the lease taken here.
        release: async () => {
          lease.release()
        },
      }
    },
    connect: context => {
      const address = instantAddress(context)
      const mapping = instantMapping(context.schema)
      let sdk: InstantSDK
      let lease: InstantClientLease
      try {
        sdk = loadSDK()
        lease = acquireInstantClient(sdk, address, mapping.schema)
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
            throw serverFailure('save', error)
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

/** instantAddress reads the address that keys the shared client from the declaration's configuration. */
function instantAddress(context: TR.DataProviderContext): InstantClientAddress {
  return {
    apiURI: optionalConfigurationText(providerName, context, 'ApiURI'),
    appId: requiredConfigurationText(providerName, context, 'AppId'),
    websocketURI: optionalConfigurationText(providerName, context, 'WebsocketURI'),
  }
}

/** sessionOf reads InstantAuth's `Session` proof; any other Session value cannot sign InstantDB in. */
function sessionOf(value: Readonly<Record<string, unknown>>): InstantSession {
  const text = (name: string): boolean => typeof value[name] === 'string' && value[name] !== ''
  const optionalText = (name: string): boolean => value[name] === undefined || text(name)
  Assert.input(
    text('appId') && text('refreshToken') && optionalText('apiURI') && optionalText('websocketURI'),
    `${providerName} accepts Session proofs from InstantAuth only.`,
  )
  return value as InstantSession
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw Errors.abortError('The authentication request was cancelled.')
  }
}

/** signInWithToken signs the shared client in; the server refusing the token means signing in again. */
async function signInWithToken(core: InstantCore, refreshToken: string, subject: string): Promise<void> {
  let user: Readonly<{ id: string }>
  try {
    user = (await core.auth.signInWithToken(refreshToken)).user
  } catch (error) {
    const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined
    if (typeof status === 'number' && status >= 400 && status < 500) {
      Errors.throwUserInput('Sign in again to access account data.', { cause: error })
    }
    throw instantFailure('sign-in', error)
  }
  Assert.input(user.id === subject, 'Sign in again to access account data.')
}

/**
 * ensureAccount makes sure the user's `accounts` row exists, linked to its `$users` row, as the
 * generated rules require of a new account. The existence check reads through the SDK's cache, so a
 * returning user signs in offline. Two devices signing in at once may both find no row; `create`
 * refuses a row that exists, so the device that loses re-reads the server and accepts the winner's.
 */
async function ensureAccount(sdk: InstantSDK, core: InstantCore, id: string, signal: AbortSignal): Promise<void> {
  const query = { [accountNamespace]: { $: { fields: ['id'], where: { id } } } }
  const holds = (data: InstantQueryResult | undefined): boolean =>
    (data?.[accountNamespace] ?? []).some(row => row['id'] === id)
  if (holds(await firstResult(core, query, signal))) {
    return
  }
  const row = sdk.tx[accountNamespace]![id]!
  try {
    await core.transact(row.create({}).link({ [accountUserLabel]: id }))
  } catch (error) {
    let existing: InstantQueryResult | undefined
    try {
      existing = (await core.queryOnce(query as never)).data as InstantQueryResult
    } catch {
      throw serverFailure('account setup', error)
    }
    if (!holds(existing)) {
      throw serverFailure('account setup', error)
    }
  }
}

/** firstResult reads a query's first result, from the SDK's cache when it holds one. */
function firstResult(core: InstantCore, query: object, signal: AbortSignal): Promise<InstantQueryResult | undefined> {
  return new Promise((resolve, reject) => {
    let settled = false
    let stop: (() => void) | undefined
    const settle = (finish: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener('abort', cancel)
      // The callback may run inside `subscribeQuery`, before it has returned its unsubscribe.
      void Promise.resolve().then(() => stop?.())
      finish()
    }
    const cancel = (): void => settle(() => reject(Errors.abortError('The authentication request was cancelled.')))
    signal.addEventListener('abort', cancel, { once: true })
    try {
      stop = core.subscribeQuery(query as never, (result: SubscriptionResult) => {
        settle(() =>
          result.error === undefined ? resolve(result.data) : reject(instantFailure('account lookup', result.error))
        )
      })
    } catch (error) {
      settle(() => reject(instantFailure('account lookup', error)))
    }
  })
}

/**
 * A refusal from the server names its kind (`permission-denied`, `record-not-unique`) so a person
 * can tell a rule from a conflict; the server's own message may echo data and stays in the cause.
 */
function serverFailure(operation: string, error: unknown): Error {
  if (Errors.isTaoError(error)) {
    return error
  }
  const type = typeof error === 'object' && error !== null
    ? (error as { body?: { type?: unknown } }).body?.type
    : undefined
  const reason = typeof type === 'string' && /^[a-z][a-z-]{0,63}$/.test(type) ? ` (${type})` : ''
  return new Errors.HostEnvironmentError(`InstantDB ${operation} failed${reason}.`, { cause: error })
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
