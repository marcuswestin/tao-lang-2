import type { EntityGenerationDeclaration } from '@generation'
import { Describe, Expect, Test } from '@shared/test'
import { StudioFeedBrowser } from '../studio-src/StudioFeedBrowser'
import type { StudioPreviewManifestV2 } from '../studio-src/StudioPreviewManifest'

Describe('Studio feed browser', () => {
  Test(
    'browses active fixture, deterministic generated, live and other curated fixtures without exposing secrets',
    () => {
      const input = manifest()
      const result = StudioFeedBrowser.build(input, {
        liveRows: { Article: [{ fields: { Secret: 'hidden live', Title: 'Live title' }, key: '42' }] },
        seed: 'browser-seed',
      })
      const article = result.inventory.entities[0]!
      Expect(article.sources.map(source => [source.kind, source.rows.length])).toEqual([
        ['fixture', 1],
        ['generated', 3],
        ['live', 1],
        ['library', 1],
      ])
      Expect(article.fields.map(field => field.name)).toEqual(['Title', 'Status', 'PublishedAt'])
      Expect(article.sources[0]!.rows[0]).toMatchObject({
        fields: { Title: 'Active title' },
        label: 'MainArticle',
        source: { fixtureId: 'Main', kind: 'fixture', label: 'Main fixture', row: 'Main:MainArticle' },
      })
      Expect(article.sources[3]!.rows[0]).toMatchObject({
        fields: { Title: 'Edge title' },
        source: { fixtureId: 'EdgeCases', kind: 'library' },
      })
      Expect(JSON.stringify(result.inventory)).not.toContain('hidden')
      Expect(JSON.stringify(result.inventory)).not.toContain('Secret')
      Expect(JSON.stringify(result.inventory)).not.toContain('promotion')
      Expect(JSON.parse(JSON.stringify(result.inventory))).toEqual(result.inventory)
      Expect(result.promotions.get(article.sources[0]!.rows[0]!.id)).toEqual({
        entity: 'Article',
        fields: { Title: 'Active title' },
        name: 'MainArticle',
      })
      Expect(StudioFeedBrowser.build(input, { seed: 'browser-seed' }).inventory.entities[0]!.sources[1])
        .toEqual(article.sources[1])
      Expect(article.sources[1]!.rows[0]!.fields).not.toHaveProperty('Status')
      Expect(input.fixtures[0]!.plan).toMatchObject({ creates: [{ fields: { Secret: 'hidden fixture' } }] })
    },
  )

  Test('rejects invalid captured values per row and bounds live rows', () => {
    const result = StudioFeedBrowser.build(manifest(), {
      liveRows: {
        Article: [
          { fields: { Title: 42 } },
          { fields: { PublishedAt: 'yesterday', Title: 'Bad time' } },
          { fields: { Status: 'Bogus', Title: 'Bad case' } },
          { fields: { Surprise: 'unknown', Title: 'Unknown field' } },
          ...Array.from({ length: 260 }, (_, index) => ({ fields: { Title: `Row ${index}` }, key: String(index) })),
        ],
      },
      seed: 'seed',
    })
    const live = result.inventory.entities[0]!.sources[2]!
    Expect(live.rows).toHaveLength(246)
    Expect(live.truncated).toBe(true)
    Expect(live.issues).toEqual([
      'Studio feed field Article.Title has the wrong type.',
      'Studio feed field Article.PublishedAt has the wrong type.',
      'Studio feed field Article.Status has the wrong type.',
      'Studio feed row contains unknown Article field Surprise.',
    ])
  })

  Test('exposes one level of relation fields and collections, suppressing unsupported required generation', () => {
    const input = manifest()
    const related: EntityGenerationDeclaration = {
      ...article,
      fields: [
        ...article.fields,
        {
          name: 'Author',
          optional: false,
          secret: false,
          type: { entity: 'Article', inverse: false, kind: 'relation' },
        },
        {
          name: 'Replies',
          optional: true,
          secret: false,
          type: { entity: 'Article', inverse: true, kind: 'relation' },
        },
      ],
    }
    const result = StudioFeedBrowser.build({ ...input, generationDeclarations: [related] }, { seed: 'seed' })
    const entity = result.inventory.entities[0]!
    Expect(entity.fields.find(field => field.name === 'Author')!.relation).toMatchObject({
      collection: 'Articles',
      entity: 'Article',
      fields: [{ path: 'Author.Title' }, { path: 'Author.Status' }, {
        path: 'Author.PublishedAt',
      }],
    })
    Expect(entity.fields.find(field => field.name === 'Replies')!.relation).toEqual({
      collection: 'Articles',
      entity: 'Article',
      fields: [],
    })
    Expect(entity.sources[1]).toMatchObject({
      issues: ['Article.Author: outbound-relation.', 'Article.Replies: inverse-relation.'],
      rows: [],
    })
    Expect(entity.sources[0]).toMatchObject({
      issues: ['Studio feed row is missing required Article.Author.'],
      rows: [],
    })
  })

  Test('keeps all sources for empty projects and rejects unknown scenario selection', () => {
    const result = StudioFeedBrowser.build({ ...manifest(), fixtures: [], scenarios: [] }, { seed: 'seed' })
    Expect(result.inventory.entities[0]!.sources.map(source => source.kind)).toEqual([
      'fixture',
      'generated',
      'live',
      'library',
    ])
    Expect(() => StudioFeedBrowser.build(manifest(), { activeScenarioId: 'missing', seed: 'seed' }))
      .toThrow('scenario does not exist')
  })
})

const article: EntityGenerationDeclaration = {
  collection: 'Articles',
  fields: [
    { name: 'Title', optional: false, secret: false, type: { kind: 'scalar', scalar: 'text' } },
    { name: 'Secret', optional: true, secret: true, type: { kind: 'scalar', scalar: 'text' } },
    {
      name: 'Status',
      optional: true,
      secret: false,
      type: { cases: ['Draft', 'Published'], kind: 'case', name: 'Status' },
    },
    { name: 'PublishedAt', optional: true, secret: false, type: { kind: 'scalar', scalar: 'time' } },
  ],
  kind: 'entity',
  name: 'Article',
}

function manifest(): StudioPreviewManifestV2 {
  const source = {
    kind: 'tao' as const,
    path: 'App.tao',
    range: { end: 1, start: 0 },
  }
  return {
    capabilities: { captureDomains: [], scheme: 'reactive-browser' },
    cells: [],
    compileRevision: 1,
    fixtures: [
      {
        fixtureId: 'Main',
        label: 'Main fixture',
        plan: {
          creates: [{
            entity: 'Article',
            fields: { Secret: 'hidden fixture', Title: 'Active title' },
            name: 'MainArticle',
          }],
        },
        source,
      },
      {
        fixtureId: 'EdgeCases',
        label: 'Edge cases',
        plan: { creates: [{ entity: 'Article', fields: { Title: 'Edge title' }, name: 'EdgeArticle' }] },
        source,
      },
    ],
    generationDeclarations: [article],
    manifestRevision: 'one',
    parametersBySubject: {},
    project: { appName: 'App', entryPath: 'App.tao', root: '/project' },
    scenarios: [{
      args: {},
      fixtureId: 'Main',
      group: 'App',
      label: 'Main',
      prepare: [],
      scenarioId: 'App.main',
      source,
      stateLayers: [],
      subjectId: 'App',
    }],
    sourceVersions: {},
    states: [],
    subjects: [],
    version: 2,
  }
}
