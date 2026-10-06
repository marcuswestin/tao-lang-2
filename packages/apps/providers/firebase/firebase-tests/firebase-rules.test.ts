import type TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { generateFirebaseBackend, type TaoDataPolicy } from '../firebase-src/generate'

const schema: TR.DataSchemaDefinition = {
  name: 'Notes',
  entities: {
    Account: {
      collection: 'Accounts',
      fields: { DisplayName: { kind: 'text', defaultValue: '' }, Bio: { kind: 'text', optional: true } },
    },
    Note: {
      collection: 'Notes',
      fields: {
        Body: { kind: 'text' },
        Done: { kind: 'boolean' },
        Score: { kind: 'number', optional: true },
        UpdatedAt: { kind: 'time' },
        Status: { kind: 'enum', cases: ['Draft', 'Final'] },
        Owner: { kind: 'relation', relation: 'Account' },
      },
    },
  },
}

const emptyPolicy: TaoDataPolicy = {
  accountEntity: 'Account',
  entities: { Account: { grants: [] }, Note: { grants: [] } },
}

function edited(edit: (copy: TR.DataSchemaDefinition) => void): TR.DataSchemaDefinition {
  const copy = structuredClone(schema)
  edit(copy)
  return copy
}

Describe('Firebase rules generation', () => {
  Test('scopes declared rows to the signed-in UID and validates the replica wire shape', () => {
    const { files } = generateFirebaseBackend(schema)
    const rules = files['firestore.rules']
    Expect(rules).toContain('match /users/{userId}/stores/{storageKey}')
    Expect(rules).toContain('request.auth != null && request.auth.uid == userId')
    Expect(rules).toContain('match /Account/{id}')
    Expect(rules).toContain('signedInAsOwner() && id == userId && validRow()')
    Expect(rules).toContain('data.keys().hasAll(["_deleted","serverTimestamp","DisplayName"])')
    Expect(rules).toContain('&& data["DisplayName"] is string')
    Expect(rules).not.toContain('data["DisplayName"] == null')
    Expect(rules).toContain('!data.keys().hasAny(["Bio"]) || data["Bio"] == null || (data["Bio"] is string)')
    Expect(rules).toContain('match /Note/{id}')
    Expect(rules).toContain(
      'data.keys().hasAll(["_deleted","serverTimestamp","Body","Done","UpdatedAt","Status","Owner"])',
    )
    Expect(rules).toContain(
      'data.keys().hasOnly(["_deleted","serverTimestamp","Body","Done","Score","UpdatedAt","Status","Owner"])',
    )
    Expect(rules).toContain('data["Body"] is string')
    Expect(rules).toContain('data["Done"] is bool')
    Expect(rules).toContain('data["Score"] is number')
    Expect(rules).toContain('data["UpdatedAt"] is number')
    Expect(rules).toContain('data["Status"] in ["Draft","Final"]')
    Expect(rules).toContain('data["Owner"] == userId')
    Expect(rules).toContain('!request.resource.data.diff(resource.data).affectedKeys().hasAny(["Owner"])')
    Expect(rules).toContain('data.serverTimestamp == request.time')
    Expect(rules).toContain('request.resource.data._deleted == false')
    Expect(rules).toContain('allow delete: if false;')
    Expect(rules).not.toContain('"Id"')
    Expect(files['firestore.indexes.json']).toBe('{\n  "indexes": [],\n  "fieldOverrides": []\n}\n')
  })

  Test('an absent or empty policy remains private', () => {
    Expect(generateFirebaseBackend(schema, emptyPolicy).files['firestore.rules'])
      .toBe(generateFirebaseBackend(schema).files['firestore.rules'])
    const privateNotes = edited(copy => {
      delete copy.entities['Note']!.fields['Owner']
    })
    const rules = generateFirebaseBackend(privateNotes).files['firestore.rules']
    Expect(rules).toContain('match /Note/{id}')
    Expect(rules).toContain('allow get, list: if signedInAsOwner();')
  })

  Test('rejects authored grants, including a mismatched policy', () => {
    const grant = { operations: ['read'] as const, principal: ['Owner'] }
    Expect(() =>
      generateFirebaseBackend(edited(copy => {
        copy.entities['Note']!.grants = [grant]
      }))
    )
      .toThrow('does not yet support authored grants')
    Expect(() =>
      generateFirebaseBackend(schema, {
        ...emptyPolicy,
        entities: { ...emptyPolicy.entities, Note: { grants: [grant] } },
      })
    ).toThrow('does not yet support authored grants')
    Expect(() => generateFirebaseBackend(schema, { ...emptyPolicy, entities: { Account: { grants: [] } } }))
      .toThrow('does not cover')
  })

  Test('refuses schema features that the rules cannot enforce', () => {
    Expect(() =>
      generateFirebaseBackend(edited(copy => {
        copy.schemaVersion = 2
      }))
    ).toThrow('schema migrations')
    Expect(() =>
      generateFirebaseBackend(edited(copy => {
        copy.entities['Note']!.fields['Body']!.unique = true
      }))
    )
      .toThrow('unique fields')
    Expect(() =>
      generateFirebaseBackend(edited(copy => {
        copy.entities['Note']!.uniqueConstraints = [['Body']]
      }))
    )
      .toThrow('unique fields')
    Expect(() =>
      generateFirebaseBackend(edited(copy => {
        copy.entities['Note']!.fields['Owner'] = { kind: 'relation', relation: 'Note' }
      }))
    )
      .toThrow('only direct relations to Account')
    Expect(() =>
      generateFirebaseBackend(edited(copy => {
        copy.entities['Note']!.fields['Ref'] = { kind: 'reference', relation: 'Account', referenceField: 'Id' }
      }))
    )
      .toThrow('does not yet support references')
    Expect(() =>
      generateFirebaseBackend(edited(copy => {
        copy.entities['Note']!.inverseFields = { Notes: { relation: 'Account', inverseField: 'Owner' } }
      }))
    )
      .toThrow('inverse relations')
  })

  Test('rejects identifiers that could change generated rule structure', () => {
    Expect(() =>
      generateFirebaseBackend(edited(copy => {
        copy.entities['Note/{id}'] = copy.entities['Note']!
      }))
    )
      .toThrow('entity name')
    Expect(() =>
      generateFirebaseBackend(edited(copy => {
        copy.entities['Note']!.fields['Body"] || true'] = { kind: 'text' }
      }))
    )
      .toThrow('as a field')
    Expect(() =>
      generateFirebaseBackend(edited(copy => {
        copy.entities['Note']!.fields['serverTimestamp'] = { kind: 'time' }
      }))
    )
      .toThrow('as a field')
  })
})
