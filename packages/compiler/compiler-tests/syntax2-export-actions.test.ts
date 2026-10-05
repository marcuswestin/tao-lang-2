import { Workspace } from '@compiler/workspace'
import { Assert, CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'

Describe('compiler: Syntax2 Export action', () => {
  Test('samples a checked Duration before cleanup and drains cleanup when upload fails', async () => {
    const appRoot = FS.resolvePath('Apps/Syntax2', Repo.getRoot())
    const result = await Workspace.compile(FS.resolvePath('Main.tao', appRoot))
    const actionPath = FS.resolvePath('library/BookActions.tao', appRoot)
    const bookIOPath = FS.resolvePath('library/BookIO.tao', appRoot)
    const bookIOSidecarPath = FS.resolvePath('library/BookIO.ts', appRoot)
    const providerPath = FS.resolvePath('library/BookStoreProvider.ts', appRoot)
    const backendPath = FS.resolvePath('library/BookBackend.ts', appRoot)
    const actions = result.validation.files.find(file => file.path === actionPath)
    const io = result.validation.files.find(file => file.path === bookIOPath)
    Assert.defined(actions, 'the real Syntax2 BookActions source is in the compiled graph')
    Assert.defined(io, 'the real Syntax2 BookIO source is in the compiled graph')
    Assert(result.files.some(file => file.sourcePath === bookIOSidecarPath), 'the real BookIO sidecar is emitted')
    const providerModule = result.files.find(file => file.sourcePath === providerPath)
    const backendModule = result.files.find(file => file.sourcePath === backendPath)
    Assert.defined(providerModule, 'the real BookStore provider is emitted')
    Assert.defined(backendModule, 'the real Book backend is emitted')

    await withTaoFiles('tao-syntax2-export-actions-', {}, async (_paths, root) => {
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

      await FS.writeText(
        FS.resolvePath('Clock.ts', root),
        `
        import { createContinuousClockNowMilliseconds } from ${
          JSON.stringify(
            FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-continuous-clock.ts', Repo.getRoot()),
          )
        }
        import { createNativeModules } from ${
          JSON.stringify(
            FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-native-modules.ts', Repo.getRoot()),
          )
        }
        const samples = [1000, 2500, 4000, 5500]
        let reads = 0
        export function clockReads() { return reads }
        export function resetClock() { reads = 0 }
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
              '@runtime/*': [FS.resolvePath('packages/apps/runtime/TaoRuntime-src/*', Repo.getRoot())],
              '@tao/runtime': [FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot())],
              '@runtime/TR-continuous-clock': [FS.resolvePath('Clock.ts', root)],
              react: [FS.resolvePath('packages/apps/runtime/node_modules/react/index.js', Repo.getRoot())],
            },
          },
        }),
      )

      const bookStoreProvider = FS.resolvePath(
        `out/${providerModule.relativePath.replace(/\.[cm]?tsx?$/, '.js')}`,
        root,
      )
      const bookBackend = FS.resolvePath(`out/${backendModule.relativePath.replace(/\.[cm]?tsx?$/, '.js')}`, root)
      const runtimeTR = FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot())
      const runner = FS.resolvePath('Check.ts', root)
      const actionModule = result.files.find(file =>
        file.sourcePath === actionPath && file.relativePath.endsWith('.tsx')
      )
      Assert.defined(actionModule, 'the real Export declaration emits an executable module')
      const generatedImport = `./out/${actionModule.relativePath.replace(/\.[cm]?tsx?$/, '.js')}`
      await FS.writeText(
        runner,
        `
        import TR from ${JSON.stringify(runtimeTR)}
        import { TaoActionFailure } from ${
          JSON.stringify(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-errors.ts', Repo.getRoot()))
        }
        import { mock } from 'bun:test'
        import { BookProvider, bookStoreSession } from ${JSON.stringify(bookStoreProvider)}
        import { BookBackend } from ${JSON.stringify(bookBackend)}
        import { clockReads, resetClock } from './Clock.ts'
        import * as Platform from ${
          JSON.stringify(FS.resolvePath('packages/shared/shared-src/Platform.ts', Repo.getRoot()))
        }

        mock.module('react-native', () => ({
          ActivityIndicator: 'ActivityIndicator', Image: 'Image', KeyboardAvoidingView: 'KeyboardAvoidingView',
          Platform: { OS: 'ios' }, Pressable: 'Pressable', ScrollView: 'ScrollView', Switch: 'Switch',
          Text: 'Text', TextInput: 'TextInput', View: 'View',
        }))
        const Actions = await import(${JSON.stringify(generatedImport)})

        const definition = {
          name: 'Syntax2ExportProof', schemaVersion: 1,
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
        const connection = BookProvider().connect({ configuration: {}, schema: definition, storageKey: 'Syntax2ExportProof' })
        const session = bookStoreSession(connection)
        session.backend.seedServer([{ ID: 'book-001', Title: 'Export fixture', Note: 'actual bytes' }])
        const schema = TR.Data.Schema(definition, connection)
        await schema.settle()
        schema.activateQuery(plan)
        await schema.settle()
        const book = schema.query(plan)[0]

        const cleanupReads: number[] = []
        const cleanedFiles: object[] = []
        const operationReads: number[] = []
        const createPDF = BookBackend.prototype.createTemporaryPDF
        BookBackend.prototype.createTemporaryPDF = function (bookID) {
          operationReads.push(clockReads())
          return createPDF.call(this, bookID)
        }
        const upload = BookBackend.prototype.uploadFile
        BookBackend.prototype.uploadFile = function (file) {
          operationReads.push(clockReads())
          return upload.call(this, file)
        }
        const cleanup = BookBackend.prototype.deleteTemporaryFile
        BookBackend.prototype.deleteTemporaryFile = function (file) {
          cleanupReads.push(clockReads())
          cleanedFiles.push(file)
          return cleanup.call(this, file)
        }
        const exportAction = Actions.Export
        if (!exportAction) throw new Error('compiled Export action was not exported')
        resetClock()
        const completed = await TR.DoResult(exportAction, TR.Value(book))
        const sampleAtCleanup = cleanupReads[0]
        const accepted = session.backend.acceptedUploads()
        const expiredAfterCleanup = !session.backend.readTemporaryFile(cleanedFiles[0]).ok
        const completedPayload = completed.evaluate().jsValue
        const successOperationReads = operationReads.slice()

        session.backend.failNext('upload', 'Upload unavailable')
        resetClock()
        cleanupReads.length = 0
        cleanedFiles.length = 0
        operationReads.length = 0
        let failed = false
        let failureCase: string | undefined
        let failureSentence: string | undefined
        try { await TR.DoResult(exportAction, TR.Value(book)) } catch (error) {
          failed = error instanceof TaoActionFailure
          if (failed) {
            failureCase = error.caseName
            failureSentence = error.message
          }
        }
        const failureCleanupReads = cleanupReads.slice()
        const failedFileExpired = !session.backend.readTemporaryFile(cleanedFiles[0]).ok
        const uploadsAfterFailure = session.backend.acceptedUploads()
        Platform.runtimeConsole.info(JSON.stringify({
          completed: completed?.getJSValue?.() ?? completed,
          checkedDuration: TR.isQuantityPayload(completedPayload),
          durationCanonical: completedPayload.canonical,
          durationUnit: completedPayload.unit,
          sampleAtCleanup,
          successOperationReads,
          failureOperationReads: operationReads,
          accepted: accepted.map(upload => ({ fileID: upload.FileID, bytes: Array.from(upload.Bytes) })),
          expiredAfterCleanup,
          failed,
          failureCase,
          failureSentence,
          failureCleanupReads,
          failedFileExpired,
          failureCleanedFiles: cleanedFiles.length,
          uploadsAfterFailure: uploadsAfterFailure.length,
        }))
      `,
      )
      const execution = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [runner],
        cwd: root,
        processPolicy: 'test',
      })
      Expect({ exitCode: execution.exitCode, stderr: execution.stderr }).toEqual({ exitCode: 0, stderr: '' })
      const observed = JSON.parse(execution.stdout)
      Expect(observed.sampleAtCleanup).toBe(2)
      Expect(observed.successOperationReads).toEqual([1, 1])
      Expect(observed.accepted).toHaveLength(1)
      Expect(new TextDecoder().decode(Uint8Array.from(observed.accepted[0].bytes))).toContain('%PDF-1.4')
      Expect(observed.expiredAfterCleanup).toBe(true)
      Expect(observed.checkedDuration).toBe(true)
      Expect(observed.durationCanonical).toBe(1.5)
      Expect(observed.durationUnit).toBe('seconds')
      Expect(observed.failed).toBe(true)
      Expect(observed.failureCase).toBe('Failure')
      Expect(observed.failureSentence).toBe('Upload unavailable')
      Expect(observed.failureCleanupReads).toEqual([1])
      Expect(observed.failureOperationReads).toEqual([1, 1])
      Expect(observed.failedFileExpired).toBe(true)
      Expect(observed.failureCleanedFiles).toBe(1)
      Expect(observed.uploadsAfterFailure).toBe(1)
    }, { location: 'worktree' })
  })
})
