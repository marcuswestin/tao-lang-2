import { Diagnostics, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import SourceActions from '@source-actions'
import { Workspace } from '../../compiler-src/workspace/index'

Describe('workspace source overlays', () => {
  Test('compiles virtual imports and shared fixtures from an immutable source snapshot', async () => {
    await withTaoFiles('tao-workspace-overlays-', {
      'Project.tao': 'project { id "overlays" name "Overlays" remote none }',
      'Main.tao': 'app Preview { view Main } view Main() { render inject ```ts return null ``` }',
      'Data.tao': 'public data Playlists / Playlist { Title text }',
      '@/studio/Row.tao': 'public view PlaylistRow() { render inject ```ts return null ``` }',
    }, async (paths, root) => {
      const row = paths['@/studio/Row.tao']!
      const sketches = FS.resolvePath('@/studio/Sketches.tao', root)
      const sidecar = FS.resolvePath('@/studio/Row.test.tao', root)
      const sourceOverrides = {
        [row]:
          'use Playlist from ../../Data\npublic view PlaylistRow(Playlist) { render Native() } view Native() { render inject ```ts return null ``` }',
        [sketches]:
          'use Playlist from ../../Data\npublic fixture Sketches { Chill = create Playlist { Title: "Transient title" } }',
        [sidecar]:
          'use PlaylistRow from ./Row\nuse Sketches from ./Sketches\nscenarios PlaylistRow "feed" { fixture Sketches device phone scenario "draft" { render (Playlist: Chill) } }',
      }
      const rowSource = sourceOverrides[row]!
      const workspace = await Workspace.open(root, { sourceOverrides })
      sourceOverrides[row] = 'invalid source'
      const parsed = await workspace.parse(sidecar)
      Expect(Diagnostics.errorMessages(parsed.diagnostics)).toEqual([])
      Expect(parsed.files.map(file => file.path)).toContain(sketches)
      const compiled = await workspace.compileFiles([paths['Main.tao']!, row, sidecar], {
        studio: true,
        journeyObservations: true,
      })
      Expect(compiled.files.map(file => file.code).join('\n'))
        .toContain(SourceActions.studioSourceVersion(rowSource))
      Expect(compiled.studioManifest?.fixtures[0]).toMatchObject({
        name: 'Sketches',
        creates: [{ name: 'Chill', entity: 'Playlist', fields: { Title: 'Transient title' } }],
      })
      Expect(compiled.studioManifest?.scenarios[0]?.subject).toMatchObject({
        viewName: 'PlaylistRow',
        arguments: { Playlist: { handle: 'Chill', kind: 'fixture-reference' } },
      })
      Expect(compiled.studioManifest?.views.find(view => view.name === 'PlaylistRow')?.parameters)
        .toEqual([{ name: 'Playlist', kind: 'entity', entity: 'Playlist', required: true, typeName: 'Playlist' }])
      Expect(await FS.readText(row)).toBe('public view PlaylistRow() { render inject ```ts return null ``` }')
      Expect(await FS.exists(sketches)).toBe(false)
      Expect(await FS.exists(sidecar)).toBe(false)
      Expect(await FS.exists(`${paths['Data.tao']}.ts`)).toBe(false)
      const ordinary = await (await Workspace.open(root)).parse(row)
      Expect(ordinary.entry.document.textDocument.getText()).toBe(
        'public view PlaylistRow() { render inject ```ts return null ``` }',
      )
    })
  })

  Test('loads a virtual folder sibling and rejects paths outside the physical project', async () => {
    await withTaoFiles(
      'tao-workspace-overlay-boundary-',
      { 'Main.tao': 'let Result = Shared' },
      async (paths, root) => {
        const workspace = await Workspace.open(root, {
          sourceOverrides: { 'Sibling.tao': 'folder let Shared = "virtual"' },
        })
        Expect(Diagnostics.errorMessages((await workspace.parse(paths['Main.tao']!)).diagnostics)).toEqual([])
        await Expect(Workspace.open(root, { sourceOverrides: { '../Escape.tao': '' } })).rejects.toThrow(
          'inside the workspace root',
        )
        await FS.symlink(FS.dirname(root), FS.resolvePath('escape', root))
        await Expect(Workspace.open(root, { sourceOverrides: { 'escape/Virtual.tao': '' } })).rejects.toThrow(
          'physically inside',
        )
      },
    )
  })

  Test('a virtual file shadows a same-named disk directory without loading its invalid sources', async () => {
    await withTaoFiles('tao-workspace-overlay-shadow-', {
      'Main.tao': 'use Item from ./Catalog\nlet Result = Item',
      'Catalog/Broken.tao': 'public let Item =',
    }, async (paths, root) => {
      const ordinary = await (await Workspace.open(root)).parse(paths['Main.tao'])
      Expect(ordinary.files.map(file => file.path)).toContain(paths['Catalog/Broken.tao'])
      Expect(Diagnostics.errorMessages(ordinary.diagnostics).length).toBeGreaterThan(0)

      const virtualPath = FS.resolvePath('Catalog.tao', root)
      const overlay = await Workspace.open(root, {
        sourceOverrides: { [virtualPath]: 'public let Item = "virtual"' },
      })
      const parsed = await overlay.parse(paths['Main.tao'])
      Expect(Diagnostics.errorMessages(parsed.diagnostics)).toEqual([])
      Expect(parsed.files.map(file => file.path)).toContain(virtualPath)
      Expect(parsed.files.map(file => file.path)).not.toContain(paths['Catalog/Broken.tao'])
      Expect(await FS.exists(virtualPath)).toBe(false)
      Expect(await FS.readText(paths['Catalog/Broken.tao'])).toBe('public let Item =')
    })
  })
})
