import { Workspace } from '@compiler/workspace'
import { Assert, CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'

Describe('compiler: Syntax2 Export completion', () => {
  Test('waits two seconds after Export before notifying its rendered BookRow', async () => {
    const appRoot = FS.resolvePath('Apps/Syntax2', Repo.getRoot())
    const result = await Workspace.compile(FS.resolvePath('Main.tao', appRoot))
    const bookViewsPath = FS.resolvePath('library/BookViews.tao', appRoot)
    Assert(
      result.validation.files.some(file => file.path === bookViewsPath),
      'the real BookViews source is in the compiled graph',
    )
    const rowModule = result.files.find(file => file.sourcePath === bookViewsPath && file.relativePath.endsWith('.tsx'))
    Assert.defined(rowModule, 'the real BookRow view emits an executable module')

    await withTaoFiles('tao-syntax2-export-completion-', {}, async (_paths, root) => {
      for (const generated of result.files) {
        if (generated.relativePath.endsWith('.d.ts')) {
          continue
        }
        await FS.writeText(
          FS.resolvePath(`out/${generated.relativePath.replace(/\.[cm]?tsx?$/, '.js')}`, root),
          ts.transpileModule(generated.code, {
            compilerOptions: {
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ESNext,
              jsx: ts.JsxEmit.React,
            },
          }).outputText,
        )
      }
      await FS.symlink(
        Repo.resolvePath('packages/apps/expo-host/node_modules'),
        FS.resolvePath('node_modules', root),
      )
      const runtimeRoot = FS.resolvePath('packages/apps/runtime/TaoRuntime-src', Repo.getRoot())
      const runtimeNodeModules = FS.resolvePath('packages/apps/runtime/node_modules', Repo.getRoot())
      await FS.writeText(
        FS.resolvePath('Clock.ts', root),
        `
        import { createContinuousClockNowMilliseconds } from ${
          JSON.stringify(FS.resolvePath('TR-continuous-clock.ts', runtimeRoot))
        }
        import { createNativeModules } from ${JSON.stringify(FS.resolvePath('TR-native-modules.ts', runtimeRoot))}
        const samples = [1000, 2500]
        let reads = 0
        export const nowMilliseconds = createContinuousClockNowMilliseconds(createNativeModules({
          'react-native': () => ({ Platform: { OS: 'ios' } }),
          'expo-modules-core': () => ({ requireNativeModule: (name: string) => {
            if (name !== 'TaoContinuousClock') throw new Error('wrong native clock module')
            return { nowMilliseconds: () => samples[reads++] ?? samples[samples.length - 1]! }
          } }),
        }))
      `,
      )
      await FS.writeText(
        FS.resolvePath('tsconfig.json', root),
        JSON.stringify({
          compilerOptions: {
            paths: {
              '@runtime/*': [FS.resolvePath('*', runtimeRoot)],
              '@tao/runtime': [FS.resolvePath('TR.ts', runtimeRoot)],
              '@runtime/TR-continuous-clock': [FS.resolvePath('Clock.ts', root)],
              react: [FS.resolvePath('react/index.js', runtimeNodeModules)],
            },
          },
        }),
      )

      const rowImport = `./out/${rowModule.relativePath.replace(/\.[cm]?tsx?$/, '.js')}`
      const moduleFor = (sourcePath: string) => result.files.find(file => file.sourcePath === sourcePath)
      const provider = moduleFor(FS.resolvePath('library/BookStoreProvider.ts', appRoot))
      const io = moduleFor(FS.resolvePath('library/BookIO.ts', appRoot))
      Assert.defined(provider, 'the actual BookStore provider is emitted')
      Assert.defined(io, 'the actual BookIO adapter is emitted')
      const providerImport = `./out/${provider.relativePath.replace(/\.[cm]?tsx?$/, '.js')}`
      const ioImport = `./out/${io.relativePath.replace(/\.[cm]?tsx?$/, '.js')}`
      const runner = FS.resolvePath('Check.ts', root)
      await FS.writeText(
        runner,
        `
        import { expect, mock } from 'bun:test'
        ;(globalThis as any).expect = expect
        mock.module('react-native', () => ({
          ActivityIndicator: 'ActivityIndicator', Image: 'Image', KeyboardAvoidingView: 'KeyboardAvoidingView',
          Platform: { OS: 'ios' }, Pressable: 'Pressable', ScrollView: 'ScrollView', Switch: 'Switch',
          Text: 'Text', TextInput: 'TextInput', View: 'View', Button: 'Button',
          StyleSheet: { flatten: (style: unknown) => style },
        }))
        const [TRModule, React, Testing, rowModule, providerModule, ioModule] = await Promise.all([
          import(${JSON.stringify(FS.resolvePath('TR.ts', runtimeRoot))}),
          import('react'),
          import('@testing-library/react-native'),
          import(${JSON.stringify(rowImport)}),
          import(${JSON.stringify(providerImport)}),
          import(${JSON.stringify(ioImport)}),
        ])
        const TR = TRModule.default
        const definition = {
          name: 'Syntax2ExportCompletionProof', schemaVersion: 1,
          entities: {
            Person: { collection: 'People', fields: { Name: { kind: 'text' } } },
            Book: { collection: 'Books', fields: {
              Title: { kind: 'text', required: 'Enter a title' },
              Note: { kind: 'text', defaultValue: '' },
              Author: { kind: 'relation', relation: 'Person', optional: true },
              LoanedOut: { kind: 'boolean', defaultValue: false },
            } },
          },
        }
        const plan = { entity: 'Book', filters: [], pageSize: 40 }
        const connection = providerModule.BookProvider().connect({
          configuration: {}, schema: definition, storageKey: 'Syntax2ExportCompletionProof',
        })
        const session = providerModule.bookStoreSession(connection)
        session.backend.seedServer([{ ID: 'book-001', Title: 'Export fixture', Note: 'actual bytes' }])
        const schema = TR.Data.Schema(definition, connection)
        await schema.settle()
        schema.activateQuery(plan)
        await schema.settle()
        const book = schema.query(plan)[0]
        TR.Clock.beginTest(1000)
        let before = ''
        let at1999 = ''
        let after2000 = ''
        let uploads = 0
        let notifications = 0
        const stop = schema.subscribe(() => notifications++)
        try {
          const screen = Testing.render(React.createElement(rowModule.BookRow, { Book: TR.Value(book) }))
          const button = screen.getByLabelText('Export book-001')
          await Testing.fireEventAsync.press(button)
          await Promise.resolve()
          before = ioModule.ExportNotice(book)
          uploads = session.backend.acceptedUploads().length
          TR.Clock.advance(1999)
          at1999 = ioModule.ExportNotice(book)
          const notificationsAt1999 = notifications
          TR.Clock.advance(1)
          const { settleActionRoots } = await import(${
          JSON.stringify(FS.resolvePath('TR-action-transactions.ts', runtimeRoot))
        })
          await settleActionRoots()
          after2000 = ioModule.ExportNotice(book)
          const finalNotifications = notifications
          console.log(JSON.stringify({
            before, at1999, after2000, uploads, notificationsAt1999, finalNotifications,
          }))
        } finally {
          Testing.cleanup()
          stop()
          TR.Clock.endTest()
        }
      `,
      )
      const execution = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [runner],
        cwd: root,
        processPolicy: 'test',
      })
      Expect(execution.exitCode).toBe(0)
      Expect(execution.stderr).toBe(
        'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer\n',
      )
      const exported = JSON.parse(execution.stdout)
      Expect(exported.before).toBe('')
      Expect(exported.at1999).toBe('')
      Expect(exported.after2000).toBe('Export completed in 1.5 seconds.')
      Expect(exported.uploads).toBe(1)
      Expect(exported.notificationsAt1999).toBe(0)
      Expect(exported.finalNotifications).toBe(1)
    }, { location: 'worktree' })
  })
})
