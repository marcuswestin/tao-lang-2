import { Assert, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'
import { checkProjectTypeScriptWithConfigInputs } from '../project-tooling-src/ProjectTypeScriptCheck'
import {
  ensureProjectTypeScriptConfig,
  ProjectConfigValidationMessages,
} from '../project-tooling-src/ProjectTypeScriptConfig'
import { withNativeProgram } from './ProjectNativeTestSupport'

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
})
