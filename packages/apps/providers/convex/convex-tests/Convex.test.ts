import type TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { type BackendContext, type BackendPlan, ensureAccount, listRows, writeRows } from '../convex-src/backend'
import { ConvexProvider } from '../convex-src/Convex'
import { generateConvexBackend } from '../convex-src/generate'

const schema: TR.DataSchemaDefinition = {
  name: 'Notes',
  entities: {
    Account: {
      collection: 'Accounts',
      fields: { DisplayName: { kind: 'text' } },
      grants: [
        { operations: ['read'], principal: [] },
        { operations: ['update'], principal: [], updateFields: ['DisplayName'] },
      ],
    },
    Note: {
      collection: 'Notes',
      fields: {
        Body: { kind: 'text' },
        Owner: { kind: 'relation', relation: 'Account', onDelete: 'cascade' },
      },
      grants: [
        { operations: ['read', 'create', 'delete'], principal: ['Owner'] },
        { operations: ['update'], principal: ['Owner'], updateFields: ['Body'] },
      ],
    },
  },
}

const policy = {
  accountEntity: 'Account',
  entities: {
    Account: { grants: schema.entities['Account']!.grants! },
    Note: { grants: schema.entities['Note']!.grants! },
  },
}

const plan: BackendPlan = {
  protected: true,
  accountEntity: 'Account',
  entities: {
    Account: {
      table: 'accounts',
      fields: { DisplayName: { kind: 'text' } },
      inverseFields: {},
      grants: policy.entities.Account.grants,
    },
    Note: {
      table: 'notes',
      fields: { Body: { kind: 'text' }, Owner: { kind: 'relation', relation: 'Account' } },
      inverseFields: {},
      grants: policy.entities.Note.grants,
    },
  },
}

function parentRelationPlan(onDelete: 'cascade' | 'restrict'): BackendPlan {
  return {
    ...plan,
    entities: {
      ...plan.entities,
      Note: {
        ...plan.entities['Note']!,
        fields: {
          ...plan.entities['Note']!.fields,
          Parent: { kind: 'relation', relation: 'Note', optional: true, onDelete },
        },
      },
    },
  }
}

function server(subject: string) {
  const tables = new Map<string, Record<string, unknown>[]>([['accounts', []], ['notes', []]])
  let nextId = 0
  const ctx: BackendContext = {
    auth: { getUserIdentity: async () => ({ tokenIdentifier: subject }) },
    db: {
      query: table => ({
        collect: async () => tables.get(table)!.map(row => ({ ...row, taoId: row['taoId'] as string })),
      }),
      insert: async (table, value) => {
        const id = `${table}-${++nextId}`
        tables.get(table)!.push({ ...value, _id: id })
        return id
      },
      patch: async (id, value) => {
        const row = [...tables.values()].flat().find(candidate => candidate['_id'] === id)!
        Object.assign(row, value)
      },
      delete: async id => {
        for (const rows of tables.values()) {
          const index = rows.findIndex(row => row['_id'] === id)
          if (index >= 0) {
            rows.splice(index, 1)
          }
        }
      },
    },
  }
  return {
    ctx,
    tables,
    as: (other: string): BackendContext => ({
      ...ctx,
      auth: { getUserIdentity: async () => ({ tokenIdentifier: other }) },
    }),
  }
}

Describe('Convex provider backend', () => {
  Test('generates per-entity tables, Clerk auth, and public functions bound to the policy', () => {
    const files = generateConvexBackend(schema, policy)
    Expect(files['schema.ts']).toContain('"notes": defineTable')
    Expect(files['schema.ts']).toContain('"Body": v.string()')
    Expect(files['schema.ts']).toContain('"Owner": v.string()')
    Expect(files['schema.ts']).toContain('"DisplayName": v.optional(v.union(v.string(), v.null()))')
    Expect(files['auth.config.ts']).toContain("applicationID: 'convex'")
    Expect(files['tao.ts']).toContain('"principal": [')
    Expect(files['tao.ts']).toContain('listRows(ctx as unknown as BackendContext, plan)')
    Expect(files['tao.ts']).toContain('writeRows(ctx as unknown as BackendContext, plan, args.operations)')
  })

  Test('resolves each Account and denies cross-user reads and writes on the server', async () => {
    const { ctx, as, tables } = server('clerk|alice')
    const alice = await ensureAccount(ctx, plan)
    await ensureAccount(as('clerk|bob'), plan)
    Expect((await listRows(ctx, plan))['Account']).toEqual([{ Id: alice, DisplayName: '' }])
    Expect(tables.get('accounts')![0]!['DisplayName']).toBe('')
    await writeRows(ctx, plan, [
      { kind: 'update', entity: 'Note', id: 'Note-1', fields: { Body: 'private' } },
      { kind: 'link', entity: 'Note', id: 'Note-1', field: 'Owner', target: alice },
    ])
    Expect((await listRows(ctx, plan))['Note']).toEqual([{ Id: 'Note-1', Body: 'private', Owner: alice }])
    Expect((await listRows(as('clerk|bob'), plan))['Note']).toEqual([])
    await Expect(writeRows(as('clerk|bob'), plan, [
      { kind: 'update', entity: 'Note', id: 'Note-1', fields: { Body: 'stolen' } },
    ])).rejects.toThrow('Convex denied access to this row.')
    await Expect(writeRows(as('clerk|bob'), plan, [
      { kind: 'update', entity: 'Note', id: 'Note-2', fields: { Body: 'forged' } },
      { kind: 'link', entity: 'Note', id: 'Note-2', field: 'Owner', target: alice },
    ])).rejects.toThrow('Convex denied access to this row.')
    Expect(tables.get('notes')![0]!['Body']).toBe('private')
    Expect(tables.get('notes')).toHaveLength(1)
  })

  Test('refuses Account bootstrap when a required relation has no target', async () => {
    const { ctx, tables } = server('clerk|alice')
    const requiredRelationPlan: BackendPlan = {
      ...plan,
      entities: {
        ...plan.entities,
        Account: {
          ...plan.entities['Account']!,
          fields: { ...plan.entities['Account']!.fields, Team: { kind: 'relation', relation: 'Account' } },
        },
      },
    }
    await Expect(ensureAccount(ctx, requiredRelationPlan)).rejects.toThrow("Convex requires a valid 'Team' field.")
    Expect(tables.get('accounts')).toEqual([])
  })

  Test('rejects incomplete direct creates and null required updates, while filling Tao defaults', async () => {
    const { ctx, tables } = server('clerk|alice')
    const alice = await ensureAccount(ctx, plan)
    const defaultedPlan: BackendPlan = {
      ...plan,
      entities: {
        ...plan.entities,
        Note: {
          ...plan.entities['Note']!,
          fields: { ...plan.entities['Note']!.fields, CreatedAt: { kind: 'time', defaultNow: true } },
        },
      },
    }
    await Expect(writeRows(ctx, defaultedPlan, [
      { kind: 'update', entity: 'Note', id: 'Note-1', fields: {} },
      { kind: 'link', entity: 'Note', id: 'Note-1', field: 'Owner', target: alice },
    ])).rejects.toThrow("Convex requires a valid 'Body' field.")
    Expect(tables.get('notes')).toEqual([])
    const requiredTimePlan: BackendPlan = {
      ...defaultedPlan,
      entities: {
        ...defaultedPlan.entities,
        Note: {
          ...defaultedPlan.entities['Note']!,
          fields: { ...defaultedPlan.entities['Note']!.fields, CreatedAt: { kind: 'time' } },
        },
      },
    }
    await Expect(writeRows(ctx, requiredTimePlan, [
      { kind: 'update', entity: 'Note', id: 'Note-1', fields: { Body: 'complete' } },
      { kind: 'link', entity: 'Note', id: 'Note-1', field: 'Owner', target: alice },
    ])).rejects.toThrow("Convex requires a valid 'CreatedAt' field.")
    Expect(tables.get('notes')).toEqual([])
    await writeRows(ctx, defaultedPlan, [
      { kind: 'update', entity: 'Note', id: 'Note-1', fields: { Body: 'complete' } },
      { kind: 'link', entity: 'Note', id: 'Note-1', field: 'Owner', target: alice },
    ])
    Expect(typeof tables.get('notes')![0]!['CreatedAt']).toBe('number')
    await Expect(writeRows(ctx, defaultedPlan, [
      { kind: 'update', entity: 'Note', id: 'Note-1', fields: { Body: null } },
    ])).rejects.toThrow('Invalid Tao field value.')
    Expect(tables.get('notes')![0]!['Body']).toBe('complete')
  })

  Test('updates fields, rejects owner relinking, and deletes a row by its document id', async () => {
    const { ctx, as, tables } = server('clerk|alice')
    const alice = await ensureAccount(ctx, plan)
    const bob = await ensureAccount(as('clerk|bob'), plan)
    await writeRows(ctx, plan, [
      { kind: 'update', entity: 'Note', id: 'Note-1', fields: { Body: 'first' } },
      { kind: 'link', entity: 'Note', id: 'Note-1', field: 'Owner', target: alice },
    ])
    await writeRows(ctx, plan, [{ kind: 'update', entity: 'Note', id: 'Note-1', fields: { Body: 'second' } }])
    Expect(tables.get('notes')![0]!['Body']).toBe('second')
    await Expect(writeRows(ctx, plan, [
      { kind: 'link', entity: 'Note', id: 'Note-1', field: 'Owner', target: bob },
    ])).rejects.toThrow('Convex denied access to this row.')
    Expect(tables.get('notes')![0]!['Owner']).toBe(alice)
    await writeRows(ctx, plan, [{ kind: 'delete', entity: 'Note', id: 'Note-1' }])
    Expect(tables.get('notes')).toEqual([])
  })

  Test('cascades a server-side child when its parent is deleted', async () => {
    const { ctx, tables } = server('clerk|alice')
    const alice = await ensureAccount(ctx, plan)
    const cascading = parentRelationPlan('cascade')
    await writeRows(ctx, cascading, [
      { kind: 'update', entity: 'Note', id: 'Note-1', fields: { Body: 'parent' } },
      { kind: 'update', entity: 'Note', id: 'Note-2', fields: { Body: 'child' } },
      { kind: 'link', entity: 'Note', id: 'Note-1', field: 'Owner', target: alice },
      { kind: 'link', entity: 'Note', id: 'Note-2', field: 'Owner', target: alice },
      { kind: 'link', entity: 'Note', id: 'Note-2', field: 'Parent', target: 'Note-1' },
    ])
    await writeRows(ctx, cascading, [{ kind: 'delete', entity: 'Note', id: 'Note-1' }])
    Expect(tables.get('notes')).toEqual([])
  })

  Test('restricts deletion while a server-side child still refers to its parent', async () => {
    const { ctx, tables } = server('clerk|alice')
    const alice = await ensureAccount(ctx, plan)
    const restricting = parentRelationPlan('restrict')
    await writeRows(ctx, restricting, [
      { kind: 'update', entity: 'Note', id: 'Note-1', fields: { Body: 'parent' } },
      { kind: 'update', entity: 'Note', id: 'Note-2', fields: { Body: 'child' } },
      { kind: 'link', entity: 'Note', id: 'Note-1', field: 'Owner', target: alice },
      { kind: 'link', entity: 'Note', id: 'Note-2', field: 'Owner', target: alice },
      { kind: 'link', entity: 'Note', id: 'Note-2', field: 'Parent', target: 'Note-1' },
    ])
    await Expect(writeRows(ctx, restricting, [
      { kind: 'delete', entity: 'Note', id: 'Note-1' },
    ])).rejects.toThrow('Cannot delete the referenced row because Note.Parent still refers to it.')
    Expect(tables.get('notes')!.map(row => row['taoId'])).toEqual(['Note-1', 'Note-2'])
  })

  Test("deletes another account's child by cascade while denying its explicit deletion", async () => {
    const { ctx, as, tables } = server('clerk|alice')
    const alice = await ensureAccount(ctx, plan)
    const bob = await ensureAccount(as('clerk|bob'), plan)
    const cascading = parentRelationPlan('cascade')
    await writeRows(ctx, cascading, [
      { kind: 'update', entity: 'Note', id: 'Note-1', fields: { Body: 'parent' } },
      { kind: 'link', entity: 'Note', id: 'Note-1', field: 'Owner', target: alice },
    ])
    await writeRows(as('clerk|bob'), { ...cascading, protected: false }, [
      { kind: 'update', entity: 'Note', id: 'Note-2', fields: { Body: 'child' } },
      { kind: 'link', entity: 'Note', id: 'Note-2', field: 'Owner', target: bob },
      { kind: 'link', entity: 'Note', id: 'Note-2', field: 'Parent', target: 'Note-1' },
    ])
    await Expect(writeRows(ctx, cascading, [
      { kind: 'delete', entity: 'Note', id: 'Note-2' },
    ])).rejects.toThrow('Convex denied access to this row.')
    await writeRows(ctx, cascading, [
      { kind: 'delete', entity: 'Note', id: 'Note-1' },
    ])
    Expect(tables.get('notes')!.map(row => row['taoId'])).toEqual([])
  })

  Test('rejects a direct link to a private relation target', async () => {
    const { ctx, as, tables } = server('clerk|alice')
    const alice = await ensureAccount(ctx, plan)
    const bob = await ensureAccount(as('clerk|bob'), plan)
    const cascading = parentRelationPlan('cascade')
    await writeRows(ctx, cascading, [
      { kind: 'update', entity: 'Note', id: 'Note-1', fields: { Body: 'private parent' } },
      { kind: 'link', entity: 'Note', id: 'Note-1', field: 'Owner', target: alice },
    ])
    await Expect(writeRows(as('clerk|bob'), cascading, [
      { kind: 'update', entity: 'Note', id: 'Note-2', fields: { Body: 'foreign child' } },
      { kind: 'link', entity: 'Note', id: 'Note-2', field: 'Owner', target: bob },
      { kind: 'link', entity: 'Note', id: 'Note-2', field: 'Parent', target: 'Note-1' },
    ])).rejects.toThrow('Convex denied access to this row.')
    Expect(tables.get('notes')!.map(row => row['taoId'])).toEqual(['Note-1'])
  })

  Test('rejects mixed delete and mutation operations before persisting a phantom relation target', async () => {
    const { ctx, tables } = server('clerk|alice')
    const alice = await ensureAccount(ctx, plan)
    const cascading = parentRelationPlan('cascade')
    await writeRows(ctx, cascading, [
      { kind: 'update', entity: 'Note', id: 'Note-1', fields: { Body: 'parent' } },
      { kind: 'link', entity: 'Note', id: 'Note-1', field: 'Owner', target: alice },
    ])
    const deleted = { kind: 'delete', entity: 'Note', id: 'Note-1' } as const
    const revived = { kind: 'update', entity: 'Note', id: 'Note-1', fields: { Body: 'revived' } } as const
    for (const ordered of [[deleted, revived], [revived, deleted]]) {
      await Expect(writeRows(ctx, cascading, [
        ...ordered,
        { kind: 'update', entity: 'Note', id: 'Note-2', fields: { Body: 'child' } },
        { kind: 'link', entity: 'Note', id: 'Note-2', field: 'Owner', target: alice },
        { kind: 'link', entity: 'Note', id: 'Note-2', field: 'Parent', target: 'Note-1' },
      ])).rejects.toThrow('Cannot delete and mutate the same Tao row in one commit.')
    }
    Expect(tables.get('notes')!.map(row => [row['taoId'], row['Body']])).toEqual([['Note-1', 'parent']])
  })

  Test('accepts an authored null unlink and rejects a mismatched or malformed relation target', async () => {
    const { ctx, tables } = server('clerk|alice')
    const alice = await ensureAccount(ctx, plan)
    const optionalPlan: BackendPlan = {
      ...plan,
      entities: {
        ...plan.entities,
        Note: {
          ...plan.entities['Note']!,
          fields: { ...plan.entities['Note']!.fields, Related: { kind: 'relation', relation: 'Note', optional: true } },
          grants: [
            { operations: ['read', 'create', 'delete'], principal: ['Owner'] },
            { operations: ['update'], principal: ['Owner'], updateFields: ['Body', 'Related'] },
          ],
        },
      },
    }
    await writeRows(ctx, optionalPlan, [
      { kind: 'update', entity: 'Note', id: 'Note-1', fields: { Body: 'first' } },
      { kind: 'link', entity: 'Note', id: 'Note-1', field: 'Owner', target: alice },
    ])
    await writeRows(ctx, optionalPlan, [
      { kind: 'unlink', entity: 'Note', id: 'Note-1', field: 'Related', target: null },
    ])
    Expect(tables.get('notes')![0]!['Related']).toBeNull()
    await Expect(writeRows(ctx, optionalPlan, [
      { kind: 'unlink', entity: 'Note', id: 'Note-1', field: 'Related', target: 'Note-2' },
    ])).rejects.toThrow('Invalid Tao relation target.')
    await Expect(writeRows(ctx, optionalPlan, [
      { kind: 'link', entity: 'Note', id: 'Note-1', field: 'Related', target: null as never },
    ])).rejects.toThrow('Invalid Tao relation target.')
  })
})

Describe('Convex client connection', () => {
  Test('passes a fresh Clerk IdentityToken to the client and resolves Account on the server', async () => {
    let fetchToken: (() => Promise<string | null>) | undefined
    let closed = false
    const client = {
      close: async () => {
        closed = true
      },
      query: async () => ({}),
      mutation: async () => 'account:clerk|alice',
      onUpdate: () => () => undefined,
      setAuth: (fetch: typeof fetchToken) => {
        fetchToken = fetch
      },
    }
    const provider = ConvexProvider(() => client as never)
    const auth = await provider.authenticate!({
      configuration: { DeploymentURL: 'https://example.convex.cloud' },
      schema,
      provider: 'Clerk',
      principal: {} as never,
      proof: async () => ({ kind: 'IdentityToken', token: 'clerk-session-token' }) as never,
      signal: new AbortController().signal,
    })
    Expect(auth.accountId).toBe('account:clerk|alice')
    Expect(await fetchToken?.()).toBe('clerk-session-token')
    Expect(await auth.credential?.(new AbortController().signal)).toBe('clerk-session-token')
    await auth.release?.(new AbortController().signal)
    Expect(closed).toBe(true)
  })

  Test('loads and subscribes to authorized rows, then sends row operations for a save', async () => {
    const calls: unknown[] = []
    let updated: ((rows: Record<string, Record<string, unknown>[]>) => void) | undefined
    const client = {
      close: async () => undefined,
      query: async () => ({ Account: [], Note: [] }),
      mutation: async (_reference: unknown, args: unknown) => {
        calls.push(args)
      },
      onUpdate: (_reference: unknown, _args: unknown, callback: typeof updated) => {
        updated = callback
        return () => {
          updated = undefined
        }
      },
      setAuth: () => undefined,
    }
    const connection = ConvexProvider(() => client as never).connect({
      configuration: { DeploymentURL: 'https://example.convex.cloud' },
      schema,
      storageKey: 'Notes',
    })
    const initial = await connection.load() as string
    const snapshots: string[] = []
    const stop = connection.subscribe!({ error: () => undefined, snapshot: value => snapshots.push(value!) })
    updated?.({ Account: [], Note: [{ Id: 'Note-1', Body: 'hello', Owner: null }] })
    Expect((JSON.parse(snapshots[0]!) as { rows: Record<string, unknown[]> }).rows['Note']).toEqual([
      { Id: 'Note-1', Body: 'hello', Owner: null },
    ])
    const next = JSON.stringify({
      formatVersion: 1,
      nextId: 2,
      rows: {
        Account: [],
        Note: [{ Id: 'Note-1', Body: 'hello', Owner: null }],
      },
      schemaVersion: 1,
    })
    await connection.save(next, [], { previousSnapshot: initial })
    Expect(calls).toEqual([{
      operations: [{ kind: 'update', entity: 'Note', id: 'Note-1', fields: { Body: 'hello' } }],
    }])
    await connection.save(next, [{ entity: 'Note', id: 'Note-1', fields: ['Owner'] }], { previousSnapshot: next })
    Expect(calls[1]).toEqual({
      operations: [{ kind: 'unlink', entity: 'Note', id: 'Note-1', field: 'Owner', target: null }],
    })
    stop()
    connection.close?.()
  })
})
