import type TR from '@runtime/TR'
import { Errors } from '@shared/core'
import { Describe, Expect, Test } from '@shared/test'
import {
  createPylonCommitHandler,
  generatePylonBackend,
  pylonManifest,
  type TaoDataPolicy,
} from '../pylon-src/generate'
import { createPylonEnsureAccountHandler } from '../pylon-src/pylon-commit'

const schema: TR.DataSchemaDefinition = {
  name: 'Notebook',
  entities: {
    Account: { collection: 'Accounts', fields: { Name: { kind: 'text', optional: true } } },
    Note: {
      collection: 'Notes',
      fields: {
        Owner: { kind: 'relation', relation: 'Account' },
        Body: { kind: 'text' },
        CreatedAt: { kind: 'time', defaultNow: true },
        Secret: { kind: 'text', optional: true },
        Parent: { kind: 'relation', relation: 'Note', optional: true, onDelete: 'cascade' },
        RestrictedParent: { kind: 'relation', relation: 'Note', optional: true },
      },
    },
  },
}
const access: TaoDataPolicy = {
  accountEntity: 'Account',
  entities: {
    Account: { grants: [{ operations: ['read', 'update'], principal: [], updateFields: ['Name'] }] },
    Note: {
      grants: [{ operations: ['read', 'create', 'update', 'delete'], principal: ['Owner'], updateFields: ['Body'] }],
    },
  },
}

function fixture(userId = 'alice') {
  const rows = new Map<string, Record<string, unknown>>([
    ['Note:n1', { id: 'n1', Owner: 'alice', Body: 'old', Secret: 'private', Parent: null, RestrictedParent: null }],
    ['Account:alice', { id: 'alice' }],
    ['Account:bob', { id: 'bob' }],
  ])
  const changes: string[] = []
  const db = {
    get: async (entity: string, id: string) => rows.get(`${entity}:${id}`) ?? null,
    insert: async (entity: string, row: Record<string, unknown>) => {
      rows.set(`${entity}:${row['id']}`, { ...row })
      changes.push(`insert:${entity}`)
      return String(row['id'])
    },
    update: async (entity: string, id: string, fields: Record<string, unknown>) => {
      rows.set(`${entity}:${id}`, { ...rows.get(`${entity}:${id}`), ...fields })
      changes.push(`update:${entity}`)
      return true
    },
    delete: async (entity: string, id: string) => {
      rows.delete(`${entity}:${id}`)
      changes.push(`delete:${entity}`)
      return true
    },
    link: async (entity: string, id: string, field: string, target: string) => {
      rows.set(`${entity}:${id}`, { ...rows.get(`${entity}:${id}`), [field]: target })
      changes.push(`link:${entity}`)
      return true
    },
    unlink: async (entity: string, id: string, field: string) => {
      rows.set(`${entity}:${id}`, { ...rows.get(`${entity}:${id}`), [field]: null })
      changes.push(`unlink:${entity}`)
      return true
    },
    paginate: async (entity: string, options: { cursor: string | null; numItems: number }) => {
      const all = [...rows.entries()].filter(([key]) => key.startsWith(`${entity}:`)).map(([, value]) => value)
      const offset = options.cursor === null ? 0 : Number(options.cursor)
      const page = all.slice(offset, offset + 1)
      return { page, nextCursor: offset + 1 < all.length ? String(offset + 1) : null, isDone: offset + 1 >= all.length }
    },
  }
  const context = {
    auth: { userId, isGuest: false },
    db: { unsafe: db },
    error: (_: string, message: string) => new Errors.UserInputError(message),
  }
  return { changes, context, rows, run: createPylonCommitHandler(schema, access) }
}

Describe('Pylon generated backend', () => {
  Test('generates row entities, denied direct writes, and guarded functions', () => {
    const generated = generatePylonBackend(schema, access)
    const manifest = pylonManifest(schema, access)
    Expect(Object.keys(generated.files)).toEqual(['app.ts', 'functions/taoCommit.ts', 'functions/taoEnsureAccount.ts'])
    Expect(JSON.stringify(manifest)).toContain('TaoCommit')
    Expect(JSON.stringify(manifest)).toContain('auth.userId')
    Expect(JSON.stringify(manifest)).toContain('allowInsert')
    Expect(generated.files['functions/taoCommit.ts']).toContain('createPylonCommitHandler')
  })

  Test('accepts a permitted update and deduplicates the same transaction receipt', async () => {
    const host = fixture()
    const args = { id: 'commit-1', operations: [{ kind: 'update', entity: 'Note', id: 'n1', fields: { Body: 'new' } }] }
    Expect(await host.run(host.context, args)).toEqual({ status: 'saved' })
    Expect(host.rows.get('Note:n1')?.['Body']).toBe('new')
    Expect(await host.run(host.context, args)).toEqual({ status: 'saved' })
    Expect(host.changes).toEqual(['update:Note', 'insert:TaoCommit'])
  })

  Test('unions field permissions from matching update grants', async () => {
    const host = fixture()
    const splitAccess: TaoDataPolicy = {
      ...access,
      entities: {
        ...access.entities,
        Note: {
          grants: [
            { operations: ['update'], principal: ['Owner'], updateFields: ['Body'] },
            { operations: ['update'], principal: ['Owner'], updateFields: ['Secret'] },
          ],
        },
      },
    }
    const run = createPylonCommitHandler(schema, splitAccess)
    Expect(
      await run(host.context, {
        id: 'split-fields',
        operations: [
          { kind: 'update', entity: 'Note', id: 'n1', fields: { Body: 'new', Secret: 'changed' } },
        ],
      }),
    ).toEqual({ status: 'saved' })
    Expect(host.rows.get('Note:n1')?.['Body']).toBe('new')
    Expect(host.rows.get('Note:n1')?.['Secret']).toBe('changed')
  })

  Test('treats a matching update grant without updateFields as unrestricted', async () => {
    const host = fixture()
    const unrestrictedAccess: TaoDataPolicy = {
      ...access,
      entities: {
        ...access.entities,
        Note: {
          grants: [
            { operations: ['update'], principal: ['Owner'] },
          ],
        },
      },
    }
    const run = createPylonCommitHandler(schema, unrestrictedAccess)
    Expect(
      await run(host.context, {
        id: 'unrestricted-fields',
        operations: [
          { kind: 'update', entity: 'Note', id: 'n1', fields: { Body: 'new', Secret: 'changed' } },
        ],
      }),
    ).toEqual({ status: 'saved' })
    Expect(host.rows.get('Note:n1')?.['Secret']).toBe('changed')
  })

  Test('rejects forbidden fields, ownership transfer, and another account row', async () => {
    const host = fixture()
    await Expect(host.run(host.context, {
      id: 'x1',
      operations: [
        { kind: 'update', entity: 'Note', id: 'n1', fields: { Secret: 'stolen' } },
      ],
    })).rejects.toThrow('Data access denied.')
    await Expect(host.run(host.context, {
      id: 'x2',
      operations: [
        { kind: 'link', entity: 'Note', id: 'n1', field: 'Owner', target: 'bob' },
      ],
    })).rejects.toThrow('Data access denied.')
    const bob = fixture('bob')
    await Expect(bob.run(bob.context, {
      id: 'x3',
      operations: [
        { kind: 'delete', entity: 'Note', id: 'n1' },
      ],
    })).rejects.toThrow('Data access denied.')
    Expect(host.changes).toEqual([])
    Expect(bob.changes).toEqual([])
  })

  Test('rejects incomplete creates and links to missing relation targets before writing', async () => {
    const host = fixture()
    await Expect(host.run(host.context, {
      id: 'missing-body',
      operations: [
        { kind: 'link', entity: 'Note', id: 'fresh', field: 'Owner', target: 'alice' },
      ],
    })).rejects.toThrow('missing required field Body')
    await Expect(host.run(host.context, {
      id: 'missing-target',
      operations: [
        { kind: 'update', entity: 'Note', id: 'fresh', fields: { Body: 'hello' } },
        { kind: 'link', entity: 'Note', id: 'fresh', field: 'Owner', target: 'alice' },
        { kind: 'link', entity: 'Note', id: 'fresh', field: 'Parent', target: 'ghost' },
      ],
    })).rejects.toThrow('Relation target does not exist.')
    Expect(host.changes).toEqual([])
  })

  Test('rejects a readable-owned row linked to another account private target', async () => {
    const host = fixture('bob')
    await Expect(host.run(host.context, {
      id: 'foreign-target',
      operations: [
        { kind: 'update', entity: 'Note', id: 'bob-note', fields: { Body: 'mine' } },
        { kind: 'link', entity: 'Note', id: 'bob-note', field: 'Owner', target: 'bob' },
        { kind: 'link', entity: 'Note', id: 'bob-note', field: 'Parent', target: 'n1' },
      ],
    })).rejects.toThrow('Relation target is not readable.')
    Expect(host.changes).toEqual([])
  })

  Test('fills declared defaults on a direct create before persisting the row', async () => {
    const host = fixture()
    Expect(
      await host.run(host.context, {
        id: 'complete-create',
        operations: [
          { kind: 'update', entity: 'Note', id: 'fresh', fields: { Body: 'hello' } },
          { kind: 'link', entity: 'Note', id: 'fresh', field: 'Owner', target: 'alice' },
        ],
      }),
    ).toEqual({ status: 'saved' })
    const row = host.rows.get('Note:fresh')!
    Expect(row['Body']).toBe('hello')
    Expect(row['Owner']).toBe('alice')
    Expect(row['Secret']).toBe(null)
    Expect(typeof row['CreatedAt']).toBe('number')
  })

  Test('restricts incoming relations and cascades owned inverse rows before a permitted delete', async () => {
    const host = fixture()
    host.rows.set('Note:n2', {
      id: 'n2',
      Owner: 'alice',
      Body: 'child',
      Secret: null,
      Parent: 'n1',
      RestrictedParent: null,
    })
    host.rows.set('Note:n3', {
      id: 'n3',
      Owner: 'alice',
      Body: 'restrictor',
      Secret: null,
      Parent: null,
      RestrictedParent: 'n1',
    })
    await Expect(host.run(host.context, {
      id: 'restricted',
      operations: [
        { kind: 'delete', entity: 'Note', id: 'n1' },
      ],
    })).rejects.toThrow('Cannot delete Note while Note.RestrictedParent refers to it.')
    Expect(host.changes).toEqual([])
    host.rows.delete('Note:n3')
    Expect(
      await host.run(host.context, {
        id: 'cascade',
        operations: [
          { kind: 'delete', entity: 'Note', id: 'n1' },
        ],
      }),
    ).toEqual({ status: 'saved' })
    Expect(host.changes).toEqual(['delete:Note', 'delete:Note', 'insert:TaoCommit'])
    Expect(host.rows.has('Note:n2')).toBe(false)
    Expect(host.rows.has('Note:n1')).toBe(false)
  })

  Test('bootstraps a complete Account with type-zero values for an incomplete profile', async () => {
    const accountSchema: TR.DataSchemaDefinition = {
      ...schema,
      entities: {
        ...schema.entities,
        Account: {
          collection: 'Accounts',
          fields: {
            DisplayName: { kind: 'text', required: 'Enter your name' },
            Visits: { kind: 'number', defaultValue: 3 },
            Enabled: { kind: 'boolean' },
            Nickname: { kind: 'text', optional: true },
          },
        },
      },
    }
    const host = fixture()
    host.rows.delete('Account:alice')
    const ensure = createPylonEnsureAccountHandler(accountSchema, 'Account')
    Expect(await ensure(host.context)).toEqual({ accountId: 'alice' })
    Expect(host.rows.get('Account:alice')).toEqual({
      id: 'alice',
      DisplayName: '',
      Visits: 3,
      Enabled: false,
      Nickname: null,
    })
    Expect(generatePylonBackend(accountSchema, access).files['functions/taoEnsureAccount.ts']).toContain(
      'createPylonEnsureAccountHandler(schema, "Account")',
    )
  })
})
