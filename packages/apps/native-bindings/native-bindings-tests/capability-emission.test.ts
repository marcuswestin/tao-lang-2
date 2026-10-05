import { Workspace } from '@compiler/workspace'
import { NativeBindings } from '@native-bindings'
import TR from '@runtime/TR'
import { TaoActionOwner } from '@runtime/TR-native-subscription'
import { Repo } from '@shared'
import { Deferred, Describe, Expect, settle, Test, withTaoFiles } from '@shared/test'
import ts from 'typescript'
import type { NativeApiCatalog, NativeApiOperation, NativeApiType } from '../native-bindings-src/native-api'

const number: NativeApiType = { kind: 'primitive', name: 'number' }
const text: NativeApiType = { kind: 'primitive', name: 'text' }
const task: NativeApiType = { kind: 'reference', name: 'Task' }
const parameter = (name: string, type: NativeApiType) => ({ name, type, optional: false })
const provenance = { packageName: 'native-fixture', declaration: 'index.d.ts', line: 1, column: 1, symbol: 'Task' }
const operation = (
  name: string,
  target: NativeApiOperation['target'],
  parameters: NativeApiOperation['parameters'],
  result?: NativeApiType,
): NativeApiOperation => ({ name, target, parameters, result, asynchronous: false, platforms: [], provenance })
const base: NativeApiCatalog = {
  source: 'fixture',
  packageName: 'native-fixture',
  packageVersion: '1',
  declaration: 'index.d.ts',
  declarationHash: 'fixture',
  enums: [],
  operations: [],
}

async function generate(catalog: NativeApiCatalog) {
  return NativeBindings.generate({
    packageName: catalog.packageName,
    fromDirectory: Repo.getRoot(),
    source: {
      name: 'fixture',
      async read() {
        return { catalog, diagnostics: [] }
      },
    },
  })
}

async function executable(catalog: NativeApiCatalog, native: object) {
  const generated = await generate(catalog)
  const exports: Record<string, (...arguments_: unknown[]) => unknown> = {}
  const javascript = ts.transpileModule(generated.files['Bindings.ts']!, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('require', 'exports', javascript)(
    (name: string) => name === '@tao/runtime' ? { default: TR } : native,
    exports,
  )
  return { generated, exports }
}

Describe('catalog capability emission', () => {
  Test('places required Tao parameters first while retaining native argument and callback indices', async () => {
    const fixture: NativeApiCatalog = {
      ...base,
      operations: [{
        ...operation('Open', { kind: 'call', path: ['open'] }, [
          { ...parameter('initialUri', text), optional: true },
          parameter('mimeType', text),
          { ...parameter('mode', text), optional: true },
        ], text),
        arguments: [{ kind: 'parameter', index: 0 }, { kind: 'parameter', index: 1 }, { kind: 'parameter', index: 2 }],
      }, {
        ...operation('Visit', { kind: 'call', path: ['visit'] }, [
          { ...parameter('progress', { kind: 'callback', parameters: [parameter('value', text)] }), optional: true },
          parameter('mimeType', text),
        ], text),
        arguments: [{ kind: 'parameter', index: 0 }, { kind: 'parameter', index: 1 }],
        callbackOwnership: [{ parameter: 0, fields: [], lifetime: { kind: 'call' } }],
      }],
    }
    const received: unknown[][] = []
    const { generated, exports } = await executable(fixture, {
      open(...args: unknown[]) {
        received.push(args)
        return 'opened'
      },
      visit(progress: ((value: string) => void) | undefined, mimeType: string) {
        progress?.(mimeType)
        return mimeType
      },
    })
    Expect(exports['Open']!('image/png', null, null)).toBe('opened')
    Expect(exports['Open']!('video/*', 'file://one', 'extra')).toBe('opened')
    Expect(received).toEqual([[undefined, 'image/png'], ['file://one', 'video/*', 'extra']])
    const owner = new TaoActionOwner()
    const seen: string[] = []
    await TR.Action(() => {
      Expect(exports['Visit']!(
        'image/png',
        TR.Action((value: TR.Value<string>) => {
          seen.push(value.jsValue)
        }).jsValue,
      )).toBe('image/png')
    }, { owner }).jsValue.invoke()
    await settle()
    Expect(seen).toEqual(['image/png'])
    owner.dispose()
    Expect(owner.subscriptions.size).toBe(0)
    await withTaoFiles('native-parameter-order', {
      '.tao/.gitkeep': '',
      'Bindings.tao': generated.files['Bindings.tao']!,
      'Bindings.ts': generated.files['Bindings.ts']!,
      'Main.tao':
        'use Open, Visit from ./Bindings.tao\naction Handler(Value text) {}\naction Inspect() { do Open(MimeType: "image/png")\ndo Open(InitialUri: "file://one", MimeType: "video/*", Mode: "extra")\ndo Visit(MimeType: "image/png", Progress: Handler) }',
    }, async paths => {
      const validated = await Workspace.validate(paths['Main.tao'])
      Expect(
        validated.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic =>
          diagnostic.message
        ),
      ).toEqual([])
    }, { verbatim: true })
  })

  Test('rejects missing, duplicate and incorrectly assigned callback ownership before emitting wrappers', async () => {
    const callback: NativeApiType = { kind: 'callback', parameters: [] }
    const fixture: NativeApiCatalog = {
      ...base,
      records: [{ name: 'Options', fields: [parameter('callback', callback)] }],
      operations: [
        operation('Use', { kind: 'call', path: ['use'] }, [parameter('options', { kind: 'record', name: 'Options' })]),
      ],
    }
    await Expect(generate(fixture)).rejects.toThrow('needs an explicit callback lifetime')
    const owned = { parameter: 0, fields: ['callback'], lifetime: { kind: 'call' as const } }
    await Expect(
      generate({
        ...fixture,
        operations: [{ ...fixture.operations[0]!, callbackOwnership: [{ ...owned, fields: ['missing'] }] }],
      }),
    ).rejects.toThrow('has no callback field')
    await Expect(
      generate({ ...fixture, operations: [{ ...fixture.operations[0]!, callbackOwnership: [owned, owned] }] }),
    ).rejects.toThrow('repeats callback ownership')
    await Expect(
      generate({
        ...fixture,
        operations: [{ ...fixture.operations[0]!, callbackOwnership: [{ ...owned, lifetime: { kind: 'promise' } }] }],
      }),
    ).rejects.toThrow('requires a pending result')
    await Expect(
      generate({
        ...fixture,
        operations: [{
          ...fixture.operations[0]!,
          callbackOwnership: [{ ...owned, lifetime: { kind: 'resource', result: true } }],
        }],
      }),
    ).rejects.toThrow('requires a reference result')
  })

  Test(
    'applies listener controls at the declared event argument before typed queued delivery and preserves property identity',
    async () => {
      let raw!: Target
      class Target {
        constructor() {
          raw = this
        }
        callback: ((code: number, event: Event) => void) | undefined
        onchange: unknown = null
        addEventListener(_name: string, callback: (code: number, event: Event) => void) {
          this.callback = callback
        }
        removeEventListener(_name: string, callback: unknown) {
          if (this.callback === callback) {
            this.callback = undefined
          }
        }
      }
      const target: NativeApiType = { kind: 'reference', name: 'Target' }
      const event: NativeApiType = { kind: 'reference', name: 'Event' }
      const listener: NativeApiType = { kind: 'listener', name: 'TargetListener' }
      const fixture: NativeApiCatalog = {
        ...base,
        references: [{
          name: 'Target',
          typescript: 'import("native-fixture").Target',
          runtimeConstructor: { path: ['Target'] },
          methods: ['addEventListener', 'removeEventListener'],
          provenance,
        }, {
          name: 'Event',
          typescript: 'globalThis.Event',
          runtimeConstructor: { path: ['Event'] },
          methods: [],
          provenance,
        }],
        listeners: [{
          name: 'TargetListener',
          typescript: '(code: number, event: Event) => void',
          parameters: [parameter('code', number), parameter('event', event)],
          provenance,
          returnContract: 'void',
          event: { argumentIndex: 1, permittedControls: ['preventDefault'] },
        }],
        operations: [
          operation('NewTarget', { kind: 'construct', path: ['Target'] }, [], target),
          {
            ...operation('Register', {
              kind: 'method',
              receiver: { kind: 'reference', name: 'Target' },
              member: 'addEventListener',
            }, [parameter('receiver', target), parameter('listener', listener)]),
            eventBinding: {
              kind: 'register',
              listener: 'TargetListener',
              receiverParameter: 0,
              eventName: { kind: 'literal', value: 'tick' },
              callbackParameter: 1,
            },
          },
          {
            ...operation('Remove', {
              kind: 'method',
              receiver: { kind: 'reference', name: 'Target' },
              member: 'removeEventListener',
            }, [parameter('receiver', target), parameter('listener', listener)]),
            eventBinding: {
              kind: 'remove',
              listener: 'TargetListener',
              receiverParameter: 0,
              eventName: { kind: 'literal', value: 'tick' },
              callbackParameter: 1,
            },
          },
          {
            ...operation(
              'GetListener',
              { kind: 'get', receiver: { kind: 'reference', name: 'Target' }, member: 'onchange' },
              [parameter('receiver', target)],
              { kind: 'nullable', value: listener },
            ),
            arguments: [],
            eventBinding: { kind: 'property-get', listener: 'TargetListener', receiverParameter: 0 },
          },
          {
            ...operation('SetListener', {
              kind: 'set',
              receiver: { kind: 'reference', name: 'Target' },
              member: 'onchange',
            }, [parameter('receiver', target), parameter('listener', { kind: 'nullable', value: listener })]),
            eventBinding: {
              kind: 'property-set',
              listener: 'TargetListener',
              receiverParameter: 0,
              callbackParameter: 1,
            },
          },
          operation(
            'Prevented',
            { kind: 'get', receiver: { kind: 'reference', name: 'Event' }, member: 'defaultPrevented' },
            [],
            { kind: 'primitive', name: 'boolean' },
          ),
        ],
      }
      const { generated, exports } = await executable(fixture, { Target, Event })
      const owner = new TaoActionOwner()
      const seen: string[] = []
      let targetHandle: unknown
      let listenerHandle: unknown
      await TR.Action(() => {
        targetHandle = exports['NewTarget']!()
        listenerHandle = exports['CreateTargetListener']!(
          TR.Action((code: TR.Value<number>, value: TR.Value<unknown>) => {
            seen.push(`${code.jsValue}:${exports['Prevented']!(value.jsValue)}`)
          }).jsValue,
          { PreventDefault: true },
        )
        exports['Register']!(targetHandle, listenerHandle)
        exports['SetListener']!(targetHandle, listenerHandle)
        Expect(exports['GetListener']!(targetHandle)).toBe(listenerHandle)
      }, { owner }).jsValue.invoke()
      const eventValue = new Event('tick', { cancelable: true })
      raw.callback!(7, eventValue)
      Expect(eventValue.defaultPrevented).toBe(true)
      Expect(seen).toEqual([])
      await settle()
      Expect(seen).toEqual(['7:true'])
      await TR.Action(() => {
        exports['Remove']!(targetHandle, listenerHandle)
        exports['SetListener']!(targetHandle, null)
      }, { owner }).jsValue.invoke()
      Expect(raw.callback).toBeUndefined()
      Expect(exports['GetListener']!(targetHandle)).toBe(null)
      const nativeObject = {
        handleEvent() {
          seen.push('native')
        },
      }
      raw.onchange = nativeObject
      const wrapped = exports['GetListener']!(targetHandle)
      Expect(exports['GetListener']!(targetHandle)).toBe(wrapped)
      await TR.Action(() => {
        exports['SetListener']!(targetHandle, wrapped)
      }, { owner }).jsValue.invoke()
      Expect(exports['GetListener']!(targetHandle)).toBe(wrapped)
      ;(raw.onchange as (code: number, event: Event) => void)(8, new Event('tick'))
      Expect(seen.at(-1)).toBe('native')
      Expect(() => exports['Register']!(targetHandle, targetHandle)).toThrow()
      exports['ReleaseTargetListener']!(listenerHandle)
      owner.dispose()
      Expect(owner.subscriptions.size).toBe(0)
      await withTaoFiles('native-listener-consumer', {
        '.tao/.gitkeep': '',
        'Bindings.tao': generated.files['Bindings.tao']!,
        'Bindings.ts': generated.files['Bindings.ts']!,
        'Main.tao':
          'use Target, TargetListener, Event, CreateTargetListener, Register from ./Bindings.tao\naction Handler(Code number, Value Event) {}\naction Inspect(Value Target) { let Listener = do CreateTargetListener(Action: Handler)\ndo Register(Value, Listener) }',
      }, async paths => {
        const validated = await Workspace.validate(paths['Main.tao'])
        Expect(
          validated.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic =>
            diagnostic.message
          ),
        ).toEqual([])
      }, { verbatim: true })
    },
  )

  Test('finishes promise-scoped nested progress independently of a terminal observer', async () => {
    const external = Deferred<string>()
    let progress!: (value: number) => void
    const fixture: NativeApiCatalog = {
      ...base,
      records: [{
        name: 'Options',
        fields: [parameter('progress', { kind: 'callback', parameters: [parameter('value', number)] })],
      }],
      operations: [{
        ...operation('Transfer', { kind: 'call', path: ['transfer'] }, [
          parameter('options', { kind: 'record', name: 'Options' }),
        ], text),
        asynchronous: true,
        pending: { name: 'TransferPending', result: text },
        callbackOwnership: [{ parameter: 0, fields: ['progress'], lifetime: { kind: 'promise' } }],
      }],
    }
    const { exports } = await executable(fixture, {
      transfer(options: { progress(value: number): void }) {
        progress = options.progress
        return external.promise
      },
    })
    const owner = new TaoActionOwner()
    const seen: string[] = []
    let pending: unknown
    await TR.Action(() => {
      pending = exports['Transfer']!({
        Progress: TR.Action((value: TR.Value<number>) => {
          seen.push(`progress:${value.jsValue}`)
        }).jsValue,
      })
      exports['ObserveTransferPending']!(
        pending,
        TR.Action(() => {
          seen.push(`terminal:${exports['TransferPendingStatus']!(pending)}`)
        }).jsValue,
      )
    }, { owner }).jsValue.invoke()
    progress(1)
    await settle()
    external.reject('native failure')
    await settle()
    progress(2)
    await settle()
    Expect(seen).toEqual(['progress:1', 'terminal:rejected'])
    Expect(exports['TransferPendingError']!(pending)).toBe('native failure')
    Expect(() => exports['TransferPendingResult']!(pending)).toThrow('has not fulfilled')
    owner.dispose()
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('removes a nested subscription callback through the same checked resource handle', async () => {
    let progress!: () => void
    let removed = 0
    const fixture: NativeApiCatalog = {
      ...base,
      records: [{ name: 'Options', fields: [parameter('progress', { kind: 'callback', parameters: [] })] }, {
        name: 'Subscription',
        disposal: 'remove',
        fields: [parameter('remove', { kind: 'callback', parameters: [] })],
      }],
      operations: [{
        ...operation('Watch', { kind: 'call', path: ['watch'] }, [
          parameter('options', { kind: 'record', name: 'Options' }),
        ], { kind: 'record', name: 'Subscription' }),
        callbackOwnership: [{ parameter: 0, fields: ['progress'], lifetime: { kind: 'subscription' } }],
      }, {
        ...operation('RemoveAgain', { kind: 'call', path: ['removeAgain'] }, [
          parameter('subscription', { kind: 'record', name: 'Subscription' }),
        ]),
      }],
    }
    const { exports } = await executable(fixture, {
      watch(options: { progress(): void }) {
        progress = options.progress
        return {
          remove() {
            removed++
          },
        }
      },
      removeAgain(subscription: { remove(): void }) {
        subscription.remove()
      },
    })
    const owner = new TaoActionOwner()
    const seen: string[] = []
    let subscription!: { Remove: { invoke(): void | Promise<void> } }
    await TR.Action(() => {
      subscription = exports['Watch']!({
        Progress: {
          label: 'progress',
          invoke() {
            seen.push(this.label)
          },
        },
      }) as typeof subscription
    }, { owner }).jsValue.invoke()
    progress()
    await settle()
    Expect(seen).toEqual(['progress'])
    await subscription.Remove.invoke()
    progress()
    await settle()
    Expect(seen).toEqual(['progress'])
    Expect(removed).toBe(1)
    exports['RemoveAgain']!(subscription)
    Expect(removed).toBe(1)
    Expect(() => exports['RemoveAgain']!({ Remove: { invoke() {} } })).toThrow(
      'Expected a generated Subscription handle',
    )
    owner.dispose()
    Expect(removed).toBe(1)
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('roundtrips fixed tuples as ordered named records and rejects wrong tuple shapes', async () => {
    const tuple: NativeApiType = { kind: 'record', name: 'Entry' }
    const fixture = {
      ...base,
      records: [{ name: 'Entry', tuple: true as const, fields: [parameter('key', text), parameter('value', number)] }],
      operations: [
        operation('Echo', { kind: 'call', path: ['echo'] }, [parameter('entry', tuple)], tuple),
        operation('Bad', { kind: 'call', path: ['bad'] }, [], tuple),
      ],
    }
    let received: unknown
    const { generated, exports } = await executable(fixture, {
      echo(value: unknown) {
        received = value
        return value
      },
      bad: () => ['wrong'],
    })
    Expect(exports['Echo']!({ Key: 'one', Value: 1 })).toEqual({ Key: 'one', Value: 1 })
    Expect(received).toEqual(['one', 1])
    Expect(() => exports['Echo']!({ Key: 'one' })).toThrow('fixed native tuple shape')
    Expect(() => exports['Bad']!()).toThrow('fixed native tuple shape')
    await withTaoFiles('native-tuple-consumer', {
      '.tao/.gitkeep': '',
      'Bindings.tao': generated.files['Bindings.tao']!,
      'Bindings.ts': generated.files['Bindings.ts']!,
      'Main.tao':
        'use Echo, Entry from ./Bindings.tao\naction Accept(Value Entry) from ./Consumer.ts\naction Inspect() { let Result = do Echo(Entry: Entry { Key: "one", Value: 1 })\ndo Accept(Result) }',
      'Consumer.ts': '',
    }, async paths => {
      const validated = await Workspace.validate(paths['Main.tao'])
      Expect(
        validated.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic =>
          diagnostic.message
        ),
      ).toEqual([])
    }, { verbatim: true })
  })

  Test(
    'retains constructor progress across pending task restarts and cancels through explicit receiver metadata',
    async () => {
      const deferred = Deferred<string>()
      class Task {
        static last: Task
        constructor(readonly options: { nested: { progress(value: number): void } }) {
          Task.last = this
        }
        start() {
          return deferred.promise
        }
        cancel() {
          this.options.nested.progress(99)
        }
      }
      const fixture: NativeApiCatalog = {
        ...base,
        records: [{
          name: 'Inner',
          fields: [parameter('progress', { kind: 'callback', parameters: [parameter('value', number)] })],
        }, { name: 'Options', fields: [parameter('nested', { kind: 'record', name: 'Inner' })] }],
        references: [{
          name: 'Task',
          typescript: 'import("native-fixture").Task',
          runtimeConstructor: { path: ['Task'] },
          methods: ['start', 'cancel'],
          provenance,
        }],
        operations: [
          {
            ...operation('NewTask', { kind: 'construct', path: ['Task'] }, [
              parameter('options', { kind: 'record', name: 'Options' }),
            ], task),
            callbackOwnership: [{
              parameter: 0,
              fields: ['nested', 'progress'],
              lifetime: { kind: 'resource', result: true },
            }],
          },
          {
            ...operation('Start', { kind: 'method', receiver: { kind: 'reference', name: 'Task' }, member: 'start' }, [
              parameter('receiver', task),
            ], text),
            asynchronous: true,
            pending: { name: 'TaskPending', result: text },
            arguments: [],
          },
          {
            ...operation(
              'Cancel',
              { kind: 'method', receiver: { kind: 'reference', name: 'Task' }, member: 'cancel' },
              [parameter('receiver', task)],
            ),
            arguments: [],
            callbackEffect: { kind: 'cancel-receiver', parameter: 0 },
          },
        ],
      }
      const { generated, exports } = await executable(fixture, { Task })
      const owner = new TaoActionOwner()
      const seen: string[] = []
      let handle: unknown
      let pending: unknown
      await TR.Action(() => {
        handle = exports['NewTask']!({
          Nested: {
            Progress: TR.Action((value: TR.Value<number>) => {
              seen.push(`progress:${value.jsValue}`)
            }).jsValue,
          },
        })
        pending = exports['Start']!(handle)
        Expect('then' in (pending as object)).toBe(false)
        exports['ObserveTaskPending']!(
          pending,
          TR.Action(() => {
            seen.push(`terminal:${exports['TaskPendingResult']!(pending)}`)
          }).jsValue,
        )
        seen.push('committed')
      }, { owner }).jsValue.invoke()
      Task.last.options.nested.progress(1)
      await settle()
      Expect(seen).toEqual(['committed', 'progress:1'])
      deferred.resolve('done')
      await settle()
      Expect(seen).toEqual(['committed', 'progress:1', 'terminal:done'])
      Task.last.options.nested.progress(2)
      await settle()
      Expect(seen.at(-1)).toBe('progress:2')
      await TR.Action(() => {
        exports['Cancel']!(handle)
      }, { owner }).jsValue.invoke()
      Task.last.options.nested.progress(3)
      await settle()
      Expect(seen).toEqual(['committed', 'progress:1', 'terminal:done', 'progress:2'])
      Expect(() => exports['TaskPendingStatus']!(handle)).toThrow()
      Expect(() => exports['Cancel']!(pending)).toThrow()
      owner.dispose()
      Expect(owner.subscriptions.size).toBe(0)
      await withTaoFiles('native-pending-consumer', {
        '.tao/.gitkeep': '',
        'Bindings.tao': generated.files['Bindings.tao']!,
        'Bindings.ts': generated.files['Bindings.ts']!,
        'Native.ts':
          'export declare class Task { constructor(options: { nested: { progress(value: number): void } }); start(): Promise<string>; cancel(): void }',
        'Main.tao':
          'use Start, Task, TaskPending, TaskPendingResult from ./Bindings.tao\naction Accept(Value text) from ./Consumer.ts\naction Inspect(Value Task) { let Pending = do Start(Value)\nlet Result = do TaskPendingResult(Pending)\ndo Accept(Result) }',
        'Consumer.ts': '',
      }, async paths => {
        const validation = await Workspace.validate(paths['Main.tao'])
        Expect(
          validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic =>
            diagnostic.message
          ),
        ).toEqual([])
        const program = ts.createProgram([paths['Bindings.ts']], {
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noEmit: true,
          skipLibCheck: true,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          jsx: ts.JsxEmit.ReactJSX,
          types: ['node'],
          paths: {
            '@tao/runtime': [Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts')],
            'native-fixture': [paths['Native.ts']],
          },
        })
        const source = program.getSourceFile(paths['Bindings.ts'])!
        Expect(
          [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)].map(diagnostic =>
            ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
          ),
        ).toEqual([])
      }, { verbatim: true })
    },
  )
})
