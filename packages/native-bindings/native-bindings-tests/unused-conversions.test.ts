import { ExpoApiSource, NativeBindings } from '@native-bindings'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import ts from 'typescript'

Describe('native binding conversion reachability', () => {
  Test('typechecks Haptics and Clipboard with unused locals rejected', async () => {
    const fromDirectory = Repo.resolvePath('packages/apps/expo-host')
    for (const packageName of ['expo-haptics', 'expo-clipboard']) {
      const generated = await NativeBindings.generate({
        source: ExpoApiSource,
        packageName,
        fromDirectory,
        exclude: packageName === 'expo-clipboard' ? ['ClipboardPasteButton', 'isPasteButtonAvailable'] : undefined,
      })
      Expect(generated.diagnostics).toEqual([])
      await withTaoFiles('native-unused-conversions', {
        'Bindings.ts': generated.files['Bindings.ts']!,
        // Enum values come from compiled Tao; their identity does not affect conversion reachability.
        'Bindings.tao.ts': generated.catalog.enums.map(enumeration =>
          `export declare const ${enumeration.name}: Record<string, { evaluate(): { jsValue: unknown } }>`
        ).join('\n'),
      }, async paths => {
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
          paths: { '@tao/runtime': [Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts')] },
        }
        const native = ts.resolveModuleName(
          packageName,
          FS.resolvePath('native-import.ts', fromDirectory),
          options,
          ts.sys,
        ).resolvedModule
        Expect(native).toBeDefined()
        const program = ts.createProgram([paths['Bindings.ts']], {
          ...options,
          paths: { ...options.paths, [packageName]: [native!.resolvedFileName] },
        })
        const source = program.getSourceFile(paths['Bindings.ts'])!
        Expect(source).toBeDefined()
        Expect([
          ...program.getSyntacticDiagnostics(source),
          ...program.getSemanticDiagnostics(source),
        ].map(diagnostic => ({
          code: diagnostic.code,
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        }))).toEqual([])
      }, { verbatim: true })
    }
  })
})
