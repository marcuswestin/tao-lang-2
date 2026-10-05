import { LSPWorkspace, Workspace } from '@compiler/workspace'
import { AST, Langium } from '@parser'
import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: wildcard imports', () => {
  Test('compiles only referenced runtime exports while retaining private transitive helpers', async () => {
    await withTaoFiles('tao-wildcard-closure-', {
      'Main.tao': `
        use all from ./Library
        app Demo { id "com.tao.wildcard" version "1.0.0" name "Wildcard" view Home }
        view Home { render Widget }
      `,
      'Library/Widget.tao': `
        let Caption = "private helper"
        public view Widget { render "{Caption}" }
      `,
      'Library/Unused.tao': 'public view Unused { render "unused export" }',
    }, async (paths, root) => {
      const result = await (await Workspace.open(root)).compile(paths['Main.tao']!)
      const sources = result.files.map(file => file.sourcePath)
      Expect(sources).toContain(paths['Library/Widget.tao'])
      const widget = result.files.find(file =>
        file.sourcePath === paths['Library/Widget.tao'] && file.relativePath.endsWith('.tsx')
      )
      Expect(widget?.code).toContain('private helper')
      const main = result.files.find(file =>
        file.sourcePath === paths['Main.tao'] && file.relativePath.endsWith('.tsx')
      )
      Expect(main?.code).toContain('Widget')
      Expect(main?.code).not.toContain('Unused')
    })
  })

  Test('links the standard library through wildcard imports', async () => {
    const result = await Compiler.compileCode(`
      use all from @tao/ui
      app Demo { id "com.tao.wildcard.ui" version "1.0.0" name "Wildcard" view Home }
      view Home { render Col { Spacer Button("Ready") { on press -> { } } } }
    `)
    Expect(result.code).toContain('Ready')
  })

  Test('rebuilds wildcard scope when a public export changes', async () => {
    await withTaoFiles('tao-wildcard-freshness-', {
      'Main.tao': 'use all from ./Library.tao view Home { render Badge }',
      'Library.tao': 'public view Badge { render "Before" }',
    }, async (paths, root) => {
      const workspace = await LSPWorkspace.open(root)
      await workspace.validate(paths['Main.tao']!)
      const { shared } = workspace.services
      const documents = shared.workspace.LangiumDocuments
      const builder = shared.workspace.DocumentBuilder
      const main = documents.getDocument(Langium.URI.file(paths['Main.tao']!))!
      const errors = () => (main.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1)
      Expect(errors()).toEqual([])
      await FS.writeText(paths['Library.tao']!, 'file view Badge { render "After" }')
      await builder.update([Langium.URI.file(paths['Library.tao']!)], [])
      const render = AST.streamAllContents(main.parseResult.value).find(AST.isRender)
      Expect.Is(render, AST.isRender)
      Expect(render.view?.ref).toBeUndefined()
      Expect(errors().some(error => typeof error.message === 'string' && error.message.includes('Badge'))).toBe(true)
    })
  })

  Test('revalidates unused wildcard collisions when exports are added and removed', async () => {
    await withTaoFiles('tao-wildcard-unused-freshness-', {
      'Main.tao': 'use all from ./Library.tao\nlet Added = "local"',
      'Library.tao': 'public let Other = "initial"',
    }, async (paths, root) => {
      const workspace = await LSPWorkspace.open(root)
      await workspace.validate(paths['Main.tao']!)
      const { shared } = workspace.services
      const main = shared.workspace.LangiumDocuments.getDocument(Langium.URI.file(paths['Main.tao']!))!
      const errors = () => (main.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1)
      Expect(errors()).toEqual([])
      await FS.writeText(paths['Library.tao']!, 'public let Added = "new"')
      await shared.workspace.DocumentBuilder.update([Langium.URI.file(paths['Library.tao']!)], [])
      Expect(errors().some(error => typeof error.message === 'string' && error.message.includes('Added'))).toBe(true)
      await FS.writeText(paths['Library.tao']!, 'public let Other = "restored"')
      await shared.workspace.DocumentBuilder.update([Langium.URI.file(paths['Library.tao']!)], [])
      Expect(errors()).toEqual([])
    })
  })
})
