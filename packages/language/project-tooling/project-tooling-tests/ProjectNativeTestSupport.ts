import { BridgeMetadata } from '@compiler/bridge-metadata'
import { Workspace } from '@compiler/workspace'
import { FS, TaoStdlib } from '@shared'
import { Expect, withTaoFiles } from '@shared/test'
import { ExpoApiSource, inspectMaintainedNativeBindings, NativeBindings } from 'tao-native-bindings'
import { publishProjectOutputs } from '../project-tooling-src/ProjectOutputPublisher'
import { checkProjectTypeScriptWithConfigInputs } from '../project-tooling-src/ProjectTypeScriptCheck'
import { ensureProjectTypeScriptConfig } from '../project-tooling-src/ProjectTypeScriptConfig'

/** copyNativeBindings copies the repository's fresh maintained native outputs into a fixture stdlib root. */
export async function copyNativeBindings(selectedRoot: string): Promise<void> {
  const originalRoot = TaoStdlib.declaredRoot() ?? FS.resolvePath('../../../apps/stdlib', import.meta.dir)
  const original = await inspectMaintainedNativeBindings({ stdlibRoot: originalRoot })
  Expect(original.status).toBe('fresh')
  for (const path of original.outputPaths) {
    await FS.copyFile(path, FS.resolvePath(FS.relativePath(originalRoot, path), selectedRoot))
  }
}

export type NativeProgramFixture = {
  root: string
  tao: string
  implementation: string
  check: (options?: { isolatedContracts?: boolean }) => ReturnType<typeof checkProjectTypeScriptWithConfigInputs>
}

/** withNativeProgram generates a native ping binding, publishes its contract, and hands the test a checker. */
export async function withNativeProgram(run: (fixture: NativeProgramFixture) => Promise<void>): Promise<void> {
  await withTaoFiles('tao-native-program-', {
    '.tao/.gitkeep': '',
    '.tao-ts/native-bindings/ping/inputs/node_modules/native-ping/package.json':
      '{"name":"native-ping","version":"1.0.0","types":"index.d.ts"}',
    '.tao-ts/native-bindings/ping/inputs/node_modules/native-ping/index.d.ts':
      'export declare function ping(value: string): string;\nexport declare function buffer(): ArrayBuffer;\n',
    'Main.ts':
      'import type { Ping } from "./Native.tao"\nexport const ping: Ping = value => value\nexport const result: string | Promise<string> = ping("hello")\n',
  }, async (_paths, root) => {
    const tao = FS.resolvePath('Native.tao', root)
    const implementation = FS.resolvePath('.tao-ts/native-bindings/ping/Bindings.ts', root)
    const generated = await NativeBindings.generate({
      source: ExpoApiSource,
      packageName: 'native-ping',
      fromDirectory: FS.resolvePath('.tao-ts/native-bindings/ping/inputs', root),
      implementationImport: './.tao-ts/native-bindings/ping/Bindings.ts',
      taoTypeImport: '../../../Native.tao',
    })
    Expect(generated.diagnostics).toEqual([])
    await FS.writeText(tao, generated.files['Bindings.tao']!)
    await FS.writeText(implementation, generated.files['Bindings.ts']!)
    const validated = await (await Workspace.open(root)).validate(tao)
    Expect(validated.diagnostics).toEqual([])
    const modules = BridgeMetadata.collect(validated.files, root)
    const published = await publishProjectOutputs(
      root,
      modules.map(module => ({
        path: module.path,
        sourcePath: module.sourcePath,
        content: module.code,
        kind: 'contract' as const,
        sourceMappings: module.sourceMappings.map(mapping => ({
          generatedPath: module.path,
          generatedRange: mapping.generated,
          sourcePath: module.sourcePath,
          sourceRange: mapping.source,
        })),
      })),
    )
    const options = { nativeBindings: { stdlibRoot: root } }
    await ensureProjectTypeScriptConfig(root, options)
    const engine = FS.resolvePath('lib/typescript.js', FS.dirname(require.resolve('typescript/package.json')))
    const inspected = {
      status: 'fresh' as const,
      diagnostics: [],
      inputPaths: [engine],
      outputPaths: [tao, implementation],
      identity: 'native-program-fixture',
    }
    const check = (checking?: { isolatedContracts?: boolean }) =>
      checkProjectTypeScriptWithConfigInputs(
        root,
        published.contractPaths,
        [],
        published.sourceMappings,
        options,
        undefined,
        inspected,
        checking?.isolatedContracts ? modules.filter(module => module.sourcePath === tao) : [],
      )
    await run({ root, tao, implementation, check })
  }, { verbatim: true })
}
