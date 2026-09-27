import type TR from '@runtime/TR'
import { Errors } from '@shared/core'
import { Describe, Expect, Test } from '@shared/test'
import { instantRules } from '../instantdb-src/instant-rules'
import { instantMapping } from '../instantdb-src/instant-schema'
import { notesPolicy, notesSchema, publicNotesSchema } from './fixtures'

const attribute = (valueType: string, config: { indexed?: boolean; unique?: boolean } = {}) => ({
  config: { indexed: config.indexed === true, unique: config.unique === true },
  required: false,
  valueType,
})

Describe('InstantDB schema mapping', () => {
  Test('maps collections to namespaces, fields to attributes, and relations to links', () => {
    const mapping = instantMapping(notesSchema)

    Expect(mapping.schema).toEqual({
      entities: {
        $users: { attrs: { email: attribute('string', { indexed: true, unique: true }) }, links: {} },
        accounts: { attrs: { displayName: attribute('string') }, links: {} },
        notes: {
          attrs: {
            body: attribute('string'),
            createdAt: attribute('number', { indexed: true }),
            pinned: attribute('boolean'),
            status: attribute('string'),
          },
          links: {},
        },
        tags: { attrs: { label: attribute('string', { unique: true }) }, links: {} },
      },
      links: {
        'accounts_$user': {
          forward: { has: 'one', label: '$user', on: 'accounts', onDelete: 'cascade' },
          reverse: { has: 'one', label: 'account', on: '$users' },
        },
        notes_owner: {
          forward: { has: 'one', label: 'owner', on: 'notes', onDelete: 'cascade' },
          reverse: { has: 'many', label: 'notes', on: 'accounts' },
        },
        tags_note: {
          forward: { has: 'one', label: 'note', on: 'tags' },
          reverse: { has: 'many', label: 'tags', on: 'notes' },
        },
      },
    })
    // The name tables reverse every derived name.
    Expect(mapping.entityOfNamespace).toEqual({ accounts: 'Account', notes: 'Note', tags: 'Tag' })
    Expect(mapping.entities['Note']).toMatchObject({
      attributes: { Body: 'body', CreatedAt: 'createdAt', Pinned: 'pinned', Status: 'status' },
      inverseLabels: { Tags: 'tags' },
      namespace: 'notes',
      relations: { Owner: { cascade: true, label: 'owner', reverseLabel: 'notes', target: 'Account' } },
    })
    Expect(mapping.entities['Account']!.inverseLabels).toEqual({ Notes: 'notes' })
  })

  Test('derives a reverse label when the target declares no inverse, and maps references to json', () => {
    const schema = structuredClone(publicNotesSchema)
    delete schema.entities['Note']!.inverseFields
    const mapping = instantMapping(schema)
    Expect(mapping.schema.links['tags_note']!.reverse).toEqual({ has: 'many', label: 'tagsByNote', on: 'notes' })
    Expect(mapping.schema.entities['notes']!.attrs['ref']).toEqual(attribute('json'))
    // Without an account entity there is no `$users` link or restated `$users` namespace.
    Expect(Object.keys(mapping.schema.entities)).toEqual(['notes', 'tags'])
  })

  Test('is deterministic for the same compiled schema', () => {
    Expect(JSON.stringify(instantMapping(notesSchema))).toBe(
      JSON.stringify(instantMapping(structuredClone(notesSchema))),
    )
  })

  Test('refuses what InstantDB cannot represent, with the reason', () => {
    const refusal = (
      edit: (schema: { entities: Record<string, TR.DataSchemaDefinition['entities'][string]> }) => void,
    ) => {
      const schema = structuredClone(notesSchema)
      edit(schema)
      try {
        instantMapping(schema)
      } catch (error) {
        Expect(error).toBeInstanceOf(Errors.UserInputError)
        return Errors.messageOf(error)
      }
      return Errors.throwUnexpected('expected the mapping to refuse')
    }

    Expect(refusal(schema => {
      schema.entities['Note'] = { ...schema.entities['Note']!, uniqueConstraints: [['Body', 'Status']] }
    })).toBe(
      "InstantDB cannot store this Tao data: InstantDB cannot enforce the compound unique constraint 'Note.Body + Status': "
        + 'it enforces uniqueness one attribute at a time.',
    )
    Expect(refusal(schema => {
      schema.entities['Tag']!.fields['Note'] = { kind: 'relation', relation: 'Note', unique: true }
    })).toContain("InstantDB cannot enforce the unique relation 'Tag.Note'")
    Expect(refusal(schema => {
      schema.entities['Tag'] = { ...schema.entities['Tag']!, collection: 'Notes' }
    })).toContain("Entities 'Note' and 'Tag' both map to InstantDB namespace 'notes'.")
    Expect(refusal(schema => {
      schema.entities['Tag'] = { ...schema.entities['Tag']!, collection: '$Files' }
    })).toContain("maps to InstantDB namespace '$Files', which InstantDB reserves.")
    Expect(refusal(schema => {
      schema.entities['Tag']!.fields['Id'] = { kind: 'text' }
    })).toContain("'Tag.Id' maps to InstantDB label 'id' on 'tags'")
    Expect(refusal(schema => {
      schema.entities['Note']!.fields['body'] = { kind: 'text' }
    })).toContain("'Note.Body' and 'Note.body' both map to InstantDB label 'notes.body'.")
    Expect(refusal(schema => {
      schema.entities['Account']!.fields['Notes'] = { kind: 'text' }
    })).toContain("'Account.Notes' and the reverse of 'Note.Owner' both map to InstantDB label 'accounts.notes'.")
    Expect(refusal(schema => {
      schema.entities['Tag']!.fields['Note'] = { kind: 'relation', relation: 'Elsewhere' }
    })).toContain("The relation 'Tag.Note' targets 'Elsewhere', which is not in the same datasource.")
  })
})

Describe('InstantDB permission rules', () => {
  Test('are public for every namespace without a policy, and closed for anything else', () => {
    Expect(instantRules(instantMapping(publicNotesSchema))).toEqual({
      $default: { allow: { $default: 'false' } },
      attrs: { allow: { $default: 'false' } },
      notes: { allow: { create: 'true', delete: 'true', update: 'true', view: 'true' } },
      tags: { allow: { create: 'true', delete: 'true', update: 'true', view: 'true' } },
    })
  })

  Test("walk each grant path to the account's $users row, keep owners immutable, and scope updates", () => {
    const rules = instantRules(instantMapping(notesSchema), notesPolicy)
    Expect(rules['accounts']).toEqual({
      allow: {
        create: "auth.id == data.id && auth.id in data.ref('$user.id')",
        delete: 'false',
        // Linking the account to its own `$users` row is what a first sign-in's create needs.
        link: { $user: 'auth.id == data.id && auth.id == linkedData.id' },
        unlink: { $user: 'false' },
        update: "principal0 && request.modifiedFields.all(f, (principal0 && f in ['displayName']))",
        view: 'principal0',
      },
      bind: ['principal0', "auth.id in data.ref('$user.id')"],
    })
    Expect(rules['notes']).toEqual({
      allow: {
        create: 'principal0',
        delete: 'principal0',
        unlink: { owner: 'false' },
        update: "principal0 && request.modifiedFields.all(f, (principal0 && f in ['body', 'pinned']))",
        view: 'principal0',
      },
      bind: ['principal0', "auth.id in data.ref('owner.$user.id')"],
    })
    Expect(rules['tags']!.bind).toEqual(['principal0', "auth.id in data.ref('note.owner.$user.id')"])
  })

  Test('let a grant that names a non-owner relation link and unlink it', () => {
    const schema = structuredClone(notesSchema)
    schema.entities['Tag']!.fields['Related'] = { kind: 'relation', optional: true, relation: 'Note' }
    schema.entities['Tag']!.grants = [
      { operations: ['read'], principal: ['Note', 'Owner'] },
      { operations: ['update'], principal: ['Note', 'Owner'], updateFields: ['Related'] },
    ]
    const policy = {
      ...notesPolicy,
      entities: { ...notesPolicy.entities, Tag: { grants: schema.entities['Tag']!.grants } },
    }
    const rules = instantRules(instantMapping(schema), policy)
    Expect(rules['tags']!.allow).toMatchObject({
      create: 'false',
      delete: 'false',
      unlink: { note: 'false', related: 'principal0' },
      update: "principal0 && request.modifiedFields.all(f, (principal0 && f in ['related']))",
    })
  })

  Test('follow an inverse relation in a grant path', () => {
    const schema = structuredClone(notesSchema)
    schema.entities['Account']!.grants = [{ operations: ['read'], principal: ['Notes', 'Owner'] }]
    const policy = {
      ...notesPolicy,
      entities: { ...notesPolicy.entities, Account: { grants: schema.entities['Account']!.grants } },
    }
    Expect(instantRules(instantMapping(schema), policy)['accounts']!.bind).toEqual([
      'principal0',
      "auth.id in data.ref('notes.owner.$user.id')",
    ])
  })

  Test('refuse grants InstantDB cannot enforce', () => {
    const refusal = (grants: TR.DataSchemaDefinition['entities'][string]['grants']) => {
      const policy = { ...notesPolicy, entities: { ...notesPolicy.entities, Tag: { grants: grants ?? [] } } }
      try {
        instantRules(instantMapping(notesSchema), policy)
      } catch (error) {
        Expect(error).toBeInstanceOf(Errors.UserInputError)
        return Errors.messageOf(error)
      }
      return Errors.throwUnexpected('expected the rules to refuse')
    }
    Expect(refusal([{ operations: ['update'], principal: ['Note', 'Owner'], updateFields: ['Note'] }])).toBe(
      "InstantDB cannot enforce updating the owner 'Tag.Note': owners are immutable there.",
    )
    Expect(refusal([{ operations: ['read'], principal: ['Note'] }])).toBe(
      "The grant path 'Tag.Note' must end at 'Account'.",
    )
    Expect(refusal([{ operations: ['read'], principal: ['Label'] }])).toBe(
      "The grant path 'Tag.Label' crosses 'Label', which is not a relation.",
    )
    Expect(() => instantRules(instantMapping(notesSchema), { accountEntity: 'Account', entities: {} })).toThrow(
      "The data policy does not cover 'Account'; recompile so the policy and schema agree.",
    )
  })
})
