import type TR from '@runtime/TR'
import { CLI, Errors, FS, Platform, Repo } from '@shared'
import { Expect, mkTestDir } from '@shared/test'
import type { AccountProtocol } from 'tao-shared/auth'
import { type ReferenceHost, ReferenceProvider } from '../../../../apps/stdlib/@tao/data/providers/reference/Reference'
import { AccountServer, type AccountServerOptions } from '../../account-server-src/AccountServer'

const schema: TR.DataSchemaDefinition = {
  name: 'Notes',
  entities: {
    Account: { collection: 'Accounts', fields: { DisplayName: { kind: 'text' } } },
    Note: { collection: 'Notes', fields: { Owner: { kind: 'relation', relation: 'Account' }, Body: { kind: 'text' } } },
  },
}

export async function referenceTest(instant?: AccountServerOptions['instant']) {
  const root = await mkTestDir('tao-reference-provider-', { location: 'host' })
  const server = await AccountServer.start({
    ...(instant === undefined ? {} : { instant }),
    databasePath: FS.resolvePath('accounts.sqlite', root),
    issuer: 'local-reference',
    resource: 'notes',
    policy: {
      accountEntity: 'Account',
      entities: {
        Account: {
          fields: ['DisplayName'],
          grants: [{ principal: [], operations: ['read'] }, {
            principal: [],
            operations: ['update'],
            updateFields: ['DisplayName'],
          }],
        },
        Note: {
          fields: ['Owner', 'Body'],
          relations: { Owner: { entity: 'Account' } },
          grants: [{ principal: ['Owner'], operations: ['read', 'create', 'delete'] }, {
            principal: ['Owner'],
            operations: ['update'],
            updateFields: ['Body'],
          }],
        },
      },
    },
  })
  const checkpointPaths = new Set<string>()
  const connections: TR.DataConnection[] = []
  let nextPoll: (() => void) | undefined
  const test = {
    online: true,
    nativeVault: false,
    storageFailed: false,
    storageLimit: 16 * 1024 * 1024,
    failDataRead: false,
    beforePost: undefined as (() => Promise<void>) | undefined,
    beforeStorage: undefined as (() => Promise<void>) | undefined,
    acquireCheckpoint: undefined as ReferenceHost['acquireCheckpoint'],
    vault: new Map<string, string>(),
    poll() {
      const run = nextPoll
      nextPoll = undefined
      run?.()
    },
    async persisted() {
      return (await Promise.all([...checkpointPaths].map(path => FS.readText(path)))).join('\n')
    },
    async coldProcess(session: AccountProtocol.Session): Promise<{ offline: { state: string }; snapshot: string }> {
      const input = FS.resolvePath('offline-process.json', root)
      const output = FS.resolvePath('offline-process-result.json', root)
      await FS.writeJson(input, {
        accountId: session.accountId,
        configuration: {
          ServerURL: server.url,
          Resource: 'notes',
          Offline: [{ entity: 'Note', field: 'Owner', actor: 'account' }],
        },
        root,
        schema,
        storageKey: JSON.stringify(['notes', session.accountId]),
        vault: Object.fromEntries(test.vault),
      })
      const result = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [
          'run',
          Repo.resolvePath(
            'packages/services/account-server/account-server-tests/fixtures/reference-offline-process.ts',
          ),
          input,
          output,
        ],
        stdio: 'pipe',
      })
      if (result.exitCode !== 0) {
        Errors.throwHostEnvironment(`Offline recovery process failed: ${result.stderr}`)
      }
      return await FS.readJson(output)
    },
    async evict() {
      for (const path of checkpointPaths) {
        await FS.remove(path)
      }
      checkpointPaths.clear()
    },
    async transferNote(id: string, owner: string) {
      await server.seed([{ entity: 'Note', id, fields: { Owner: owner, Body: 'previous server content' } }])
    },
    async signIn(name: string, register = false): Promise<AccountProtocol.Session> {
      const response = await fetch(`${server.url}/v1/auth/${register ? 'sign-up' : 'sign-in'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `${name}@example.test`, password: 'a-good-password', resource: 'notes' }),
      })
      Expect(response.status).toBe(200)
      return await response.json() as AccountProtocol.Session
    },
    async serverRows(session: AccountProtocol.Session): Promise<AccountProtocol.Snapshot> {
      const response = await fetch(`${server.url}/v1/data`, { headers: { authorization: `Bearer ${session.token}` } })
      Expect(response.status).toBe(200)
      return await response.json() as AccountProtocol.Snapshot
    },
    async serverWrite(session: AccountProtocol.Session, operations: AccountProtocol.Operation[]) {
      const response = await fetch(`${server.url}/v1/data/transactions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ operationId: Platform.randomUUID(), operations }),
      })
      Expect(response.status).toBe(200)
    },
    connect(session: AccountProtocol.Session, controller = new AbortController()) {
      const host: ReferenceHost = {
        ...(test.acquireCheckpoint === undefined ? {} : { acquireCheckpoint: test.acquireCheckpoint }),
        operationId: () => Platform.randomUUID(),
        request: async (input, options) => {
          if (!test.online) {
            Errors.throwHostEnvironment('Test network is offline.')
          }
          if (test.failDataRead && String(input).endsWith('/v1/data')) {
            Errors.throwHostEnvironment('Test initial fill is offline.')
          }
          if (options?.method === 'POST') {
            await test.beforePost?.()
          }
          return await fetch(input, options)
        },
        schedule: callback => {
          nextPoll = callback
          return () => {
            if (nextPoll === callback) {
              nextPoll = undefined
            }
          }
        },
        secureStorage: () =>
          test.nativeVault
            ? {
              getItem: key => Promise.resolve(test.vault.get(key) ?? null),
              setItem: (key, value) => {
                test.vault.set(key, value)
                return Promise.resolve()
              },
              removeItem: key => {
                test.vault.delete(key)
                return Promise.resolve()
              },
            }
            : undefined,
        storage: () => ({
          getItem: async key => {
            const path = FS.resolvePath(Platform.sha256Hex(key), root)
            return await FS.isFile(path) ? await FS.readText(path) : null
          },
          setItem: async (key, value) => {
            await test.beforeStorage?.()
            if (test.storageFailed) {
              Errors.throwHostEnvironment('Reference test storage is full.')
            }
            const path = FS.resolvePath(Platform.sha256Hex(key), root)
            await FS.writeText(path, value)
            checkpointPaths.add(path)
          },
        }),
      }
      const connection = ReferenceProvider(host).connect({
        auth: {
          accountId: session.accountId,
          generation: 1,
          signal: controller.signal,
          credential: () => Promise.resolve({ audience: 'notes', value: session.token }),
        },
        configuration: {
          ServerURL: server.url,
          Resource: 'notes',
          StorageLimitBytes: test.storageLimit,
          Offline: [{ entity: 'Note', field: 'Owner', actor: 'account' }],
        },
        schema,
        storageKey: JSON.stringify(['notes', session.accountId]),
      })
      connections.push(connection)
      return connection
    },
    async stop() {
      for (const connection of connections) {
        connection.close?.()
        await connection.invalidateAuth?.()
      }
      await server.stop()
      await FS.remove(root)
    },
  }
  return test
}
