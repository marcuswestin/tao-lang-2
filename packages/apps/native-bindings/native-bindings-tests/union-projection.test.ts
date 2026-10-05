import { Workspace } from '@compiler/workspace'
import { NativeBindings } from '@native-bindings'
import { RuntimeAssert } from '@runtime/TR-assert'
import { nativeByteControls } from '@runtime/TR-native-bytes'
import { Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import ts from 'typescript'
import type { NativeApiCatalog, NativeApiType } from '../native-bindings-src/native-api'

const result: NativeApiType = {
  kind: 'union',
  members: [{ kind: 'record', name: 'Chunk' }, { kind: 'record', name: 'End' }],
}
const catalog: NativeApiCatalog = {
  source: 'union-fixture',
  packageName: 'union-fixture',
  packageVersion: '1',
  declaration: 'index.d.ts',
  declarationHash: 'fixture',
  enums: [
    { name: 'Reading', literal: true, members: [{ name: 'More', value: false }] },
    { name: 'Finished', literal: true, members: [{ name: 'Done', value: true }] },
  ],
  records: [
    {
      name: 'Chunk',
      fields: [
        { name: 'done', type: { kind: 'enum', name: 'Reading' }, optional: false },
        { name: 'value', type: { kind: 'bytes' }, optional: false },
        {
          name: 'metadata',
          type: { kind: 'map', name: 'Labels', value: { kind: 'primitive', name: 'text' } },
          optional: true,
        },
      ],
    },
    {
      name: 'End',
      fields: [
        { name: 'done', type: { kind: 'enum', name: 'Finished' }, optional: false },
        { name: 'value', type: { kind: 'bytes' }, optional: true },
      ],
    },
  ],
  operations: [{
    name: 'Read',
    parameters: [],
    asynchronous: false,
    platforms: [],
    target: { kind: 'call', path: ['read'] },
    result,
  }],
}

async function generate(input = catalog) {
  return NativeBindings.generate({
    source: { name: input.source, read: async () => ({ catalog: input, diagnostics: [] }) },
    packageName: input.packageName,
    fromDirectory: '.',
  })
}

Describe('checked structural union projections', () => {
  Test('executes stream reads and validates discriminants, required bytes, and optional EOF bytes', async () => {
    const generated = await generate()
    let raw: unknown = { done: false, value: Uint8Array.from([0, 255]) }
    const module = { exports: {} }
    const javascript = ts.transpileModule(generated.files['Bindings.ts']!, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    new Function('require', 'exports', javascript)((name: string) => {
      if (name === '@tao/runtime') {
        return { default: { NativeBytes: nativeByteControls, NativeAssert: RuntimeAssert } }
      }
      if (name === './Bindings.tao') {
        return {
          Reading: { More: { evaluate: () => ({ jsValue: false }) } },
          Finished: { Done: { evaluate: () => ({ jsValue: true }) } },
        }
      }
      Expect(name).toBe('union-fixture')
      return { read: () => raw }
    }, module.exports)
    const actions = module.exports as Record<string, (...args: unknown[]) => unknown>
    const read = actions['Read']!
    const chunk = actions['ReadResultAsChunk']!
    const end = actions['ReadResultAsEnd']!
    const isChunk = actions['ReadResultIsChunk']!
    const isEnd = actions['ReadResultIsEnd']!
    const value = read()
    Expect(chunk(value)).toBe(value)
    Expect(value).toMatchObject({ Done: false, Value: [0, 255] })
    Expect(isEnd(value)).toBe(false)
    Expect(() => end(value)).toThrow('Expected End member of ReadResult')
    raw = { done: true }
    const eof = read()
    Expect(end(eof)).toBe(eof)
    Expect(isChunk(eof)).toBe(false)
    Expect(() => chunk(eof)).toThrow('Expected Chunk member of ReadResult')
    for (
      const invalid of [
        null,
        {},
        { Done: true, Value: [0] },
        { Done: false },
        { Done: false, Value: [-1] },
        { Done: false, Value: [256] },
        { Done: false, Value: [1.5] },
        { Done: false, Value: ['1'] },
        { Done: false, Value: new Array(1) },
        { Done: false, Value: [1], Metadata: [{ Key: 1, Value: 'valid' }] },
        { Done: false, Value: [1], Metadata: [{ Key: 'valid', Value: 1 }] },
      ]
    ) {
      Expect(isChunk(invalid)).toBe(false)
      Expect(() => chunk(invalid)).toThrow('Expected Chunk member of ReadResult')
    }
    for (const invalid of [{ Done: true, Value: [-1] }, { Done: true, Value: ['1'] }]) {
      Expect(isEnd(invalid)).toBe(false)
      Expect(() => end(invalid)).toThrow('Expected End member of ReadResult')
    }
    Expect(end({ Done: true, Value: [1] })).toEqual({ Done: true, Value: [1] })
    raw = { done: false, value: Uint8Array.from([1]), metadata: { label: 'chunk' } }
    const labeled = read()
    Expect(isChunk(labeled)).toBe(true)
    Expect(chunk(labeled)).toMatchObject({ Metadata: [{ Key: 'label', Value: 'chunk' }] })
    raw = { done: true, value: 'wrong optional field' }
    Expect(read).toThrow('Expected a declared native union member')
  })

  Test('a generated Read, member guard and checked projection expose typed bytes to a Tao consumer', async () => {
    const generated = await generate()
    await withTaoFiles('native-union-projection', {
      '.tao/.gitkeep': '',
      'Bindings.tao': generated.files['Bindings.tao']!,
      'Bindings.ts': generated.files['Bindings.ts']!,
      'Bindings.tao.ts':
        'export declare const Reading: { More: { evaluate(): { jsValue: false } } }; export declare const Finished: { Done: { evaluate(): { jsValue: true } } };',
      'Consumer.ts': '',
      'node_modules/union-fixture/package.json': JSON.stringify({ name: 'union-fixture', types: 'index.d.ts' }),
      'node_modules/union-fixture/index.d.ts':
        'export declare function read(): { done: false; value: Uint8Array<ArrayBuffer>; metadata?: Record<string, string> } | { done: true; value?: Uint8Array<ArrayBuffer> };',
      'Main.tao': `use Read, ReadResultIsChunk, ReadResultAsChunk from ./Bindings.tao
action Consume(Bytes list of number) from ./Consumer.ts
action Inspect() {
  let Result = do Read()
  let IsChunk = do ReadResultIsChunk(Result)
  if IsChunk {
    let ChunkValue = do ReadResultAsChunk(Result)
    do Consume(Bytes: ChunkValue.Value)
  }
}`,
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
        types: ['node'],
        paths: { '@tao/runtime': [Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts')] },
      })
      const sidecar = program.getSourceFile(paths['Bindings.ts'])!
      Expect(
        [...program.getSyntacticDiagnostics(sidecar), ...program.getSemanticDiagnostics(sidecar)].map(diagnostic =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        ),
      ).toEqual([])
    }, { verbatim: true })
  })

  Test('deduplicates projections and rejects a public name collision', async () => {
    const repeated = await generate({
      ...catalog,
      operations: [...catalog.operations, { ...catalog.operations[0]!, name: 'ReadAgain' }],
    })
    Expect(repeated.files['Bindings.tao']!.match(/public\s+action ReadResultAsChunk\(/g)).toHaveLength(1)
    await Expect(
      generate({
        ...catalog,
        operations: [...catalog.operations, {
          ...catalog.operations[0]!,
          name: 'ReadResultAsChunk',
          result: undefined,
        }],
      }),
    ).rejects.toThrow('Native declarations collide')
  })
})
