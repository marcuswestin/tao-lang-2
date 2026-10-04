import { FS, ProjectIdentity } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '../compiler-src/workspace'

const source = `
  app Demo { id "com.tao.demo" version "1.0.0" name "Demo" view Home }
  view Home() { render inject \`\`\`ts return null \`\`\` }
`

Describe('compiled project origin identity', () => {
  Test('keeps declaration origins across a copied project and isolates a new project ID', async () => {
    await withTaoFiles('tao-compiler-project-origin-', {
      'First/.tao/.gitkeep': '',
      'First/App.tao': source,
      'Second/.tao/.gitkeep': '',
      'Second/App.tao': source,
      'Unused/.tao/.gitkeep': '',
      'Unused/Package.tao': 'package { name "Unused" version 1.0.0 license AGPL-3.0-only }',
    }, async (paths, root) => {
      const firstRoot = FS.resolvePath('First', root)
      const secondRoot = FS.resolvePath('Second', root)
      const firstId = ProjectIdentity.read(firstRoot)
      const secondId = ProjectIdentity.read(secondRoot)
      Expect(firstId).toBeDefined()
      Expect(secondId).toBeDefined()
      Expect(firstId).not.toBe(secondId)
      // This marked project is indexed, but the selected app does not require its publication.
      await FS.remove(FS.resolvePath('Unused/.tao/project.json', root))

      const declaration = (id: string) =>
        JSON.stringify([
          'tao.declaration',
          1,
          id,
          '@workspace',
          'App',
          'app',
          'Demo',
        ])
      const compile = async (path: string) => (await Workspace.compile(path)).files.map(file => file.code).join('\n')
      const original = await compile(paths['First/App.tao'])
      const independent = await compile(paths['Second/App.tao'])
      Expect(original).toContain(declaration(firstId!))
      Expect(independent).toContain(declaration(secondId!))
      Expect(independent).not.toContain(declaration(firstId!))

      await FS.writeText(
        FS.resolvePath('.tao/project.json', secondRoot),
        await FS.readText(FS.resolvePath('.tao/project.json', firstRoot)),
      )
      const copied = await compile(paths['Second/App.tao'])
      Expect(copied).toContain(declaration(firstId!))
      Expect(copied).not.toContain(declaration(secondId!))
    })
  })
})
