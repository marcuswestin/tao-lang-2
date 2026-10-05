import { ExpoApiSource } from '@native-bindings'
import { Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import type * as TS from 'typescript'
import { maintainedNativeSources } from '../native-bindings-src/maintained-native-sources'
import { resolveTypeScriptApiInput } from '../native-bindings-src/typescript-api-source'

async function extract(
  declaration: string,
  run: (result: Awaited<ReturnType<typeof ExpoApiSource.read>>, root: string) => Promise<void> | void,
  extraFiles: Record<string, string> = {},
) {
  await withTaoFiles(
    'native-object-extraction',
    {
      'tsconfig.json': JSON.stringify({
        compilerOptions: { target: 'ES5', lib: ['ES5'], types: ['bun', 'node'], strictNullChecks: false },
      }),
      'node_modules/native-example/package.json': JSON.stringify({
        name: 'native-example',
        version: '1.0.0',
        types: 'index.d.ts',
        main: 'index.js',
      }),
      'node_modules/native-example/index.js': 'throw Error("Declarations must never execute")',
      'node_modules/native-example/index.d.ts': declaration,
      ...extraFiles,
    },
    async (_paths, root) => run(await ExpoApiSource.read({ packageName: 'native-example', fromDirectory: root }), root),
    { location: 'host', verbatim: true },
  )
}

function assertPublicCoverage(catalog: Awaited<ReturnType<typeof ExpoApiSource.read>>['catalog']) {
  const ts = require(Repo.resolvePath('node_modules/typescript/lib/typescript.js')) as typeof TS
  const program = ts.createProgram([
    Repo.resolvePath(`packages/apps/native-bindings/node_modules/${catalog.packageName}/${catalog.declaration}`),
  ], {
    target: ts.ScriptTarget.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    customConditions: ['react-native'],
    types: [],
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    skipLibCheck: true,
    strict: true,
  })
  const checker = program.getTypeChecker()
  const file = program.getSourceFile(program.getRootFileNames()[0]!)!
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(file)!)
  const names = exports.map(symbol => symbol.name).sort()
  Expect([
    ...new Set(
      catalog.coverage?.filter(row => names.includes(row.provenance.symbol))
        .map(row => row.provenance.symbol),
    ),
  ].sort()).toEqual(names)
  for (const exported of exports) {
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    if (!declaration || !(symbol.flags & ts.SymbolFlags.Class)) {
      continue
    }
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration)
    const constructor = checker.getSignaturesOfType(type, ts.SignatureKind.Construct)[0]
    if (!constructor) {
      continue
    }
    for (const shape of [type, checker.getReturnTypeOfSignature(constructor)]) {
      for (const property of checker.getPropertiesOfType(shape)) {
        const declaration = property.valueDeclaration ?? property.declarations?.[0]
        if (
          !declaration || property.name === 'prototype'
          || property.declarations?.some(node =>
            !!(ts.getCombinedModifierFlags(node)
              & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected))
          )
        ) {
          continue
        }
        const member = property.name.startsWith('__@')
          ? (declaration as TS.NamedDeclaration).name?.getText()
          : property.name
        Expect(catalog.coverage?.some(row => row.provenance.symbol === `${exported.name}.${member}`)).toBe(true)
      }
    }
  }
}

Describe('native object declaration extraction', () => {
  Test(
    'covers every public Files export and member with verified events, pending transfers and tuple protocols',
    async () => {
      const entry = maintainedNativeSources.find(source => source.capability === 'files')!
      const { catalog, diagnostics, resolvedInputs } = await ExpoApiSource.read({
        packageName: 'expo-file-system',
        fromDirectory: Repo.resolvePath('packages/apps/native-bindings'),
        globalExports: entry.globalExports,
      })
      Expect(diagnostics).toEqual([])
      Expect(catalog.packageVersion).toBe('57.0.7')
      assertPublicCoverage(catalog)
      Expect(catalog.operations).toHaveLength(218)
      Expect(entry.globalExports).toEqual(['AbortController'])
      Expect(catalog.operations.find(operation => operation.name === 'AbortControllerConstruct')?.target)
        .toEqual({ kind: 'construct', path: ['AbortController'], global: true })
      Expect(catalog.references?.find(reference => reference.name === 'AbortController')?.runtimeConstructor)
        .toEqual({ path: ['AbortController'], global: true })
      Expect(catalog.operations.find(operation => operation.name === 'AbortControllerSignalGet')?.result)
        .toEqual({ kind: 'reference', name: 'AbortSignal' })
      Expect(catalog.references?.filter(reference => reference.name === 'AbortSignal')).toHaveLength(1)
      Expect(catalog.operations.some(operation => operation.name === 'AbortSignalConstruct')).toBe(false)
      Expect(catalog.operations.filter(operation => operation.target?.kind === 'construct' && operation.target.global))
        .toHaveLength(1)
      Expect(resolvedInputs?.map(({ filePath: _path, packageRoot: _root, ...input }) => input)).toEqual(catalog.inputs)
      Expect(resolvedInputs?.every(input => input.filePath.startsWith(input.packageRoot + '/'))).toBe(true)
      Expect(JSON.stringify(catalog)).not.toContain(Repo.getRoot())
      Expect(catalog.operations.find(operation => operation.provenance?.symbol === 'File.info')?.name).toBe(
        'FileInfoAction',
      )
      Expect(catalog.operations.find(operation => operation.provenance?.symbol === 'Directory.info')?.name).toBe(
        'DirectoryInfoAction',
      )
      Expect(catalog.references?.find(reference => reference.name === 'FileHandle')).toMatchObject({
        typescript: 'import("expo-file-system").FileHandle',
        methods: ['close', 'readBytes', 'writeBytes'],
      })
      Expect(catalog.references?.find(reference => reference.name === 'FormData')?.typescript)
        .toBe('Awaited<ReturnType<(import("expo-file-system").File)["formData"]>>')
      Expect(catalog.listeners).toEqual([
        Expect['objectContaining']({
          name: 'EventListener',
          returnContract: 'ignored',
          returnProvenance: Expect['objectContaining']({ packageName: 'typescript', declaration: 'lib/lib.dom.d.ts' }),
          event: {
            argumentIndex: 0,
            permittedControls: ['preventDefault', 'stopPropagation', 'stopImmediatePropagation'],
          },
        }),
      ])
      Expect(catalog.records?.find(record => record.tuple)).toMatchObject({
        fields: [
          { name: 'item0', optional: false, type: { kind: 'reference', name: 'ReadableStreamUint8ArrayArrayBuffer' } },
          { name: 'item1', optional: false, type: { kind: 'reference', name: 'ReadableStreamUint8ArrayArrayBuffer' } },
        ],
      })
      Expect(catalog.operations.filter(operation => operation.eventBinding)).toHaveLength(8)
      Expect(catalog.operations.find(operation => operation.name === 'EventTargetAddEventListener')?.eventBinding)
        .toEqual({
          kind: 'register',
          listener: 'EventListener',
          receiverParameter: 0,
          eventName: { kind: 'parameter', index: 1 },
          callbackParameter: 2,
          optionsParameter: 3,
        })
      Expect(catalog.operations.find(operation => operation.name === 'AbortSignalOnabortSet')?.parameters[1]?.type)
        .toEqual({ kind: 'nullable', value: { kind: 'listener', name: 'EventListener' } })
      Expect(catalog.operations.filter(operation => operation.pending).map(operation => operation.name)).toEqual([
        'DownloadTaskDownloadAsync',
        'DownloadTaskPauseAsync',
        'DownloadTaskResumeAsync',
        'FileDownloadFileAsync',
        'FileUpload',
        'UploadTaskUploadAsync',
      ])
      Expect(catalog.operations.find(operation => operation.name === 'FileUpload')?.callbackOwnership).toEqual([
        { parameter: 2, fields: ['onProgress'], lifetime: { kind: 'promise' } },
      ])
      Expect(catalog.operations.find(operation => operation.name === 'UploadTaskConstruct')?.callbackOwnership).toEqual(
        [
          { parameter: 2, fields: ['onProgress'], lifetime: { kind: 'resource', result: true } },
        ],
      )
      Expect(catalog.operations.find(operation => operation.name === 'UploadTaskCancel')?.callbackEffect)
        .toEqual({ kind: 'cancel-receiver', parameter: 0 })
      Expect(catalog.coverage?.filter(row => row.provenance.declaration === 'build/legacyWarnings.d.ts')).toHaveLength(
        16,
      )
      Expect(
        catalog.inputs?.some(input =>
          input.packageName === 'typescript' && input.declaration === 'lib/lib.dom.d.ts'
          && input.hash.length === 64
        ),
      ).toBe(true)
    },
  )

  Test('covers every public Photos export and member while preserving finite enum field correlations', async () => {
    const { catalog, diagnostics } = await ExpoApiSource.read({
      packageName: 'expo-media-library',
      fromDirectory: Repo.resolvePath('packages/apps/native-bindings'),
    })
    Expect(diagnostics).toEqual([])
    Expect(catalog.packageVersion).toBe('57.0.5')
    assertPublicCoverage(catalog)
    Expect(catalog.operations).toHaveLength(67)
    Expect(JSON.stringify(catalog)).not.toContain(Repo.getRoot())
    Expect(catalog.operations.find(operation => operation.provenance?.symbol === 'Query.constructor')?.provenance)
      .toMatchObject({ signature: '(): import("expo-media-library/build/index").Query', line: 13, column: 5 })
    Expect(catalog.operations.find(operation => operation.provenance?.symbol === 'Asset.constructor')?.provenance)
      .toMatchObject({ signature: '(id: string): import("expo-media-library/build/index").Asset', line: 20, column: 5 })
    Expect(catalog.operations.find(operation => operation.provenance?.symbol === 'Album.constructor')?.provenance)
      .toMatchObject({ signature: '(id: string): import("expo-media-library/build/index").Album', line: 14, column: 5 })
    Expect(catalog.references?.map(reference => reference.name)).toEqual(['Album', 'Asset', 'Query'])
    Expect(catalog.references?.every(reference => reference.runtimeConstructor?.inheritedPrototype)).toBe(true)
    Expect(catalog.operations.filter(operation => operation.provenance?.symbol === 'Query.eq')).toHaveLength(7)
    Expect(catalog.operations.filter(operation => operation.provenance?.symbol === 'Query.within')).toHaveLength(7)
    Expect(catalog.operations.find(operation => operation.name === 'QueryEqForAssetFieldMEDIATYPE')).toMatchObject({
      parameters: [{ name: 'receiver', type: { kind: 'reference', name: 'Query' }, optional: false }, {
        name: 'value',
        type: { kind: 'enum', name: 'MediaType' },
        optional: false,
      }],
      arguments: [{ kind: 'export', path: ['AssetField', 'MEDIA_TYPE'] }, { kind: 'parameter', index: 1 }],
    })
    Expect(
      catalog.operations.find(operation => operation.name === 'QueryWithinForAssetFieldISFAVORITE')?.parameters[1]
        ?.type,
    )
      .toEqual({ kind: 'list', element: { kind: 'primitive', name: 'boolean' } })
    Expect(catalog.operations.find(operation => operation.name === 'AssetStaticDelete')?.target)
      .toEqual({ kind: 'method', receiver: { kind: 'module', path: ['Asset'] }, member: 'delete' })
    Expect(catalog.operations.find(operation => operation.name === 'AssetDelete')?.target)
      .toEqual({ kind: 'method', receiver: { kind: 'reference', name: 'Asset' }, member: 'delete' })
    Expect(catalog.operations.find(operation => operation.name === 'AssetGetExif')?.result)
      .toEqual({ kind: 'map', name: 'AssetGetExifResult', value: { kind: 'dynamic' } })
    Expect(catalog.operations.find(operation => operation.name === 'QueryOrderBy')?.parameters[1]?.type).toEqual({
      kind: 'union',
      members: [
        { kind: 'enum', name: 'AssetField' },
        { kind: 'record', name: 'SortDescriptor' },
      ],
    })
    Expect(catalog.coverage?.filter(row => row.provenance.declaration === 'build/legacyWarnings.d.ts')).toHaveLength(19)
    Expect(catalog.coverage?.find(row => row.provenance.symbol === 'usePermissions')).toMatchObject({
      disposition: 'react-hook',
      operations: [],
    })
  })
  Test(
    'reflects constructors, inherited methods, live properties and returned interfaces without executing exports',
    async () => {
      await extract(
        `
export interface Handle { close(): void; read(count: number): Uint8Array; }
export interface Closable { close(): void; }
export declare class Base { inherited(): string; }
export declare class File extends Base implements Closable {
  constructor(path: string);
  static from(path: string): File;
  readonly uri: string;
  get size(): number; set size(value: number);
  close(): void;
  open(): Handle;
  copy(...destinations: File[]): File;
  private hidden;
  [Symbol.iterator](): Handle;
}
export declare const available: boolean;
`,
        ({ catalog, diagnostics }) => {
          Expect(diagnostics).toEqual([])
          Expect(
            catalog.operations.find(operation => operation.name === 'FileConstruct')?.target,
          ).toEqual({ kind: 'construct', path: ['File'] })
          Expect(
            catalog.operations.find(operation => operation.name === 'FileFrom')?.target,
          ).toEqual({ kind: 'method', receiver: { kind: 'module', path: ['File'] }, member: 'from' })
          Expect(
            catalog.operations.find(operation => operation.name === 'FileInherited')?.parameters[0],
          ).toEqual({ name: 'receiver', optional: false, type: { kind: 'reference', name: 'File' } })
          Expect(
            catalog.operations.find(operation => operation.name === 'FileSizeSet')?.target,
          ).toEqual({ kind: 'set', receiver: { kind: 'reference', name: 'File' }, member: 'size' })
          Expect(catalog.operations.some(operation => operation.name === 'FileUriSet')).toBe(false)
          Expect(catalog.operations.some(operation => operation.name === 'FileHiddenGet')).toBe(false)
          Expect(
            catalog.operations.find(operation => operation.name === 'FileCopy')?.arguments,
          ).toEqual([{ kind: 'parameter', index: 1, rest: true }])
          Expect(
            catalog.operations.find(operation => operation.name === 'HandleRead')?.result,
          ).toEqual({ kind: 'bytes' })
          Expect(
            catalog.references?.find(reference => reference.name === 'File'),
          ).toMatchObject({
            typescript: 'import("native-example").File',
            base: 'Base',
            protocols: ['Closable'],
            runtimeConstructor: { path: ['File'], inheritedPrototype: true },
          })
          Expect(
            catalog.references?.find(reference => reference.name === 'Handle'),
          ).toMatchObject({ methods: ['close', 'read'] })
          Expect(
            catalog.operations.find(operation => operation.name === 'FileIterator')?.target,
          ).toEqual({ kind: 'method', receiver: { kind: 'reference', name: 'File' }, member: { symbol: 'iterator' } })
          Expect(
            catalog.operations.find(operation => operation.name === 'availableGet')?.target,
          ).toEqual({ kind: 'get', receiver: { kind: 'module', path: [] }, member: 'available' })
          Expect(catalog.operations.every(operation => operation.provenance?.line && operation.target)).toBe(true)
          Expect(
            catalog.coverage?.find(row => row.provenance.symbol === 'Handle')?.disposition,
          ).toBe('type')
          Expect(
            catalog.inputs?.some(input =>
              input.packageName === 'typescript' && input.declaration === 'lib/lib.es5.d.ts' && input.hash.length === 64
            ),
          ).toBe(true)
          Expect(
            catalog.inputs?.some(input => input.packageName === 'bun-types' || input.packageName === '@types/node'),
          )
            .toBe(false)
          Expect(catalog.inputs?.some(input => input.declaration === 'lib/lib.dom.d.ts')).toBe(true)
        },
      )
    },
  )

  Test('rejects explicit imports that augment the declaration environment with host globals', async () => {
    await withTaoFiles(
      'native-host-globals',
      {
        'node_modules/native-example/package.json': JSON.stringify({
          name: 'native-example',
          version: '1.0.0',
          types: 'index.d.ts',
        }),
        'node_modules/native-example/index.d.ts': 'import "bun-types"; export declare function read(): string;',
        'node_modules/bun-types/package.json': JSON.stringify({
          name: 'bun-types',
          version: '1.0.0',
          types: 'index.d.ts',
        }),
        'node_modules/bun-types/index.d.ts': 'export {}; declare global { interface Blob { hostOnly(): void; } }',
      },
      async (_paths, root) => {
        await Expect(ExpoApiSource.read({ packageName: 'native-example', fromDirectory: root })).rejects.toThrow(
          "Native declaration environment includes unsupported host globals from 'bun-types/index.d.ts'.",
        )
      },
      { location: 'host', verbatim: true },
    )
  })

  Test(
    'specializes finite field constraints without broadening field values or redundant native arguments',
    async () => {
      await extract(
        `
export interface Fields { name: string; size: number; }
export declare class Filter {
  static eq<K extends keyof Fields>(field: K, value: Fields[K]): Filter;
  static within<K extends keyof Fields>(field: K, values: Fields[K][]): Filter;
  next(): Filter;
}
`,
        ({ catalog, diagnostics }) => {
          Expect(diagnostics).toEqual([])
          Expect(catalog.operations.find(operation => operation.name === 'FilterEqForName')).toMatchObject({
            parameters: [{ name: 'value', optional: false, type: { kind: 'primitive', name: 'text' } }],
            arguments: [{ kind: 'literal', value: 'name' }, { kind: 'parameter', index: 0 }],
            provenance: { specialization: { K: '"name"' } },
          })
          Expect(catalog.operations.find(operation => operation.name === 'FilterEqForSize')?.parameters).toEqual([{
            name: 'value',
            optional: false,
            type: { kind: 'primitive', name: 'number' },
          }])
          Expect(catalog.operations.find(operation => operation.name === 'FilterWithinForSize')?.parameters[0]?.type)
            .toEqual({ kind: 'list', element: { kind: 'primitive', name: 'number' } })
          Expect(catalog.references?.map(reference => reference.name)).toEqual(['Filter'])
          Expect(catalog.operations.filter(operation => operation.name === 'FilterNext')).toHaveLength(1)
        },
      )
    },
  )

  Test('retains absence distinctions, dynamic values, typed maps and concrete records', async () => {
    await extract(
      `
export interface Page<T> { entries: T[]; }
export declare function page(): Page<string>;
export declare function absent(value: string | undefined): void;
export declare function distinctions(): string | null | undefined;
export declare function metadata(): { [key: string]: number };
export declare function dynamicValue(): unknown;
`,
      ({ catalog, diagnostics }) => {
        Expect(diagnostics).toEqual([])
        Expect(catalog.operations.find(operation => operation.name === 'page')?.result).toEqual({
          kind: 'record',
          name: 'PageString',
        })
        Expect(catalog.records?.find(record => record.name === 'PageString')?.fields[0]?.type).toEqual({
          kind: 'list',
          element: { kind: 'primitive', name: 'text' },
        })
        Expect(catalog.operations.find(operation => operation.name === 'absent')?.parameters[0]?.type).toEqual({
          kind: 'nullable',
          value: { kind: 'primitive', name: 'text' },
          absence: 'undefined',
        })
        Expect(catalog.operations.find(operation => operation.name === 'distinctions')?.result).toEqual({
          kind: 'union',
          members: [{ kind: 'absence', value: 'undefined' }, { kind: 'absence', value: 'null' }, {
            kind: 'primitive',
            name: 'text',
          }],
        })
        Expect(catalog.operations.find(operation => operation.name === 'metadata')?.result).toEqual({
          kind: 'map',
          name: 'MetadataResult',
          value: { kind: 'primitive', name: 'number' },
        })
        Expect(catalog.operations.find(operation => operation.name === 'dynamicValue')?.result).toEqual({
          kind: 'dynamic',
        })
      },
    )
  })

  Test('does not retain partial value records from an unsupported live property', async () => {
    await extract(
      'export declare const manager: { data: { callback: () => void }; run(): void; };',
      ({ catalog, diagnostics }) => {
        Expect(diagnostics).toEqual([{
          symbol: 'manager.data',
          reason: 'Nested callbacks require an explicit resource contract.',
        }])
        Expect(catalog.records).toBeUndefined()
        Expect(catalog.operations.map(operation => operation.name)).toEqual(['managerGet', 'managerRun'])
      },
    )
  })

  Test('diagnoses internal submodule references instead of inventing package root exports', async () => {
    await extract(
      'import { Internal } from "./internal"; export declare function open(): Internal;',
      ({ catalog, diagnostics }) => {
        Expect(diagnostics).toEqual([{
          symbol: 'open',
          reason: "Native reference 'Internal' has no public TypeScript annotation.",
        }])
        Expect(catalog.operations).toEqual([])
        Expect(catalog.references).toBeUndefined()
      },
      { 'node_modules/native-example/internal.d.ts': 'export declare class Internal { read(): string; }' },
    )
  })

  Test('rejects compiler error types while preserving explicitly declared any and unknown', async () => {
    await extract(
      `import type { Missing } from 'missing-package';
export declare function readBroken(): Missing;
export declare function readMissingName(): MissingName;
export declare function readAny(value: any): any;
export declare function readUnknown(value: unknown): unknown;`,
      ({ catalog, diagnostics }) => {
        Expect(diagnostics).toEqual([
          {
            symbol: 'readBroken',
            reason:
              "Unresolved TypeScript type 'Missing'. native-example/index.d.ts:1:30: TS2307: Cannot find module 'missing-package' or its corresponding type declarations.",
          },
          {
            symbol: 'readMissingName',
            reason:
              "Unresolved TypeScript type 'MissingName'. native-example/index.d.ts:3:44: TS2304: Cannot find name 'MissingName'.",
          },
        ])
        Expect(catalog.operations.map(operation => operation.name)).toEqual(['readAny', 'readUnknown'])
        for (const operation of catalog.operations) {
          Expect(operation.result).toEqual({ kind: 'dynamic' })
          Expect(operation.parameters[0]?.type).toEqual({ kind: 'dynamic' })
        }
        Expect(catalog.coverage?.filter(row => row.disposition === 'unsupported').map(row => row.provenance.symbol))
          .toEqual(['readBroken', 'readMissingName'])
      },
    )
  })

  Test('retains missing named export and transitive alias compiler origins', async () => {
    await extract(
      `import type { Missing } from './types';
import type { Broken } from './alias';
export declare function readMissingExport(): Missing;
export declare function readBrokenAlias(): Broken;`,
      ({ catalog, diagnostics }) => {
        Expect(diagnostics).toEqual([
          {
            symbol: 'readMissingExport',
            reason:
              "Unresolved TypeScript type 'Missing'. native-example/index.d.ts:1:15: TS2305: Module '\"./types\"' has no exported member 'Missing'.",
          },
          {
            symbol: 'readBrokenAlias',
            reason:
              "Unresolved TypeScript type 'MissingName'. native-example/alias.d.ts:1:22: TS2304: Cannot find name 'MissingName'.",
          },
        ])
        Expect(catalog.operations).toEqual([])
        Expect(catalog.records).toBeUndefined()
      },
      {
        'node_modules/native-example/types.d.ts': 'export interface Present { value: string; }',
        'node_modules/native-example/alias.d.ts': 'export type Broken = MissingName;',
      },
    )
  })

  Test('names overloads from argument types, independent of declaration order', async () => {
    const first =
      'export declare function read(value: string): string; export declare function read(value: number): number;'
    const second =
      'export declare function read(value: number): number; export declare function read(value: string): string;'
    let names: string[] = []
    await extract(first, ({ catalog, diagnostics }) => {
      Expect(diagnostics).toEqual([])
      names = catalog.operations.map(operation => operation.name)
    })
    await extract(second, ({ catalog, diagnostics }) => {
      Expect(diagnostics).toEqual([])
      Expect(catalog.operations.map(operation => operation.name)).toEqual(names)
    })
    Expect(names).toEqual(['readWithNumber', 'readWithString'])
  })

  Test('selects declared global factories with exact targets and transient hashed resolution inputs', async () => {
    await extract(
      `
declare global {
  class SelectedGlobal {
    constructor();
    static create(): SelectedGlobal;
    readonly value: string;
    read(): string;
  }
}
export declare function marker(): void;
`,
      async (_result, root) => {
        const selected = await ExpoApiSource.read({
          packageName: 'native-example',
          fromDirectory: root,
          globalExports: ['SelectedGlobal'],
        })
        Expect(selected.diagnostics).toEqual([])
        Expect(selected.catalog.references?.find(reference => reference.name === 'SelectedGlobal'))
          .toMatchObject({
            typescript: 'globalThis.SelectedGlobal',
            runtimeConstructor: { path: ['SelectedGlobal'], global: true },
          })
        Expect(selected.catalog.operations.find(operation => operation.name === 'SelectedGlobalConstruct')?.target)
          .toEqual({ kind: 'construct', path: ['SelectedGlobal'], global: true })
        Expect(selected.catalog.operations.find(operation => operation.name === 'SelectedGlobalCreate')?.target)
          .toEqual({
            kind: 'method',
            receiver: { kind: 'module', path: ['SelectedGlobal'], global: true },
            member: 'create',
          })
        Expect(selected.catalog.operations.find(operation => operation.name === 'SelectedGlobalRead')?.target)
          .toEqual({ kind: 'method', receiver: { kind: 'reference', name: 'SelectedGlobal' }, member: 'read' })
        Expect(selected.catalog.coverage?.find(row => row.provenance.symbol === 'SelectedGlobal'))
          .toMatchObject({
            disposition: 'generated',
            provenance: { packageName: 'native-example', declaration: 'index.d.ts' },
          })
        Expect(selected.resolvedInputs?.map(({ filePath: _file, packageRoot: _root, ...input }) => input))
          .toEqual(selected.catalog.inputs)
        Expect(JSON.stringify(selected.catalog)).not.toContain(root)
        Expect(resolveTypeScriptApiInput('native-example', root)).toBe(`${root}/node_modules/native-example/index.d.ts`)
        Expect(resolveTypeScriptApiInput('missing-native-package', root)).toBe(undefined)
        await Expect(
          ExpoApiSource.read({ packageName: 'native-example', fromDirectory: root, globalExports: ['MissingGlobal'] }),
        ).rejects.toThrow("Native global export 'MissingGlobal' must resolve to a declared global runtime value.")
      },
    )
    await extract(`export declare class AbortController { constructor(); }`, async (_result, root) => {
      await Expect(
        ExpoApiSource.read({ packageName: 'native-example', fromDirectory: root, globalExports: ['AbortController'] }),
      ).rejects.toThrow("Native global export 'AbortController' must resolve to a declared global runtime value.")
    })
  })

  Test('splits ambiguous optional overloads into every finite distinguishing call form', async () => {
    await extract(
      `
export declare function pick(options?: { multiple?: false }): string;
export declare function pick(options?: { multiple: true }): string[];
export declare function pick(uri?: string, mime?: string): number;
`,
      ({ catalog, diagnostics }) => {
        Expect(diagnostics).toEqual([])
        const variants = catalog.operations.filter(operation => operation.provenance?.symbol === 'pick')
        Expect(variants).toHaveLength(4)
        const required = variants.filter(operation => operation.provenance?.specialization?.['requiredParameter'])
        Expect(required.map(operation => operation.provenance?.specialization?.['requiredParameter']).sort())
          .toEqual(['mime', 'options', 'uri'])
        for (const operation of required) {
          const parameter = operation.provenance!.specialization!['requiredParameter']!
          Expect(operation.name.endsWith(`Requiring${parameter[0]!.toUpperCase()}${parameter.slice(1)}`)).toBe(true)
          Expect(operation.parameters.find(item => item.name === parameter)?.optional).toBe(false)
          Expect(catalog.coverage?.find(row => row.operations.includes(operation.name))?.provenance.specialization)
            .toEqual(operation.provenance?.specialization)
        }
        const mime = required.find(operation => operation.provenance?.specialization?.['requiredParameter'] === 'mime')!
        Expect(mime.parameters.map(parameter => ({ name: parameter.name, optional: parameter.optional })))
          .toEqual([{ name: 'uri', optional: true }, { name: 'mime', optional: false }])
        Expect(mime.result).toEqual({ kind: 'primitive', name: 'number' })
      },
    )
    await extract(
      `
export declare function conflict(value?: string): number;
export declare function conflict(value?: string): string;
`,
      ({ diagnostics }) => {
        Expect(diagnostics).toMatchObject([{
          symbol: 'conflict',
          reason:
            "Native overload 'conflict' has conflicting absent-argument results without a finite distinguishing parameter.",
        }])
      },
    )
  })

  Test('records exact unsupported symbols and validates explicit deferrals', async () => {
    await extract(
      `
export declare function infinite<T>(value: T): T;
export declare function callback(value: () => number): void;
/** @deprecated Use current instead. */
export declare function old(): void;
export declare function usePermissions(): unknown;
`,
      async ({ diagnostics, catalog }, root) => {
        Expect(diagnostics.map(diagnostic => diagnostic.symbol)).toEqual(['infinite', 'callback'])
        Expect(catalog.coverage?.find(row => row.provenance.symbol === 'old')).toMatchObject({
          disposition: 'deprecated',
          reason: 'Use current instead.',
          operations: ['old'],
        })
        const deferred = await ExpoApiSource.read({
          packageName: 'native-example',
          fromDirectory: root,
          defer: [{ symbol: 'usePermissions', disposition: 'react-hook', reason: 'Requires a React render scope.' }],
        })
        Expect(deferred.catalog.coverage?.find(row => row.provenance.symbol === 'usePermissions')).toMatchObject({
          disposition: 'react-hook',
          reason: 'Requires a React render scope.',
        })
        await Expect(
          ExpoApiSource.read({
            packageName: 'native-example',
            fromDirectory: root,
            defer: [{ symbol: 'missing', disposition: 'react-hook', reason: 'Missing.' }],
          }),
        ).rejects.toThrow("No public native export 'missing' exists to defer.")
      },
    )
  })

  Test('keeps live exported objects and constructor values as references', async () => {
    await extract(
      `
export interface NativeFile { open(): NativeFile; }
export declare const File: { new(path: string): NativeFile; from(path: string): NativeFile; };
export declare const manager: { open(): NativeFile; readonly version: string; };
`,
      ({ catalog, diagnostics }) => {
        Expect(diagnostics).toEqual([])
        Expect(catalog.references?.find(reference => reference.name === 'NativeFile')).toMatchObject({
          typescript: 'import("native-example").NativeFile',
          runtimeConstructor: { path: ['File'] },
        })
        Expect(catalog.references?.find(reference => reference.name === 'manager')).toMatchObject({
          typescript: 'typeof import("native-example").manager',
          methods: ['open'],
        })
        Expect(catalog.operations.find(operation => operation.name === 'managerOpen')?.target).toEqual({
          kind: 'method',
          receiver: { kind: 'reference', name: 'manager' },
          member: 'open',
        })
      },
    )
  })

  Test('anchors package ambient protocols through an unambiguous public return signature', async () => {
    await extract(
      `
declare global { interface NativeOpaque { read(): string; } }
export declare function opaque(): Promise<NativeOpaque>;
`,
      ({ catalog, diagnostics }) => {
        Expect(diagnostics).toEqual([])
        Expect(catalog.references?.find(reference => reference.name === 'NativeOpaque')).toMatchObject({
          typescript: 'Awaited<ReturnType<typeof import("native-example")["opaque"]>>',
          methods: ['read'],
        })
        Expect(catalog.operations.find(operation => operation.name === 'NativeOpaqueRead')?.result)
          .toEqual({ kind: 'primitive', name: 'text' })
      },
    )
    await extract(
      `
declare global { interface NativeOpaque { read(): string; } }
export declare function opaque(value: string): NativeOpaque;
export declare function opaque(value: number): string;
`,
      ({ diagnostics, catalog }) => {
        Expect(diagnostics).toMatchObject([{
          symbol: 'opaque',
          reason: "Native ambient reference 'NativeOpaque' requires an unambiguous public signature type anchor.",
        }])
        Expect(catalog.references ?? []).toEqual([])
      },
    )
  })

  Test('qualifies concrete generic reference annotations and reuses cyclic references', async () => {
    await extract(
      `
export interface Box<T> { get(): T; next(): Box<T>; }
export interface File { close(): void; }
export declare function box(): Box<File>;
export declare function textBox(): Box<string>;
`,
      ({ catalog, diagnostics }) => {
        Expect(diagnostics).toEqual([])
        Expect(catalog.references?.find(reference => reference.name === 'BoxFile')?.typescript).toBe(
          'import("native-example").Box<import("native-example").File>',
        )
        Expect(catalog.references?.find(reference => reference.name === 'BoxString')?.typescript).toBe(
          'import("native-example").Box<string>',
        )
        Expect(catalog.operations.find(operation => operation.name === 'BoxStringGet')?.result).toEqual({
          kind: 'primitive',
          name: 'text',
        })
        Expect(catalog.operations.find(operation => operation.name === 'BoxFileNext')?.result).toEqual({
          kind: 'reference',
          name: 'BoxFile',
        })
        Expect(catalog.references?.map(reference => reference.name)).toEqual(['BoxFile', 'BoxString', 'File'])
      },
    )
  })

  Test('pins standard synchronous callback metadata and never infers it from an unrelated class name', async () => {
    await extract('export declare function form(): FormData;', ({ catalog, diagnostics }) => {
      Expect(diagnostics.filter(diagnostic => diagnostic.symbol === 'FormData.forEach')).toEqual([])
      Expect(catalog.operations.find(operation => operation.name === 'FormDataForEach')).toMatchObject({
        callbackLifetime: 'call',
        provenance: { packageName: 'typescript', declaration: 'lib/lib.dom.d.ts', symbol: 'FormData.forEach' },
      })
      Expect(catalog.operations.some(operation => operation.name.startsWith('ReadableStreamConstruct'))).toBe(false)
    })
    await extract(
      'export declare class FormData { forEach(callback: (value: string) => void): void; }',
      ({ catalog, diagnostics }) => {
        Expect(catalog.operations.some(operation => operation.name === 'FormDataForEach')).toBe(false)
        Expect(diagnostics).toEqual([{
          symbol: 'FormData.forEach',
          reason: 'Callback operations must return a supported owned subscription.',
        }])
      },
    )
  })

  Test('specializes reached byte-stream protocols with correlated input and output types', async () => {
    await extract(
      `
export declare function stream(): ReadableStream<Uint8Array<ArrayBuffer>>;
export declare function reader(): ReadableStreamBYOBReader;
export declare function bytes(): Uint8Array<ArrayBuffer>;
`,
      ({ catalog, diagnostics }) => {
        Expect(
          diagnostics.filter(diagnostic =>
            diagnostic.symbol.endsWith('.pipeThrough') || diagnostic.symbol === 'ReadableStreamBYOBReader.read'
          ),
        ).toEqual([])
        const pipe = catalog.operations.find(operation =>
          operation.name === 'ReadableStreamUint8ArrayArrayBufferPipeThroughForUint8ArrayArrayBuffer'
        )
        Expect(pipe?.result).toEqual({ kind: 'reference', name: 'ReadableStreamUint8ArrayArrayBuffer' })
        Expect(pipe?.provenance?.specialization).toEqual({ T: 'Uint8Array<ArrayBuffer>' })
        const pair = catalog.records?.find(record =>
          record.name === 'ReadableWritablePairUint8ArrayArrayBufferUint8ArrayArrayBuffer'
        )
        Expect(pair?.fields).toEqual([
          {
            name: 'readable',
            optional: false,
            type: { kind: 'reference', name: 'ReadableStreamUint8ArrayArrayBuffer' },
          },
          {
            name: 'writable',
            optional: false,
            type: { kind: 'reference', name: 'WritableStreamUint8ArrayArrayBuffer' },
          },
        ])
        const read = catalog.operations.find(operation =>
          operation.name === 'ReadableStreamBYOBReaderReadForUint8ArrayArrayBuffer'
        )
        Expect(read?.parameters[1]?.type).toEqual({ kind: 'bytes' })
        Expect(read?.provenance?.specialization).toEqual({ T: 'Uint8Array<ArrayBuffer>' })
        Expect(catalog.operations.find(operation => operation.name === 'ReadableStreamGenericReaderClosedGet'))
          .toMatchObject({ asynchronous: true })
        Expect(catalog.references?.some(reference => reference.name === 'PromiseVoid')).toBe(false)
      },
    )
  })

  Test('recognizes only the verified watcher resource declaration and disposal shape', async () => {
    await withTaoFiles('native-watch-extraction', {
      'tsconfig.json': JSON.stringify({ compilerOptions: { types: [] } }),
      'node_modules/expo-file-system/package.json': JSON.stringify({
        name: 'expo-file-system',
        version: '1',
        types: 'build/index.d.ts',
      }),
      'node_modules/expo-file-system/build/index.d.ts':
        `export type { WatchSubscription } from './FileSystemWatcher.types'; import type { WatchSubscription } from './FileSystemWatcher.types'; export declare class File { watch(callback: (event: string | undefined) => void): WatchSubscription; }`,
      'node_modules/expo-file-system/build/FileSystemWatcher.types.d.ts':
        'export type WatchSubscription = { remove(): void };',
    }, async (_paths, root) => {
      const result = await ExpoApiSource.read({ packageName: 'expo-file-system', fromDirectory: root })
      Expect(result.diagnostics).toEqual([])
      Expect(result.catalog.operations.find(operation => operation.name === 'FileWatch')).toMatchObject({
        result: { kind: 'record', name: 'WatchSubscription' },
        callbackLifetime: 'subscription',
      })
      Expect(result.catalog.records?.find(record => record.name === 'WatchSubscription')).toMatchObject({
        disposal: 'remove',
      })
    }, { location: 'host', verbatim: true })
  })
})
