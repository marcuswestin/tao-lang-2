import type TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { JazzProvider } from '../jazz-src/Jazz'
import {
  jazzApp,
  jazzDeploymentFiles,
  jazzMapping,
  jazzPermissions,
  type TaoDataPolicy,
} from '../jazz-src/jazz-deployment'

const owner = '11111111-1111-4111-8111-111111111111'
const note = '22222222-2222-4222-8222-222222222222'
const definition: TR.DataSchemaDefinition = {
  name: 'JazzNotes',
  entities: {
    Account: { collection: 'Accounts', fields: { Name: { kind: 'text', optional: true } } },
    Note: {
      collection: 'Notes',
      fields: { Body: { kind: 'text' }, Owner: { kind: 'relation', relation: 'Account' } },
    },
  },
}
const policy: TaoDataPolicy = {
  accountEntity: 'Account',
  entities: {
    Account: {
      grants: [
        { operations: ['read'], principal: [] },
        { operations: ['update'], principal: [], updateFields: ['Name'] },
      ],
    },
    Note: {
      grants: [
        { operations: ['read', 'create', 'delete'], principal: ['Owner'] },
        { operations: ['update'], principal: ['Owner'], updateFields: ['Body'] },
      ],
    },
  },
}

function snapshot(rows: Record<string, Record<string, unknown>[]>): string {
  return JSON.stringify({ formatVersion: 1, nextId: 1, rows, schemaVersion: 1 })
}

Describe('Jazz provider', () => {
  Test('maps one Tao row to one Jazz table row and compiles owner policy', () => {
    const mapping = jazzMapping(definition)
    Expect(mapping['Account']!.table).toBe('accounts')
    Expect(mapping['Note']!.fields['Owner']).toBe('ownerId')
    const app = jazzApp(definition)
    Expect(app['notes']).toBeDefined()
    const permissions = jazzPermissions(definition, policy)
    Expect(permissions['notes']!.select).toBeDefined()
    Expect(permissions['notes']!.insert).toBeDefined()
    Expect(permissions['notes']!.update).toBeDefined()
    const files = jazzDeploymentFiles(definition, policy)
    Expect(files['schema.ts']).toContain('jazzApp')
    Expect(files['permissions.ts']).toContain('jazzPermissions')
    Expect(JSON.stringify(permissions['notes']!.update)).toContain('ownerId')
  })

  Test('refuses policy paths and fields the server translation cannot enforce', () => {
    const compound = {
      ...definition,
      entities: {
        ...definition.entities,
        Note: {
          ...definition.entities['Note']!,
          uniqueConstraints: [['Body', 'Owner']],
        },
      },
    }
    Expect(() => jazzMapping(compound)).toThrow('Jazz cannot yet enforce Tao unique constraints')
    const paths = {
      ...policy,
      entities: {
        ...policy.entities,
        Note: {
          grants: [{ operations: ['read'] as const, principal: ['Owner', 'Owner'] }],
        },
      },
    }
    Expect(() => jazzPermissions(definition, paths)).toThrow('multi-hop grant')
    const fields = {
      ...policy,
      entities: {
        ...policy.entities,
        Note: {
          grants: [{ operations: ['update'] as const, principal: ['Owner'], updateFields: [] }],
        },
      },
    }
    const fieldPolicy = jazzPermissions(definition, fields)
    Expect(JSON.stringify(fieldPolicy['notes']!.update)).toContain('body')
    const owned = {
      ...definition,
      entities: {
        ...definition.entities,
        Note: {
          ...definition.entities['Note']!,
          fields: {
            ...definition.entities['Note']!.fields,
            Owner: { kind: 'relation' as const, relation: 'Account', onDelete: 'cascade' as const },
          },
        },
      },
    }
    Expect(() => jazzPermissions(owned, policy)).not.toThrow()
    const deletable = {
      ...policy,
      entities: {
        ...policy.entities,
        Account: {
          grants: [...policy.entities['Account']!.grants, { operations: ['delete'] as const, principal: [] }],
        },
      },
    }
    Expect(() => jazzPermissions(owned, deletable)).toThrow('cannot enforce cascading')
  })

  Test('authenticates the exact Clerk issuer and subject and resolves Jazz account', async () => {
    const token = 'opaque.jwt.token'
    const proof = {
      kind: 'IdentityToken' as const,
      issuer: 'https://clerk.example',
      subject: 'user_1',
      token,
      provider: 'Clerk',
    }
    const writes: unknown[] = []
    let closed = false
    const db = {
      getAuthState: () => ({
        session: {
          user: {
            account: owner,
            identity: {
              issuer: proof.issuer,
              subject: proof.subject,
            },
          },
        },
      }),
      upsert: (...args: unknown[]) => {
        writes.push(args)
        return { wait: async () => undefined }
      },
    }
    const session = {
      loginOrRegisterJWT: async ({ getToken }: { getToken: () => Promise<string> }) => {
        Expect(await getToken()).toBe(token)
      },
      getSnapshot: () => ({ client: { db } }),
      close: async () => {
        closed = true
      },
    }
    const provider = JazzProvider(async () => ({ createJazzSession: async () => session } as never))
    const result = await provider.authenticate!({
      configuration: { AppId: 'app-1' },
      schema: definition,
      provider: 'Clerk',
      principal: {} as never,
      signal: new AbortController().signal,
      proof: async () => proof as never,
    })
    Expect(result.accountId).toBe(owner)
    Expect(writes).toHaveLength(1)
    Expect((writes[0] as unknown[])[1]).toBe(owner)
    await result.release!(new AbortController().signal)
    Expect(closed).toBe(true)
  })

  Test('writes row changes as one transaction and waits for server durability', async () => {
    const calls: unknown[][] = []
    const old = snapshot({ Account: [{ Id: owner, Name: null }], Note: [] })
    const next = snapshot({ Account: [{ Id: owner, Name: null }], Note: [{ Id: note, Body: 'Hi', Owner: owner }] })
    const db = {
      getAuthState: () => ({ session: { user: { account: owner } } }),
      subscribe: (_table: unknown, callbacks: { onUpdate(rows: unknown[]): void }) => {
        callbacks.onUpdate([])
        return () => undefined
      },
      transaction: async (action: (tx: unknown) => void) => {
        action({
          upsert: (...args: unknown[]) => calls.push(['upsert', ...args]),
          update: (...args: unknown[]) => calls.push(['update', ...args]),
          delete: (...args: unknown[]) => calls.push(['delete', ...args]),
        })
        return { wait: async (options: unknown) => calls.push(['wait', options]) }
      },
    }
    const session = {
      loginOrRegisterJWT: async () => undefined,
      getSnapshot: () => ({ client: { db } }),
      close: async () => undefined,
    }
    const provider = JazzProvider(async () => ({ createJazzSession: async () => session } as never))
    const connection = provider.connect({
      configuration: { AppId: 'app-1' },
      schema: definition,
      storageKey: 'test',
      auth: { accountId: owner, generation: 1, signal: new AbortController().signal, credential: async () => 'token' },
    })
    await connection.load()
    await connection.save(next, [], { previousSnapshot: old })
    Expect(calls.map(call => call[0])).toEqual(['upsert', 'wait'])
    Expect((calls[0]![3] as Record<string, unknown>)['body']).toBe('Hi')
    Expect((calls[0]![3] as Record<string, unknown>)['ownerId']).toBe(owner)
    Expect(calls[1]![1]).toEqual({ tier: 'global' })
    connection.close?.()
  })
})
