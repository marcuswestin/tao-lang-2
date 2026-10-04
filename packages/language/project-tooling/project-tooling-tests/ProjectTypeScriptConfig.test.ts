import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import * as ts from 'typescript'
import { checkProjectTypeScript } from '../project-tooling-src/ProjectTypeScriptCheck'
import {
  ensureProjectTypeScriptConfig,
  findProjectRoot,
  writeProjectTypeScriptConfigUnderLock,
} from '../project-tooling-src/ProjectTypeScriptConfig'

Describe('project TypeScript configuration', () => {
  Test('finds the nearest .tao marker, ignoring an ancestor tsconfig alone', async () => {
    const root = await mkTestDir('tao-project-config-root-')
    try {
      const child = FS.resolvePath('nested/project/src', root)
      await FS.mkdir(child)
      await FS.writeJson(FS.resolvePath('tsconfig.json', root), {})
      Expect(await findProjectRoot(FS.resolvePath('App.tao', child))).toBeUndefined()

      const project = FS.resolvePath('nested/project', root)
      await FS.mkdir(FS.resolvePath('.tao', project))
      Expect(await findProjectRoot(FS.resolvePath('App.tao', child))).toBe(project)
    } finally {
      await FS.remove(root)
    }
  })

  Test('creates the overlay once and leaves developer config edits intact', async () => {
    const root = await mkTestDir('tao-project-config-write-')
    try {
      await FS.mkdir(FS.resolvePath('.tao', root))
      const first = await ensureProjectTypeScriptConfig(root)
      Expect(first.diagnostics).toEqual([])
      Expect(first.changedOutputPaths).toEqual([first.baseConfigPath, first.rootConfigPath])
      Expect(await FS.readJson(first.rootConfigPath)).toEqual({ extends: './.tao/typescript/tsconfig.json' })
      const base = await FS.readJson<{ compilerOptions: { rootDirs: string[]; noEmit: boolean }; include: string[] }>(
        first.baseConfigPath,
      )
      Expect(base.compilerOptions.rootDirs).toEqual(['../..', '../../.tao-ts'])
      Expect(base.compilerOptions.noEmit).toBe(true)
      Expect(base.include).toContain('../../**/*.tsx')
      Expect(base.include).toContain('../../.tao-ts/**/*.ts')

      const edited =
        '{\n  // developer-owned config\n  "extends": "./.tao/typescript/tsconfig.json",\n  "compilerOptions": { "strict": false }\n}\n'
      await FS.writeText(first.rootConfigPath, edited)
      const second = await ensureProjectTypeScriptConfig(root)
      Expect(second.changedOutputPaths).toEqual([])
      Expect(await FS.readText(first.rootConfigPath)).toBe(edited)
    } finally {
      await FS.remove(root)
    }
  })

  Test('does not turn a tsconfig-only directory into a Tao project', async () => {
    const root = await mkTestDir('tao-project-config-unmarked-')
    try {
      const rootConfig = FS.resolvePath('tsconfig.json', root)
      await FS.writeText(rootConfig, '{ "compilerOptions": { "strict": false } }\n')
      const result = await ensureProjectTypeScriptConfig(root)
      Expect(result.changedOutputPaths).toEqual([])
      Expect(result.diagnostics[0]?.message).toContain('No Tao project marker')
      Expect(await FS.readText(rootConfig)).toBe('{ "compilerOptions": { "strict": false } }\n')
      Expect(await FS.exists(result.baseConfigPath)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('native TypeScript resolves installed host exports while project and authored paths win', async () => {
    const fixture = await mkTestDir('tao-project-native-config-', { location: 'host' })
    try {
      const root = FS.resolvePath('project', fixture)
      const firstRoot = FS.resolvePath('first/node_modules', fixture)
      const secondRoot = FS.resolvePath('second/node_modules', fixture)
      await FS.mkdir(FS.resolvePath('.tao', root))
      await FS.writeText(
        FS.resolvePath('Main.ts', root),
        "import { value } from 'tao-test-peer/extra'\nexport const output: number = value\n",
      )
      await FS.writeText(FS.resolvePath('unused/package.json', firstRoot), '{"name":"unused"}\n')
      await FS.writeText(
        FS.resolvePath('tao-test-peer/package.json', secondRoot),
        '{"name":"tao-test-peer","exports":{".":{"types":"./index.d.ts"},"./extra":{"types":"./lib/extra.d.ts"}}}\n',
      )
      await FS.writeText(FS.resolvePath('tao-test-peer/index.d.ts', secondRoot), 'export declare const value: number\n')
      await FS.writeText(
        FS.resolvePath('tao-test-peer/lib/extra.d.ts', secondRoot),
        'export declare const value: number\n',
      )
      const options = { hostModuleRoots: [firstRoot, secondRoot] }
      await ensureProjectTypeScriptConfig(root, options)
      Expect(nativeDiagnostics(root)).toEqual([])

      const projectPeer = FS.resolvePath('node_modules/tao-test-peer', root)
      await FS.writeText(
        FS.resolvePath('package.json', projectPeer),
        '{"name":"tao-test-peer","exports":{"./extra":{"types":"./extra.d.ts"}}}\n',
      )
      await FS.writeText(FS.resolvePath('extra.d.ts', projectPeer), 'export declare const value: string\n')
      await ensureProjectTypeScriptConfig(root, options)
      Expect(nativeDiagnostics(root).some(diagnostic => diagnostic.code === 2322)).toBe(true)

      await FS.writeText(FS.resolvePath('Override.ts', root), 'export const value: number = 1\n')
      await FS.writeText(
        FS.resolvePath('tsconfig.json', root),
        '{"extends":"./.tao/typescript/tsconfig.json","compilerOptions":{"paths":{"tao-test-peer/extra":["./Override.ts"]}}}\n',
      )
      Expect(nativeDiagnostics(root)).toEqual([])
    } finally {
      await FS.remove(fixture)
    }
  })

  Test('native generated config resolves checkout React Native and runtime imports like the checker', async () => {
    const fixture = await mkTestDir('tao-project-native-runtime-', { location: 'host' })
    try {
      const root = FS.resolvePath('project', fixture)
      const checkout = FS.resolvePath('../../../..', import.meta.dir)
      const runtimeRoot = FS.resolvePath('packages/apps/runtime', checkout)
      const hostRoot = FS.resolvePath('packages/apps/expo-host/node_modules', checkout)
      await FS.mkdir(FS.resolvePath('.tao', root))
      await FS.writeText(
        FS.resolvePath('Main.ts', root),
        "import TR from '@tao/runtime'\nimport type { ViewProps } from 'react-native'\nexport const runtime = TR\nexport type Props = ViewProps\n",
      )
      const options = { runtimeRoot, hostModuleRoots: [hostRoot] }
      await ensureProjectTypeScriptConfig(root, options)
      const native = nativeDiagnostics(root)
      const checked = await checkProjectTypeScript(root, [], [], [], options)
      Expect(native.filter(diagnostic => diagnostic.code === 2307 || diagnostic.code === 7016)).toEqual([])
      Expect(checked.filter(diagnostic => diagnostic.code === 'TS2307' || diagnostic.code === 'TS7016')).toEqual([])
    } finally {
      await FS.remove(fixture)
    }
  })

  Test('omits host aliases reserved for a selected dependency’s private install', async () => {
    const fixture = await mkTestDir('tao-project-private-paths-', { location: 'host' })
    try {
      const root = FS.resolvePath('project', fixture)
      const hostModulesRoot = FS.resolvePath('host/node_modules', fixture)
      await FS.mkdir(FS.resolvePath('.tao', root))
      await FS.writeText(FS.resolvePath('util/package.json', hostModulesRoot), '{"name":"util","types":"index.d.ts"}\n')
      await FS.writeText(FS.resolvePath('util/index.d.ts', hostModulesRoot), 'export declare const value: number\n')
      await FS.writeText(
        FS.resolvePath('other/package.json', hostModulesRoot),
        '{"name":"other","types":"index.d.ts"}\n',
      )
      await FS.writeText(FS.resolvePath('other/index.d.ts', hostModulesRoot), 'export declare const value: number\n')

      const result = await writeProjectTypeScriptConfigUnderLock(
        root,
        { hostModuleRoots: [hostModulesRoot] },
        new Set(['util']),
      )
      const base = await FS.readJson<{ compilerOptions: { paths: Record<string, string[]> } }>(result.baseConfigPath)
      Expect(base.compilerOptions.paths['util']).toBeUndefined()
      Expect(base.compilerOptions.paths['other']).toEqual([FS.resolvePath('other/index.d.ts', hostModulesRoot)])
    } finally {
      await FS.remove(fixture)
    }
  })
})

function nativeDiagnostics(root: string): readonly ts.Diagnostic[] {
  const configPath = FS.resolvePath('tsconfig.json', root)
  const read = ts.readConfigFile(configPath, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, configPath)
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  return [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
}
