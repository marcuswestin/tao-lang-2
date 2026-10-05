import { BridgeMetadata } from '@compiler/bridge-metadata'
import { Workspace } from '@compiler/workspace'
import { NativeBindings } from '@native-bindings'
import { AST } from '@parser'
import { nativeByteControls } from '@runtime/TR-native-bytes'
import { nativeValueControls } from '@runtime/TR-native-values'
import { Assert, FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import ts from 'typescript'
import type { NativeApiCatalog, NativeApiType } from '../native-bindings-src/native-api'

const event: NativeApiType = { kind: 'reference', name: 'Event' }
const end: NativeApiType = { kind: 'record', name: 'End' }
const origin = { packageName: 'native-fixture', declaration: 'index.d.ts', line: 1, column: 1, symbol: 'Event' }
const catalog: NativeApiCatalog = {
  source: 'bridge-fixture',
  packageName: 'native-fixture',
  packageVersion: '1',
  declaration: 'index.d.ts',
  declarationHash: 'fixture',
  enums: [{ name: 'Finished', literal: true, members: [{ name: 'Done', value: true }] }],
  references: [
    { name: 'Event', typescript: 'Event', methods: ['preventDefault'], provenance: origin },
    { name: 'Buffer', typescript: 'ArrayBuffer', methods: ['slice'], provenance: origin },
  ],
  records: [
    {
      name: 'End',
      fields: [{ name: 'done', optional: false, type: { kind: 'enum', name: 'Finished' } }, {
        name: 'value',
        optional: false,
        type: { kind: 'nullable', value: { kind: 'bytes' }, absence: 'undefined' },
      }],
    },
    { name: 'Canceled', fields: [{ name: 'result', optional: false, type: { kind: 'absence', value: 'null' } }] },
    {
      name: 'Options',
      fields: [{
        name: 'onProgress',
        optional: true,
        type: {
          kind: 'callback',
          parameters: [{ name: 'value', optional: false, type: { kind: 'primitive', name: 'number' } }],
        },
      }],
    },
  ],
  listeners: [{
    name: 'Listener',
    typescript: '(event: Event) => void',
    parameters: [{ name: 'event', optional: false, type: event }],
    returnContract: 'void',
    provenance: origin,
  }],
  operations: [
    {
      name: 'Visit',
      parameters: [{ name: 'options', optional: false, type: { kind: 'record', name: 'Options' } }],
      asynchronous: false,
      platforms: [],
      target: { kind: 'call', path: ['visit'] },
      callbackOwnership: [{ parameter: 0, fields: ['onProgress'], lifetime: { kind: 'call' } }],
    },
    {
      name: 'EchoEnd',
      parameters: [{ name: 'value', optional: false, type: end }],
      result: end,
      asynchronous: false,
      platforms: [],
      target: { kind: 'call', path: ['echoEnd'] },
    },
    {
      name: 'CanceledResult',
      parameters: [],
      result: { kind: 'record', name: 'Canceled' },
      asynchronous: false,
      platforms: [],
      target: { kind: 'call', path: ['canceled'] },
    },
    {
      name: 'Start',
      parameters: [],
      pending: { name: 'EventPending', result: event },
      asynchronous: true,
      platforms: [],
      target: { kind: 'call', path: ['start'] },
    },
  ],
}

Describe('native nominal bridge contracts', () => {
  Test('normalizes omitted nullable slots while retaining native required keys and boxed null', async () => {
    const fixture = {
      ...catalog,
      references: [],
      listeners: [],
      operations: catalog.operations.filter(operation => !operation.pending && operation.name !== 'Visit'),
    }
    const generated = await NativeBindings.generate({
      source: { name: fixture.source, read: async () => ({ catalog: fixture, diagnostics: [] }) },
      packageName: fixture.packageName,
      fromDirectory: '.',
    })
    const done = Symbol('Done')
    let received: { done: boolean; value?: unknown } | undefined
    const javascript = ts.transpileModule(generated.files['Bindings.ts']!, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const module = { exports: {} }
    new Function('require', 'exports', javascript)((name: string) => {
      if (name === '@tao/runtime') {
        return { default: { NativeBytes: nativeByteControls, NativeValues: nativeValueControls } }
      }
      if (name === './Bindings.tao') {
        return { Finished: { Done: { evaluate: () => ({ jsValue: done }) } } }
      }
      Expect(name).toBe('native-fixture')
      return {
        echoEnd(value: { done: boolean; value?: unknown }) {
          received = value
          return value
        },
        canceled: () => ({ result: null }),
      }
    }, module.exports)
    const actions = module.exports as Record<string, (...args: unknown[]) => unknown>
    Expect(actions['EchoEnd']!({ Done: done })).toEqual({ Done: done, Value: null })
    Assert.defined(received, 'native echo received its declared record')
    Expect(Object.hasOwn(received, 'value')).toBe(true)
    Expect(received.value).toBeUndefined()
    const canceled = actions['CanceledResult']!()
    Assert.input(canceled !== null && typeof canceled === 'object', 'native canceled result is a record')
    Expect(Object.hasOwn(canceled, 'Result')).toBe(true)
    Expect(nativeValueControls.unbox((canceled as { Result: unknown }).Result)).toBeNull()
  })

  Test(
    'checks real Tao signatures using descriptor types, permits nullable EOF omission and rejects wrong callback families',
    async () => {
      const generated = await NativeBindings.generate({
        source: { name: catalog.source, read: async () => ({ catalog, diagnostics: [] }) },
        packageName: catalog.packageName,
        fromDirectory: '.',
      })
      const names = JSON.parse(generated.files['bindings.json']!).bridgeTypes as string[]
      Expect(names).toEqual(['Buffer', 'Event', 'EventPending', 'Listener', 'NativeValue'])
      Expect(generated.files['Bindings.ts']).toContain('"Event": TR.NativeReference<NativeEvent>')
      Expect(generated.files['Bindings.ts']).toContain('"Listener": ReturnType<typeof ListenerListener.create>')
      Expect(generated.files['Bindings.ts']).toContain('"EventPending": ReturnType<typeof EventPendingPending.start>')
      Expect(generated.catalog.records).toEqual(catalog.records)
      await withTaoFiles('native-real-bridge-contract', {
        '.tao/.gitkeep': '',
        'Bindings.tao': generated.files['Bindings.tao']!,
        'Bindings.ts': generated.files['Bindings.ts']!,
        'node_modules/native-fixture/package.json': JSON.stringify({ name: 'native-fixture', types: 'index.d.ts' }),
        'node_modules/native-fixture/index.d.ts':
          'export declare function echoEnd(value: { done: true; value: Uint8Array<ArrayBuffer> | undefined }): { done: true; value: Uint8Array<ArrayBuffer> | undefined }; export declare function canceled(): { result: null }; export declare function start(): Promise<Event>; export declare function visit(options: { onProgress?: (value: number) => void }): void;',
        'Valid.ts':
          'import { EchoEnd, Visit } from "./Bindings"; export const value = EchoEnd({ Done: Symbol("Done") }); Visit({ OnProgress: { invoke(value) { void value.jsValue } } }); Visit({ OnProgress: null }); Visit({});',
        'Wrong.ts':
          'import type TR from "@tao/runtime"; import { CreateListener, type NativeTypes } from "./Bindings"; declare const wrong: TR.ActionValue<[TR.Value<NativeTypes["Buffer"]>]>; CreateListener(wrong);',
      }, async (paths, root) => {
        const validated = await Workspace.validate(paths['Bindings.tao'])
        Expect(
          validated.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic =>
            diagnostic.message
          ),
        ).toEqual([])
        const typeOriginResolver = (declaration: AST.TypeDefinition) =>
          AST.isTypeDeclaration(declaration) && AST.getDocument(declaration).uri.fsPath === paths['Bindings.tao']
            && names.includes(declaration.name)
            ? { implementationPath: paths['Bindings.ts'], exportName: 'NativeTypes', memberName: declaration.name }
            : undefined
        const contract = BridgeMetadata.collect(validated.files, root, new Map(), { typeOriginResolver }).find(module =>
          module.sourcePath === paths['Bindings.tao']
        )
        Assert.defined(contract, 'real Tao bridge contract exists')
        await FS.writeText(contract.path, contract.code)
        // The adjacent case companion needs imports relative to its actual location.
        const cases = BridgeMetadata.caseSetTypesFor(
          validated.files.find(file => file.path === paths['Bindings.tao'])!.ast.statements,
        )
        await FS.writeText(FS.resolvePath('Bindings.tao.ts', root), `import type TR from '@tao/runtime'\n${cases}`)
        const options: ts.CompilerOptions = {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          types: ['node'],
          paths: { '@tao/runtime': [Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts')] },
        }
        const program = ts.createProgram(
          [contract.path, paths['Bindings.ts'], paths['Valid.ts'], paths['Wrong.ts']],
          options,
        )
        for (const path of [contract.path, paths['Bindings.ts'], paths['Valid.ts']]) {
          const file = program.getSourceFile(path)!
          Expect(
            [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)].map(diagnostic =>
              ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
            ),
          ).toEqual([])
        }
        const wrong = program.getSemanticDiagnostics(program.getSourceFile(paths['Wrong.ts'])!)
        Expect(wrong).toHaveLength(1)
        Expect(wrong[0]!.code).toBe(2345)
        Expect(ts.flattenDiagnosticMessageText(wrong[0]!.messageText, '\n')).toContain('ActionValue')
        Expect(contract.code).toContain('NativeTypes["Event"]')
        Expect(contract.code).toContain('"Value"?: Array<number> | null')
        Expect(contract.code).toContain('"Result":')
        Expect(contract.code).toContain('"OnProgress"?: { invoke(')
        Expect(generated.files['Bindings.ts']).toContain('"OnProgress"?: { invoke(')
      }, { verbatim: true })
    },
  )
})
