import type { EntityGenerationDeclaration } from '@generation'
import { Describe, Expect, Test } from '@shared/test'
import { StudioFeedBrowser } from '../studio-src/StudioFeedBrowser'
import { StudioFeedDraft } from '../studio-src/StudioFeedDraft'
import type { StudioFeedSource } from '../studio-src/StudioFeedSource'
import type { StudioPreviewManifestV2 } from '../studio-src/StudioPreviewManifest'
import type { StudioSketchCatalogSnapshot } from '../studio-src/StudioSketchCatalog'

Describe('Studio Feed draft preparation', () => {
  Test(
    'promotes inverse members after their parent without mistaking reverse discovery for a creation cycle',
    async () => {
      const base = fixture()
      const manifest: StudioPreviewManifestV2 = {
        ...base.manifest,
        generationDeclarations: base.manifest.generationDeclarations.map(declaration =>
          declaration.kind === 'entity' && declaration.name === 'Person'
            ? {
              ...declaration,
              fields: [...declaration.fields, {
                name: 'Reports',
                optional: true,
                secret: false,
                type: { entity: 'Person', inverse: true, kind: 'relation' as const },
              }],
            }
            : declaration
        ),
      }
      const browser = StudioFeedBrowser.build(manifest, { seed: 'seed' })
      const rowId = browser.inventory.entities.find(entity => entity.name === 'Person')!.sources[0]!.rows[0]!.id
      const calls: Parameters<typeof StudioFeedSource.prepare>[0][] = []
      await StudioFeedDraft.prepare({
        ...base,
        browser,
        manifest,
        request: { ...base.request, kind: 'select', rowId },
        prepareSource: async request => {
          calls.push(request)
          return { sources: { '/project/@/studio/View1.tao': request.viewSource } }
        },
      })
      Expect(calls[0]!.promotions.map(row => row.fields['Name'])).toEqual(['Boss', 'Author'])
      Expect(calls[0]!.promotions[1]!.fields['Manager']).toEqual({
        handle: calls[0]!.promotions[0]!.name,
        kind: 'fixture-reference',
      })
    },
  )

  Test('resolves fixture relation closure and binds a copied catalog without writing or changing content', async () => {
    const input = fixture()
    const calls: Parameters<typeof StudioFeedSource.prepare>[0][] = []
    const result = await StudioFeedDraft.prepare({
      ...input,
      prepareSource: async request => {
        calls.push(request)
        return {
          sources: { '/project/@/studio/View1.tao': request.viewSource, '/project/@/studio/Sketches.tao': 'prepared' },
        }
      },
    })
    Expect(calls).toHaveLength(1)
    Expect(calls[0]!.promotions.map(row => row.entity)).toEqual(['Person', 'Person', 'Article'])
    const [manager, author, article] = calls[0]!.promotions
    Expect(author!.fields['Manager']).toEqual({ handle: manager!.name, kind: 'fixture-reference' })
    Expect(article!.fields['Author']).toEqual({ handle: author!.name, kind: 'fixture-reference' })
    Expect(result.selectedHandle).toBe(article!.name)
    Expect(result.catalog.sketches[0]!.rects[0]).toMatchObject({
      content: 'Original',
      fieldBinding: { parameter: 'Article', path: 'Author.Name', presentation: { kind: 'text' } },
    })
    Expect(input.catalog.sketches[0]!.rects[0]).not.toHaveProperty('fieldBinding')
    Expect(result.catalog.revision).toBe(3)
    Expect(result.sources).toEqual({
      '/project/@/studio/View1.tao': 'public view View1 {}',
      '/project/@/studio/Sketches.tao': 'prepared',
    })
  })

  Test(
    'rejects forged rows and private, collection, or incompatible presentation bindings before building source',
    async () => {
      const base = fixture()
      for (
        const request of [
          { ...base.request, rowId: 'forged' },
          { ...base.request, path: ['Secret'] },
          { ...base.request, path: ['Author'] },
          { ...base.request, path: ['Count'], presentation: 'image' as const },
          { ...base.request, path: ['Author', 'Manager', 'Name'] },
        ]
      ) {
        const calls: unknown[] = []
        await Expect(StudioFeedDraft.prepare({
          ...base,
          prepareSource: async request => {
            calls.push(request)
            return { sources: {} }
          },
          request,
        })).rejects.toThrow()
        Expect(calls).toHaveLength(0)
      }
    },
  )

  Test('allocates a deterministic different handle for an existing conflicting shared fixture row', async () => {
    const base = fixture()
    const calls: Parameters<typeof StudioFeedSource.prepare>[0][] = []
    const build: typeof StudioFeedSource.prepare = async request => {
      calls.push(request)
      return { sources: { '/project/@/studio/View1.tao': request.viewSource } }
    }
    const first = await StudioFeedDraft.prepare({ ...base, prepareSource: build })
    const existing = `public fixture Sketches { ${first.selectedHandle} = create Article { Title: "Conflict" } }`
    const readSource = async (path: string) => path.endsWith('Sketches.tao') ? existing : 'public view View1 {}'
    const second = await StudioFeedDraft.prepare({ ...base, prepareSource: build, readSource })
    const repeated = await StudioFeedDraft.prepare({ ...base, prepareSource: build, readSource })
    Expect(second.selectedHandle).toBe(`${first.selectedHandle}_2`)
    Expect(repeated.selectedHandle).toBe(second.selectedHandle)
  })
})

function fixture() {
  const person: EntityGenerationDeclaration = {
    collection: 'People',
    kind: 'entity',
    name: 'Person',
    fields: [
      { name: 'Name', optional: false, secret: false, type: { kind: 'scalar', scalar: 'text' } },
      { name: 'Manager', optional: true, secret: false, type: { entity: 'Person', inverse: false, kind: 'relation' } },
    ],
  }
  const article: EntityGenerationDeclaration = {
    collection: 'Articles',
    kind: 'entity',
    name: 'Article',
    fields: [
      { name: 'Title', optional: false, secret: false, type: { kind: 'scalar', scalar: 'text' } },
      { name: 'Count', optional: true, secret: false, type: { kind: 'scalar', scalar: 'number' } },
      { name: 'Secret', optional: true, secret: true, type: { kind: 'scalar', scalar: 'text' } },
      { name: 'Author', optional: false, secret: false, type: { entity: 'Person', inverse: false, kind: 'relation' } },
    ],
  }
  const source = { kind: 'tao' as const, path: 'App.tao', range: { end: 1, start: 0 } }
  const manifest: StudioPreviewManifestV2 = {
    capabilities: { captureDomains: [], scheme: 'reactive-browser' },
    cells: [],
    compileRevision: 1,
    fixtures: [{
      fixtureId: 'Main',
      label: 'Main',
      source,
      plan: {
        creates: [
          { entity: 'Person', fields: { Name: 'Boss' }, name: 'Boss' },
          {
            entity: 'Person',
            fields: { Manager: { handle: 'Boss', kind: 'fixture-reference' }, Name: 'Author' },
            name: 'Writer',
          },
          {
            entity: 'Article',
            fields: { Author: { handle: 'Writer', kind: 'fixture-reference' }, Title: 'Story' },
            name: 'Story',
          },
        ],
      },
    }],
    generationDeclarations: [person, article],
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
  const browser = StudioFeedBrowser.build(manifest, { seed: 'seed' })
  const rowId = browser.inventory.entities.find(entity => entity.name === 'Article')!.sources[0]!.rows[0]!.id
  const catalog: StudioSketchCatalogSnapshot = {
    formatVersion: 1,
    nextViewNumber: 2,
    revision: 3,
    sketches: [{
      height: 100,
      id: 'sketch1',
      name: 'Sketch',
      project: '/project',
      rectOrder: ['rect1'],
      rects: [{ content: 'Original', height: 20, id: 'rect1', kind: 'text', width: 20, x: 0, y: 0 }],
      snapped: [],
      view: 'View1',
      width: 100,
      x: 0,
      y: 0,
    }],
  }
  return {
    browser,
    catalog,
    entryPath: 'App.tao',
    manifest,
    projectRoot: '/project',
    readSource: async (path: string) => path.endsWith('Sketches.tao') ? undefined : 'public view View1 {}',
    request: {
      catalogRevision: 3,
      draftRevision: 0,
      kind: 'bind' as const,
      path: ['Author', 'Name'],
      presentation: 'text' as const,
      rectId: 'rect1',
      requestId: 'bind1',
      rowId,
      sketchId: 'sketch1',
    },
  }
}
