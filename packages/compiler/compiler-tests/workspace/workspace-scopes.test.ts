import { Packages } from '@ast-utils'
import { AST, Langium } from '@parser'
import { Diagnostics, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '../../compiler-src/workspace/index'
import { createWorkspaceLspServices } from '../../compiler-src/workspace/langium-services'

const tsFence = '```ts'
const fence = '```'

Describe('what a workspace reference may resolve to', () => {
  // These three references once fell through to Langium's default scope, which offers every
  // top-level declaration of every loaded document. Each test loads the declaration it must not find,
  // because under the default scope being loaded was all it took to be found.
  Test("resolves a responding view's type by ordinary visibility, not by what happens to be loaded", async () => {
    await withTaoFiles(
      'tao-workspace-response-type-scope-',
      {
        'Main.tao': `
          use AsksImported, AsksUnimported from @ui
          view MainView() { }
        `,
        '@data/Results.tao': 'project type ConfirmResult is one of Confirmed',
        '@ui/Imported.tao': `
          use ConfirmResult from @data
          project view AsksImported() responds ConfirmResult { }
        `,
        '@ui/Unimported.tao': 'project view AsksUnimported() responds ConfirmResult { }',
      },
      async (paths, rootDir) => {
        const parsed = await (await Workspace.open(rootDir)).parse(paths['Main.tao']!)
        const responseOf = (path: string) =>
          parsed.files.find(file => file.path === path)?.ast.statements.find(AST.isViewDeclaration)?.response

        Expect(parsed.files.map(file => file.path)).toEqual(
          Expect['arrayContaining']([paths['@data/Results.tao'], paths['@ui/Unimported.tao']]),
        )
        Expect(responseOf(paths['@ui/Imported.tao']!)?.ref?.name).toBe('ConfirmResult')
        Expect(responseOf(paths['@ui/Unimported.tao']!)?.ref).toBeUndefined()
        Expect(Diagnostics.errorMessages(parsed.diagnostics).join('\n')).toContain('ConfirmResult')
      },
    )
  })

  Test('resolves what a test exercises by ordinary visibility', async () => {
    await withTaoFiles(
      'tao-workspace-test-dependency-scope-',
      {
        'Main.tao': `
          app Exercised { id "com.tao.test.exercised" version "1.0.0" name "Exercised"  view MainView }
          view MainView() { render inject ${tsFence} return null ${fence} }
        `,
        'Unrelated.tao': `
          app Unrelated { id "com.tao.test.unrelated" version "1.0.0" name "Unrelated"  view UnrelatedView }
          view UnrelatedView() { render inject ${tsFence} return null ${fence} }
        `,
        'Main.test.tao': `
          use Exercised from ./Main
          use UnrelatedView from ./Unrelated
          test Exercised { test "runs" { run Exercised } }
          test Unrelated { test "is not reachable" { run Exercised } }
        `,
      },
      async (paths, rootDir) => {
        const parsed = await (await Workspace.open(rootDir)).parse(paths['Main.test.tao']!)
        const dependencies = parsed.entry.ast.statements.filter(AST.isTestDeclaration)
          .map(test => test.dependencies[0]?.ref?.name)

        Expect(parsed.files.map(file => file.path)).toEqual(Expect['arrayContaining']([paths['Unrelated.tao']]))
        Expect(dependencies).toEqual(['Exercised', undefined])
      },
    )
  })

  // The editor updates a changed document in place and only relinks the files that import it, so the
  // importing file keeps its use statement while what that statement resolves to is replaced. A
  // resolution remembered across the update would point the import at a declaration in a syntax
  // tree nothing holds any more.
  Test('resolves an import against the imported file as it is after an editor update', async () => {
    await withTaoFiles(
      'tao-workspace-lsp-import-after-update-',
      {
        'App/.tao/.gitkeep': '',
        'App/Main.tao': `
          package { version "1.0.0" license AGPL-3.0-only }
          use Label from @data
          project let Selected = Label
        `,
        'App/@data/Data.tao': 'project let Label = "Before"',
      },
      async (paths, rootDir) => {
        const packagesContext = await Packages.createContext(FS.resolvePath('App', rootDir))
        const services = createWorkspaceLspServices(packagesContext)
        const documents = services.shared.workspace.LangiumDocuments
        const factory = services.shared.workspace.LangiumDocumentFactory
        const builder = services.shared.workspace.DocumentBuilder
        const main = await factory.fromUri(Langium.URI.file(paths['App/Main.tao']!))
        const data = await factory.fromUri(Langium.URI.file(paths['App/@data/Data.tao']!))
        documents.addDocument(main)
        documents.addDocument(data)
        await builder.build([main, data], { eagerLinking: true, validation: true })
        const importedLabel = () => {
          const file = main.parseResult.value
          Expect.Is(file, AST.isTaoFile)
          return file.statements.find(AST.isUseStatement)?.importedDeclarations[0]?.ref
        }
        const before = importedLabel()
        Expect(before && AST.findRoot(before)).toBe(data.parseResult.value)

        await FS.writeText(paths['App/@data/Data.tao']!, 'project let Label = "After"')
        await builder.update([data.uri], [])
        await builder.build([main, data], { eagerLinking: true, validation: true })

        const after = importedLabel()
        Expect(after).toBeDefined()
        Expect(after).not.toBe(before)
        Expect(after && AST.findRoot(after)).toBe(data.parseResult.value)
        Expect((main.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1)).toEqual([])
      },
    )
  })
})
