import type { EntityGenerationDeclaration } from '@generation'
import { Describe, Expect, Test } from '@shared/test'
import { StudioFeedInventory } from '../studio-src/StudioFeedInventory'

Describe('Studio feed inventory', () => {
  Test('normalizes fixture, generated, live, and library rows into stable immutable promotion items', () => {
    const inventory = StudioFeedInventory.build(article, [
      {
        kind: 'fixture',
        plan: {
          accounts: [],
          creates: [{ entity: 'Article', fields: { Published: false, Title: 'Fixture' }, name: 'FixtureArticle' }],
        },
      },
      { declaration: article, kind: 'generated', seed: 'inventory-seed' },
      {
        entity: 'Article',
        kind: 'live',
        rows: [{ fields: { Published: true, Title: 'Live' }, key: 'live-42' }],
      },
      {
        entity: 'Article',
        kind: 'library',
        rows: [{ fields: { Published: false, Title: 'Library' }, name: 'LibraryArticle' }],
      },
    ])

    Expect(inventory.items.map(item => ({
      fields: item.fields,
      id: item.id,
      promotion: item.promotion,
      source: item.source,
    }))).toEqual([
      {
        fields: { Published: false, Title: 'Fixture' },
        id: 'feed_uz4qgj',
        promotion: { entity: 'Article', fields: { Published: false, Title: 'Fixture' }, name: 'FixtureArticle' },
        source: { kind: 'fixture', row: 'FixtureArticle' },
      },
      {
        fields: { Published: false, Title: '' },
        id: 'feed_gcwn36',
        promotion: { entity: 'Article', fields: { Published: false, Title: '' }, name: 'ArticleEmpty' },
        source: { kind: 'generated', row: 'empty', seed: 'inventory-seed' },
      },
      {
        fields: { Published: false, Title: 'Example item' },
        id: 'feed_pbm8b2',
        promotion: { entity: 'Article', fields: { Published: false, Title: 'Example item' }, name: 'ArticleTypical' },
        source: { kind: 'generated', row: 'typical', seed: 'inventory-seed' },
      },
      {
        fields: { Published: true, Title: 'A deliberately long example title for layout stress' },
        id: 'feed_lkd331',
        promotion: {
          entity: 'Article',
          fields: { Published: true, Title: 'A deliberately long example title for layout stress' },
          name: 'ArticleEdge',
        },
        source: { kind: 'generated', row: 'edge', seed: 'inventory-seed' },
      },
      {
        fields: { Published: true, Title: 'Live' },
        id: 'feed_tsodpe',
        promotion: { entity: 'Article', fields: { Published: true, Title: 'Live' }, name: 'ArticleLive1' },
        source: { kind: 'live', row: 'live-42' },
      },
      {
        fields: { Published: false, Title: 'Library' },
        id: 'feed_57dpbx',
        promotion: { entity: 'Article', fields: { Published: false, Title: 'Library' }, name: 'LibraryArticle' },
        source: { kind: 'library', row: 'LibraryArticle' },
      },
    ])
    Expect(Object.isFrozen(inventory)).toBe(true)
    Expect(Object.isFrozen(inventory.items)).toBe(true)
    Expect(Object.isFrozen(inventory.items[0]?.fields)).toBe(true)
    Expect(StudioFeedInventory.build(article, [{ declaration: article, kind: 'generated', seed: 'inventory-seed' }]))
      .toEqual(
        StudioFeedInventory.build(article, [{ declaration: article, kind: 'generated', seed: 'inventory-seed' }]),
      )
  })

  Test('rejects source entity and field type mismatches', () => {
    Expect(() =>
      StudioFeedInventory.build(article, [{
        entity: 'Person',
        kind: 'live',
        rows: [],
      }])
    ).toThrow('does not match Article')
    Expect(() =>
      StudioFeedInventory.build(article, [{
        kind: 'fixture',
        plan: {
          accounts: [],
          creates: [{ entity: 'Article', fields: { Published: 'yes', Title: 'Wrong' }, name: 'Bad' }],
        },
      }])
    ).toThrow('Article.Published has the wrong type')
    Expect(() =>
      StudioFeedInventory.build(article, [{
        entity: 'Article',
        kind: 'library',
        rows: [{ fields: { Published: true, Title: 42 } }],
      }])
    ).toThrow('Article.Title has the wrong type')
    Expect(() =>
      StudioFeedInventory.build(article, [{
        declaration: {
          ...article,
          fields: [{ name: 'Title', optional: false, secret: false, type: { kind: 'scalar', scalar: 'number' } }],
        },
        kind: 'generated',
        seed: 'seed',
      }])
    ).toThrow('schema for Article does not match')
  })
})

const article: EntityGenerationDeclaration = {
  collection: 'Articles',
  fields: [
    { name: 'Title', optional: false, secret: false, type: { kind: 'scalar', scalar: 'text' } },
    { name: 'Published', optional: false, secret: false, type: { kind: 'scalar', scalar: 'boolean' } },
  ],
  kind: 'entity',
  name: 'Article',
}
