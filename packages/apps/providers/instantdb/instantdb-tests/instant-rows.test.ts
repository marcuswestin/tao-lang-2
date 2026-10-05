import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { RowIdentities, rowOperations } from '../instantdb-src/instant-rows'
import { instantMapping } from '../instantdb-src/instant-schema'
import { publicNotesSchema } from './fixtures'

function snapshot(rows: Record<string, Record<string, unknown>[]>): string {
  return JSON.stringify({ formatVersion: 1, nextId: 3, rows, schemaVersion: 1 })
}

Describe('hosted row operations', () => {
  Test('diffs an atomic multirow commit with Tao names and retains authored same-value writes', () => {
    const before = snapshot({
      Note: [{ Body: 'same', Id: 'Note-1', Pinned: false, Ref: null }],
      Tag: [{ Id: 'Tag-1', Label: 'old', Note: 'Note-1' }],
    })
    const after = snapshot({
      Note: [
        { Body: 'same', Id: 'Note-1', Pinned: true, Ref: null },
        { Body: 'new', Id: 'Note-2', Pinned: false, Ref: null },
      ],
      Tag: [{ Id: 'Tag-2', Label: 'new tag', Note: 'Note-2' }],
    })
    const intents: TR.DataWriteIntent[] = [{ entity: 'Note', fields: ['Body'], id: 'Note-1' }]

    Expect(TR.DataRows.rowOperations(publicNotesSchema, before, after, intents)).toEqual([
      { entity: 'Note', fields: { Body: 'same', Pinned: true }, id: 'Note-1', kind: 'update' },
      { entity: 'Note', fields: { Body: 'new', Pinned: false }, id: 'Note-2', kind: 'update' },
      { entity: 'Tag', fields: { Label: 'new tag' }, id: 'Tag-2', kind: 'update' },
      { entity: 'Tag', field: 'Note', id: 'Tag-2', kind: 'link', target: 'Note-2' },
      { entity: 'Tag', id: 'Tag-1', kind: 'delete' },
    ])

    let sequence = 0
    const identities = new RowIdentities(() => `00000000-0000-0000-0000-${String(++sequence).padStart(12, '0')}`)
    Expect(rowOperations(instantMapping(publicNotesSchema), publicNotesSchema, before, after, intents, identities))
      .toEqual([
        {
          attributes: { body: 'same', pinned: true },
          id: '00000000-0000-0000-0000-000000000001',
          kind: 'update',
          namespace: 'notes',
        },
        {
          attributes: { body: 'new', pinned: false },
          id: '00000000-0000-0000-0000-000000000002',
          kind: 'update',
          namespace: 'notes',
        },
        {
          attributes: { label: 'new tag' },
          id: '00000000-0000-0000-0000-000000000003',
          kind: 'update',
          namespace: 'tags',
        },
        {
          id: '00000000-0000-0000-0000-000000000003',
          kind: 'link',
          label: 'note',
          namespace: 'tags',
          target: '00000000-0000-0000-0000-000000000002',
        },
        { id: '00000000-0000-0000-0000-000000000004', kind: 'delete', namespace: 'tags' },
      ])
  })

  Test('emits an unlink for a cleared relation and an empty update for a created row', () => {
    const schema = structuredClone(publicNotesSchema)
    schema.entities['Tag']!.fields['Label']!.optional = true
    schema.entities['Tag']!.fields['Note']!.optional = true
    const before = snapshot({
      Note: [{ Body: 'one', Id: 'Note-1', Pinned: false, Ref: null }],
      Tag: [{ Id: 'Tag-1', Label: 'tag', Note: 'Note-1' }],
    })
    const after = snapshot({
      Note: [{ Body: 'one', Id: 'Note-1', Pinned: false, Ref: null }],
      Tag: [
        { Id: 'Tag-1', Label: 'tag', Note: null },
        { Id: 'Tag-2', Label: null, Note: null },
      ],
    })
    Expect(TR.DataRows.rowOperations(schema, before, after, [])).toEqual([
      { entity: 'Tag', fields: {}, id: 'Tag-2', kind: 'update' },
      { entity: 'Tag', field: 'Note', id: 'Tag-1', kind: 'unlink', target: 'Note-1' },
    ])
  })

  Test('retains an authored clear of an already empty relation for providers that can clear unknown links', () => {
    const schema = structuredClone(publicNotesSchema)
    schema.entities['Tag']!.fields['Note']!.optional = true
    const unchanged = snapshot({
      Note: [{ Body: 'one', Id: 'Note-1', Pinned: false, Ref: null }],
      Tag: [{ Id: 'Tag-1', Label: 'tag', Note: null }],
    })
    const intents: TR.DataWriteIntent[] = [{ entity: 'Tag', fields: ['Note'], id: 'Tag-1' }]

    Expect(TR.DataRows.rowOperations(schema, unchanged, unchanged, intents)).toEqual([
      { entity: 'Tag', field: 'Note', id: 'Tag-1', kind: 'unlink', target: null },
    ])
    const identities = new RowIdentities(() => '00000000-0000-0000-0000-000000000001')
    Expect(rowOperations(instantMapping(schema), schema, unchanged, unchanged, intents, identities)).toEqual([])
  })
})
