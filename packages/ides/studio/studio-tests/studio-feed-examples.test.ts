import type { EntityGenerationDeclaration } from '@generation'
import { Describe, Expect, Test } from '@shared/test'
import { StudioFeedExamples } from '../studio-src/StudioFeedExamples'

Describe('Studio feed examples', () => {
  Test('generates stable promotion-ready rows across semantic field vocabularies and scalar ranges', () => {
    const plan = StudioFeedExamples.generate(person, 'feed-seed-7')

    Expect(plan).toEqual({
      entity: 'Person',
      rows: [
        {
          entity: 'Person',
          fields: {
            Active: false,
            Address: '',
            Age: 0,
            AvatarImage: '',
            Bio: '',
            DisplayName: '',
            JoinedAt: '1970-01-01T00:00:00.000Z',
            Status: 'New',
          },
          name: 'PersonEmpty',
          variant: 'empty',
        },
        {
          entity: 'Person',
          fields: {
            Active: false,
            Address: '42 Orchard Street',
            Age: 31,
            AvatarImage: 'https://placehold.co/320x320/png?text=AvatarImage',
            Bio: 'A concise example for the Studio feed.',
            DisplayName: 'Maya Diaz',
            JoinedAt: '2024-12-12T23:00:00.000Z',
            Status: 'Active',
          },
          name: 'PersonTypical',
          variant: 'typical',
        },
        {
          entity: 'Person',
          fields: {
            Active: true,
            Address: '1847 West Seventy-Second Street, Apartment 1204',
            Age: 1560763,
            AvatarImage: 'https://placehold.co/1200x1200/png?text=AvatarImage',
            Bio: 'A detailed example with enough length to exercise wrapping, truncation, and expanded feed layouts.',
            DisplayName: 'Alexandria Montgomery-Williams',
            JoinedAt: '2099-12-31T23:59:59.999Z',
            Status: 'Archived',
          },
          name: 'PersonEdge',
          variant: 'edge',
        },
      ],
      seed: 'feed-seed-7',
      unsupported: [
        { field: 'Manager', reason: 'outbound-relation', required: true, target: 'Person' },
        { field: 'Reports', reason: 'inverse-relation', required: false, target: 'Person' },
        { field: 'PrivateNotes', reason: 'secret', required: false },
      ],
    })
    Expect(StudioFeedExamples.generate(person, 'feed-seed-7')).toEqual(plan)
  })

  Test('requires an explicit seed and reports an empty case set instead of inventing a value', () => {
    const declaration: EntityGenerationDeclaration = {
      collection: 'Things',
      fields: [{
        name: 'Impossible',
        optional: false,
        secret: false,
        type: { cases: [], kind: 'case', name: 'Impossible' },
      }],
      kind: 'entity',
      name: 'Thing',
    }

    Expect(() => StudioFeedExamples.generate(declaration, '')).toThrow('explicit seed')
    Expect(StudioFeedExamples.generate(declaration, 'seed')).toMatchObject({
      rows: [{ fields: {} }, { fields: {} }, { fields: {} }],
      unsupported: [{ field: 'Impossible', reason: 'zero-case-type', required: true }],
    })
  })
})

const person: EntityGenerationDeclaration = {
  collection: 'People',
  fields: [
    { name: 'DisplayName', optional: false, secret: false, type: { kind: 'scalar', scalar: 'text' } },
    { name: 'Address', optional: false, secret: false, type: { kind: 'scalar', scalar: 'text' } },
    { name: 'AvatarImage', optional: true, secret: false, type: { kind: 'scalar', scalar: 'text' } },
    { name: 'Bio', optional: true, secret: false, type: { kind: 'scalar', scalar: 'text' } },
    { name: 'Age', optional: false, secret: false, type: { kind: 'scalar', scalar: 'number' } },
    { name: 'Active', optional: false, secret: false, type: { kind: 'scalar', scalar: 'boolean' } },
    { name: 'JoinedAt', optional: false, secret: false, type: { kind: 'scalar', scalar: 'time' } },
    {
      name: 'Status',
      optional: false,
      secret: false,
      type: { cases: ['New', 'Active', 'Archived'], kind: 'case', name: 'Status' },
    },
    {
      name: 'Manager',
      optional: false,
      secret: false,
      type: { entity: 'Person', inverse: false, kind: 'relation' },
    },
    {
      name: 'Reports',
      optional: true,
      secret: false,
      type: { entity: 'Person', inverse: true, kind: 'relation' },
    },
    { name: 'PrivateNotes', optional: true, secret: true, type: { kind: 'scalar', scalar: 'text' } },
  ],
  kind: 'entity',
  name: 'Person',
}
