import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'
import { BridgeMetadata, type BridgeTypeOriginResolver } from '../compiler-src/bridge-metadata'
import { Workspace } from '../compiler-src/workspace'

const strictOptions: ts.CompilerOptions = {
  strict: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noEmit: true,
  types: [],
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
}

const tao = `
type File is {}
type Directory is {}
type Entry is File | Directory
type Scalar is text | number
type Mode is one of Quiet, Loud
type Envelope is { File File, Files list of File, Entry Entry, Listener action(File), Mode Mode }
type Options is { Enabled boolean, Tag text? }
action Read(Receiver File) returns File from ./Native.ts
action Subscribe(Listener action(File)) from ./Native.ts
action SubscribeUnion(Listener action(Entry)) from ./Native.ts
action SubscribeScalar(Listener action(Scalar)) from ./Native.ts
action Exchange(Input Envelope) returns Envelope from ./Native.ts
action ReadAll() returns list of File from ./Native.ts
action Select() returns Entry from ./Native.ts
action SetMode(Value Mode) returns Mode from ./Native.ts
action Configure(Value Options) from ./Native.ts
`

const runtime = `
declare namespace TR {
  export type Value<T> = { evaluate(): { jsValue: T } }
  export type Evaluable = Value<unknown>
  export type ActionValue<A extends readonly unknown[]> = { invoke(...args: A): void | Promise<void> }
}
export default TR
`

const native = `
import type TR from './sdk/runtime/TaoRuntime-src/TR'
declare const fileFamily: unique symbol
declare const directoryFamily: unique symbol
export type NativeTypes = {
  File: { readonly [fileFamily]: 'File' }
  Directory: { readonly [directoryFamily]: 'Directory' }
}
export type NativeMode = 'quiet' | 'loud'
type Envelope = {
  File: NativeTypes['File']
  Files: NativeTypes['File'][]
  Entry: NativeTypes['File'] | NativeTypes['Directory']
  Listener: { invoke(...args: [TR.Value<NativeTypes['File']>]): void | Promise<void> }
  Mode: NativeMode
}
export declare function Read(receiver: NativeTypes['File']): NativeTypes['File']
export declare function Subscribe(listener: TR.ActionValue<[TR.Value<NativeTypes['File']>]>): void
export declare function SubscribeUnion(listener: TR.ActionValue<[TR.Value<NativeTypes['File'] | NativeTypes['Directory']>]>): void
export declare function SubscribeScalar(listener: TR.ActionValue<[TR.Evaluable]>): void
export declare function Exchange(input: Envelope): Envelope
export declare function ReadAll(): NativeTypes['File'][]
export declare function Select(): NativeTypes['File'] | NativeTypes['Directory']
export declare function SetMode(value: NativeMode): NativeMode
export declare function Configure(value: { Enabled: boolean; Tag?: string | null }): void
`

Describe('compiler: native bridge type origins', () => {
  Test('preserves opaque origins through receivers, callbacks, records, lists, unions and results', async () => {
    await withTaoFiles('tao-native-type-origins-', {
      'Main.tao': tao,
      'Native.ts': native,
      'sdk/runtime/TaoRuntime-src/TR.ts': runtime,
      'Consumer.ts': `
import type { File } from './.tao-ts/Main.tao'
import type { NativeTypes } from './Native'
declare const value: NativeTypes['File']
export const accepted: File = value
`,
    }, async (paths, root) => {
      const validation = await (await Workspace.open(root)).validate(paths['Main.tao'])
      Expect(validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      const file = validation.files.find(file => file.path === paths['Main.tao'])
      Assert.defined(file, 'native fixture source is parsed')
      const declarations = file.ast.statements.filter(AST.isTypeDeclaration)
      const origins = new Map<AST.TypeDefinition, string>(
        declarations.filter(declaration => ['File', 'Directory', 'Mode'].includes(declaration.name))
          .map(declaration => [declaration, declaration.name]),
      )
      const typeOriginResolver: BridgeTypeOriginResolver = declaration => {
        const name = origins.get(declaration)
        return name === undefined ? undefined : {
          implementationPath: paths['Native.ts'],
          exportName: name === 'Mode' ? 'NativeMode' : 'NativeTypes',
          ...(name === 'Mode' ? {} : { memberName: name }),
        }
      }
      const companion = BridgeMetadata.collect(validation.files, root, new Map(), {
        runtimeRoot: FS.resolvePath('sdk/runtime', root),
        typeOriginResolver,
      }).find(module => module.sourcePath === paths['Main.tao'])
      Assert.defined(companion, 'native bridge companion is generated')
      Expect(companion.code).toContain(
        'export type Read = (arg0: import("../Native").NativeTypes["File"]) => import("../Native").NativeTypes["File"] | Promise<import("../Native").NativeTypes["File"]>',
      )
      Expect(companion.code).toContain('TR.ActionValue<[TR.Value<import("../Native").NativeTypes["File"]>]>')
      Expect(companion.code).toContain(
        'TR.ActionValue<[TR.Value<import("../Native").NativeTypes["File"] | import("../Native").NativeTypes["Directory"]>]>',
      )
      Expect(companion.code).toContain(
        'export type SubscribeScalar = (arg0: TR.ActionValue<[TR.Evaluable]>) => void | Promise<void>',
      )
      Expect(companion.code).toContain('"Files": Array<import("../Native").NativeTypes["File"]>')
      Expect(companion.code).toContain(
        '"Listener": { invoke(...args: [TR.Value<import("../Native").NativeTypes["File"]>]): void | Promise<void> }',
      )
      Expect(companion.code).toContain('"Mode": import("../Native").NativeMode')
      Expect(companion.code).toContain('export type File = import("../Native").NativeTypes["File"]')
      Expect(companion.code).toContain(
        'export type Configure = (arg0: { "Enabled": boolean; "Tag"?: string | null }) => void | Promise<void>',
      )
      Expect(companion.code).not.toContain('Parameters<typeof Sidecar.Read>[0]')
      await FS.writeText(companion.path, companion.code)
      Expect(
        ts.getPreEmitDiagnostics(ts.createProgram([companion.path, paths['Consumer.ts']], strictOptions))
          .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
      ).toEqual([])

      await FS.writeText(
        paths['Consumer.ts'],
        `
import type { File } from './.tao-ts/Main.tao'
import type { NativeTypes } from './Native'
declare const directory: NativeTypes['Directory']
export const wrongFamily: File = directory
export const forged: File = {}
`,
      )
      const consumerDiagnostics = ts.getPreEmitDiagnostics(
        ts.createProgram([companion.path, paths['Consumer.ts']], strictOptions),
      )
      Expect(consumerDiagnostics).toHaveLength(2)
      Expect(consumerDiagnostics.every(diagnostic => diagnostic.file?.fileName === paths['Consumer.ts'])).toBe(true)
      Expect(consumerDiagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')))
        .toEqual([
          "Property '[fileFamily]' is missing in type '{ readonly [directoryFamily]: \"Directory\"; }' but required in type '{ readonly [fileFamily]: \"File\"; }'.",
          "Property '[fileFamily]' is missing in type '{}' but required in type '{ readonly [fileFamily]: \"File\"; }'.",
        ])

      for (
        const incompatible of [
          native.replace("Read(receiver: NativeTypes['File'])", "Read(receiver: NativeTypes['Directory'])"),
          native.replace("): NativeTypes['File']\n", "): NativeTypes['Directory']\n"),
          native.replace(
            "Subscribe(listener: TR.ActionValue<[TR.Value<NativeTypes['File']>]>):",
            "Subscribe(listener: TR.ActionValue<[TR.Value<NativeTypes['Directory']>]>):",
          ),
        ]
      ) {
        Expect(incompatible).not.toBe(native)
        await FS.writeText(paths['Native.ts'], incompatible)
        const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([companion.path], strictOptions))
        Expect(diagnostics.length).toBeGreaterThan(0)
        Expect(
          diagnostics.every(diagnostic => diagnostic.code === 2344 && diagnostic.file?.fileName === companion.path),
        ).toBe(true)
      }

      const modulePath = FS.resolvePath('.tao/cache/compiled/Main.ts', root)
      const options = { modulePath, typeOriginResolver }
      const types = BridgeMetadata.typesFor(file.ast, file.ast.statements, options)
      Expect(types).toContain('import("../../../Native").NativeTypes["File"]')
      const fileDeclaration = declarations.find(declaration => declaration.name === 'File')
      Assert.defined(fileDeclaration, 'File declaration owns its native type origin')
      Expect(BridgeMetadata.resultType(Type.ofDefinition(fileDeclaration), options))
        .toBe('import("../../../Native").NativeTypes["File"]')
      const unmapped = BridgeMetadata.typesFor(file.ast)
      Expect(unmapped).toContain('export type Read = (arg0: {  }) => {  } | Promise<{  }>')
      Expect(unmapped).toContain(
        'export type SubscribeUnion = (arg0: TR.ActionValue<[TR.Evaluable]>) => void | Promise<void>',
      )
      Expect(unmapped).not.toContain('import(')
      Expect(BridgeMetadata.typesFor(file.ast, file.ast.statements, { typeOriginResolver: () => undefined })).toBe(
        unmapped,
      )
    })
  })

  Test('publishes a mapped type from a file without foreign actions or case declarations', async () => {
    await withTaoFiles('tao-native-type-only-', {
      'Types.tao': 'type File is {}',
      'Native.ts': 'export type FileReference = { readonly family: "File" }',
    }, async (paths, root) => {
      const validation = await (await Workspace.open(root)).validate(paths['Types.tao'])
      Expect(validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      const file = validation.files.find(file => file.path === paths['Types.tao'])
      Assert.defined(file, 'type-only source is parsed')
      const declaration = file.ast.statements.find(AST.isTypeDeclaration)
      Assert.defined(declaration, 'type-only File is declared')
      const typeOriginResolver: BridgeTypeOriginResolver = candidate =>
        candidate === declaration
          ? { implementationPath: paths['Native.ts'], exportName: 'FileReference' }
          : undefined
      const modules = BridgeMetadata.collect(validation.files, root, new Map(), { typeOriginResolver })
        .filter(module => module.sourcePath === paths['Types.tao'])
      Expect(modules).toHaveLength(1)
      Expect(modules[0]?.code).toContain('export type File = import("../Native").FileReference')
      Expect(modules[0]?.implementationPaths).toEqual([])
      const modulePath = FS.resolvePath('.tao-ts/Types.tao.ts', root)
      Expect(BridgeMetadata.typesFor(file.ast, file.ast.statements, { modulePath, typeOriginResolver }))
        .toBe('export type File = import("../Native").FileReference')
      Expect(BridgeMetadata.collect(validation.files, root).filter(module => module.sourcePath === paths['Types.tao']))
        .toEqual([])
    })
  })
})
