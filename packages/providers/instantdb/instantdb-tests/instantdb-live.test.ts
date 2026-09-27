import type TR from '@runtime/TR'
import { Platform } from '@shared'
import { Assert, Errors } from '@shared/core'
import { Describe, Expect, MockModule, Test, until } from '@shared/test'
import { acquireInstantClient, type InstantSDK } from '../instantdb-src/instant-clients'
import { pushInstantSchema } from '../instantdb-src/instant-push'
import { instantRules } from '../instantdb-src/instant-rules'
import { instantMapping } from '../instantdb-src/instant-schema'
import { InstantDBProvider } from '../instantdb-src/InstantDB'
import { notesPolicy, notesSchema, publicNotesSchema } from './fixtures'

// The React Native SDK's two native modules, doubled so it loads under Bun (see `bunInstantSDK`).
MockModule('react-native-get-random-values', () => ({}))
MockModule('@react-native-community/netinfo', () => ({
  default: { addEventListener: () => () => {}, fetch: async () => ({ isConnected: true }) },
}))

// Run explicitly against the machine's local InstantDB (`./agent unsandboxed local-instantdb start`):
// TAO_INSTANT_LIVE_API_URL=http://localhost:9020 ./agent test-file packages/providers/instantdb/instantdb-tests/instantdb-live.test.ts
// Each test makes its own ephemeral app, which the local service expires on its own.
const apiURI = Platform.runtimeProcess.env['TAO_INSTANT_LIVE_API_URL']
const liveTest = apiURI === undefined ? Test['skip'] : Test
const timeout = 120_000

Describe('InstantDB per-row provider against local InstantDB (requires TAO_INSTANT_LIVE_API_URL)', () => {
  liveTest('pushes the generated schema and rules additively and refuses a removal', async () => {
    const app = await ephemeralApp()
    const mapping = instantMapping(publicNotesSchema)
    const generated = { rules: instantRules(mapping), schema: mapping.schema }
    const first = await pushInstantSchema(app.target, generated)
    Expect(first.steps.map(step => [step.purpose, step.endpoint, step.authorization])).toEqual([
      ['plan schema', `${app.apiURI}/superadmin/apps/${app.id}/schema/push/plan`, 'Bearer app admin token'],
      ['apply schema', `${app.apiURI}/superadmin/apps/${app.id}/schema/push/apply`, 'Bearer app admin token'],
      ['apply rules', `${app.apiURI}/superadmin/apps/${app.id}/perms`, 'Bearer app admin token'],
    ])
    Expect(first.changes).toContain('add-attr notes.body')
    Expect(first.changes).toContain('add-attr tags.note')

    const again = await pushInstantSchema(app.target, generated)
    Expect(again.changes).toEqual([])
    Expect(again.steps.map(step => step.purpose)).toEqual(['plan schema', 'apply rules'])

    const narrowed = structuredClone(publicNotesSchema)
    delete (narrowed.entities['Note']!.fields as Record<string, unknown>)['Pinned']
    const narrowedMapping = instantMapping(narrowed)
    const refused = pushInstantSchema(app.target, {
      rules: instantRules(narrowedMapping),
      schema: narrowedMapping.schema,
    })
    await Expect(refused).rejects.toThrow("The app stores 'notes.pinned', which the Tao schema no longer declares.")
  }, timeout)

  liveTest("round-trips rows between two clients, which converge on each other's writes", async () => {
    const app = await ephemeralApp()
    const mapping = instantMapping(publicNotesSchema)
    await pushInstantSchema(app.target, { rules: instantRules(mapping), schema: mapping.schema })
    const alpha = await liveConnection(app, 'primary', publicNotesSchema)
    const beta = await liveConnection(app, 'alternate', publicNotesSchema)
    try {
      Expect(rowsOf(alpha.current(), 'Note')).toEqual([])

      await alpha.commit(rows => {
        rows['Note']!.push({ Body: 'hello', Id: 'Note-1', Pinned: false, Ref: null })
        rows['Tag']!.push({ Id: 'Tag-1', Label: 'first', Note: 'Note-1' })
      })
      const seen = await until(() => {
        const note = rowsOf(beta.current(), 'Note')[0]
        const tag = rowsOf(beta.current(), 'Tag')[0]
        return note !== undefined && tag !== undefined ? { note, tag } : undefined
      }, { description: 'the second client to receive the note and its tag', timeoutMs: 30_000 })
      Expect(seen.note).toMatchObject({ Body: 'hello', Pinned: false, Ref: null })
      Expect(seen.note['Id']).toMatch(/^[0-9a-f-]{36}$/)
      Expect(seen.tag).toMatchObject({ Label: 'first', Note: seen.note['Id'] })

      // The second client edits one field; the first keeps the row under the id it created it with.
      await beta.commit(rows => {
        rows['Note']![0]!['Body'] = 'edited elsewhere'
      })
      await until(() => rowsOf(alpha.current(), 'Note')[0]?.['Body'] === 'edited elsewhere', {
        description: 'the first client to receive the edit',
        timeoutMs: 30_000,
      })
      Expect(rowsOf(alpha.current(), 'Note')).toEqual([
        { Body: 'edited elsewhere', Id: 'Note-1', Pinned: false, Ref: null },
      ])

      // One commit that deletes a tag and then the note it restricts is one transaction.
      await beta.commit(rows => {
        rows['Tag'] = []
        rows['Note'] = []
      })
      await until(() => rowsOf(alpha.current(), 'Note').length === 0 && rowsOf(alpha.current(), 'Tag').length === 0, {
        description: 'the first client to see both rows deleted',
        timeoutMs: 30_000,
      })

      // Restrict is the runtime's check, not the server's: a writer that skips it strands the tag,
      // which the server keeps and every client projects away while its required note is gone.
      await alpha.commit(rows => {
        rows['Note']!.push({ Body: 'second', Id: 'Note-2', Pinned: false, Ref: null })
        rows['Tag']!.push({ Id: 'Tag-2', Label: 'second', Note: 'Note-2' })
      })
      await until(() => rowsOf(beta.current(), 'Tag').length === 1, { description: 'the second tag to arrive' })
      await beta.commit(rows => {
        rows['Note'] = []
      })
      await until(() => rowsOf(alpha.current(), 'Note').length === 0 && rowsOf(alpha.current(), 'Tag').length === 0, {
        description: 'the first client to project the stranded tag away',
        timeoutMs: 30_000,
      })
      Expect((await app.adminQuery('tags')).map(row => row['label'])).toEqual(['second'])
    } finally {
      alpha.close()
      beta.close()
    }
  }, timeout)

  liveTest('owner rules keep each account to its own rows, for reads and writes', async () => {
    const app = await ephemeralApp()
    const mapping = instantMapping(notesSchema)
    const generated = { rules: instantRules(mapping, notesPolicy), schema: mapping.schema }
    await pushInstantSchema(app.target, generated)
    // Restating `$users` for the account link proposes no change to InstantDB's own namespace.
    Expect((await pushInstantSchema(app.target, generated)).changes).toEqual([])
    const alice = await app.user('alice@example.test')
    const bob = await app.user('bob@example.test')
    // Account rows are provisioned by the admin here; a later auth provider creates them on sign-in.
    await app.admin('/admin/transact', {
      steps: [alice, bob].flatMap(user => [
        ['update', 'accounts', user.id, { displayName: user.email }],
        ['link', 'accounts', user.id, { $user: user.id }],
      ]),
    })
    const aliceClient = await liveConnection(app, 'primary', notesSchema, alice.refreshToken)
    const bobClient = await liveConnection(app, 'alternate', notesSchema, bob.refreshToken)
    try {
      Expect(rowsOf(aliceClient.current(), 'Account').map(row => row['Id'])).toEqual([alice.id])
      Expect(rowsOf(bobClient.current(), 'Account').map(row => row['Id'])).toEqual([bob.id])

      await aliceClient.commit(rows => {
        rows['Note']!.push(noteRow('Note-1', 'alice private', alice.id))
      })
      await bobClient.commit(rows => {
        rows['Note']!.push(noteRow('Note-1', 'bob private', bob.id))
      })
      const aliceNote = aliceClient.remoteIdOf('Note', 'Note-1')
      Expect((await app.queryAs(bob.email, 'notes')).map(row => row['body'])).toEqual(['bob private'])
      Expect((await app.queryAs(alice.email, 'notes')).map(row => row['body'])).toEqual(['alice private'])
      await until(() => rowsOf(bobClient.current(), 'Note').length === 1, { description: 'bob to see his note' })
      Expect(rowsOf(bobClient.current(), 'Note').map(row => row['Body'])).toEqual(['bob private'])

      // Bob's client cannot edit, delete, or forge alice's rows even when it names them directly.
      const aliceAccount = { DisplayName: alice.email, Id: alice.id }
      const stolen = noteRow(aliceNote, 'alice private', alice.id)
      const withAlice = (rows: Record<string, Record<string, unknown>[]>) => {
        rows['Account']!.push(aliceAccount)
        rows['Note']!.push(stolen)
      }
      await Expect(bobClient.commit(rows => {
        rows['Note']!.find(row => row['Id'] === aliceNote)!['Body'] = 'stolen'
      }, withAlice)).rejects.toThrow('InstantDB save failed (permission-denied).')
      await Expect(bobClient.commit(rows => {
        rows['Note'] = rows['Note']!.filter(row => row['Id'] !== aliceNote)
      }, withAlice)).rejects.toThrow('InstantDB save failed (permission-denied).')
      await Expect(bobClient.commit(rows => {
        rows['Note']!.push(noteRow('Note-9', 'forged', alice.id))
      }, rows => {
        rows['Account']!.push(aliceAccount)
      })).rejects.toThrow('InstantDB save failed (permission-denied).')

      // Alice may change the fields her grant names, and nothing else.
      await aliceClient.commit(rows => {
        rows['Note']![0]!['Body'] = 'alice edited'
        rows['Note']![0]!['Pinned'] = true
      })
      await Expect(aliceClient.commit(rows => {
        rows['Note']![0]!['Status'] = 'Final'
      })).rejects.toThrow('InstantDB save failed (permission-denied).')
      const unlinked = await app.adminAs(alice.email, '/admin/transact', {
        steps: [['unlink', 'notes', aliceNote, { owner: alice.id }]],
      })
      Expect(unlinked.status).toBe(400)
      Expect((await app.queryAs(alice.email, 'notes')).map(row => [row['body'], row['pinned']])).toEqual([
        ['alice edited', true],
      ])

      // Deleting an account cascades to the notes it owns.
      await app.admin('/admin/transact', { steps: [['delete', 'accounts', alice.id]] })
      Expect((await app.adminQuery('notes')).map(row => row['body'])).toEqual(['bob private'])
    } finally {
      aliceClient.close()
      bobClient.close()
    }
  }, timeout)
})

type Rows = Record<string, Record<string, unknown>[]>

function noteRow(id: string, body: string, owner: string): Record<string, unknown> {
  return { Body: body, CreatedAt: 1, Id: id, Owner: owner, Pinned: false, Status: 'Draft' }
}

function rowsOf(snapshot: string | undefined, entity: string): Record<string, unknown>[] {
  return snapshot === undefined ? [] : (JSON.parse(snapshot) as { rows: Rows }).rows[entity] ?? []
}

/**
 * liveConnection mounts the provider the way the runtime does: load, subscribe, and commit whole
 * snapshots with the consumed snapshot as the baseline. `endpoint` picks a spelling of the local
 * host, because the SDK shares one client per address and two clients need two addresses.
 */
async function liveConnection(
  app: EphemeralApp,
  endpoint: 'alternate' | 'primary',
  schema: TR.DataSchemaDefinition,
  refreshToken?: string,
) {
  const address = endpoint === 'primary' ? app.apiURI : alternateHost(app.apiURI)
  const websocketURI = `${address.replace(/^http/, 'ws')}/runtime/session`
  const sdk = await bunInstantSDK()
  const lease = acquireInstantClient(sdk, { apiURI: address, appId: app.id, websocketURI })
  if (refreshToken !== undefined) {
    await lease.db.core.auth.signInWithToken(refreshToken)
  }
  const connection = InstantDBProvider(() => sdk).connect({
    configuration: { ApiURI: address, AppId: app.id, WebsocketURI: websocketURI },
    schema,
    storageKey: 'Live',
  })
  let current = await connection.load() as string | undefined
  const errors: unknown[] = []
  const stop = connection.subscribe!({
    error: error => errors.push(error),
    snapshot: value => {
      current = value
    },
  })
  return {
    close: () => {
      stop()
      connection.close?.()
      lease.release()
      Expect(errors).toEqual([])
    },
    /**
     * commit edits the current snapshot and saves it. `pretend` first adds rows to the baseline, as
     * a client would that names rows it was never shown; such a commit leaves the view alone.
     */
    commit: async (edit: (rows: Rows) => void, pretend?: (rows: Rows) => void) => {
      const previous = JSON.parse(current ?? emptyEnvelope(schema)) as { nextId: number; rows: Rows }
      pretend?.(previous.rows)
      const next = structuredClone(previous)
      edit(next.rows)
      await connection.save(JSON.stringify(next), [], { previousSnapshot: JSON.stringify(previous) })
      if (pretend === undefined) {
        current = JSON.stringify(next)
      }
    },
    current: () => current,
    remoteIdOf: (entity: string, id: string) => connection.referenceToken!({ entity, id, schema: schema.name }),
  }
}

function emptyEnvelope(schema: TR.DataSchemaDefinition): string {
  return JSON.stringify({
    formatVersion: 1,
    nextId: 1,
    rows: Object.fromEntries(Object.keys(schema.entities).map(entity => [entity, []])),
    schemaVersion: schema.schemaVersion ?? 1,
  })
}

function alternateHost(uri: string): string {
  const url = new URL(uri)
  url.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost'
  return url.origin
}

type EphemeralApp = Awaited<ReturnType<typeof ephemeralApp>>

async function ephemeralApp() {
  const base = new URL(apiURI!).origin
  Assert.input(
    ['localhost', '127.0.0.1'].includes(new URL(base).hostname),
    'The InstantDB live tests run only against a local InstantDB.',
  )
  const created = await fetch(`${base}/dash/apps/ephemeral`, {
    body: JSON.stringify({ title: `Tao InstantDB provider ${Platform.randomUUID()}` }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  Expect(created.status).toBe(200)
  const { app } = await created.json() as { app: { 'admin-token': string; id: string } }
  const token = app['admin-token']
  const call = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      body: JSON.stringify(body),
      headers: {
        'app-id': app.id,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...headers,
      },
      method: 'POST',
    })
  const admin = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    const response = await call(path, body)
    if (!response.ok) {
      Errors.throwHostEnvironment(`InstantDB admin ${path} failed: ${await response.text()}`)
    }
    return await response.json() as Record<string, unknown>
  }
  const rows = (result: Record<string, unknown>, namespace: string) =>
    (result[namespace] ?? []) as Record<string, unknown>[]
  return {
    admin,
    adminAs: (email: string, path: string, body: unknown) => call(path, body, { 'as-email': email }),
    adminQuery: async (namespace: string) =>
      rows(await admin('/admin/query', { query: { [namespace]: {} } }), namespace),
    apiURI: base,
    id: app.id,
    queryAs: async (email: string, namespace: string) => {
      const response = await call('/admin/query', { query: { [namespace]: {} } }, { 'as-email': email })
      Expect(response.status).toBe(200)
      return rows(await response.json() as Record<string, unknown>, namespace)
    },
    target: { apiURI: base, appId: app.id, token },
    user: async (email: string) => {
      const { user } = await admin('/admin/refresh_tokens', { email }) as {
        user: { id: string; refresh_token: string }
      }
      return { email, id: user.id, refreshToken: user.refresh_token }
    },
  }
}

/**
 * The live tests run the React Native SDK itself under Bun. Its two native modules are doubled at
 * the top of this file (random values come from Bun's own `crypto`, and the network always reports
 * online); storage is in memory through the SDK's `Store` option, because Bun resolves the package's
 * browser storage rather than AsyncStorage. The SDK only connects where `window` exists.
 */
async function bunInstantSDK(): Promise<InstantSDK> {
  const native = await import('@instantdb/react-native')
  const host = globalThis as { window?: unknown }
  host.window ??= globalThis
  class MemoryStore extends native.StoreInterface {
    private readonly values = new Map<string, unknown>()
    async getItem(key: string) {
      return this.values.get(key) ?? null
    }
    async removeItem(key: string) {
      this.values.delete(key)
    }
    async multiSet(pairs: Array<[string, unknown]>) {
      for (const [key, value] of pairs) {
        this.values.set(key, value)
      }
    }
    async getAllKeys() {
      return [...this.values.keys()]
    }
  }
  return {
    i: native.i,
    id: native.id,
    init: config => native.init({ ...config, Store: MemoryStore }),
    tx: native.tx,
  }
}
