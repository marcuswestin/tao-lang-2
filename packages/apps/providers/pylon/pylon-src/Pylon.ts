import TR from '@runtime/TR'
import { Assert, Errors } from '@shared/core'
import { nativePylonOutboxStorage, PylonOutbox, pylonOutboxKey } from './pylon-outbox'
import { nativePylonClient, type NativeSDK, nativeSDK, pylonBaseURL } from './PylonAuth'

type Engine = ReturnType<NativeSDK['getSync']>
export type PylonDataClient = Readonly<{
  initialize(baseURL: string): Promise<void>
  token(): string | null
  sync(): Engine
}>

const nativeClient: PylonDataClient = {
  initialize: (baseURL: string) => nativePylonClient.initialize(baseURL),
  token: () => nativePylonClient.token(),
  sync: () => nativeSDK().getSync(),
}

/** Row-based Pylon datasource. The generated backend checks all write grants in its transaction. */
export function PylonProvider(
  client: PylonDataClient = nativeClient,
  storage: TR.KeyValueStorage = nativePylonOutboxStorage(),
): TR.DataProvider {
  return {
    testNetwork: 'remote',
    authenticate: async context => {
      Assert.input(context.provider === 'PylonAuth', 'Pylon accepts Session proofs from PylonAuth.')
      const baseURL = pylonBaseURL(context.configuration)
      const proof = await context.proof('Session', context.signal)
      const value = proof.value as Readonly<Record<string, unknown>>
      Assert.input(
        value['baseURL'] === baseURL && typeof value['token'] === 'string' && value['token'] !== '',
        'PylonAuth and Pylon must use the same BaseURL.',
      )
      await client.initialize(baseURL)
      Assert.input(client.token() === value['token'], 'Sign in again to access account data.')
      let account: { accountId: string }
      try {
        account = await client.sync().fn<{ accountId: string }>('taoEnsureAccount')
      } catch (error) {
        throw failure('account lookup', error)
      }
      Assert.input(account.accountId === proof.subject, 'Pylon account does not match the signed-in session.')
      return { accountId: account.accountId, credential: async () => value['token'] as string }
    },
    connect: context => {
      const baseURL = pylonBaseURL(context.configuration)
      Assert.input(context.auth !== undefined, 'Pylon requires an authenticated account.')
      const auth = context.auth
      const outbox = new PylonOutbox(
        storage,
        pylonOutboxKey(baseURL, auth.accountId, context.schema.name),
        auth.accountId,
      )
      let closed = false
      let sync: Engine | undefined
      let stopStore: (() => void) | undefined
      let observer: TR.DataConnectionObserver | undefined
      let view: string | undefined
      let nextId = 1
      let verifiedToken: string | undefined
      let retryTimer: ReturnType<typeof setTimeout> | undefined
      let draining: Promise<boolean> | undefined

      async function invalidate(): Promise<void> {
        closed = true
        verifiedToken = undefined
        observer = undefined
        stopStore?.()
        stopStore = undefined
        if (retryTimer) {
          clearTimeout(retryTimer)
        }
        await outbox.invalidate()
      }
      const stopInvalidation = auth.onInvalidate?.(invalidate)

      const ensure = async (): Promise<Engine> => {
        if (closed || auth.signal.aborted) {
          throw Errors.abortError('Account data access ended.')
        }
        await client.initialize(baseURL)
        const credential = await auth.credential(auth.signal)
        Assert.input(
          credential !== '' && client.token() === credential,
          'Pylon session changed. Sign in again to access account data.',
        )
        verifiedToken = credential
        sync ??= client.sync()
        return sync
      }
      const project = (engine: Engine): string => {
        if (closed || auth.signal.aborted || !verifiedToken || client.token() !== verifiedToken) {
          throw Errors.abortError('Account data access ended.')
        }
        const rows = Object.fromEntries(
          Object.entries(context.schema.entities).map(([entity, definition]) => [
            entity,
            engine.store.list(entity).map(remote => ({
              Id: remote['id'],
              ...Object.fromEntries(Object.keys(definition.fields).map(field => [field, remote[field] ?? null])),
            })),
          ]),
        )
        return JSON.stringify({ formatVersion: 1, schemaVersion: context.schema.schemaVersion ?? 1, nextId, rows })
      }
      const publish = (): void => {
        if (closed || !sync) {
          return
        }
        void ensure().then(() => {
          const snapshot = project(sync!)
          if (snapshot !== view) {
            view = snapshot
            observer?.snapshot(snapshot)
          }
        }).catch(error => observer?.error(failure('subscription', error)))
      }
      const scheduleRetry = (): void => {
        if (retryTimer || closed) {
          return
        }
        retryTimer = setTimeout(() => {
          retryTimer = undefined
          void drain().catch(error => observer?.error(error))
        }, 5_000)
      }
      const drain = (): Promise<boolean> => {
        draining ??= (async () => {
          const engine = await ensure()
          for (const pending of await outbox.list()) {
            if (closed || auth.signal.aborted) {
              return false
            }
            try {
              await engine.fn('taoCommit', pending)
              await outbox.acknowledge(pending.id)
            } catch (error) {
              const status = typeof error === 'object' && error !== null
                ? (error as { status?: unknown }).status
                : undefined
              if (status === 401) {
                // Keep the encrypted write for this account; a later verified session may replay it.
                throw failure('session expired', error)
              }
              if (typeof status === 'number' && status >= 400 && status < 500) {
                await outbox.acknowledge(pending.id)
                throw failure('save', error)
              }
              scheduleRetry()
              return false
            }
          }
          return true
        })().finally(() => {
          draining = undefined
        })
        return draining
      }
      const write = async (
        snapshot: string,
        intents: readonly TR.DataWriteIntent[],
        previous?: string,
      ): Promise<'saved' | 'queued'> => {
        await ensure()
        const operations = TR.DataRows.rowOperations(context.schema, previous ?? view, snapshot, intents)
        const value = JSON.parse(snapshot) as { nextId?: number }
        nextId = Math.max(nextId, value.nextId ?? 1)
        if (operations.length === 0) {
          view = snapshot
          return 'saved'
        }
        try {
          const id = `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
          await outbox.enqueue({ id, operations })
          view = snapshot
          return await drain() ? 'saved' : 'queued'
        } catch (error) {
          throw failure('save', error)
        }
      }
      return {
        async load() {
          const engine = await ensure()
          // The 0.20 native client starts asynchronously. A pull is the online initial boundary.
          try {
            await engine.pull()
          } catch (error) {
            throw failure('load', error)
          }
          await ensure()
          if (closed) {
            return undefined
          }
          const snapshot = project(engine)
          view = snapshot
          stopStore?.()
          stopStore = engine.store.subscribe(publish)
          await drain().catch(error => {
            observer?.error(error)
            return false
          })
          return snapshot
        },
        save: async (snapshot, intents = [], writeContext) => {
          await write(snapshot, intents, writeContext?.previousSnapshot)
        },
        submit: async (snapshot, intents = [], writeContext) => {
          return { status: await write(snapshot, intents, writeContext?.previousSnapshot) }
        },
        subscribe(next) {
          observer = next
          return () => {
            if (observer === next) {
              observer = undefined
            }
          }
        },
        referenceToken: reference => reference.id,
        resolveReference: reference => reference.token,
        close() {
          closed = true
          stopInvalidation?.()
          if (retryTimer) {
            clearTimeout(retryTimer)
          }
          stopStore?.()
          stopStore = undefined
          observer = undefined
        },
        invalidateAuth: invalidate,
      }
    },
  }
}

function failure(operation: string, error: unknown): Error {
  if (Errors.isTaoError(error)) {
    return error
  }
  return new Errors.HostEnvironmentError(`Pylon ${operation} failed.`, { cause: error })
}
