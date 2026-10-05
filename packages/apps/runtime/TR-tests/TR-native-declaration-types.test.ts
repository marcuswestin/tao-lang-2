import { FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'

const consumerTypes = `
import { createNativeReferenceType, type NativeReference } from './emitted/TR-native-references'
import { createNativePendingType, type NativePendingType } from './emitted/TR-native-pending'
import { invokeNativeAction } from './emitted/TR-native-action'
type File = { readonly kind: 'file'; text: string }
type Directory = { readonly kind: 'directory'; children: string[] }
type PendingFile = ReturnType<NativePendingType<File>['start']>
type PendingDirectory = ReturnType<NativePendingType<Directory>['start']>
`

Describe('native declarations', () => {
  Test('retains reference and pending result families in emitted consumer types', async () => {
    await withTaoFiles('native-declaration-types-', {
      'Accepted.ts': consumerTypes + `
const files = createNativeReferenceType('File', (value): value is File =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'file')
const native: File = { kind: 'file', text: 'owned' }
export const file: NativeReference<File> = files.wrap(native)
export const wide: NativeReference<unknown> = file
const operation = createNativePendingType<File>('Read')
export const pending: PendingFile = operation.start(() => Promise.resolve(native))
export const pendingWide: ReturnType<NativePendingType<unknown>['start']> = pending
export const result: File = operation.read(pending)
declare const owner: Parameters<typeof invokeNativeAction>[1]
invokeNativeAction({ invoke() {} }, owner, () => true)
`,
      'Rejected.ts': consumerTypes + `
declare const directory: NativeReference<Directory>
declare const pendingDirectory: PendingDirectory
export const wrongReference: NativeReference<File> = directory
export const wrongPending: PendingFile = pendingDirectory
export const forgedReference: NativeReference<File> = {}
export const forgedPending: PendingFile = {}
`,
    }, async (paths, rootDir) => {
      const runtimeDir = Repo.resolvePath('packages/apps/runtime/TaoRuntime-src')
      const roots = ['TR-native-references.ts', 'TR-native-pending.ts', 'TR-native-action.ts']
        .map(name => FS.resolvePath(name, runtimeDir))
      const hostRoot = Repo.resolvePath('packages/apps/expo-host')
      const metro = require(FS.resolvePath('metro.config.cjs', hostRoot)) as {
        transformer: { babelTransformerPath: string }
      }
      const transformer = require(metro.transformer.babelTransformerPath) as {
        transform(input: {
          filename: string
          src: string
          options: {
            projectRoot: string
            platform: string
            dev: boolean
            type: string
            enableBabelRCLookup: boolean
          }
        }): { ast: unknown }
      }
      for (const filename of roots) {
        const transformed = transformer.transform({
          filename,
          src: await FS.readText(filename),
          options: { projectRoot: hostRoot, platform: 'ios', dev: false, type: 'module', enableBabelRCLookup: true },
        })
        Expect(transformed.ast).toBeDefined()
      }
      const options: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        types: [],
        skipLibCheck: true,
      }
      const declarations = new Map<string, string>()
      const program = ts.createProgram(roots, {
        ...options,
        noCheck: true,
        declaration: true,
        emitDeclarationOnly: true,
        rootDir: runtimeDir,
        outDir: FS.resolvePath('emitted', rootDir),
      })
      for (const root of roots) {
        const source = program.getSourceFile(root)!
        const emitted = program.emit(source, (path, content) => declarations.set(path, content))
        Expect(emitted.emitSkipped).toBe(false)
        Expect(emitted.diagnostics.map(diagnostic => diagnostic.code)).toEqual([])
      }
      await Promise.all([...declarations].map(([path, content]) => FS.writeText(path, content)))
      const check = (path: string) =>
        ts.getPreEmitDiagnostics(ts.createProgram([path], {
          ...options,
          noEmit: true,
          strict: true,
        }))
      Expect(
        check(paths['Accepted.ts']).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
      ).toEqual([])
      const rejected = check(paths['Rejected.ts']).map(diagnostic => ({
        code: diagnostic.code,
        line: diagnostic.file && diagnostic.start !== undefined
          ? diagnostic.file.text.split('\n')[diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line]
          : undefined,
      }))
      Expect(rejected).toEqual([
        { code: 2322, line: 'export const wrongReference: NativeReference<File> = directory' },
        { code: 2322, line: 'export const wrongPending: PendingFile = pendingDirectory' },
        { code: 2739, line: 'export const forgedReference: NativeReference<File> = {}' },
        { code: 2739, line: 'export const forgedPending: PendingFile = {}' },
      ])
    }, { verbatim: true })
  })
})
