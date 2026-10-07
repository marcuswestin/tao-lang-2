import { Type } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import Formatter from '@formatter'
import { NativeBindings } from '@native-bindings'
import { AST } from '@parser'
import { runAction } from '@runtime/TR-action-transactions'
import { nativeByteControls } from '@runtime/TR-native-bytes'
import { nativeCallCallbacks } from '@runtime/TR-native-call-callbacks'
import { createNativeReferenceGroup } from '@runtime/TR-native-references'
import { TaoActionOwner } from '@runtime/TR-native-subscription'
import { nativeValueControls } from '@runtime/TR-native-values'
import { Assert, Errors, FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { StateValidator } from '@validator/validators/StateValidator'
import ts from 'typescript'
import type { NativeApiCatalog, NativeApiOperation, NativeApiType } from '../native-bindings-src/native-api'

const text: NativeApiType = { kind: 'primitive', name: 'text' }
const number: NativeApiType = { kind: 'primitive', name: 'number' }
const file: NativeApiType = { kind: 'reference', name: 'File' }
const photo: NativeApiType = { kind: 'reference', name: 'Photo' }
const fileMap: NativeApiType = { kind: 'map', name: 'FileMap', value: file }
const provenance = { packageName: 'native-fixture', declaration: 'index.d.ts', line: 12, column: 3, symbol: 'File' }
const parameter = (name: string, type: NativeApiType) => ({ name, type, optional: false })
const operation = (
  name: string,
  target: NativeApiOperation['target'],
  parameters: NativeApiOperation['parameters'],
  result?: NativeApiType,
): NativeApiOperation => ({ name, target, parameters, result, asynchronous: false, platforms: [], provenance })
const method = (name: string, member: string, parameters: NativeApiOperation['parameters'], result?: NativeApiType) =>
  operation(name, { kind: 'method', receiver: { kind: 'reference', name: 'File' }, member }, parameters, result)

const catalog: NativeApiCatalog = {
  source: 'object-fixture',
  packageName: 'native-fixture',
  packageVersion: '1',
  declaration: 'index.d.ts',
  declarationHash: 'fixture',
  enums: [{ name: 'Choice', literal: true, members: [{ name: 'First', value: 'first' }] }],
  records: [{ name: 'Label', fields: [parameter('text', text)] }, {
    name: 'Envelope',
    fields: [
      parameter('files', fileMap),
      parameter('values', { kind: 'list', element: file }),
      { ...parameter('attachment', file), optional: true },
    ],
  }],
  references: [
    {
      name: 'Photo',
      typescript: 'import("native-fixture").Photo',
      base: 'File',
      protocols: ['Writable'],
      runtimeConstructor: { path: ['Photo'] },
      methods: [],
      provenance,
    },
    {
      name: 'File',
      typescript: 'import("native-fixture").File',
      runtimeConstructor: { path: ['File'], inheritedPrototype: true },
      methods: ['append'],
      provenance,
    },
    { name: 'Writable', typescript: 'import("native-fixture").Writable', methods: ['append'], provenance },
    { name: 'Iterator', typescript: 'Iterator<string>', methods: ['next'], provenance },
  ],
  operations: [
    operation('NewFile', { kind: 'construct', path: ['File'] }, [parameter('text', text)], file),
    operation('NewPhoto', { kind: 'construct', path: ['Photo'] }, [parameter('text', text)], photo),
    operation('FileText', { kind: 'get', receiver: { kind: 'reference', name: 'File' }, member: 'text' }, [], text),
    operation('WriteFile', { kind: 'set', receiver: { kind: 'reference', name: 'File' }, member: 'text' }, [
      parameter('text', text),
    ]),
    method('Append', 'append', [parameter('text', text)], file),
    {
      ...method('CatalogAppend', 'append', [parameter('receiver', file), parameter('text', text)], file),
      arguments: [{ kind: 'parameter', index: 1 }],
    },
    {
      ...operation('CatalogText', { kind: 'get', receiver: { kind: 'reference', name: 'File' }, member: 'text' }, [
        parameter('receiver', file),
      ], text),
      arguments: [],
    },
    {
      ...operation('CatalogWrite', { kind: 'set', receiver: { kind: 'reference', name: 'File' }, member: 'text' }, [
        parameter('receiver', file),
        parameter('value', text),
      ]),
      arguments: [{ kind: 'parameter', index: 1 }],
    },
    method(
      'AppendParts',
      'appendParts',
      [{ ...parameter('parts', { kind: 'list', element: text }), rest: true }],
      file,
    ),
    operation(
      'Iterate',
      { kind: 'method', receiver: { kind: 'reference', name: 'File' }, member: { symbol: 'iterator' } },
      [],
      { kind: 'reference', name: 'Iterator' },
    ),
    operation('Next', { kind: 'method', receiver: { kind: 'reference', name: 'Iterator' }, member: 'next' }, [], {
      kind: 'dynamic',
    }),
    operation('SameFile', { kind: 'call', path: ['sameFile'] }, [parameter('file', file)], file),
    operation('StaticFile', { kind: 'method', receiver: { kind: 'module', path: ['File'] }, member: 'create' }, [
      parameter('text', text),
    ], file),
    operation('FileFromText', { kind: 'call', path: ['from'] }, [parameter('value', text)], file),
    operation('FileFromNumber', { kind: 'call', path: ['from'] }, [parameter('value', number)], file),
    operation('GetFiles', { kind: 'call', path: ['files'] }, [parameter('file', file)], fileMap),
    operation('ReadFiles', { kind: 'call', path: ['readFiles'] }, [parameter('files', fileMap)], text),
    operation('EchoEnvelope', { kind: 'call', path: ['echoEnvelope'] }, [
      parameter('envelope', { kind: 'record', name: 'Envelope' }),
    ], { kind: 'record', name: 'Envelope' }),
    operation('ChoiceText', { kind: 'call', path: ['choiceText'] }, [
      parameter('choice', {
        kind: 'union',
        members: [{ kind: 'enum', name: 'Choice' }, { kind: 'record', name: 'Label' }, file],
      }),
    ], text),
    operation('ChoiceResult', { kind: 'call', path: ['choiceResult'] }, [parameter('kind', text)], {
      kind: 'union',
      members: [{ kind: 'enum', name: 'Choice' }, { kind: 'record', name: 'Label' }, file],
    }),
    operation('Dynamic', { kind: 'call', path: ['dynamic'] }, [], { kind: 'dynamic' }),
    operation('GetBytes', { kind: 'call', path: ['bytes'] }, [], { kind: 'bytes' }),
    operation('WriteBytes', { kind: 'call', path: ['writeBytes'] }, [parameter('bytes', { kind: 'bytes' })], {
      kind: 'bytes',
    }),
    operation('MaybeFile', { kind: 'call', path: ['maybeFile'] }, [
      parameter('file', { kind: 'nullable', value: file, absence: 'undefined' }),
    ], { kind: 'nullable', value: file, absence: 'undefined' }),
    operation('Undefined', { kind: 'call', path: ['undefinedValue'] }, [], { kind: 'absence', value: 'undefined' }),
    {
      ...operation('Specialized', { kind: 'call', path: ['specialized'] }, [parameter('value', text)], text),
      arguments: [{ kind: 'literal', value: 'fixed' }, { kind: 'parameter', index: 0 }, {
        kind: 'export',
        path: ['Token'],
      }],
    },
    {
      ...operation('SpecializedOptional', { kind: 'call', path: ['specialized'] }, [{
        ...parameter('value', text),
        optional: true,
      }], text),
      arguments: [{ kind: 'literal', value: 'fixed' }, { kind: 'parameter', index: 0 }, {
        kind: 'export',
        path: ['Token'],
      }],
    },
  ],
}

class File {
  #text: string
  static last: File
  constructor(text: string) {
    this.#text = text
    File.last = this
  }
  get text() {
    return this.#text
  }
  set text(value: string) {
    this.#text = value
  }
  append(value: string) {
    this.#text += value
    return this
  }
  appendParts(...values: string[]) {
    return this.append(values.join('|'))
  }
  static create(text: string) {
    return new this(text)
  }
  *[Symbol.iterator]() {
    yield this.#text
  }
}
class Photo extends File {}

async function generate(fixture = catalog) {
  return NativeBindings.generate({
    packageName: 'native-fixture',
    fromDirectory: Repo.getRoot(),
    source: {
      name: 'object-fixture',
      async read() {
        return { catalog: fixture, diagnostics: [] }
      },
    },
  })
}

async function executable() {
  const generated = await generate()
  const bytes = new Uint8Array([1, 255])
  const choice = Object.freeze({})
  let imports = 0
  const native = {
    File,
    Photo,
    Token: 'token',
    sameFile: (value: File) => value,
    from: (value: string | number) => new File(String(value)),
    files: (value: File) => Object.defineProperty({ first: value }, '__proto__', { enumerable: true, value }),
    readFiles: (values: Record<string, File>) =>
      `${Object.getPrototypeOf(values) === null}:${values['first']!.text}:${values['__proto__']!.text}`,
    echoEnvelope: (value: unknown) => value,
    choiceText: (value: string | { text: string } | File) => typeof value === 'string' ? value : value.text,
    choiceResult: (kind: string) =>
      kind === 'enum' ? 'first' : kind === 'record' ? { text: 'label' } : kind === 'file' ? File.last : {},
    dynamic: () => ({ presentNull: null, presentUndefined: undefined, list: [null, undefined, , 'last'] }),
    bytes: () => bytes,
    writeBytes: (value: Uint8Array) => {
      value[0] = 42
      return value
    },
    maybeFile: (value?: File) => value,
    undefinedValue: () => undefined,
    specialized: (fixed: string, value: string, token: string) => `${fixed}:${value}:${token}`,
  }
  const module = { exports: {} }
  const javascript = ts.transpileModule(generated.files['Bindings.ts']!, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('require', 'exports', javascript)((name: string) => {
    if (name === '@tao/runtime') {
      return {
        default: {
          NativeReferenceGroup: createNativeReferenceGroup,
          NativeValues: nativeValueControls,
          NativeBytes: nativeByteControls,
        },
      }
    }
    if (name === './Bindings.tao') {
      return { Choice: { First: { evaluate: () => ({ jsValue: choice }) } } }
    }
    Expect(name).toBe('native-fixture')
    imports++
    return native
  }, module.exports)
  const exports = module.exports as Record<string, (...arguments_: unknown[]) => unknown>
  const call = (name: string, ...arguments_: unknown[]) => {
    const action = exports[name]
    Assert.defined(action, `generated action '${name}' exists`)
    return action(...arguments_)
  }
  return { generated, bytes, choice, call, imports: () => imports }
}

Describe('catalog object emission', () => {
  Test('associated actions retain native identity, receiver ordering and explicit release', async () => {
    const { call, generated } = await executable()
    const file = call('File_NewFile', 'before')
    Expect(call('File_Append', file, '!')).toBe(file)
    Expect(call('File_CatalogAppend', file, '?')).toBe(file)
    Expect(call('File_Text', file)).toBe('before!?')
    call('File_CatalogWrite', file, 'after')
    Expect(call('File_CatalogText', file)).toBe('after')
    call('File_ReleaseReference', file)
    Expect(() => call('File_Text', file)).toThrow('released')
    const source = generated.files['Bindings.tao']!
    Expect(source).toContain('static action NewFile(Text text) returns File from ./Bindings.ts')
    Expect(source).toContain('action CatalogAppend(Text text) returns File from ./Bindings.ts')
    Expect(source).toContain('action ReleaseReference() from ./Bindings.ts')
    Expect(source).toContain('action CatalogAppend(Receiver File, Text text)')
  })

  Test('emits associated action blocks in the canonical formatter layout', async () => {
    const { generated } = await executable()
    const source = generated.files['Bindings.tao']!
    Expect(source).toContain('type File is item with {\n   static action NewFile(Text text) returns File')
    Expect(source).toContain('\n   action ReleaseReference() from ./Bindings.ts\n}\n')
    Expect(await Formatter.createSession().formatCode(source)).toBe(source)
  })

  Test('preserves union elements through generated result, record and callback types consumed by Tao', async () => {
    const entry: NativeApiType = { kind: 'union', members: [{ kind: 'reference', name: 'Directory' }, file] }
    const entries: NativeApiType = { kind: 'list', element: entry }
    const definition = catalog.references!.find(reference => reference.name === 'File')!
    const fixture: NativeApiCatalog = {
      ...catalog,
      enums: [],
      references: [definition, {
        ...definition,
        name: 'Directory',
        typescript: 'import("native-fixture").Directory',
        runtimeConstructor: { path: ['Directory'] },
      }],
      records: [{ name: 'Payload', fields: [parameter('choice', entry), parameter('entries', entries)] }],
      operations: [
        operation(
          'DirectoryList',
          { kind: 'method', receiver: { kind: 'reference', name: 'Directory' }, member: 'list' },
          [],
          entries,
        ),
        operation('MaybeDirectoryList', { kind: 'call', path: ['maybeList'] }, [], {
          kind: 'nullable',
          value: entries,
        }),
        operation('ReadPayload', { kind: 'call', path: ['payload'] }, [], { kind: 'record', name: 'Payload' }),
        {
          ...operation('Visit', { kind: 'call', path: ['visit'] }, [
            parameter('listener', {
              kind: 'callback',
              parameters: [parameter('entry', entry), parameter('entries', entries)],
            }),
          ]),
          callbackLifetime: 'call',
        },
      ],
    }
    const generated = await generate(fixture)
    Expect((await generate(fixture)).files).toEqual(generated.files)
    await withTaoFiles('native-compound-types', {
      '.tao/.gitkeep': '',
      'Bindings.tao': generated.files['Bindings.tao']!,
      'Bindings.ts': generated.files['Bindings.ts']!,
      'Consumer.ts': '',
      'Main.tao': `
      use DirectoryList, Directory, File from ./Bindings.tao
      type Entry is Directory | File
      action AcceptEntries(Values list of Entry) from ./Consumer.ts
      action Inspect(DirectoryValue Directory) {
        let Entries = do DirectoryList(DirectoryValue)
        do AcceptEntries(Values: Entries)
      }
    `,
    }, async paths => {
      const consumed = await Workspace.validate(paths['Main.tao'])
      Expect(
        consumed.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic =>
          diagnostic.message
        ),
      ).toEqual([])
      const inspect = consumed.entry.ast.statements.find(statement =>
        AST.isActionDeclaration(statement) && statement.name === 'Inspect'
      )
      Expect.Is(inspect, AST.isActionDeclaration)
      const result = inspect.block!.statements.find(AST.isActionResultStatement)
      Expect.Is(result, AST.isActionResultStatement)
      const type = Type.ofValueDeclaration(result)
      Expect(type.kind).toBe('list')
      Assert(type.kind === 'list', 'consumer result is a list')
      Expect(type.element?.kind).toBe('union')
      Assert(type.element?.kind === 'union', 'consumer elements retain the union')
      Expect(type.element.members.map(Type.displayName)).toEqual(['Directory', 'File'])
      const bindings = await Workspace.validate(paths['Bindings.tao'])
      const findAction = (name: string) => {
        const declaration = bindings.entry.ast.statements.find(statement =>
          AST.isActionDeclaration(statement) && statement.name === name
        )
        Expect.Is(declaration, AST.isActionDeclaration)
        return declaration
      }
      const nullable = Type.ofActionResult(findAction('MaybeDirectoryList'))
      Expect(nullable.kind).toBe('union')
      Assert(nullable.kind === 'union', 'nullable result retains outer absence')
      Expect(nullable.members.map(member => member.kind)).toEqual(['list', 'primitive'])
      const payload = bindings.entry.ast.statements.find(statement =>
        AST.isTypeDeclaration(statement) && statement.name === 'Payload'
      )
      Expect.Is(payload, AST.isTypeDeclaration)
      const shape = Type.ofDefinition(payload)
      Assert(shape.kind === 'item' && shape.item, 'payload has item fields')
      const fieldTypes = Type.itemFields(shape.item).map(Type.itemFieldType)
      Expect(fieldTypes.map(field => field.kind)).toEqual(['union', 'list'])
      const fieldEntries = fieldTypes[1]!
      Assert(
        fieldEntries.kind === 'list' && fieldEntries.element?.kind === 'union',
        'record list elements retain the union',
      )
      Expect(fieldEntries.element.members.map(Type.displayName)).toEqual(['Directory', 'File'])
      const callback = Type.ofParameter(AST.parametersOf(findAction('Visit'))[0]!)
      Assert(callback.kind === 'primitive' && callback.primitive === 'action', 'callback retains an action contract')
      Expect(callback.parameters.map(parameter => parameter.type.kind)).toEqual(['union', 'list'])
    }, { verbatim: true })
  })

  Test(
    'rejects nullable TypeReference positions with the operation and exact native type before emitting files',
    async () => {
      const nullableElements: NativeApiType = { kind: 'list', element: { kind: 'nullable', value: file } }
      const rejected = operation('NullableElements', { kind: 'call', path: ['list'] }, [], nullableElements)
      await Expect(generate({ ...catalog, operations: [rejected] })).rejects.toThrow(
        "Native operation 'NullableElements' (NullableElements) cannot represent type 'Array<File | null>' in Tao: nullable type 'File | null' occurs in list element.",
      )
      const callback = operation('NullableCallback', { kind: 'call', path: ['visit'] }, [
        parameter('listener', {
          kind: 'callback',
          parameters: [parameter('value', { kind: 'nullable', value: file, absence: 'undefined' })],
        }),
      ])
      await Expect(generate({ ...catalog, operations: [{ ...callback, callbackLifetime: 'call' }] })).rejects.toThrow(
        "Native operation 'NullableCallback' (NullableCallback) cannot represent type '(value: File | undefined) => void' in Tao: nullable type 'File | undefined' occurs in callback argument.",
      )
      await Expect(
        generate({
          ...catalog,
          records: [{ name: 'Broken', fields: [parameter('values', nullableElements)] }],
          operations: [
            operation('NestedNullable', { kind: 'call', path: ['read'] }, [], { kind: 'record', name: 'Broken' }),
          ],
        }),
      ).rejects.toThrow(
        "Native operation 'NestedNullable' (NestedNullable) cannot represent type 'Broken' in Tao: nullable type 'File | null' occurs in list element.",
      )
    },
  )
  Test(
    'accepts the flagged immediate native base while rejecting shared ancestors, sibling directories and accessor methods',
    async () => {
      class SharedObject {}
      class NativeFile extends SharedObject {
        text = 'native base'
        append() {
          return this
        }
      }
      class PublicFile extends NativeFile {}
      class NativeDirectory extends SharedObject {
        text = 'wrong sibling'
        append() {
          return this
        }
      }
      class PlainRoot {
        append() {
          return this
        }
      }
      class CallableRoot extends Function {
        append() {
          return this
        }
      }
      let accessorReads = 0
      const fake = Object.create(NativeFile.prototype)
      Object.defineProperty(fake, 'append', {
        get() {
          accessorReads++
          return () => fake
        },
      })
      const returned = {
        base: new NativeFile(),
        exported: new PublicFile(),
        directory: new NativeDirectory(),
        ancestor: new SharedObject(),
        plain: { append() {} },
        callable: Object.assign(() => {}, { append() {} }),
        fake,
      }
      const definition = catalog.references!.find(reference => reference.name === 'File')!
      const fixture: NativeApiCatalog = {
        ...catalog,
        enums: [],
        records: [],
        references: [definition, { ...definition, name: 'StrictFile', runtimeConstructor: { path: ['File'] } }, {
          ...definition,
          name: 'Plain',
          runtimeConstructor: { path: ['Plain'], inheritedPrototype: true },
        }, { ...definition, name: 'Callable', runtimeConstructor: { path: ['Callable'], inheritedPrototype: true } }],
        operations: [
          operation('GetFile', { kind: 'call', path: ['get'] }, [parameter('kind', text)], file),
          operation('GetStrict', { kind: 'call', path: ['get'] }, [parameter('kind', text)], {
            kind: 'reference',
            name: 'StrictFile',
          }),
          operation('GetPlain', { kind: 'call', path: ['get'] }, [parameter('kind', text)], {
            kind: 'reference',
            name: 'Plain',
          }),
          operation('GetCallable', { kind: 'call', path: ['get'] }, [parameter('kind', text)], {
            kind: 'reference',
            name: 'Callable',
          }),
          operation(
            'FileText',
            { kind: 'get', receiver: { kind: 'reference', name: 'File' }, member: 'text' },
            [],
            text,
          ),
        ],
      }
      const generated = await generate(fixture)
      const exports: Record<string, (value: unknown) => unknown> = {}
      const javascript = ts.transpileModule(generated.files['Bindings.ts']!, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText
      new Function('require', 'exports', javascript)((name: string) =>
        name === '@tao/runtime'
          ? { default: { NativeReferenceGroup: createNativeReferenceGroup } }
          : {
            File: PublicFile,
            Plain: PlainRoot,
            Callable: CallableRoot,
            get: (kind: keyof typeof returned) => returned[kind],
          }, exports)
      const base = exports['GetFile']!('base')
      Expect(exports['FileText']!(base)).toBe('native base')
      Expect(exports['GetFile']!('base')).toBe(base)
      Expect(exports['FileText']!(exports['GetFile']!('exported'))).toBe('native base')
      for (const kind of ['directory', 'ancestor', 'plain', 'fake']) {
        Expect(() => exports['GetFile']!(kind)).toThrow('not valid for File')
      }
      Expect(accessorReads).toBe(0)
      Expect(() => exports['GetStrict']!('base')).toThrow('not valid for StrictFile')
      Expect(() => exports['GetPlain']!('plain')).toThrow('not valid for Plain')
      Expect(() => exports['GetCallable']!('callable')).toThrow('not valid for Callable')
    },
  )
  Test(
    'finishes synchronous callback admission without dropping accepted actions, and cancels a failed call',
    async () => {
      const callbackOperation = operation('Each', { kind: 'call', path: ['each'] }, [
        parameter('callback', { kind: 'callback', parameters: [] }),
      ], number)
      const generated = await generate({
        ...catalog,
        enums: [],
        records: [],
        references: [],
        operations: [{ ...callbackOperation, callbackLifetime: 'call' }],
      })
      const events: string[] = []
      let late: (() => void) | undefined
      let failed = false
      const owner = new TaoActionOwner()
      const action = {
        invokeOwned(actualOwner: unknown, active: () => boolean) {
          Expect(actualOwner).toBe(owner)
          Expect(active()).toBe(true)
          events.push('callback')
        },
      }
      const exports: Record<string, (value: unknown) => unknown> = {}
      const javascript = ts.transpileModule(generated.files['Bindings.ts']!, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText
      new Function('require', 'exports', javascript)((name: string) =>
        name === '@tao/runtime'
          ? { default: { NativeCallCallbacks: nativeCallCallbacks } }
          : {
            each(callback: () => void) {
              events.push('native')
              late = callback
              callback()
              callback()
              if (failed) {
                Errors.throwHostEnvironment('Native fixture failed.')
              }
              return 123
            },
          }, exports)
      await runAction(
        'Owner',
        [],
        () => {
          Expect(exports['Each']!(action)).toBe(123)
          Expect(events).toEqual(['native'])
          events.push('commit')
        },
        false,
        false,
        undefined,
        undefined,
        owner,
      )
      Expect(events).toEqual(['native', 'commit', 'callback', 'callback'])
      Expect(owner.subscriptions.size).toBe(0)
      late!()
      Expect(events).toEqual(['native', 'commit', 'callback', 'callback'])
      events.length = 0
      failed = true
      await runAction(
        'Owner',
        [],
        () => {
          Expect(() => exports['Each']!(action)).toThrow('Native fixture failed.')
          events.push('commit')
        },
        false,
        false,
        undefined,
        undefined,
        owner,
      )
      Expect(events).toEqual(['native', 'commit'])
      Expect(owner.subscriptions.size).toBe(0)
      await Expect(generate({ ...catalog, operations: [callbackOperation] })).rejects.toThrow(
        "Native operation 'Each' (Each) needs an explicit callback lifetime.",
      )
    },
  )
  Test(
    'executes constructors, static overloads, live members, receiver methods, symbols and protocol upcasts',
    async () => {
      const { call, generated, imports } = await executable()
      Expect(imports()).toBe(0)
      const file = call('NewFile', 'before')
      Expect(call('SameFile', file)).toBe(file)
      Expect(call('Append', file, '!')).toBe(file)
      Expect(call('FileText', file)).toBe('before!')
      Expect(call('CatalogAppend', file, '?')).toBe(file)
      Expect(call('CatalogText', file)).toBe('before!?')
      call('CatalogWrite', file, 'catalog')
      Expect(call('CatalogText', file)).toBe('catalog')
      File.last.text = 'native mutation'
      Expect(call('FileText', file)).toBe('native mutation')
      call('WriteFile', file, 'written')
      Expect(call('AppendParts', file, ['a', 'b'])).toBe(file)
      Expect(call('FileText', file)).toBe('writtena|b')
      const iterator = call('Iterate', file)
      const step = call('Next', iterator)
      Expect(call('NativeValueText', call('NativeValueReadKey', step, 'value'))).toBe('writtena|b')
      const photo = call('NewPhoto', 'photo')
      Expect(call('FileText', photo)).toBe('photo')
      Expect(call('PhotoAsWritable', photo)).toBe(photo)
      Expect(call('FileText', call('StaticFile', 'static'))).toBe('static')
      Expect(call('FileText', call('FileFromText', 'overload'))).toBe('overload')
      Expect(call('FileText', call('FileFromNumber', 42))).toBe('42')
      Expect(call('Specialized', 'value')).toBe('fixed:value:token')
      Expect(call('SpecializedOptional', null)).toBe('fixed:undefined:token')
      Expect(generated.files['Bindings.tao']).toContain('public\ntype File is item')
      Expect(generated.files['Bindings.tao']).toContain('public\ntype Photo is File')
      Expect(generated.files['Bindings.tao']).toContain('public\naction FileText(Receiver File) returns text')
      Expect(generated.files['Bindings.ts']).toContain('// Source: native-fixture/index.d.ts:12:3')
      Expect(() => call('FileText', {})).toThrow('Use a File native reference')
      Expect(() => JSON.stringify(file)).toThrow('cannot be serialized')
      call('ReleaseFile', file)
      Expect(() => call('FileText', file)).toThrow('released')
    },
  )

  Test('converts nested resource maps and discriminates enum, record and reference unions', async () => {
    const { call, choice } = await executable()
    const file = call('NewPhoto', 'resource')
    const entries = call('GetFiles', file)
    Expect(entries).toEqual([{ Key: 'first', Value: file }, { Key: '__proto__', Value: file }])
    Expect(call('ReadFiles', entries)).toBe('true:resource:resource')
    const envelope = { Files: entries, Values: [file], Attachment: file }
    Expect(call('EchoEnvelope', envelope)).toEqual(envelope)
    Expect(call('EchoEnvelope', { Files: entries, Values: [file] })).toEqual({
      Files: entries,
      Values: [file],
    })
    Expect(() => call('ReadFiles', [{ Key: 'first', Value: file }, { Key: 'first', Value: file }])).toThrow('unique')
    Expect(call('ChoiceText', choice)).toBe('first')
    Expect(call('ChoiceText', { Text: 'record' })).toBe('record')
    Expect(call('ChoiceText', file)).toBe('resource')
    Expect(() => call('ChoiceText', 'first')).toThrow('declared native union')
    Expect(() => call('ChoiceText', { Text: 1 })).toThrow('declared native union')
    Expect(call('ChoiceResult', 'enum')).toBe(choice)
    Expect(call('ChoiceResult', 'record')).toEqual({ Text: 'label' })
    Expect(call('ChoiceResult', 'file')).toBe(file)
    Expect(() => call('ChoiceResult', 'invalid')).toThrow('declared native union')
    call('ReleasePhoto', file)
    Expect(() => call('ChoiceText', file)).toThrow('declared native union')
  })

  Test('preserves dynamic present absence, copies checked bytes, and converts undefined nullable results', async () => {
    const { call, bytes } = await executable()
    const value = call('Dynamic')
    Expect(call('NativeValueKeys', value)).toEqual(['presentNull', 'presentUndefined', 'list'])
    Expect(call('NativeValueReadKey', value, 'missing')).toBe(null)
    Expect(call('NativeValueKind', call('NativeValueReadKey', value, 'presentNull'))).toBe('null')
    Expect(call('NativeValueKind', call('NativeValueReadKey', value, 'presentUndefined'))).toBe('undefined')
    const list = call('NativeValueReadKey', value, 'list')
    Expect(call('NativeValueLength', list)).toBe(4)
    Expect(call('NativeValueKind', call('NativeValueReadIndex', list, 1))).toBe('undefined')
    Expect(call('NativeValueReadIndex', list, 2)).toBe(null)
    const snapshot = call('GetBytes')
    bytes[0] = 99
    Expect(snapshot).toEqual([1, 255])
    const input = [2, 3]
    Expect(call('WriteBytes', input)).toEqual([42, 3])
    Expect(input).toEqual([2, 3])
    Expect(() => call('WriteBytes', [256])).toThrow('0 to 255')
    Expect(call('MaybeFile', null)).toBe(null)
    const file = call('NewFile', 'maybe')
    Expect(call('MaybeFile', file)).toBe(file)
    Expect(call('NativeValueKind', call('Undefined'))).toBe('undefined')
  })

  Test(
    'validates nominal declarations, rejects persistence and typechecks precise sidecar reference results',
    async () => {
      const generated = await generate()
      await withTaoFiles('native-object-emission', {
        '.tao/.gitkeep': '',
        'Bindings.tao': generated.files['Bindings.tao']!,
        'Bindings.ts': generated.files['Bindings.ts']!,
        'Bindings.tao.ts': 'export declare const Choice: { First: { evaluate(): { jsValue: unknown } } }',
        'Native.ts': `export interface Writable { append(value: string): File }
        export class File implements Writable { constructor(value: string); text: string; append(value: string): File; appendParts(...values: string[]): File; static create(value: string): File; [Symbol.iterator](): Iterator<string> }
        export class Photo extends File {}
        export declare function sameFile(value: File): File;
        export declare function from(value: string): File;
        export declare function from(value: number): File;
        export declare function files(value: File): Record<string, File>;
        export declare function readFiles(value: Record<string, File>): string;
        export declare function echoEnvelope(value: { files: Record<string, File>; values: Array<File>; attachment?: File }): { files: Record<string, File>; values: Array<File>; attachment?: File };
        export declare function choiceText(value: 'first' | { text: string } | File): string;
        export declare function choiceResult(kind: string): 'first' | { text: string } | File;
        export declare function dynamic(): unknown;
        export declare function bytes(): Uint8Array;
        export declare function writeBytes(value: Uint8Array): Uint8Array;
        export declare function maybeFile(value: File | undefined): File | undefined;
        export declare function undefinedValue(): undefined;
        export declare const Token: string;
        export declare function specialized(fixed: string, value: string | undefined, token: string): string;
      `,
        'Main.tao': '',
      }, async paths => {
        const declarations = await Workspace.validate(paths['Bindings.tao'])
        Expect(
          declarations.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic =>
            diagnostic.message
          ),
        ).toEqual([])
        await FS.writeText(
          paths['Main.tao'],
          `use File from ./Bindings.tao
        app NativeObjects { id "native-objects" version "1.0.0" name "Native Objects"
          state Current is File = none (persist)
          view Main
        }
        view Main() { render inject \`\`\`ts return null \`\`\` }
      `,
        )
        const persisted = await Workspace.validate(paths['Main.tao'])
        Expect(persisted.diagnostics.map(diagnostic => diagnostic.message)).toContain(
          StateValidator.messages.persistedTypeUnsupported('Current', 'File'),
        )
        const options: ts.CompilerOptions = {
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
        }
        const program = ts.createProgram([paths['Bindings.ts']], options)
        const source = program.getSourceFile(paths['Bindings.ts'])!
        Expect([...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]
          .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([])
        Expect(await FS.readText(paths['Bindings.ts'])).toContain('): TR.NativeReference<NativeFile>')
      }, { verbatim: true })
    },
  )
})
