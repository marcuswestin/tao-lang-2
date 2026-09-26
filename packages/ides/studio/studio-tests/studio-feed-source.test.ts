import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Diagnostics, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { StudioFeedSource } from '../studio-src/StudioFeedSource'
import { studioGeneratedSourceHeader } from '../studio-src/StudioGeneratedSources'
import type { StudioSketch } from '../studio-src/StudioSketchCatalog'

const sketch: StudioSketch = {
  height: 100,
  id: 'card',
  name: 'View1',
  project: 'feed',
  rectOrder: ['title'],
  rects: [],
  snapped: [{
    rect: { height: 20, id: 'title', kind: 'Text', width: 100, x: 0, y: 0 },
    target: {
      elementName: 'Placeholder',
      path: '@/studio/View1.tao',
      renderId: 'stale',
      sourceVersion: 'stale',
      studioRectId: 'title',
      view: 'View1',
    },
  }],
  view: 'View1',
  width: 200,
  x: 0,
  y: 0,
}

const viewSource = `${studioGeneratedSourceHeader}
use Placeholder from @tao/ui
public view View1(Title text) {
  #studio_rect_007400690074006c0065
  render Placeholder(Title)
}
scenarios View1 "sketch" {
  device phone
  render (Title: "Inherited")
  scenario "first" { render (Title: "Existing") press #studio_rect_007400690074006c0065 }
  scenario "second" { press down #studio_rect_007400690074006c0065 advance 600.ms }
}
`.trim()

const files = {
  'Main.tao': 'use Playlist from ./Data\nview Main(Playlist) { }',
  'Data.tao': 'public data Playlists / Playlist { Title text }',
  '@/studio/View1.tao': viewSource,
}

Describe('Studio Feed source preparation', () => {
  Test('prepares a linked shared fixture, required parameter, and tagged binding without writing sources', async () => {
    await withTaoFiles('tao-studio-feed-source-', files, async (paths, root) => {
      const result = await StudioFeedSource.prepare({
        bindings: [{ path: ['Title'], presentation: 'text', rectId: 'title' }],
        entity: 'Playlist',
        entryPath: paths['Main.tao'],
        projectRoot: root,
        promotions: [{ entity: 'Playlist', fields: { Title: 'Chill' }, name: 'Chill' }],
        selectedHandle: 'Chill',
        sketch,
        viewSource,
      })
      const viewPath = paths['@/studio/View1.tao']
      const fixturePath = FS.resolvePath('@/studio/Sketches.tao', root)
      const source = result.sources[viewPath]!
      Expect(source.startsWith(studioGeneratedSourceHeader)).toBe(true)
      Expect(source).toContain('view View1(Title text, Playlist)')
      Expect(source).toContain('Text(Playlist.Title)')
      Expect(source).toContain('render (Title: "Existing", Playlist: Chill)')
      Expect(source).toContain('render (Title: "Inherited", Playlist: Chill)')
      Expect(source).toContain('press down #studio_rect_007400690074006c0065\n      advance 600.ms')
      Expect(result.sources[fixturePath]).toContain('use Playlist from ../../Data.tao')
      const parsed = await (await Workspace.open(root, { sourceOverrides: result.sources })).parse(viewPath)
      const group = parsed.entry.ast.statements.find(AST.isScenarioGroupDeclaration)!
      const fixture = group.block.entries.find(AST.isScenarioFixtureClause)!.fixture.ref
      Expect.Is(fixture, AST.isFixtureDeclaration)
      Expect(AST.getDocument(fixture).uri.fsPath).toBe(fixturePath)
      Expect(await FS.readText(viewPath)).toBe(viewSource)
      Expect(await FS.exists(fixturePath)).toBe(false)

      const next = await StudioFeedSource.prepare({
        entity: 'Playlists',
        entryPath: paths['Main.tao'],
        fixtureSource: result.sources[fixturePath],
        projectRoot: root,
        promotions: [{ entity: 'Playlists', fields: { Title: 'Morning' }, name: 'Morning' }],
        scenarioName: 'second',
        selectedHandle: 'Morning',
        sketch,
        viewSource: source,
      })
      Expect(next.sources[viewPath]).toContain('render (Title: "Existing", Playlist: Chill)')
      Expect(next.sources[viewPath]).toContain('render (Title: "Inherited", Playlist: Morning)')
      Expect(next.sources[viewPath]).toContain('press down #studio_rect_007400690074006c0065\n      advance 600.ms')
      Expect(next.sources[viewPath]).toContain('Text(Playlist.Title)')
      Expect(next.sources[fixturePath]).toContain('Chill = create Playlist')
      Expect(next.sources[fixturePath]).toContain('Morning = create Playlist')
      Expect(await FS.readText(viewPath)).toBe(viewSource)
      Expect(await FS.exists(fixturePath)).toBe(false)
    })
  })

  Test('compiles canonical project-package entity imports in the view and virtual shared fixture', async () => {
    await withTaoFiles('tao-studio-feed-package-', {
      'Main.tao':
        'use Playlist from @model\napp Feed { view Main }\nview Main() { render inject ```ts return null ``` }',
      '@model/Data.tao': 'public data Playlists / Playlist { Title text }',
      '@/studio/View1.tao': viewSource,
    }, async (paths, root) => {
      const initial = await (await Workspace.open(root)).parse(paths['Main.tao'])
      Expect(Diagnostics.errorMessages(initial.diagnostics)).toEqual([])
      const result = await StudioFeedSource.prepare({
        entity: 'Playlist',
        entryPath: paths['Main.tao'],
        projectRoot: root,
        promotions: [{ entity: 'Playlist', fields: { Title: 'Chill' }, name: 'Chill' }],
        selectedHandle: 'Chill',
        sketch,
        viewSource,
      })
      const viewPath = paths['@/studio/View1.tao']
      const fixturePath = FS.resolvePath('@/studio/Sketches.tao', root)
      Expect(result.sources[viewPath]).toContain('use Playlist from @model')
      Expect(result.sources[fixturePath]).toContain('use Playlist from @model')
      const compiled = await (await Workspace.open(root, { sourceOverrides: result.sources }))
        .compileFiles([paths['Main.tao'], viewPath], { studio: true })
      Expect(compiled.studioManifest?.views.find(view => view.name === 'View1')?.parameters)
        .toContainEqual({ name: 'Playlist', kind: 'entity', entity: 'Playlist', required: true, typeName: 'Playlist' })
      Expect(await FS.readText(viewPath)).toBe(viewSource)
      Expect(await FS.exists(fixturePath)).toBe(false)
    })
  })

  Test('rejects a stale selected handle before any source is written', async () => {
    await withTaoFiles('tao-studio-feed-source-stale-', files, async (paths, root) => {
      await Expect(StudioFeedSource.prepare({
        entity: 'Playlist',
        entryPath: paths['Main.tao'],
        projectRoot: root,
        promotions: [{ entity: 'Playlist', fields: { Title: 'Chill' }, name: 'Chill' }],
        selectedHandle: 'Removed',
        sketch,
        viewSource,
      })).rejects.toThrow('does not create Playlist')
      Expect(await FS.readText(paths['@/studio/View1.tao'])).toBe(viewSource)
      Expect(await FS.exists(FS.resolvePath('@/studio/Sketches.tao', root))).toBe(false)
    })
  })
})
