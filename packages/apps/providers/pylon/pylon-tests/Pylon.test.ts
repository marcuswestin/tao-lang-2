import type TR from '@runtime/TR'
import { Errors } from '@shared/core'
import { Describe, Expect, Test } from '@shared/test'
import { type PylonDataClient, PylonProvider } from '../pylon-src/Pylon'
import { pylonOutboxKey } from '../pylon-src/pylon-outbox'

const schema: TR.DataSchemaDefinition = {
  name: 'Notebook',
  entities: {
    Account: { collection: 'Accounts', fields: {} },
    Note: { collection: 'Notes', fields: { Owner: { kind: 'relation', relation: 'Account' }, Body: { kind: 'text' } } },
  },
}
const snapshot = (body: string | null) =>
  JSON.stringify({
    formatVersion: 1,
    schemaVersion: 1,
    nextId: 2,
    rows: { Account: [{ Id: 'alice' }], Note: body === null ? [] : [{ Id: 'n1', Owner: 'alice', Body: body }] },
  })

function fixture() {
  let token: string | null = 'alice-token'
  let serverFailure = false
  let serverStatus: number | undefined
  const rows = new Map<string, Record<string, unknown>[]>([
    ['Account', [{ id: 'alice' }]],
    ['Note', [{ id: 'n1', Owner: 'alice', Body: 'old' }]],
  ])
  const calls: Array<{ name: string; args: unknown }> = []
  const storageValues = new Map<string, string>()
  let listener: (() => void) | undefined
  const client: PylonDataClient = {
    async initialize() {},
    token: () => token,
    sync: () => ({
      async pull() {},
      async fn<T>(name: string, args?: unknown): Promise<T> {
        calls.push({ name, args })
        if (name === 'taoEnsureAccount') {
          return { accountId: 'alice' } as T
        }
        if (serverStatus !== undefined) {
          throw Object.assign(new Errors.HostEnvironmentError('server refused'), { status: serverStatus })
        }
        if (serverFailure) {
          Errors.throwHostEnvironment('network unavailable')
        }
        return { status: 'saved' } as T
      },
      store: {
        list: (entity: string) => rows.get(entity) ?? [],
        subscribe(next: () => void) {
          listener = next
          return () => {
            listener = undefined
          }
        },
      },
    }),
  }
  const storage: TR.KeyValueStorage = {
    getItem: async key => storageValues.get(key) ?? null,
    setItem: async (key, value) => {
      storageValues.set(key, value)
    },
    removeItem: async key => {
      storageValues.delete(key)
    },
  }
  const signal = new AbortController()
  const auth = {
    accountId: 'alice',
    generation: 1,
    signal: signal.signal,
    credential: async () => 'alice-token',
    onInvalidate: (cleanup: () => void | Promise<void>) => {
      invalidate = cleanup
      return () => {
        invalidate = undefined
      }
    },
  }
  let invalidate: (() => void | Promise<void>) | undefined
  const connect = () =>
    PylonProvider(client, storage).connect({
      auth,
      configuration: { BaseURL: 'https://example.test' },
      schema,
      storageKey: 'test',
    })
  return {
    auth,
    calls,
    connect,
    client,
    storageValues,
    signal,
    emit: () => listener?.(),
    invalidate: async () => invalidate?.(),
    setFailure: (value: boolean) => {
      serverFailure = value
    },
    setStatus: (value: number | undefined) => {
      serverStatus = value
    },
    setToken: (value: string | null) => {
      token = value
    },
  }
}

Describe('Pylon datasource', () => {
  Test('uses an injective SecureStore-safe key for each account and schema', () => {
    const key = pylonOutboxKey('https://host.test/a?b=c', 'alice:é.😀', 'Notes / Drafts')
    Expect(/^[A-Za-z0-9._-]+$/.test(key)).toBe(true)
    Expect(key === pylonOutboxKey('https://host.test/a?b=c', 'alice:é.😁', 'Notes / Drafts')).toBe(false)
    Expect(key === pylonOutboxKey('https://host.test/a?b=c', 'alice:é.😀', 'Notes / Drafts  ')).toBe(false)
    Expect(key === pylonOutboxKey('https://host.test/a?b=d', 'alice:é.😀', 'Notes / Drafts')).toBe(false)
  })

  Test('accepts only a matching PylonAuth proof and resolves the server account', async () => {
    const host = fixture()
    const provider = PylonProvider(host.client, { getItem: async () => null, setItem: async () => {} })
    const context = {
      configuration: { BaseURL: 'https://example.test' },
      schema,
      principal: { issuer: 'pylon:test', subject: 'alice' },
      provider: 'PylonAuth',
      signal: new AbortController().signal,
      proof: async () => ({
        kind: 'Session',
        provider: 'PylonAuth',
        subject: 'alice',
        issuer: 'pylon:test',
        value: {
          baseURL: 'https://example.test',
          token: 'alice-token',
        },
      }),
    } as unknown as TR.DataAuthenticationContext
    Expect((await provider.authenticate!(context)).accountId).toBe('alice')
    Expect(host.calls.map(call => call.name)).toEqual(['taoEnsureAccount'])
    await Expect(provider.authenticate!({
      ...context,
      proof: async () => ({
        kind: 'Session',
        provider: 'PylonAuth',
        subject: 'alice',
        issuer: 'pylon:test',
        value: { baseURL: 'https://other.test', token: 'alice-token' },
      }),
    } as unknown as TR.DataAuthenticationContext)).rejects.toThrow('same BaseURL')
  })

  Test('projects rows and submits row operations to the generated function', async () => {
    const host = fixture()
    const connection = host.connect()
    Expect(JSON.parse((await connection.load())!)?.rows.Note[0]).toEqual({ Id: 'n1', Owner: 'alice', Body: 'old' })
    Expect(await connection.submit!(snapshot('new'), [], { previousSnapshot: snapshot('old') })).toEqual({
      status: 'saved',
    })
    Expect((host.calls[0]?.args as { operations: unknown[] }).operations).toEqual([
      { entity: 'Note', id: 'n1', kind: 'update', fields: { Body: 'new' } },
    ])
    Expect(await connection.submit!(snapshot(null), [], { previousSnapshot: snapshot('new') })).toEqual({
      status: 'saved',
    })
    Expect((host.calls[1]?.args as { operations: unknown[] }).operations).toEqual([
      { entity: 'Note', id: 'n1', kind: 'delete' },
    ])
    Expect(await connection.submit!(snapshot('created'), [], { previousSnapshot: snapshot(null) })).toEqual({
      status: 'saved',
    })
    Expect((host.calls[2]?.args as { operations: unknown[] }).operations).toEqual([
      { entity: 'Note', id: 'n1', kind: 'update', fields: { Body: 'created' } },
      { entity: 'Note', id: 'n1', kind: 'link', field: 'Owner', target: 'alice' },
    ])
    connection.close?.()
  })

  Test('durably queues an uncertain send and replays it after a same-account restart', async () => {
    const host = fixture()
    const first = host.connect()
    await first.load()
    host.setFailure(true)
    Expect(await first.submit!(snapshot('new'), [], { previousSnapshot: snapshot('old') })).toEqual({
      status: 'queued',
    })
    Expect(host.storageValues.size).toBe(1)
    first.close?.()
    host.setFailure(false)
    const second = host.connect()
    await second.load()
    await Promise.resolve()
    await Promise.resolve()
    Expect(host.calls.filter(call => call.name === 'taoCommit')).toHaveLength(2)
    Expect(host.storageValues.size).toBe(0)
    second.close?.()
  })

  Test('blocks a token switch and seals encrypted pending writes until the same account returns', async () => {
    const host = fixture()
    const connection = host.connect()
    await connection.load()
    host.setFailure(true)
    await connection.submit!(snapshot('new'), [], { previousSnapshot: snapshot('old') })
    host.setToken('bob-token')
    await Expect(connection.load()).rejects.toThrow('session changed')
    await host.invalidate()
    Expect(host.storageValues.size).toBe(1)
    connection.close?.()
    host.setToken('alice-token')
    host.setFailure(false)
    const restored = host.connect()
    await restored.load()
    Expect(host.storageValues.size).toBe(0)
    restored.close?.()
  })

  Test('retains a 401 write for a newly verified session of the same account', async () => {
    const host = fixture()
    const connection = host.connect()
    await connection.load()
    host.setStatus(401)
    await Expect(connection.submit!(snapshot('new'), [], { previousSnapshot: snapshot('old') })).rejects.toThrow(
      'server refused',
    )
    Expect(host.storageValues.size).toBe(1)
    connection.close?.()
    host.setStatus(undefined)
    const resumed = host.connect()
    await resumed.load()
    Expect(host.storageValues.size).toBe(0)
    Expect(host.calls.filter(call => call.name === 'taoCommit')).toHaveLength(2)
    resumed.close?.()
  })
})
