import { Workspace } from '@compiler/workspace'
import { Assert, CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

Describe('compiler: associated action authentication context', () => {
  Test(
    'passes the mounted scope through module, view, nested and cyclic selections while plain actions remain unscoped',
    async () => {
      await withTaoFiles('tao-associated-action-auth-', {
        'Main.tao': `
        use Books, Book, Caller, PlainCaller, CycleCaller from ./Books
        app Demo { id "com.tao.action.auth" version "1.0.0" name "Scoped actions" view Main }
        view Main() {
          action Select(Row Book) {
            let Saved = Row.Forward
            do Saved()
          }
          action SelectPlain(Row Book) { do Row.Plain() }
          render Empty()
        }
        view Empty() from ./Native.tsx
      `,
        'Books.tao': `
        public data Books / Book {
          Title text,
          action Book.Duplicate() { create Book { Title: "created" } },
          action Book.Forward() { do Book.Duplicate() },
          action Book.Plain() { },
          action Book.CycleA() { if false { do Book.CycleB() } },
          action Book.CycleB() { if false { do Book.CycleA() } create Book { Title: "cycle" } }
        }
        public action Caller(Row Book) { do Row.Forward() }
        public action PlainCaller(Row Book) { do Row.Plain() }
        public action CycleCaller(Row Book) { do Row.CycleA() }
      `,
        'Native.tsx': 'export function Empty(_props: { Layout?: unknown; Tag?: string }) { return null }',
      }, async (paths, root) => {
        const compiled = await (await Workspace.open(root)).compile(paths['Main.tao'])
        const main = compiled.files.find(file =>
          file.sourcePath === paths['Main.tao'] && file.relativePath.endsWith('.tsx')
        )
        const books = compiled.files.find(file =>
          file.sourcePath === paths['Books.tao'] && file.relativePath.endsWith('.tsx')
        )
        Assert.defined(main, 'the actual view selection module is emitted')
        Assert.defined(books, 'the actual associated create action module is emitted')
        const mainCode = main.code.replace(/\s+/g, ' ')
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
        import { Caller, PlainCaller, _TaoDataCatalog } from ${
            JSON.stringify(FS.resolvePath(books.relativePath, output))
          }
        import TR from ${JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))}
        import { runtimeConsole } from ${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/Platform.ts'))}
        const firstScope = TR.Auth.CreateScope()
        const secondScope = TR.Auth.CreateScope()
        try {
          const first = TR.Auth.Store(firstScope, _TaoDataCatalog)
          const second = TR.Auth.Store(secondScope, _TaoDataCatalog)
          TR.Data.Create(first, 'Book', { Title: TR.Value('first') })
          TR.Data.Create(second, 'Book', { Title: TR.Value('second') })
          const row = (store: typeof first) => TR.Value(store.query({ entity: 'Book', filters: [] })[0])
          await TR.DoResult(TR.Call(Caller, TR.Value(firstScope)), row(first))
          await TR.DoResult(TR.Call(Caller, TR.Value(secondScope)), row(second))
          await TR.DoResult(TR.Call(Caller, TR.Value(firstScope)), row(first))
          await TR.DoResult(PlainCaller, row(first))
          const titles = (store: typeof first) => store.query({ entity: 'Book', filters: [] })
            .map(value => TR.Member(TR.Value(value), ['Title']).evaluate().jsValue)
          runtimeConsole.info(JSON.stringify({ first: titles(first), second: titles(second), unscoped: titles(_TaoDataCatalog) }))
        } finally {
          firstScope.dispose()
          secondScope.dispose()
        }
      `,
        )
        const config = FS.resolvePath('tsconfig.json', root)
        await FS.writeJson(config, {
          extends: Repo.resolvePath('packages/tsconfig.base.json'),
          compilerOptions: {
            allowImportingTsExtensions: true,
            composite: false,
            declaration: false,
            incremental: false,
            jsx: 'react-jsx',
            lib: ['ES2023', 'DOM'],
            noEmit: true,
            rootDir: '/',
            typeRoots: [Repo.resolvePath('node_modules/@types')],
            types: ['bun', 'node'],
          },
          include: [program, `${output}/**/*.ts`, `${output}/**/*.tsx`],
        })
        const checked = await CLI.run(Platform.runtimeProcess.execPath, {
          args: [Repo.resolvePath('node_modules/typescript-native/bin/tsc'), '--project', config],
          processPolicy: 'test',
        })
        const executed = await CLI.run(Platform.runtimeProcess.execPath, {
          args: [program],
          cwd: root,
          processPolicy: 'test',
        })
        Expect({ exitCode: executed.exitCode, stderr: executed.stderr }).toEqual({ exitCode: 0, stderr: '' })
        Expect(JSON.parse(executed.stdout)).toEqual({
          first: ['first', 'created', 'created'],
          second: ['second', 'created'],
          unscoped: [],
        })
        Expect({ exitCode: checked.exitCode, stdout: checked.stdout, stderr: checked.stderr }).toEqual({
          exitCode: 0,
          stdout: '',
          stderr: '',
        })
        Expect(booksCode.match(/_TaoAuthScope: TR.AuthScope \| undefined = undefined/g)).toHaveLength(4)
        Expect(booksCode).toContain('_Scope.Caller = TR.Function((_TaoAuthArgument: TR.Evaluable) =>')
        Expect(booksCode).toContain('_Scope.CycleCaller = TR.Function((_TaoAuthArgument: TR.Evaluable) =>')
        Expect(booksCode).toContain('_Scope.PlainCaller = TR.Action(')
        Expect(booksCode).toMatch(/\["\$actions"\]\[0\]\(TR.CaptureActionReceiver\([^]*?"one"\), \{\}, _TaoAuthScope\)/)
        Expect(mainCode).toMatch(
          /\["\$actions"\]\[1\]\(TR.CaptureActionReceiver\([^]*?"one"\), \{ owner: _TaoActionOwner \}, _TaoAuthScope\)/,
        )
        Expect(mainCode).toMatch(
          /\["\$actions"\]\[2\]\(TR.CaptureActionReceiver\([^]*?"one"\), \{ owner: _TaoActionOwner \}\)/,
        )
      })
    },
  )
})
