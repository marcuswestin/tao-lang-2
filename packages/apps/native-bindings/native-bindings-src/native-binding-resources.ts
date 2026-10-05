import { Assert, FS, Json, Platform, TaoResources, TaoStdlib } from '@shared'
import { inspectMaintainedNativeBindings } from './maintained-native-bindings'
import { maintainedNativeSources } from './maintained-native-sources'
import { resolveTypeScriptApiEngineInput } from './typescript-api-source'

/** Stage the same verified native inputs for an installed CLI and editor before outer publication. */
export async function stageNativeBindingResources(options: {
  outputRoot: string
  stdlibRoot?: string
  sourceRoots?: readonly string[]
}): Promise<void> {
  const stdlibRoot = options.stdlibRoot ?? TaoStdlib.declaredRoot() ?? FS.resolvePath('../../stdlib', import.meta.dir)
  const before = await inspectMaintainedNativeBindings({ stdlibRoot, sourceRoots: options.sourceRoots })
  Assert.input(before.status === 'fresh', before.diagnostics.map(item => item.message).join('\n'))
  const enginePath = resolveTypeScriptApiEngineInput(
    options.sourceRoots?.[0] ?? FS.resolvePath('../../expo-host', import.meta.dir),
  )
  const engineHash = Platform.sha256Hex(await FS.readText(enginePath))
  for (const source of maintainedNativeSources) {
    const manifest = Json.tryParse(
      await FS.readText(FS.resolvePath(`.tao-ts/native-bindings/${source.capability}/maintained.json`, stdlibRoot)),
    )
    Assert.input(
      Json.isRecord(manifest) && manifest['engine'] === engineHash,
      'The packaged native binding engine must match the generated declarations.',
    )
  }
  await FS.copyDirectory(
    FS.resolvePath('.tao-ts/native-bindings', stdlibRoot),
    FS.resolvePath(`${TaoResources.STDLIB_DIRECTORY}/.tao-ts/native-bindings`, options.outputRoot),
  )
  const generatorRoot = await FS.isFile(FS.resolvePath('generate.ts', import.meta.dir))
    ? import.meta.dir
    : TaoResources.resolve(TaoResources.NATIVE_BINDINGS_GENERATOR_DIRECTORY)
  Assert.input(generatorRoot !== undefined, 'The native binding generator sources are missing from this installation.')
  for await (const path of FS.walk(generatorRoot)) {
    if (path.endsWith('.ts')) {
      await FS.copyFile(
        path,
        FS.resolvePath(
          `${TaoResources.NATIVE_BINDINGS_GENERATOR_DIRECTORY}/${FS.relativePath(generatorRoot, path)}`,
          options.outputRoot,
        ),
      )
    }
  }
  await FS.copyDirectory(
    await FS.realPath(FS.dirname(FS.dirname(enginePath))),
    FS.resolvePath(`${TaoResources.NATIVE_BINDINGS_ENGINE_DIRECTORY}/node_modules/typescript`, options.outputRoot),
  )
  const after = await inspectMaintainedNativeBindings({ stdlibRoot, sourceRoots: options.sourceRoots })
  Assert.input(
    after.status === 'fresh' && after.identity === before.identity,
    'Native binding inputs changed while packaging; retry with a stable source tree.',
  )
}
