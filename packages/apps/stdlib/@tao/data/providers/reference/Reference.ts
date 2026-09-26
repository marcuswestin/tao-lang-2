import TR from '@runtime/TR'
import type { AccountProtocol } from '@shared/auth/AuthProtocol'
import { Assert, Errors, Time } from '@shared/core'
import { acquireBrowserCheckpoint, joinReferenceCheckpoint } from './ReferenceCoordinator'
import {
  parseReferenceEnvelope,
  projectReferenceWrites,
  type ReferenceCheckpoint,
  referenceEnvelope,
  referenceOfflineScopes,
  referenceOperations,
  type ReferencePending,
  retainReferenceWorkingSet,
} from './ReferenceState'

/** ReferenceHost injects platform storage, transport, and scheduling; server authority stays real. */
export type ReferenceHost = {
  acquireCheckpoint?(identity: string): Promise<() => void>
  request(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): ReturnType<typeof fetch>
  operationId(): string
  schedule(callback: () => void, milliseconds: number): () => void
  storage(): TR.KeyValueStorage
  secureStorage(): {
    getItem(key: string): Promise<string | null>
    setItem(key: string, value: string): Promise<void>
    removeItem(key: string): Promise<void>
  } | undefined
}

type WriteContext = { previousSnapshot: string }

/** ReferenceProvider durably records explicit authenticated operations before offering them online. */
export function ReferenceProvider(host: ReferenceHost = nativeHost()): TR.DataProvider {
  return {
    authenticatedAuthority: 'server',
    testNetwork: 'remote',
    testWriteRecovery: true,
    connect: context => {
      const auth = context.auth
      Assert.input(auth, 'The Reference datasource requires an authenticated app.')
      const serverURL = textConfiguration(context.configuration, 'ServerURL').replace(/\/$/, '')
      const resource = textConfiguration(context.configuration, 'Resource')
      const scopes = referenceOfflineScopes(context.configuration['Offline'], context.schema)
      // A changed field/relation layout invalidates offline readiness even when an author has
      // not explicitly changed SchemaVersion. Runtime-only functions are absent from JSON.
      const coverage = JSON.stringify([context.schema, scopes])
      const storageLimit = context.configuration['StorageLimitBytes'] ?? 16 * 1024 * 1024
      Assert.input(
        typeof storageLimit === 'number' && Number.isSafeInteger(storageLimit) && storageLimit > 0,
        'Reference StorageLimitBytes must be a positive integer.',
      )
      const pollEvery = context.configuration['PollEvery']
      const pollMilliseconds = typeof pollEvery === 'number' ? pollEvery / Time.NANOSECONDS_PER_MILLISECOND : 1_000
      Assert.input(pollMilliseconds > 0, 'Reference PollEvery must be greater than zero.')
      const identity = JSON.stringify([serverURL, resource, context.storageKey, auth.accountId])
      const checkpointKey = `tao-reference:${identity}`
      const secretKey = `tao.reference.${
        Array.from(identity).map(character => character.charCodeAt(0).toString(16).padStart(4, '0')).join('')
      }`
      const storage = host.storage()
      const vault = host.secureStorage()
      const abort = new AbortController()
      const writeListeners = new Set<() => void>()
      const coverageListeners = new Set<() => void>()
      let offlineState: { state: 'loading' | 'ready' | 'unavailable'; reason?: string; revision?: number } = {
        state: 'loading',
      }
      let closed = false
      let key: string | undefined
      let observer: TR.DataConnectionObserver | undefined
      let stopPoll: (() => void) | undefined
      let uploading: Promise<void> | undefined
      let invalidation: Promise<void> | undefined
      const coordinator = joinReferenceCheckpoint(identity, JSON.stringify([coverage, storageLimit]), () => {
        if (closed || auth.signal.aborted || key === undefined) {
          return
        }
        announceWrites()
        if (state.checkpoint !== undefined) {
          setCoverage(
            state.checkpoint.complete
              ? { state: 'ready', revision: state.checkpoint.revision }
              : { state: 'unavailable', reason: 'No complete declared working set is retained.' },
          )
          observer?.snapshot(projected())
        }
      }, host.acquireCheckpoint)
      const state = coordinator.state

      const assertOpen = (): void => {
        if (closed || auth.signal.aborted) {
          throw Errors.abortError('The account datasource connection was closed.')
        }
      }
      const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
        return coordinator.run(async () => {
          assertOpen()
          return run()
        })
      }
      const announceWrites = (): void => {
        for (const listener of writeListeners) {
          listener()
        }
      }
      const setCoverage = (state: typeof offlineState): void => {
        offlineState = state.state === 'ready' && vault === undefined
          ? { ...state, reason: 'Browser restart requires online authentication before offline data recovery.' }
          : state
        for (const listener of coverageListeners) {
          listener()
        }
      }
      const close = (): void => {
        if (closed) {
          return
        }
        closed = true
        observer = undefined
        writeListeners.clear()
        setCoverage({ state: 'unavailable', reason: 'The account connection is closed.' })
        coverageListeners.clear()
        stopPoll?.()
        stopPoll = undefined
        abort.abort()
        key = undefined
        coordinator.close()
      }
      const invalidateAuth = (): Promise<void> => {
        if (invalidation !== undefined) {
          return invalidation
        }
        close()
        auth.signal.removeEventListener('abort', onAuthAbort)
        // Work already in flight may finish an encrypted checkpoint or secure-key write. Delete
        // the accessible key after it drains, so a late callback cannot restore a logged-out key.
        invalidation = coordinator.invalidate(async () => {
          await vault?.removeItem(secretKey)
        })
        return invalidation
      }
      const onAuthAbort = (): void => {
        void invalidateAuth().catch(() => {})
      }
      auth.signal.addEventListener('abort', onAuthAbort, { once: true })

      const request = async <T>(path: string, transaction?: AccountProtocol.Transaction): Promise<T> => {
        assertOpen()
        const credential = await auth.credential(resource)
        assertOpen()
        Assert.input(credential.audience === resource, 'The auth provider returned a credential for another resource.')
        let response: Response
        try {
          response = await host.request(`${serverURL}/v1${path}`, {
            body: transaction === undefined ? undefined : JSON.stringify(transaction),
            headers: { Authorization: `Bearer ${credential.value}`, 'Content-Type': 'application/json' },
            method: transaction === undefined ? 'GET' : 'POST',
            // React Native declares a narrower ambient AbortSignal; fetch accepts the same host signal.
            signal: abort.signal as NonNullable<Parameters<typeof fetch>[1]>['signal'],
          })
        } catch (error) {
          assertOpen()
          Errors.throwHostEnvironment('The account server is offline.', {
            cause: error,
            details: { referenceOffline: true },
          })
        }
        assertOpen()
        if (!response.ok) {
          if ([400, 401, 403, 409].includes(response.status)) {
            Errors.throwUserInput(
              response.status === 409
                ? 'The account server rejected a conflicting operation.'
                : 'The account server did not authorize this operation.',
              { referenceStatus: response.status },
            )
          }
          Errors.throwHostEnvironment('The account server could not complete the request.', {
            details: { referenceOffline: true },
          })
        }
        const result = await response.json() as T
        assertOpen()
        return result
      }

      const ensureKey = async (): Promise<void> => {
        if (key !== undefined) {
          return
        }
        const stored = await vault?.getItem(secretKey)
        assertOpen()
        if (stored !== undefined && stored !== null) {
          Assert.input(/^[a-f0-9]{64}$/.test(stored), 'The account encryption key is invalid.')
          key = stored
          return
        }
        const issued = await request<AccountProtocol.DataKey>('/auth/data-key')
        Assert.input(
          issued.accountId === auth.accountId && issued.resource === resource && /^[a-f0-9]{64}$/.test(issued.key),
          'The account server returned a key for another account or resource.',
        )
        key = issued.key
        await vault?.setItem(secretKey, key)
        assertOpen()
      }
      const persist = async (next: ReferenceCheckpoint): Promise<void> => {
        assertOpen()
        Assert.defined(key, 'reference storage has an authenticated encryption key')
        const sealed = TR.Auth.Seal(key, JSON.stringify(next), identity)
        // The encrypted envelope is ASCII (JSON/base64), so its length is its stored byte count.
        if (sealed.length > storageLimit) {
          setCoverage({ state: 'unavailable', reason: 'The declared working set exceeds its storage limit.' })
          Errors.throwHostEnvironment('The declared working set exceeds Reference StorageLimitBytes.')
        }
        try {
          await storage.setItem(checkpointKey, sealed)
        } catch (error) {
          setCoverage({ state: 'unavailable', reason: 'The account checkpoint could not be persisted.' })
          throw error
        }
        state.checkpoint = next
        coordinator.changed()
        assertOpen()
        setCoverage(
          next.complete
            ? { state: 'ready', revision: next.revision }
            : { state: 'unavailable', reason: 'No complete declared working set is retained.' },
        )
      }
      const projected = (): string => {
        Assert.defined(state.checkpoint, 'reference checkpoint has loaded')
        return JSON.stringify(
          projectReferenceWrites(
            state.liveSnapshot ?? state.checkpoint.snapshot,
            state.checkpoint.pending.filter(item => item.optimistic !== false),
          ),
        )
      }
      const restore = async (): Promise<void> => {
        await ensureKey()
        const stored = await storage.getItem(checkpointKey)
        assertOpen()
        if (stored === null) {
          state.checkpoint = undefined
          state.liveSnapshot = undefined
          setCoverage({ state: 'unavailable', reason: 'The persisted account checkpoint is missing.' })
          return
        }
        Assert.defined(key, 'reference storage has an authenticated encryption key')
        const restored = JSON.parse(TR.Auth.Open(key, stored, identity)) as ReferenceCheckpoint
        Assert.input(
          restored.formatVersion === 1 && restored.accountId === auth.accountId && Array.isArray(restored.pending),
          'The account checkpoint is invalid.',
        )
        parseReferenceEnvelope(JSON.stringify(restored.snapshot))
        if (restored.coverage !== coverage) {
          restored.complete = false
          restored.snapshot = retainReferenceWorkingSet(restored.snapshot, scopes, auth.accountId)
        }
        state.checkpoint = restored
        setCoverage(
          restored.complete
            ? { state: 'ready', revision: restored.revision }
            : { state: 'unavailable', reason: 'The retained working set does not match this declaration.' },
        )
      }
      const readRemote = async (): Promise<AccountProtocol.Snapshot> => {
        const snapshot = await request<AccountProtocol.Snapshot>('/data')
        Assert.input(
          Number.isSafeInteger(snapshot.revision) && Array.isArray(snapshot.rows),
          'The account server returned invalid data.',
        )
        return snapshot
      }
      const acceptRemote = async (snapshot: AccountProtocol.Snapshot): Promise<void> => {
        if (state.checkpoint !== undefined && snapshot.revision < state.checkpoint.revision) {
          return
        }
        const completeSnapshot = referenceEnvelope(snapshot, context.schema)
        state.liveSnapshot = completeSnapshot
        await persist({
          accountId: auth.accountId,
          complete: scopes.length > 0,
          coverage,
          formatVersion: 1,
          pending: state.checkpoint?.pending ?? [],
          revision: snapshot.revision,
          snapshot: retainReferenceWorkingSet(completeSnapshot, scopes, auth.accountId),
        })
      }
      const recordFailure = async (operationId: string, error: unknown): Promise<void> => {
        await enqueue(async () => {
          if (state.checkpoint === undefined) {
            return
          }
          const next = structuredClone(state.checkpoint)
          const pending = next.pending.find(item => item.transaction.operationId === operationId)
          if (pending === undefined) {
            return
          }
          const status = Errors.isTaoError(error) ? error.details?.['referenceStatus'] : undefined
          pending.failure = {
            message: Errors.formatForUser(error),
            permanent: status === 400 || status === 401 || status === 403 || status === 409,
          }
          await persist(next)
        })
      }
      const upload = (): Promise<void> => {
        if (uploading !== undefined) {
          return uploading
        }
        uploading = (async () => {
          while (!closed) {
            const pending = await enqueue(async () =>
              state.checkpoint?.pending.find(item => item.failure?.permanent !== true)
            )
            if (pending === undefined) {
              return
            }
            try {
              const receipt = await request<AccountProtocol.Receipt>('/data/transactions', pending.transaction)
              Assert.input(
                receipt.status === 'saved' && receipt.operationId === pending.transaction.operationId
                  && Number.isSafeInteger(receipt.revision),
                'The account server returned an invalid acknowledgement.',
              )
              await enqueue(async () => {
                Assert.defined(state.checkpoint, 'a saved reference operation has a checkpoint')
                if (!state.checkpoint.pending.some(item => item.transaction.operationId === receipt.operationId)) {
                  return
                }
                const next = structuredClone(state.checkpoint)
                // Apply the acknowledged operation to the base before removing its overlay. A
                // failed refresh cannot otherwise make successfully saved content disappear.
                next.snapshot = projectReferenceWrites(next.snapshot, [pending])
                next.snapshot = retainReferenceWorkingSet(next.snapshot, scopes, auth.accountId)
                next.pending = next.pending.filter(item => item.transaction.operationId !== receipt.operationId)
                next.revision = Math.max(next.revision, receipt.revision)
                if (state.liveSnapshot !== undefined) {
                  state.liveSnapshot = projectReferenceWrites(state.liveSnapshot, [pending])
                }
                await persist(next)
              })
            } catch (error) {
              if (closed) {
                return
              }
              await recordFailure(pending.transaction.operationId, error)
              return
            }
          }
        })().finally(() => {
          uploading = undefined
        })
        return uploading
      }
      const report = (error: unknown): void => {
        if (!closed) {
          observer?.error(error)
        }
      }
      const refresh = async (): Promise<void> => {
        await upload()
        const snapshot = await readRemote()
        await enqueue(async () => {
          await acceptRemote(snapshot)
          observer?.snapshot(projected())
        })
      }
      const schedulePoll = (): void => {
        if (closed || observer === undefined) {
          return
        }
        stopPoll = host.schedule(() => {
          stopPoll = undefined
          void refresh().catch(report).finally(schedulePoll)
        }, pollMilliseconds)
      }
      const append = async (
        serialized: string,
        intents: readonly { entity: string; fields: readonly string[]; id: string }[],
        written: WriteContext | undefined,
        optimistic: boolean,
      ): Promise<string | undefined> => {
        Assert.defined(state.checkpoint, 'reference data must finish loading before writes')
        Assert.input(written !== undefined, 'Reference writes require the runtime authoring baseline.')
        const operations = referenceOperations(
          parseReferenceEnvelope(written.previousSnapshot),
          parseReferenceEnvelope(serialized),
          intents,
        )
        if (operations.length === 0) {
          return undefined
        }
        const operationId = host.operationId()
        const next = structuredClone(state.checkpoint)
        next.pending.push({ optimistic, transaction: { operationId, operations } })
        await persist(next)
        return operationId
      }

      return {
        close,
        invalidateAuth,
        load: () =>
          enqueue(async () => {
            setCoverage({ state: 'loading' })
            try {
              await restore()
              try {
                await acceptRemote(await readRemote())
              } catch (error) {
                if (
                  !Errors.isTaoError(error) || error.details?.['referenceOffline'] !== true
                  || state.checkpoint?.complete !== true
                ) {
                  throw error
                }
              }
              assertOpen()
              const snapshot = projected()
              void upload().catch(report)
              return snapshot
            } catch (error) {
              setCoverage({
                state: 'unavailable',
                reason: 'The declared working set is not available from durable storage.',
              })
              throw error
            }
          }),
        referenceToken: reference => reference.id,
        resolveReference: reference => reference.token,
        save: (serialized, intents = [], written?: WriteContext) =>
          enqueue(async () => {
            await append(serialized, intents, written, true)
            void upload().catch(report)
          }),
        submit: async (
          serialized: string,
          intents: readonly { entity: string; fields: readonly string[]; id: string }[] = [],
          written?: WriteContext,
        ) => {
          const operationId = await enqueue(() => append(serialized, intents, written, false))
          if (operationId === undefined) {
            return { status: 'saved' as const }
          }
          await upload()
          return await enqueue(async () => {
            const pending = state.checkpoint?.pending.find(item => item.transaction.operationId === operationId)
            if (pending?.failure?.permanent) {
              Errors.throwUserInput(pending.failure.message)
            }
            return { status: pending === undefined ? 'saved' as const : 'queued' as const }
          })
        },
        subscribe: next => {
          observer = next
          stopPoll?.()
          schedulePoll()
          return () => {
            if (observer === next) {
              observer = undefined
              stopPoll?.()
              stopPoll = undefined
            }
          }
        },
        writes: {
          retry: (entity, id) => {
            if (closed) {
              return
            }
            void enqueue(async () => {
              Assert.defined(state.checkpoint, 'reference checkpoint has loaded')
              const next = structuredClone(state.checkpoint)
              for (const item of next.pending) {
                if (item.transaction.operations.some(operation => operation.entity === entity && operation.id === id)) {
                  delete item.failure
                }
              }
              await persist(next)
            }).then(upload).catch(report)
          },
          status: (entity, id) => {
            if (closed) {
              return { failed: 0, queued: 0, records: [] }
            }
            const selected: ReferencePending[] =
              state.checkpoint?.pending.filter(item =>
                item.transaction.operations.some(operation => operation.entity === entity && operation.id === id)
              ) ?? []
            return {
              failed: selected.filter(item => item.failure !== undefined).length,
              queued: selected.filter(item => item.failure === undefined).length,
              records: selected.map(item => ({
                id: item.transaction.operationId,
                ...(item.failure === undefined ? {} : { message: item.failure.message }),
                recovery: structuredClone(item.transaction.operations.map(operation => ({
                  entity: operation.entity,
                  id: operation.id,
                  operation: operation.kind,
                  ...('fields' in operation ? { fields: operation.fields } : {}),
                }))),
              })),
            }
          },
          subscribe: listener => {
            writeListeners.add(listener)
            return () => {
              writeListeners.delete(listener)
            }
          },
        },
        offline: {
          status: () => ({ ...offlineState }),
          subscribe: (listener: () => void) => {
            coverageListeners.add(listener)
            return () => {
              coverageListeners.delete(listener)
            }
          },
        },
      }
    },
  }
}

function textConfiguration(configuration: Readonly<Record<string, unknown>>, name: string): string {
  const value = configuration[name]
  Assert.input(typeof value === 'string' && value.trim().length > 0, `Reference requires '${name}'.`)
  return value.trim()
}

function nativeHost(): ReferenceHost {
  return {
    ...('document' in globalThis || 'WorkerGlobalScope' in globalThis
      ? { acquireCheckpoint: acquireBrowserCheckpoint }
      : {}),
    operationId: () => TR.Auth.OperationId(),
    request: fetch,
    schedule: (callback, milliseconds) => {
      const timer = setTimeout(callback, milliseconds)
      return () => clearTimeout(timer)
    },
    secureStorage: () => TR.Auth.SecureStorage(),
    storage: () => {
      const loaded = require('@react-native-async-storage/async-storage') as TR.KeyValueStorage | {
        default: TR.KeyValueStorage
      }
      return 'default' in loaded ? loaded.default : loaded
    },
  }
}
