import type TR from '@runtime/TR'
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
