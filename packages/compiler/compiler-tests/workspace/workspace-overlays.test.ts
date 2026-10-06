import { AST } from '@parser'
import { Diagnostics, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import SourceActions from '@source-actions'
import { Workspace } from '../../compiler-src/workspace/index'

Describe('workspace source overlays', () => {
  Test('retains sealed capability transport evidence when compiling a union of entry graphs', async () => {
    await withTaoFiles('tao-workspace-capability-evidence-', {
      'Main.tao': `
        public can Display { ToText() fails never -> text }
        type Token is text with { func ToText() fails never -> text { return Token } }
        view Native where type T is Display (Value T) { render inject Value \`\`\`ts return null \`\`\` }
        view Main { let Provided = Token "original" render Native(.Value Provided) }
        app Preview { id "com.tao.test.batchcapability" version "1.0.0" name "Preview" view Main }
      `,
      'Extra.tao': `use Display from ./Main
        public can ExtraDisplay { Debug() fails never -> text }
        public func Relay(Value Display) -> Display { return Value }
      `,
    }, async (paths, root) => {
      const workspace = await Workspace.open(root)
      const validation = await workspace.validateFiles([paths['Main.tao'], paths['Extra.tao']])
      Expect(Diagnostics.errorMessages(validation.diagnostics)).toEqual([])
      Expect(validation.associatedEffects).toBeDefined()
      const extra = validation.files.find(file => file.path === paths['Extra.tao'])!
      const requirement = AST.streamAllContents(extra.ast).find(AST.isCapabilityMethodDeclaration)!
      Expect(requirement).toBeDefined()
      Expect(validation.associatedEffects!.descriptors.has(requirement)).toBe(true)
      const compiled = await workspace.compileFiles([paths['Main.tao'], paths['Extra.tao']])
      Expect(compiled.code).toContain('TR.Capability.attach(')
      Expect(compiled.files.map(file => file.code).join('\n')).toContain('"ToText"')
    })
  })

  Test('compiles virtual imports and shared fixtures from an immutable source snapshot', async () => {
    await withTaoFiles('tao-workspace-overlays-', {
      'Package.tao': 'package { version "1.0.0" license AGPL-3.0-only }',
      'Main.tao':
        'app Preview { id "com.tao.test.preview" version "1.0.0" name "Preview"  view Main } view Main() { render inject ```ts return null ``` }',
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
