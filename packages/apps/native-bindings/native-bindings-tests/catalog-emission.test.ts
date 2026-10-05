import { Workspace } from '@compiler/workspace'
import Formatter from '@formatter'
import { ExpoApiSource, NativeBindings } from '@native-bindings'
import { Parser } from '@parser'
import { Assert, FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import SourceActions from '@source-actions'
import ts from 'typescript'

Describe('complete installed catalog emission', () => {
  for (
    const { packageName, globalExports } of [
      { packageName: 'expo-file-system', globalExports: ['AbortController'] },
      { packageName: 'expo-media-library', globalExports: undefined },
    ]
  ) {
    Test(`validates every generated Tao declaration and strict sidecar type for ${packageName}`, async () => {
      const fromDirectory = Repo.resolvePath('packages/apps/expo-host')
      const generated = await NativeBindings.generate({
        source: ExpoApiSource,
        packageName,
        fromDirectory,
        globalExports,
      })
      Expect(generated.diagnostics).toEqual([])
      Expect(generated.catalog.operations.length).toBeGreaterThan(50)
      Expect(await Formatter.formatCode(generated.files['Bindings.tao']!)).toBe(generated.files['Bindings.tao'])
      const parsed = await Parser.parseCode(generated.files['Bindings.tao']!, { validation: false })
      Expect(await SourceActions.fixSource(parsed.entry.document)).toBe(generated.files['Bindings.tao'])
      if (globalExports) {
        Expect(generated.catalog.operations.find(operation => operation.name === 'AbortControllerConstruct'))
          .toMatchObject({
            target: { kind: 'construct', path: ['AbortController'], global: true },
            result: { kind: 'reference', name: 'AbortController' },
          })
        Expect(generated.catalog.operations.find(operation => operation.name === 'AbortControllerSignalGet'))
          .toMatchObject({
            result: { kind: 'reference', name: 'AbortSignal' },
          })
      }
      const streamRead = generated.catalog.operations.find(operation =>
        operation.name === 'ReadableStreamDefaultReaderUint8ArrayArrayBufferRead'
      )
      const streamProjection = generated.files['Bindings.tao']!.match(
        /public\s+action (\w+AsReadableStreamReadValueResultUint8ArrayArrayBuffer)\(/,
      )?.[1]
      if (streamRead) {
        Expect(streamProjection).toBeDefined()
      }
      const streamConsumer = streamRead
        ? `use ReadableStreamDefaultReaderUint8ArrayArrayBuffer, ${streamRead.name}, ${streamProjection}, ${
          streamProjection!.replace('AsReadable', 'IsReadable')
        } from ./Bindings.tao
action Consume(Bytes list of number) from ./Consumer.ts
action Inspect(Reader ReadableStreamDefaultReaderUint8ArrayArrayBuffer) {
  let Result = do ${streamRead.name}(Receiver: Reader)
  let IsChunk = do ${streamProjection!.replace('AsReadable', 'IsReadable')}(Result)
  if IsChunk {
    let Chunk = do ${streamProjection}(Result)
    do Consume(Bytes: Chunk.Value)
  }
}`
        : undefined
      await withTaoFiles('native-complete-catalog', {
        '.tao/.gitkeep': '',
        'Bindings.tao': generated.files['Bindings.tao']!,
        'Bindings.ts': generated.files['Bindings.ts']!,
        'Bindings.tao.ts': generated.catalog.enums.map(enumeration =>
          `export declare const ${enumeration.name}: Record<string, { evaluate(): { jsValue: unknown } }>`
        ).join('\n'),
        ...(streamConsumer ? { 'Main.tao': streamConsumer, 'Consumer.ts': '' } : {}),
        ...(packageName === 'expo-media-library'
          ? {
            'ValidQuery.tao':
              'use Query, QueryEqForAssetFieldISFAVORITE from ./Bindings.tao\naction Favorite(Receiver Query) { do QueryEqForAssetFieldISFAVORITE(Receiver: Receiver, Value: true) }\n',
          }
          : {}),
      }, async paths => {
        const validation = await Workspace.validate(paths['Bindings.tao'])
        Expect(
          validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic =>
            diagnostic.message
          ),
        ).toEqual([])
        if (streamConsumer) {
          const main = paths['Main.tao']
          Assert.defined(main, 'stream consumer fixture exists')
          const consumer = await Workspace.validate(main)
          Expect(
            consumer.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic =>
              diagnostic.message
            ),
          ).toEqual([])
        }
        if (packageName === 'expo-media-library') {
          const validQuery = await Workspace.validate(paths['ValidQuery.tao']!)
          Expect(validQuery.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
          const invalidPath = FS.resolvePath('InvalidQuery.tao', FS.dirname(paths['ValidQuery.tao']!))
          await FS.writeText(
            invalidPath,
            'use Query, QueryEqForAssetFieldISFAVORITE from ./Bindings.tao\naction Favorite(Receiver Query) { do QueryEqForAssetFieldISFAVORITE(Receiver: Receiver, Value: "favorite") }\n',
          )
          const invalidQuery = await Workspace.validate(invalidPath)
          const errors = invalidQuery.diagnostics.filter(diagnostic => diagnostic.severity === 'error')
          Expect(errors).toHaveLength(1)
          Expect(errors[0]?.message).toContain('QueryEqForAssetFieldISFAVORITE.Value, got text')
          Expect(errors[0]?.filePath).toBe(invalidPath)
        }
        const options: ts.CompilerOptions = {
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noEmit: true,
          skipLibCheck: true,
          target: ts.ScriptTarget.ES2022,
          lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          jsx: ts.JsxEmit.ReactJSX,
          types: ['node'],
          paths: { '@tao/runtime': [Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts')] },
        }
        const native =
          ts.resolveModuleName(packageName, FS.resolvePath('native-import.ts', fromDirectory), options, ts.sys)
            .resolvedModule
        Expect(native).toBeDefined()
        const program = ts.createProgram([paths['Bindings.ts']], {
          ...options,
          paths: { ...options.paths, [packageName]: [native!.resolvedFileName] },
        })
        const source = program.getSourceFile(paths['Bindings.ts'])!
        Expect(
          [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)].map(diagnostic =>
            `${
              diagnostic.start === undefined ? '' : source.getLineAndCharacterOfPosition(diagnostic.start).line + 1
            }: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}${
              diagnostic.start === undefined
                ? ''
                : ` | ${
                  source.text.slice(
                    source.getPositionOfLineAndCharacter(
                      source.getLineAndCharacterOfPosition(diagnostic.start).line,
                      0,
                    ),
                  ).split('\n')[0]
                }`
            }`
          ),
        ).toEqual([])
      }, { verbatim: true })
    })
  }
})
