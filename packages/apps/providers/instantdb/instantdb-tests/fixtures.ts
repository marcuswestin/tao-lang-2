import type TR from '@runtime/TR'
import { Platform } from '@shared'
import { Assert, Errors } from '@shared/core'
import { Expect } from '@shared/test'
import type { InstantSDK } from '../instantdb-src/instant-clients'
import type { TaoDataPolicy } from '../instantdb-src/instant-rules'

/** notesSchema is a compiled Tao schema: accounts own notes (cascade); tags restrict their note. */
export const notesSchema: TR.DataSchemaDefinition = {
  entities: {
    Account: {
      collection: 'Accounts',
      fields: { DisplayName: { kind: 'text', optional: true } },
      grants: [
        { operations: ['read'], principal: [] },
        { operations: ['update'], principal: [], updateFields: ['DisplayName'] },
      ],
      inverseFields: { Notes: { inverseField: 'Owner', relation: 'Note' } },
    },
    Note: {
      collection: 'Notes',
      fields: {
        Body: { kind: 'text' },
        CreatedAt: { defaultNow: true, indexed: true, kind: 'time' },
        Owner: { kind: 'relation', onDelete: 'cascade', relation: 'Account' },
        Pinned: { defaultValue: false, kind: 'boolean' },
        Status: { cases: ['Draft', 'Final'], kind: 'enum' },
      },
      grants: [
        { operations: ['read'], principal: ['Owner'] },
        { operations: ['create'], principal: ['Owner'] },
        { operations: ['update'], principal: ['Owner'], updateFields: ['Body', 'Pinned'] },
        { operations: ['delete'], principal: ['Owner'] },
      ],
      inverseFields: { Tags: { inverseField: 'Note', relation: 'Tag' } },
    },
    Tag: {
      collection: 'Tags',
      fields: {
        Label: { kind: 'text', unique: true },
        Note: { kind: 'relation', optional: true, relation: 'Note' },
      },
      grants: [
        { operations: ['read', 'create', 'delete'], principal: ['Note', 'Owner'] },
        { operations: ['update'], principal: ['Note', 'Owner'], updateFields: ['Label'] },
      ],
    },
  },
  name: 'InstantNotes',
  schemaVersion: 1,
}

/** notesPolicy is the compiler's `TaoDataPolicy.json` for `notesSchema`. */
export const notesPolicy: TaoDataPolicy = {
  accountEntity: 'Account',
  entities: Object.fromEntries(
    Object.entries(notesSchema.entities).map(([name, entity]) => [name, { grants: entity.grants ?? [] }]),
  ),
}

/** publicNotesSchema is `notesSchema` without an account: the unauthenticated shape. */
export const publicNotesSchema: TR.DataSchemaDefinition = {
  entities: {
    Note: {
      collection: 'Notes',
      fields: {
        Body: { kind: 'text' },
        Pinned: { defaultValue: false, kind: 'boolean' },
        Ref: { kind: 'reference', optional: true, referenceField: 'Code', relation: 'Elsewhere' },
      },
      inverseFields: { Tags: { inverseField: 'Note', relation: 'Tag' } },
    },
    Tag: {
      collection: 'Tags',
      fields: {
        Label: { kind: 'text' },
        Note: { kind: 'relation', relation: 'Note' },
      },
    },
  },
  name: 'InstantPublicNotes',
  schemaVersion: 1,
}

/** EphemeralApp is a fresh app on the local InstantDB, with admin access to it. */
export type EphemeralApp = Awaited<ReturnType<typeof ephemeralApp>>

/**
 * ephemeralApp creates an app on the local InstantDB at `apiURI`, which the service expires on its
 * own. Only a local server is accepted: the admin calls here would otherwise reach a real app.
 */
export async function ephemeralApp(apiURI: string, title: string) {
  const base = new URL(apiURI).origin
  Assert.input(
    ['localhost', '127.0.0.1'].includes(new URL(base).hostname),
    'The InstantDB live tests run only against a local InstantDB.',
  )
  const created = await fetch(`${base}/dash/apps/ephemeral`, {
    body: JSON.stringify({ title: `${title} ${Platform.randomUUID()}` }),
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
    adminQuery: async (namespace: string, query: Record<string, unknown> = {}) =>
      rows(await admin('/admin/query', { query: { [namespace]: query } }), namespace),
    apiURI: base,
    id: app.id,
    /** magicCode mints the code the local server would have emailed; it sends no email itself. */
    magicCode: async (email: string) => {
      const { code } = await admin('/admin/magic_code', { email }) as { code: string }
      return code
    },
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
    verifyRefreshToken: async (refreshToken: string) => {
      const response = await fetch(`${base}/runtime/auth/verify_refresh_token`, {
        body: JSON.stringify({ 'app-id': app.id, 'refresh-token': refreshToken }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok) {
        Errors.throwHostEnvironment(`InstantDB refresh-token check failed: ${await response.text()}`)
      }
      return (await response.json() as { user: { id: string } }).user
    },
  }
}

/**
 * bunInstantSDK is the React Native SDK itself under Bun. A live test doubles the SDK's two native
 * modules before calling it (`react-native-get-random-values`, whose values come from Bun's own
 * `crypto`, and `@react-native-community/netinfo`, which always reports online). Storage is in memory
 * through the SDK's `Store` option, because Bun resolves the package's browser storage rather than
 * AsyncStorage, and the SDK only connects where `window` exists.
 */
export async function bunInstantSDK(): Promise<InstantSDK> {
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

/** alternateHost spells the local host the other way, because the SDK shares one client per address. */
export function alternateHost(uri: string): string {
  const url = new URL(uri)
  url.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost'
  return url.origin
}

/** localInstantAddress is the configuration both InstantAuth and InstantDB take for a local app. */
export function localInstantAddress(app: EphemeralApp, origin = app.apiURI) {
  return { ApiURI: origin, AppId: app.id, WebsocketURI: `${origin.replace(/^http/, 'ws')}/runtime/session` }
}
