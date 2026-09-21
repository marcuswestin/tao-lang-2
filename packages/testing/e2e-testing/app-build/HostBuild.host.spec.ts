import { expect, test } from '@playwright/test'
import { Repo } from '@shared'
import ts from 'typescript'
import { hostEntrypoint } from './HostBuild'

test('the HNReader host wrapper compiles and publishes a native control receipt after an accepted advance', () => {
  const entrypoint = hostEntrypoint(Repo.getRoot())
  const compiled = ts.transpileModule(`${entrypoint}\nmodule.exports.HostApp = HostApp\n`, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'host-entrypoint.ts',
    reportDiagnostics: true,
  })
  const errors = compiled.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  expect(errors).toEqual([])

  const execution = executeHostEntrypoint(compiled.outputText)
  execution.HostApp()
  execution.onAdvance({ lastControlAdvanceMs: 1_000 })

  expect(execution.publishedReceipt()).toBe('Control received: advance 1000ms')
})

type HostEntrypointExecution = Readonly<{
  HostApp: () => unknown
  onAdvance: (snapshot: Readonly<{ lastControlAdvanceMs?: number }>) => void
  publishedReceipt: () => string | undefined
}>

function executeHostEntrypoint(source: string): HostEntrypointExecution {
  let onAdvance: ((snapshot: Readonly<{ lastControlAdvanceMs?: number }>) => void) | undefined
  let receipt: string | undefined
  const exports: { HostApp?: () => unknown } = {}
  const module = { exports }
  const execute = new Function(
    'require',
    'exports',
    'module',
    source,
  ) as (require: (request: string) => unknown, exports: object, module: { exports: object }) => void
  execute(
    request => {
      if (request === 'expo') {
        return { registerRootComponent: (): void => undefined }
      }
      if (request === 'react') {
        return {
          createElement: (): undefined => undefined,
          useEffect: (effect: () => void): void => effect(),
          useState: (): readonly [undefined, (next: string) => void] => [undefined, next => {
            receipt = next
          }],
        }
      }
      if (request === 'react-native') {
        return { Platform: { OS: 'ios' }, Text: 'Text', View: 'View' }
      }
      if (request.endsWith('/NativeHostTestControl.ts')) {
        return {
          installNativeHostTestControl: (
            _environment: unknown,
            options: Readonly<{ onAdvance: (snapshot: Readonly<{ lastControlAdvanceMs?: number }>) => void }>,
          ): Readonly<{ ready: Promise<void> }> => {
            onAdvance = options.onAdvance
            return { ready: Promise.resolve() }
          },
        }
      }
      if (request.endsWith('/RuntimeHostTestControl.ts')) {
        return { installRuntimeHostTestControl: (): object => ({}) }
      }
      if (request === './HostTestConfig.json') {
        return { __esModule: true, default: { runId: 'host-test', seed: 17, subject: 'hnreader' } }
      }
      if (request === './_gen_tao-app/App') {
        return { default: (): undefined => undefined }
      }
      expect(request).toBe('a known host-entrypoint dependency')
      return undefined
    },
    exports,
    module,
  )
  expect(exports.HostApp).toBeDefined()
  expect(onAdvance).toBeDefined()
  return {
    HostApp: exports.HostApp!,
    onAdvance: onAdvance!,
    publishedReceipt: () => receipt,
  }
}
