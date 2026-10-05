import { Workspace } from '@compiler/workspace'
import { Assert, CLI, Diagnostics, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'

Describe('compiler: grouped row builders across a native boundary', () => {
  Test('compiles capability-valued rows with the selected private Book renderer', async () => {
    const native = await FS.readText(FS.resolvePath('Apps/Syntax2/library/GroupedRows.ts', Repo.getRoot()))
    const groupedSource = await FS.readText(Repo.resolvePath('Apps/Syntax2/library/GroupedRows.tao'))
    const design = await FS.readText(Repo.resolvePath('Apps/Syntax2/Design.tao'))
    await withTaoFiles('tao-grouped-rows-builders-', {
      'Main.tao': `
        use GroupedRows from ./GroupedRows

        app GroupedRowsProof {
          id "com.tao.groupedrows.builders" version "1.0.0" name "Grouped rows" Design LibraryDesign view Main
        }
        view Main() { render "Rows" }
      `,
      'Design.tao': design,
      'GroupedRows.tao': groupedSource,
      'Library.tao': `
        use RenderKey from @tao/ui
        public data People / Person { Name text }
        public data Books / Book {
          Title text,
          Author Person?,
          func Book.Key() fails never -> RenderKey { return RenderKey "book:{Book.Id}" },
          view Book.Render() { render BookCard(Book.Title) }
        }
        view BookCard(Title text) from ./BookCard.tsx
      `,
      'BookCard.tsx':
        'export function BookCard({ Title }: { Title: string; Layout?: unknown; Tag?: string }) { return null }',
      'GroupedRows.ts': native,
    }, async (paths, root) => {
      const result = await (await Workspace.open(root)).compile(paths['Main.tao'])
      Expect(Diagnostics.errorMessages(result.validation.diagnostics)).toEqual([])

      const main = result.files.find(file =>
        file.sourcePath === paths['GroupedRows.tao'] && file.relativePath.endsWith('.tsx')
      )
      const library = result.files.find(file =>
        file.sourcePath === paths['Library.tao'] && file.relativePath.endsWith('.tsx')
      )
      const nativeFile = result.files.find(file => file.sourcePath === paths['GroupedRows.ts'])
      Assert.defined(main, 'the grouped row consumer is emitted')
      Assert.defined(library, 'the Book owner module is emitted')
      Assert.defined(nativeFile, 'the native projection is part of the compiled source graph')

      const libraryCode = library.code.replace(/\s+/g, ' ')
      Expect(libraryCode).toContain('TR.Member(_Scope.Book, ["Id"])')
      Expect(libraryCode).not.toContain('TR.Member(_Scope.Books, ["Id"])')
      const libraryRelativePath = FS.relativePath(FS.dirname(main.relativePath), library.relativePath)
        .replace(/\.[cm]?tsx?$/, '')
      const libraryImport = libraryRelativePath.startsWith('.') ? libraryRelativePath : `./${libraryRelativePath}`
      Expect(main.code).toContain(`from "${libraryImport}"`)
      Expect(main.code).toContain('__tao_associated_import_')
      Expect(main.code).toContain('TR.Capability.attach')
      Expect(library.code).toContain("import { BookCard as __tao_foreign_view_BookCard__ } from './BookCard'")
      Expect(library.code).toContain('export { __tao_associated_witness_')

      await FS.symlink(Repo.resolvePath('packages/apps/expo-host/node_modules'), FS.resolvePath('node_modules', root))
      for (const generated of result.files) {
        await FS.writeText(FS.resolvePath(`types-out/${generated.relativePath}`, root), generated.code)
      }
      const nativePaths = result.files.filter(file => file.sourcePath === paths['GroupedRows.ts']).map(file =>
        FS.resolvePath(`types-out/${file.relativePath}`, root)
      )
      Expect(nativePaths.length).toBeGreaterThan(0)
      const emittedTypeScriptPaths = result.files.filter(file =>
        file.relativePath.endsWith('.ts') || file.relativePath.endsWith('.tsx')
      ).map(file => FS.resolvePath(`types-out/${file.relativePath}`, root))
      const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(emittedTypeScriptPaths, {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ['bun'],
        lib: ['lib.es2023.d.ts'],
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowSyntheticDefaultImports: true,
        jsx: ts.JsxEmit.React,
        allowImportingTsExtensions: true,
        paths: {
          '@tao/runtime': [FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot())],
          '@runtime/*': [FS.resolvePath('packages/apps/runtime/TaoRuntime-src/*', Repo.getRoot())],
          react: [FS.resolvePath('packages/apps/runtime/node_modules/@types/react/index.d.ts', Repo.getRoot())],
        },
      })).map(diagnostic => ({
        path: diagnostic.file?.fileName,
        line: diagnostic.file && diagnostic.start !== undefined
          ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
          : undefined,
        code: diagnostic.code,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      }))
      Expect(diagnostics).toEqual([])

      const output = FS.resolvePath('out', root)
      for (const generated of result.files) {
        if (generated.relativePath.endsWith('.d.ts')) {
          continue
        }
        await FS.writeText(FS.resolvePath(generated.relativePath, output), generated.code)
      }
      await FS.writeJson(FS.resolvePath('tsconfig.json', root), {
        compilerOptions: {
          paths: {
            '@runtime/*': [FS.resolvePath('packages/apps/runtime/TaoRuntime-src/*', Repo.getRoot())],
            '@tao/runtime': [Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts')],
            react: [FS.resolvePath('packages/apps/runtime/node_modules/react/index.js', Repo.getRoot())],
          },
        },
      })
      const program = FS.resolvePath('CheckRows.ts', root)
      await FS.writeText(
        program,
        `
        import { mock } from 'bun:test'
        import TR from ${JSON.stringify(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))}
        import { runtimeConsole } from ${
          JSON.stringify(FS.resolvePath('packages/shared/shared-src/Platform.ts', Repo.getRoot()))
        }
        mock.module('react-native', () => ({
          ActivityIndicator: 'ActivityIndicator', Image: 'Image', KeyboardAvoidingView: 'KeyboardAvoidingView',
          Platform: { OS: 'ios' }, Pressable: 'Pressable', ScrollView: 'ScrollView', Switch: 'Switch',
          Text: 'Text', TextInput: 'TextInput', View: 'View', Button: 'Button',
        }))
        const { GroupedRows } = await import(${JSON.stringify(FS.resolvePath(main.relativePath, output))})
        const { _TaoDataCatalog } = await import(${JSON.stringify(FS.resolvePath(library.relativePath, output))})
        const scope = TR.Auth.CreateScope()
        try {
          const store = TR.Auth.Store(scope, _TaoDataCatalog)
          TR.Data.Create(store, 'Person', { Name: TR.Value('Ada') })
          TR.Data.Create(store, 'Book', { Title: TR.Value('Compiler identity') })
          const originalRows = store.query({ entity: 'Book', filters: [] })
          const originalBook = originalRows[0]
          const grouped = TR.Call(GroupedRows, TR.Value(originalRows)).evaluate().jsValue
          const header = TR.Value(grouped[0])
          const bookRow = TR.Value(grouped[1])
          const headerKey = TR.Member(header, ['RowKey']).getJSValue()
          const bookKey = TR.Member(bookRow, ['RowKey']).getJSValue()
          const headerContent = TR.Member(header, ['Content']).evaluate()
          const bookContent = TR.Member(bookRow, ['Content']).evaluate()
          const headerRendered = TR.Call(TR.Capability.method(headerContent, 'Render')).getJSValue()
          const bookRendered = TR.Call(TR.Capability.method(bookContent, 'Render')).getJSValue()
          const bookContentValue = bookContent.evaluate().jsValue
          runtimeConsole.info(JSON.stringify({
            rows: grouped.length,
            headerKey,
            bookKey,
            originalID: TR.Data.NativeEntityContext(originalBook).id,
            bookContentIdentity: bookContentValue === originalBook,
            headerRendered: headerRendered !== undefined,
            bookRendered: bookRendered !== undefined,
          }))
        } finally {
          scope.dispose()
        }
      `,
      )
      const execution = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [program],
        cwd: root,
        processPolicy: 'test',
      })
      Expect({ exitCode: execution.exitCode, stderr: execution.stderr }).toEqual({ exitCode: 0, stderr: '' })
      const actual = JSON.parse(execution.stdout)
      const originalID = actual.originalID as string
      Expect(actual).toEqual({
        rows: 2,
        headerKey: JSON.stringify(['header', JSON.stringify(['author', null])]),
        bookKey: JSON.stringify(['book', originalID]),
        originalID,
        bookContentIdentity: true,
        headerRendered: true,
        bookRendered: true,
      })
    })
  })

  Test('retains raw singular and collection receivers through associated results and rendering', async () => {
    await withTaoFiles('tao-grouped-rows-raw-receivers-', {
      'Main.tao': `
        use ReadKey, ReturnBook, ReturnBooks from ./Books
        app RawReceivers { id "com.tao.groupedrows.receivers" version "1.0.0" name "Raw receivers" view Main }
        view Main() { render Empty() }
        view Empty() from ./Native.tsx
      `,
      'Books.tao': `
        use RenderKey from @tao/ui
        public data Books / Book {
          Title text,
          action Book.Identity() { return Book },
          action Books.Identity() { return Books },
          func Book.Key() fails never -> RenderKey { return RenderKey "book:{Book.Id}" },
          view Book.Render() { render Sink(Book) }
        }
        public action ReturnBook(Row Book) {
          let Result = do Row.Identity()
          return Result
        }
        public action ReturnBooks(Rows Books) {
          let Result = do Rows.Identity()
          return Result
        }
        public func ReadKey(Row Book) fails never -> RenderKey {
          return Row.Key()
        }
        view Sink(Value Book) from ./Native.tsx
      `,
      'Native.tsx': `
        export function Empty() { return null }
        export function Sink(_props: { Value: unknown }) { return null }
      `,
    }, async (paths, root) => {
      const compiled = await (await Workspace.open(root)).compile(paths['Main.tao'])
      const books = compiled.files.find(file =>
        file.sourcePath === paths['Books.tao'] && file.relativePath.endsWith('.tsx')
      )
      Assert.defined(books, 'the associated entity module is emitted')
      const booksCode = books.code.replace(/\s+/g, ' ')

      const output = FS.resolvePath('output', root)
      for (const file of compiled.files) {
        await FS.writeText(FS.resolvePath(file.relativePath, output), file.code)
      }
      await FS.symlink(Repo.resolvePath('packages/apps/expo-host/node_modules'), FS.resolvePath('node_modules', root))
      const program = FS.resolvePath('Check.ts', root)
      await FS.writeText(
        program,
        `
        import { ReadKey, ReturnBook, ReturnBooks, _TaoDataCatalog } from ${
          JSON.stringify(FS.resolvePath(books.relativePath, output))
        }
        import TR from ${JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))}
        import { runtimeConsole } from ${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/Platform.ts'))}
        const scope = TR.Auth.CreateScope()
        try {
          const store = TR.Auth.Store(scope, _TaoDataCatalog)
          TR.Data.Create(store, 'Book', { Title: TR.Value('first') })
          TR.Data.Create(store, 'Book', { Title: TR.Value('second') })
          const rows = store.query({ entity: 'Book', filters: [] })
          const first = rows[0]
          const single = await TR.DoResult(ReturnBook, TR.Value(first))
          const collection = await TR.DoResult(ReturnBooks, TR.Value(rows))
          runtimeConsole.info(JSON.stringify({
            singleIdentity: single.evaluate().jsValue === first,
            collectionMembersIdentity: collection.evaluate().jsValue.every((row, index) => row === rows[index]),
            collectionCount: collection.evaluate().jsValue.length,
            key: TR.Call(ReadKey, TR.Value(first)).getJSValue(),
            id: TR.Data.NativeEntityContext(first).id,
          }))
        } finally {
          scope.dispose()
        }
      `,
      )
      await FS.writeJson(FS.resolvePath('tsconfig.json', root), {
        compilerOptions: {
          paths: {
            '@runtime/*': [FS.resolvePath('packages/apps/runtime/TaoRuntime-src/*', Repo.getRoot())],
            react: [FS.resolvePath('packages/apps/runtime/node_modules/react/index.js', Repo.getRoot())],
          },
        },
      })
      const executed = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [program],
        cwd: root,
        processPolicy: 'test',
      })
      Expect({ exitCode: executed.exitCode, stderr: executed.stderr }).toEqual({ exitCode: 0, stderr: '' })
      const result = JSON.parse(executed.stdout)
      Expect({
        singleIdentity: result.singleIdentity,
        collectionMembersIdentity: result.collectionMembersIdentity,
        collectionCount: result.collectionCount,
      }).toEqual({ singleIdentity: true, collectionMembersIdentity: true, collectionCount: 2 })
      Expect(result.key).toBe(`book:${result.id}`)
      Expect(booksCode).toContain('TR.Member(_Scope.Book, ["Id"])')
      Expect(booksCode).not.toContain('TR.Member(_Scope.Books, ["Id"])')
      Expect(booksCode).toContain('_Scope.Book = _ViewProps.__taoReceiver')
      Expect(booksCode).toContain('TR.Alias(() => _Scope.Book.evaluate())')
      Expect(booksCode).not.toContain('TR.Alias(() => _Scope.Books.evaluate())')
    })
  })
})
