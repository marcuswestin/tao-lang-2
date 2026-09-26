import { expect, test } from '@playwright/test'
import { Repo } from '@shared'
import ts from 'typescript'
import { hostEntrypoint } from './HostBuild'

test('the HNReader host wrapper publishes a native control receipt after an accepted advance', () => {
  const execution = executeHostEntrypoint(compileEntrypoint(), 'hnreader')
  execution.HostApp()
  execution.onAdvance({ lastControlAdvanceMs: 1_000 })
  expect(execution.publishedReceipt(0)).toBe('Control received: advance 1000ms')
})

test('native acceptance waits for both actual native mounts and keeps any fallback failed', () => {
  const execution = executeHostEntrypoint(compileEntrypoint(), 'native-navigation')
  execution.HostApp()
  expect(execution.publishedReceipt(1)).toBe('Native navigation host: waiting')
  execution.diagnostic({ host: 'tabs', implementation: 'native', kind: 'host', platform: 'ios' })
  expect(execution.publishedReceipt(1)).toBe('Native navigation host: waiting')
  execution.diagnostic({ host: 'stack', implementation: 'native', kind: 'host', platform: 'android' })
  expect(execution.publishedReceipt(1)).toBe('Native navigation host: waiting')
  execution.diagnostic({ host: 'stack', implementation: 'native', kind: 'host', platform: 'ios' })
  expect(execution.publishedReceipt(1)).toBe('Native navigation host: tabs and stack')
  execution.diagnostic({ host: 'tabs', implementation: 'basic', kind: 'host', platform: 'ios' })
  expect(execution.publishedReceipt(1)).toBe('Native navigation host: fallback')
  execution.diagnostic({ host: 'tabs', implementation: 'native', kind: 'host', platform: 'ios' })
  expect(execution.publishedReceipt(1)).toBe('Native navigation host: fallback')
})

test('a fallback during generated app loading is retained before the wrapper mounts', () => {
  const execution = executeHostEntrypoint(compileEntrypoint(), 'native-navigation', true)
  execution.HostApp()
  expect(execution.publishedReceipt(1)).toBe('Native navigation host: fallback')
})

function compileEntrypoint(): string {
  const compiled = ts.transpileModule(`${hostEntrypoint(Repo.getRoot())}\nmodule.exports.HostApp = HostApp\n`, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'host-entrypoint.ts',
    reportDiagnostics: true,
  })
  expect(compiled.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([])
  return compiled.outputText
}

type HostEntrypointExecution = Readonly<{
  HostApp: () => unknown
  onAdvance: (snapshot: Readonly<{ lastControlAdvanceMs?: number }>) => void
  publishedReceipt: (index: number) => string | undefined
  diagnostic: (record: object) => void
  renderedTags: readonly string[]
}>

function executeHostEntrypoint(
  source: string,
  subject: string,
  fallbackOnLoad = false,
  platform = 'ios',
): HostEntrypointExecution {
  let onAdvance: ((snapshot: Readonly<{ lastControlAdvanceMs?: number }>) => void) | undefined
  const receipts: (string | undefined)[] = []
  let nextState = 0
  const diagnostics: object[] = []
  const renderedTags: string[] = []
  let subscriber: (() => void) | undefined
  const diagnostic = (record: object): void => {
    diagnostics.push(record)
    subscriber?.()
  }
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
          createElement: (_type: unknown, props?: { testID?: string }): undefined => {
            if (props?.testID !== undefined) {
              renderedTags.push(props.testID)
            }
            return undefined
          },
          useEffect: (effect: () => void): void => effect(),
          useState: (initial: string | undefined): readonly [string | undefined, (next: string) => void] => {
            const index = nextState++
            receipts[index] = initial
            return [initial, next => {
              receipts[index] = next
            }]
          },
        }
      }
      if (request === 'react-native') {
        return { Platform: { OS: platform }, Text: 'Text', View: 'View' }
      }
      if (request.endsWith('/NativeHostTestControl.ts')) {
        return {
          captureNativeNavigationDiagnostics: () => diagnostics,
          subscribeNativeNavigationDiagnostics: (listener: () => void) => {
            subscriber = listener
            return () => {}
          },
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
        return { __esModule: true, default: { runId: 'host-test', seed: 17, subject } }
      }
      if (request === './_gen_tao-app/App') {
        if (fallbackOnLoad) {
          diagnostic({ host: 'tabs', implementation: 'basic', kind: 'host', platform: 'ios' })
        }
        return { default: (): undefined => undefined }
      }
      expect(request).toBe('a known host-entrypoint dependency')
      return undefined
    },
    exports,
    module,
  )
  expect(exports.HostApp).toBeDefined()
  if (platform === 'web') {
    expect(onAdvance).toBeUndefined()
  } else {
    expect(onAdvance).toBeDefined()
  }
  return {
    HostApp: exports.HostApp!,
    onAdvance: onAdvance!,
    publishedReceipt: index => receipts[index],
    diagnostic,
    renderedTags,
  }
}

test('HNReader native acceptance requires a mounted stack and keeps stack fallback failed', () => {
  const execution = executeHostEntrypoint(compileEntrypoint(), 'hnreader')
  execution.HostApp()
  expect(execution.publishedReceipt(1)).toBe('Native navigation host: waiting')
  execution.diagnostic({ host: 'tabs', implementation: 'native', kind: 'host', platform: 'ios' })
  expect(execution.publishedReceipt(1)).toBe('Native navigation host: waiting')
  execution.diagnostic({ host: 'stack', implementation: 'native', kind: 'host', platform: 'ios' })
  expect(execution.publishedReceipt(1)).toBe('Native navigation host: stack')
  execution.diagnostic({ host: 'tabs', implementation: 'basic', kind: 'host', platform: 'ios' })
  expect(execution.publishedReceipt(1)).toBe('Native navigation host: stack')
  execution.diagnostic({ host: 'stack', implementation: 'basic', kind: 'host', platform: 'ios' })
  execution.diagnostic({ host: 'stack', implementation: 'native', kind: 'host', platform: 'ios' })
  expect(execution.publishedReceipt(1)).toBe('Native navigation host: fallback')
})

test('browser HNReader and Clockwork do not render native-navigation receipts', () => {
  const browser = executeHostEntrypoint(compileEntrypoint(), 'hnreader', false, 'web')
  browser.HostApp()
  expect(browser.renderedTags).toContain('tao-host-ready')
  expect(browser.renderedTags).not.toContain('tao-native-navigation-host')
  const clockwork = executeHostEntrypoint(compileEntrypoint(), 'clockwork')
  clockwork.HostApp()
  expect(clockwork.renderedTags).not.toContain('tao-native-navigation-host')
})
