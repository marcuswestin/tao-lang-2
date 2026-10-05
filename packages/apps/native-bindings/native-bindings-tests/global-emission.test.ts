import { NativeBindings } from '@native-bindings'
import TR from '@runtime/TR'
import { Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import ts from 'typescript'
import type { NativeApiCatalog, NativeApiOperation, NativeApiType } from '../native-bindings-src/native-api'

const text: NativeApiType = { kind: 'primitive', name: 'text' }
const controller: NativeApiType = { kind: 'reference', name: 'Controller' }
const signal: NativeApiType = { kind: 'reference', name: 'Signal' }
const parameter = (name: string, type: NativeApiType) => ({ name, type, optional: false })
const provenance = {
  packageName: 'native-fixture',
  declaration: 'index.d.ts',
  line: 1,
  column: 1,
  symbol: 'Controller',
}
const operation = (
  name: string,
  target: NativeApiOperation['target'],
  parameters: NativeApiOperation['parameters'],
  result?: NativeApiType,
): NativeApiOperation => ({ name, target, parameters, result, asynchronous: false, platforms: [], provenance })

const catalog: NativeApiCatalog = {
  source: 'global-fixture',
  packageName: 'native-fixture',
  packageVersion: '1',
  declaration: 'index.d.ts',
  declarationHash: 'fixture',
  enums: [],
  references: [
    {
      name: 'Controller',
      typescript: 'globalThis.AbortController',
      runtimeConstructor: { path: ['AbortController'], global: true },
      methods: ['abort'],
      provenance,
    },
    {
      name: 'Signal',
      typescript: 'globalThis.AbortSignal',
      runtimeConstructor: { path: ['AbortSignal'], global: true },
      methods: ['addEventListener', 'removeEventListener'],
      provenance,
    },
  ],
  records: [{ name: 'Options', fields: [parameter('signal', signal)] }],
  operations: [
    operation('NewController', { kind: 'construct', path: ['AbortController'], global: true }, [], controller),
    {
      ...operation(
        'ControllerSignal',
        { kind: 'get', receiver: { kind: 'reference', name: 'Controller' }, member: 'signal' },
        [parameter('receiver', controller)],
        signal,
      ),
      arguments: [],
    },
    operation('Cancel', { kind: 'method', receiver: { kind: 'reference', name: 'Controller' }, member: 'abort' }, [
      parameter('receiver', controller),
      parameter('reason', text),
    ]),
    {
      ...operation('Aborted', { kind: 'get', receiver: { kind: 'reference', name: 'Signal' }, member: 'aborted' }, [
        parameter('receiver', signal),
      ], { kind: 'primitive', name: 'boolean' }),
      arguments: [],
    },
    operation('Send', { kind: 'call', path: ['send'] }, [parameter('options', { kind: 'record', name: 'Options' })], {
      kind: 'primitive',
      name: 'boolean',
    }),
    operation('WrongSignal', { kind: 'call', path: ['wrongSignal'] }, [], signal),
    operation(
      'SerializeCall',
      { kind: 'call', path: ['JSON', 'stringify'], global: true },
      [parameter('value', text)],
      text,
    ),
    operation(
      'SerializeMethod',
      { kind: 'method', receiver: { kind: 'module', path: ['JSON'], global: true }, member: 'stringify' },
      [parameter('value', text)],
      text,
    ),
    operation('Pi', { kind: 'get', receiver: { kind: 'module', path: ['Math'], global: true }, member: 'PI' }, [], {
      kind: 'primitive',
      name: 'number',
    }),
  ],
}

async function generate(fixture = catalog) {
  return NativeBindings.generate({
    packageName: fixture.packageName,
    fromDirectory: Repo.getRoot(),
    source: {
      name: 'global-fixture',
      async read() {
        return { catalog: fixture, diagnostics: [] }
      },
    },
  })
}

Describe('global native path emission', () => {
  Test('constructs canonical global handles and passes their exact signal to ordinary native options', async () => {
    const generated = await generate()
    let installed = 0
    let imports = 0
    let rawSignal: AbortSignal | undefined
    const native = {
      AbortController: class WrongController {},
      send(options: { signal: AbortSignal }) {
        rawSignal = options.signal
        return options.signal.aborted
      },
      wrongSignal: () => ({ addEventListener() {}, removeEventListener() {} }),
    }
    const runtime = Object.assign(Object.create(TR), {
      NativeAbortSupport() {
        installed++
      },
    })
    const exports: Record<string, (...args: unknown[]) => unknown> = {}
    const javascript = ts.transpileModule(generated.files['Bindings.ts']!, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    new Function('require', 'exports', javascript)((name: string) => {
      if (name === '@tao/runtime') {
        return { default: runtime }
      }
      Expect(name).toBe('native-fixture')
      imports++
      return native
    }, exports)
    const value = exports['NewController']!()
    const capability = exports['ControllerSignal']!(value)
    Expect(exports['ControllerSignal']!(value)).toBe(capability)
    Expect(imports).toBe(0)
    Expect(installed).toBeGreaterThan(0)
    Expect(exports['Send']!({ Signal: capability })).toBe(false)
    Expect(rawSignal instanceof globalThis.AbortSignal).toBe(true)
    const sameSignal = rawSignal!
    exports['Cancel']!(value, 'cancelled')
    Expect(exports['Aborted']!(capability)).toBe(true)
    Expect(exports['Send']!({ Signal: capability })).toBe(true)
    Expect(rawSignal).toBe(sameSignal)
    Expect(rawSignal!.reason).toBe('cancelled')
    Expect(() => exports['Cancel']!(capability, 'wrong')).toThrow(
      'Use a Controller native reference for this operation.',
    )
    Expect(() => exports['WrongSignal']!()).toThrow('not valid for Signal')
    Expect(exports['SerializeCall']!('value')).toBe('"value"')
    Expect(exports['SerializeMethod']!('value')).toBe('"value"')
    Expect(exports['Pi']!()).toBe(Math.PI)
  })

  Test('omits unused namespace resolvers and support calls for ordinary package bindings', async () => {
    const ordinary = await generate({
      ...catalog,
      references: [],
      records: [],
      operations: [operation('Read', { kind: 'call', path: ['read'] }, [], text)],
    })
    Expect(ordinary.files['Bindings.ts']).toContain('const native = ()')
    Expect(ordinary.files['Bindings.ts']).not.toContain('nativeGlobals')
    Expect(ordinary.files['Bindings.ts']).not.toContain('NativeAbortSupport')
    Expect(ordinary.files['Bindings.ts']).not.toContain("import TR from '@tao/runtime'")
    const globalOnly = await generate({
      ...catalog,
      references: [],
      records: [],
      operations: [
        operation(
          'Serialize',
          { kind: 'call', path: ['JSON', 'stringify'], global: true },
          [parameter('value', text)],
          text,
        ),
      ],
    })
    Expect(globalOnly.files['Bindings.ts']).toContain('nativeGlobals()')
    Expect(globalOnly.files['Bindings.ts']).not.toContain('const native = ()')
  })
})
