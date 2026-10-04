import { Workspace } from '@compiler/workspace'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { StudioFeedBrowser } from '../studio-src/StudioFeedBrowser'
import { StudioFeedDraft } from '../studio-src/StudioFeedDraft'
import { studioGeneratedSourceHeader } from '../studio-src/StudioGeneratedSources'
import type { StudioPreviewManifestV2 } from '../studio-src/StudioPreviewManifest'
import type { StudioSketch } from '../studio-src/StudioSketchCatalog'

Describe('HNReader Studio Feed', () => {
  Test('promotes a generated Story into a sketch and compiles its shared model binding', async () => {
    const projectRoot = Repo.resolvePath('Apps/HNReader')
    const entryPath = FS.resolvePath('HNReader.tao', projectRoot)
    const viewPath = FS.resolvePath('@/studio/View999.tao', projectRoot)
    const fixturePath = FS.resolvePath('@/studio/Sketches.tao', projectRoot)
    const existingView = await FS.exists(viewPath) ? await FS.readText(viewPath) : undefined
    const existingFixture = await FS.exists(fixturePath) ? await FS.readText(fixturePath) : undefined
    const initial = await (await Workspace.open(projectRoot))
      .compileFiles([entryPath], { appName: 'HNReader', studio: true })
    const manifest: StudioPreviewManifestV2 = {
      capabilities: { captureDomains: [], scheme: 'reactive-browser' },
      cells: [],
      compileRevision: 1,
      fixtures: [],
      generationDeclarations: initial.studioManifest!.generationDeclarations,
      manifestRevision: 'hnreader-feed',
      parametersBySubject: {},
      project: { appName: 'HNReader', entryPath, root: projectRoot },
      scenarios: [],
      sourceVersions: {},
      states: [],
      subjects: [],
      version: 2,
    }
    const browser = StudioFeedBrowser.build(manifest, { seed: 'hnreader-feed' })
    const generated = browser.inventory.entities.find(entity => entity.name === 'Story')!.sources
      .find(source => source.kind === 'generated')!
    const example = generated.rows.find(row => row.source.row === 'typical')!
    const result = await StudioFeedDraft.prepare({
      browser,
      catalog: { formatVersion: 1, nextViewNumber: 1000, revision: 1, sketches: [sketch] },
      entryPath,
      manifest,
      projectRoot,
      readSource: async path => path === viewPath ? viewSource : undefined,
      request: {
        catalogRevision: 1,
        draftRevision: 0,
        kind: 'bind',
        path: ['Title'],
        presentation: 'text',
        rectId: 'title',
        requestId: 'hnreader-generated-story',
        rowId: example.id,
        sketchId: sketch.id,
      },
    })
    Expect(result.sources[viewPath]).toContain('use Story from @model')
    Expect(result.sources[viewPath]).toContain('Text(Story.Title)')
    Expect(result.sources[fixturePath]).toContain('use Story from @model')
    const compiled = await (await Workspace.open(projectRoot, { sourceOverrides: result.sources }))
      .compileFiles([entryPath, viewPath], { appName: 'HNReader', studio: true })
    Expect(compiled.studioManifest!.views.find(view => view.name === 'View999')?.parameters).toContainEqual({
      entity: 'Story',
      kind: 'entity',
      name: 'Story',
      required: true,
      typeName: 'Story',
    })
    Expect(compiled.studioManifest!.fixtures.flatMap(fixture => fixture.creates)).toContainEqual({
      entity: 'Story',
      fields: example.fields,
      name: result.selectedHandle,
    })
    Expect(compiled.studioManifest!.scenarios.find(scenario => scenario.name === 'generatedStory')?.subject)
      .toMatchObject({ arguments: { Story: { handle: result.selectedHandle, kind: 'fixture-reference' } } })
    Expect(await FS.exists(viewPath) ? await FS.readText(viewPath) : undefined).toBe(existingView)
    Expect(await FS.exists(fixturePath) ? await FS.readText(fixturePath) : undefined).toBe(existingFixture)
  })
})

const viewSource = `${studioGeneratedSourceHeader}
use Placeholder from @tao/ui
public view View999() {
  #studio_rect_007400690074006c0065
  render Placeholder()
}
scenarios View999 "sketch" {
  device phone
  scenario "generatedStory" { }
}
`

const sketch: StudioSketch = {
  height: 100,
  id: 'hnreader-feed-regression',
  name: 'View999',
  project: 'hnreader',
  rectOrder: ['title'],
  rects: [],
  snapped: [{
    rect: { height: 20, id: 'title', kind: 'Text', width: 100, x: 0, y: 0 },
    target: {
      elementName: 'Placeholder',
      path: '@/studio/View999.tao',
      renderId: 'overlay',
      sourceVersion: 'overlay',
      studioRectId: 'title',
      view: 'View999',
    },
  }],
  view: 'View999',
  width: 200,
  x: 0,
  y: 0,
}
