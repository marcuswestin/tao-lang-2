import { Packages } from '@ast-utils'
import { AST, Langium } from '@parser'
import { Diagnostics, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '../../compiler-src/workspace/index'
import { createWorkspaceLspServices } from '../../compiler-src/workspace/langium-services'

const tsFence = '```ts'
const fence = '```'

// These tests live apart from `workspace.test.ts` on purpose. The compiler suite runs under Bun's
// `--concurrent`, which starts every test in a file at once on one thread, and that file holds a test
// with a two-second wall-clock budget. Four more tests sharing its window were enough to push it past
// the budget on a loaded machine.
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
        '@data/Results.tao': 'workspace type ConfirmResult is one of Confirmed',
        '@ui/Imported.tao': `
          use ConfirmResult from @data
          workspace view AsksImported() responds ConfirmResult { }
        `,
        '@ui/Unimported.tao': 'workspace view AsksUnimported() responds ConfirmResult { }',
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

  Test('lets app name an app anywhere in its own project and nowhere else', async () => {
    await withTaoFiles(
      'tao-workspace-default-app-scope-',
      {
        // Two app lines are a validation error of their own; linking still resolves each,
        // which is what lets one project declaration ask both questions.
        'Main.tao': 'project { id "outer" name "Outer" app Elsewhere app NestedApp }',
        'Apps.tao': `
          app Elsewhere { view Shown }
          view Shown() { render inject ${tsFence} return null ${fence} }
        `,
        'Nested/Apps.tao': `
          project { id "nested" name "Nested" }
          app NestedApp { view NestedShown }
          view NestedShown() { render inject ${tsFence} return null ${fence} }
        `,
      },
      async (paths, rootDir) => {
        // The documents are loaded by hand, as the editor loads a folder, so that the nested
        // project's app is in the workspace without anything having imported it.
        const services = createWorkspaceLspServices(await Packages.createContext(rootDir))
        const factory = services.shared.workspace.LangiumDocumentFactory
        const loaded = await Promise.all(
          Object.values(paths).map(path => factory.fromUri(Langium.URI.file(path))),
        )
        loaded.forEach(document => services.shared.workspace.LangiumDocuments.addDocument(document))
        await services.shared.workspace.DocumentBuilder.build(loaded, { eagerLinking: true })

        const main = loaded.find(document => document.uri.path === paths['Main.tao'])?.parseResult.value
        Expect.Is(main, AST.isTaoFile)
        const project = main.statements.find(AST.isProjectDeclaration)
        Expect.Is(project, AST.isProjectDeclaration)
        const named = AST.blockStatementOf(project, { filter: AST.isProjectDefaultApp })
          .map(defaultApp => defaultApp.app.ref?.name)

        Expect(named).toEqual(['Elsewhere', undefined])
      },
    )
  })

  Test('resolves what a test exercises by ordinary visibility', async () => {
    await withTaoFiles(
      'tao-workspace-test-dependency-scope-',
      {
        'Main.tao': `
          app Exercised { view MainView }
          view MainView() { render inject ${tsFence} return null ${fence} }
        `,
        'Unrelated.tao': `
          app Unrelated { view UnrelatedView }
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
        'App/Main.tao': `
          project { id "app" name "App" }
          use Label from @data
          workspace let Selected = Label
        `,
        'App/@data/Data.tao': 'workspace let Label = "Before"',
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

        await FS.writeText(paths['App/@data/Data.tao']!, 'workspace let Label = "After"')
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
