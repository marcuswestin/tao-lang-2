import { Expect, Test } from '@shared/test'
import { StudioFeedSamples } from '../studio-src/client/StudioFeedSamples'
import type { StudioFeedBrowserInventory } from '../studio-src/StudioFeedBrowser'
import type { StudioFeedItemId } from '../studio-src/StudioFeedInventory'
import type { StudioPreviewManifestV2 } from '../studio-src/StudioPreviewManifest'
import type { StudioJsonObject } from '../studio-src/StudioProtocol'
import type { StudioSketchCatalogSnapshot } from '../studio-src/StudioSketchCatalog'

const catalog: StudioSketchCatalogSnapshot = {
  formatVersion: 1,
  nextViewNumber: 2,
  revision: 1,
  sketches: [{
    id: 'sketch',
    view: 'View1',
    name: 'View 1',
    project: '/project',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rectOrder: ['title', 'cover'],
    snapped: [],
    rects: [
      {
        id: 'title',
        kind: 'Text',
        content: 'Authored',
        x: 0,
        y: 0,
        width: 50,
        height: 20,
        fieldBinding: { parameter: 'Post', path: 'Author.Name', presentation: { kind: 'text' } },
      },
      {
        id: 'cover',
        kind: 'Image',
        x: 0,
        y: 25,
        width: 50,
        height: 50,
        fieldBinding: { parameter: 'Post', path: 'Cover', presentation: { kind: 'image' } },
      },
    ],
  }],
}
const source = { kind: 'tao' as const, path: '/project/View1.tao', range: { start: 0, end: 10 } }
const rows: StudioJsonObject[] = [
  {
    entity: 'Post',
    name: 'Story',
    fields: { Author: { kind: 'fixture-reference', handle: 'Writer' }, Cover: 'https://example.test/a.png' },
  },
  { entity: 'Author', name: 'Writer', fields: { Name: 'Mina' } },
]
function manifest(): StudioPreviewManifestV2 {
  return {
    capabilities: { captureDomains: ['data'], scheme: 'reactive-browser' },
    cells: [],
    compileRevision: 1,
    fixtures: [{ fixtureId: 'fixture', label: 'Sketches', source, plan: { creates: rows } }],
    generationDeclarations: [],
    manifestRevision: 'one',
    parametersBySubject: {},
    project: { root: '/project', appName: 'Test', entryPath: 'View1.tao' },
    scenarios: [{
      args: { Post: { kind: 'fixture-reference', handle: 'Story' } },
      fixtureId: 'fixture',
      group: 'sketch',
      label: 'draft',
      prepare: [],
      scenarioId: 'draft',
      source,
      stateLayers: [],
      subjectId: 'view',
    }],
    sourceVersions: {},
    states: [],
    subjects: [{ kind: 'view', subjectId: 'view', viewName: 'View1', source }],
    version: 2,
  }
}

Test('reopened kept examples resolve scalar and related fixture handles from scenario arguments', () => {
  const values = StudioFeedSamples.project(catalog, { entities: [] }, {}, manifest(), 'draft')
  Expect(values['sketch']?.['title']).toEqual({ text: 'Mina', label: 'Author.Name' })
  Expect(values['sketch']?.['cover']).toMatchObject({ imageUrl: 'https://example.test/a.png' })
  Expect(catalog.sketches[0]?.rects[0]?.content).toBe('Authored')
})

Test('transient samples resolve related inventory rows only in their fixture and reject unsafe image URLs', () => {
  const inventory: StudioFeedBrowserInventory = {
    entities: [{
      name: 'Post',
      collection: 'Posts',
      fields: [],
      sources: [{
        kind: 'fixture',
        issues: [],
        truncated: false,
        rows: [
          {
            id: 'post' as StudioFeedItemId,
            label: 'Story',
            fields: { Author: { kind: 'fixture-reference', handle: 'Writer' }, Cover: 'javascript:alert(1)' },
            source: { kind: 'fixture', row: 'Story', fixtureId: 'fixture' },
          },
          {
            id: 'author' as StudioFeedItemId,
            label: 'Writer',
            fields: { Name: 'Mina' },
            source: { kind: 'fixture', row: 'Writer', fixtureId: 'fixture' },
          },
          {
            id: 'other' as StudioFeedItemId,
            label: 'Writer',
            fields: { Name: 'Wrong fixture' },
            source: { kind: 'fixture', row: 'Writer', fixtureId: 'other' },
          },
        ],
      }],
    }],
  }
  const values = StudioFeedSamples.project(catalog, inventory, { rowId: 'post', sketchId: 'sketch' })
  Expect(values['sketch']?.['title']?.text).toBe('Mina')
  Expect(values['sketch']?.['cover']).not.toHaveProperty('imageUrl')
})

Test('selecting a different entity preserves the example for existing parameter bindings', () => {
  const inventory: StudioFeedBrowserInventory = {
    entities: [{
      name: 'Article',
      collection: 'Articles',
      fields: [],
      sources: [{
        kind: 'generated',
        issues: [],
        truncated: false,
        rows: [
          {
            id: 'article' as StudioFeedItemId,
            label: 'Article',
            fields: { Cover: 'https://example.test/wrong.png' },
            source: { kind: 'generated', row: 'article' },
          },
        ],
      }],
    }],
  }
  const values = StudioFeedSamples.project(
    catalog,
    inventory,
    { rowId: 'article', sketchId: 'sketch' },
    manifest(),
    'draft',
  )
  Expect(values['sketch']?.['title']?.text).toBe('Mina')
  Expect(values['sketch']?.['cover']?.imageUrl).toBe('https://example.test/a.png')
})
