import { BridgeMetadata } from '@compiler/bridge-metadata'
import { Workspace } from '@compiler/workspace'
import { Assert, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { ExpoApiSource, NativeBindings } from 'tao-native-bindings'
import * as ts from 'typescript'
import { publishProjectOutputs } from '../project-tooling-src/ProjectOutputPublisher'
import { checkProjectTypeScriptWithConfigInputs } from '../project-tooling-src/ProjectTypeScriptCheck'
import {
  ensureProjectTypeScriptConfig,
  ProjectConfigValidationMessages,
} from '../project-tooling-src/ProjectTypeScriptConfig'

async function withNativeProgram(
  run: (
    fixture: {
      root: string
      tao: string
      implementation: string
      check: (options?: { isolatedContracts?: boolean }) => ReturnType<typeof checkProjectTypeScriptWithConfigInputs>
    },
  ) => Promise<void>,
): Promise<void> {
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

Describe('isolated native TypeScript checking', () => {
  Test(
    'admits verified native contracts excluded from ordinary roots only when isolated checking supplies them',
    async () => {
      await withNativeProgram(async ({ root, tao, implementation, check }) => {
        const configPath = FS.resolvePath('tsconfig.json', root)
        const config = JSON.parse(await FS.readText(configPath))
        config.exclude = ['.tao-ts/Native.tao.ts']
        await FS.writeText(configPath, JSON.stringify(config))
        const contract = FS.resolvePath('.tao-ts/Native.tao.ts', root)
        Expect(
          (await check()).diagnostics.some(diagnostic =>
            diagnostic.message === ProjectConfigValidationMessages.missingGeneratedContracts([contract])
          ),
        ).toBe(true)
        Expect((await check({ isolatedContracts: true })).diagnostics).toEqual([])
        const original = await FS.readText(implementation)
        const incorrect = original.replace(/(export function Ping\([^)]*\): )string/, '$1number')
        Assert(incorrect !== original, 'Expected: the native fixture has a string-returning Ping implementation.')
        await FS.writeText(implementation, incorrect)
        const invalid = await check({ isolatedContracts: true })
        Expect(invalid.diagnostics.some(diagnostic => diagnostic.code === 'TS2344' && diagnostic.filePath === tao))
          .toBe(true)
        Expect(
          invalid.diagnostics.some(diagnostic =>
            diagnostic.code === 'TS2322' && diagnostic.filePath === implementation
          ),
        ).toBe(true)
      })
    },
  )

  Test('checks authored runtime source bodies even when native checking needs their declarations', async () => {
    await withTaoFiles('tao-native-authored-runtime-', {
      '.tao/.gitkeep': '',
      'Main.ts': 'import { value } from "./Runtime/TaoRuntime-src/TR"\nexport const answer: number = value\n',
      'Runtime/TaoRuntime-src/TR.ts': 'export const value: number = 1\n',
      '.tao-ts/native-bindings/ping/Bindings.ts':
        'import { value } from "../../../Runtime/TaoRuntime-src/TR.ts"\nexport function Value(): number { return value }\n',
      '.tao-ts/Native.tao.ts':
        'import * as Native from "./native-bindings/ping/Bindings"\nexport const checked: () => number = Native.Value\n',
    }, async (paths, root) => {
      const options = { runtimeRoot: FS.resolvePath('Runtime', root), nativeBindings: { stdlibRoot: root } }
      await ensureProjectTypeScriptConfig(root, options)
      const configPath = FS.resolvePath('tsconfig.json', root)
      const config = JSON.parse(await FS.readText(configPath))
      config.exclude = ['Runtime']
      await FS.writeText(configPath, JSON.stringify(config))
      const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root)
      Expect(parsed.fileNames).not.toContain(paths['Runtime/TaoRuntime-src/TR.ts'])
      const sourcePath = FS.resolvePath('Native.tao', root)
      const contractPath = paths['.tao-ts/Native.tao.ts']
      const range = { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } }
      const inspection = {
        status: 'fresh' as const,
        diagnostics: [],
        inputPaths: [FS.resolvePath('lib/typescript.js', FS.dirname(require.resolve('typescript/package.json')))],
        outputPaths: [sourcePath, paths['.tao-ts/native-bindings/ping/Bindings.ts']],
        identity: 'authored-runtime-fixture',
      }
      const check = () =>
        checkProjectTypeScriptWithConfigInputs(
          root,
          [contractPath],
          [],
          [{ generatedPath: contractPath, generatedRange: range, sourcePath, sourceRange: range }],
          options,
          undefined,
          inspection,
        )
      Expect((await check()).diagnostics).toEqual([])
      await FS.writeText(paths['Runtime/TaoRuntime-src/TR.ts'], 'export const value: number = "wrong"\n')
      Expect(
        (await check()).diagnostics.some(diagnostic =>
          diagnostic.code === 'TS2322' && diagnostic.filePath === paths['Runtime/TaoRuntime-src/TR.ts']
        ),
      ).toBe(true)
    }, { verbatim: true })
  })

  Test('retains generated native ping types in an ordinary authored consumer', async () => {
    await withNativeProgram(async ({ root, check }) => {
      Expect((await check()).diagnostics).toEqual([])
      await FS.writeText(
        FS.resolvePath('Main.ts', root),
        'import type { Ping } from "./Native.tao"\nexport const ping: Ping = value => value\nping(123)\n',
      )
      Expect((await check()).diagnostics.some(diagnostic =>
        diagnostic.code === 'TS2345'
        && diagnostic.filePath === FS.resolvePath('Main.ts', root)
      )).toBe(true)
    })
  })

  Test('checks the real native implementation against its generated Tao signature', async () => {
    await withNativeProgram(async ({ tao, implementation, check }) => {
      const original = await FS.readText(implementation)
      const incorrect = original.replace(/(export function Ping\([^)]*\): )string/, '$1number')
      Assert(incorrect !== original, 'Expected: the generated fixture exports a string-returning Ping implementation.')
      await FS.writeText(implementation, incorrect)
      const checked = await check()
      Expect(checked.diagnostics.some(diagnostic => diagnostic.code === 'TS2344' && diagnostic.filePath === tao)).toBe(
        true,
      )
      Expect(checked.diagnostics.some(diagnostic =>
        diagnostic.code === 'TS2322'
        && diagnostic.filePath === implementation
      )).toBe(true)
    })
  })

  Test('preserves ordinary authored Node imports while checking native code without host globals', async () => {
    await withNativeProgram(async ({ root, check }) => {
      await FS.writeText(
        FS.resolvePath('Host.ts', root),
        'import { readFileSync } from "node:fs"\nexport const bytes: Buffer = readFileSync("example")\n',
      )
      Expect((await check()).diagnostics).toEqual([])
      await FS.writeText(
        FS.resolvePath('Host.ts', root),
        'import { readFileSync } from "node:fs"\nexport const bytes: number = readFileSync("example")\n',
      )
      Expect((await check()).diagnostics.some(diagnostic =>
        diagnostic.code === 'TS2322'
        && diagnostic.filePath === FS.resolvePath('Host.ts', root)
      )).toBe(true)
    })
  })

  Test('isolates an incompatible authored global from actual generated native wrapper checking', async () => {
    await withNativeProgram(async ({ root, implementation, check }) => {
      Expect(await FS.readText(implementation)).toContain('ArrayBufferResize')
      await FS.writeText(
        FS.resolvePath('HostGlobals.ts', root),
        'export {}\ndeclare global { interface ArrayBuffer { resize(length: number): string } }\n',
      )
      const read = ts.readConfigFile(FS.resolvePath('tsconfig.json', root), ts.sys.readFile)
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root)
      const mixed = ts.createProgram(parsed.fileNames, parsed.options)
      Expect(
        ts.getPreEmitDiagnostics(mixed).some(diagnostic =>
          diagnostic.code === 2322
          && diagnostic.file?.fileName === implementation
        ),
      ).toBe(true)
      Expect((await check()).diagnostics).toEqual([])
    })
  })
})
