import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import * as ts from 'typescript'
import {
  checkProjectTypeScript,
  checkProjectTypeScriptWithConfigInputs,
  ProjectTypeScriptProgramSession,
} from '../project-tooling-src/ProjectTypeScriptCheck'
import { ensureProjectTypeScriptConfig } from '../project-tooling-src/ProjectTypeScriptConfig'

Describe('project TypeScript host resolution', () => {
  Test('reuses an unchanged program and refreshes diagnostic mappings', async () => {
    const root = await mkTestDir('tao-tooling-program-reuse-', { location: 'host' })
    try {
      const source = FS.resolvePath('Main.ts', root)
      await FS.mkdir(FS.resolvePath('.tao', root))
      await FS.writeText(source, 'export const value: number = "wrong"\n')
      await ensureProjectTypeScriptConfig(root)
      const session = new ProjectTypeScriptProgramSession()
      const first = await checkProjectTypeScriptWithConfigInputs(root, [], [], [], {}, session)
      const repeated = await checkProjectTypeScriptWithConfigInputs(root, [], [], [], {}, session)
      Expect(first.cacheHit).toBe(false)
      Expect(repeated.cacheHit).toBe(true)
      Expect(repeated.diagnostics).toEqual(first.diagnostics)
      Expect(repeated.diagnostics).toEqual(
        (await checkProjectTypeScriptWithConfigInputs(root, [], [], [], {})).diagnostics,
      )
      const mapping = {
        generatedPath: source,
        generatedRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 100 } },
        sourcePath: FS.resolvePath('Main.tao', root),
        sourceRange: { start: { line: 4, character: 0 }, end: { line: 4, character: 10 } },
      }
      const mapped = await checkProjectTypeScriptWithConfigInputs(root, [], [], [mapping], {}, session)
      Expect(mapped.cacheHit).toBe(true)
      Expect(mapped.diagnostics).toEqual(
        (await checkProjectTypeScriptWithConfigInputs(root, [], [], [mapping], {})).diagnostics,
      )
      Expect(mapped.diagnostics.some(diagnostic => diagnostic.filePath === mapping.sourcePath)).toBe(true)

      await FS.writeText(source, 'export const value: number = 1\n')
      const edited = await checkProjectTypeScriptWithConfigInputs(root, [], [], [], {}, session)
      Expect(edited.cacheHit).toBe(false)
      Expect(edited.diagnostics).toEqual(
        (await checkProjectTypeScriptWithConfigInputs(root, [], [], [], {})).diagnostics,
      )
      Expect(edited.diagnostics).toEqual([])
      await FS.writeText(source, 'export const value: number = "wrong"\n')
      const reverted = await checkProjectTypeScriptWithConfigInputs(root, [], [], [], {}, session)
      Expect(reverted.cacheHit).toBe(false)
      Expect(reverted.diagnostics).toEqual(first.diagnostics)
      session.clear()
      Expect((await checkProjectTypeScriptWithConfigInputs(root, [], [], [], {}, session)).cacheHit).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('rechecks JavaScript and external config edits, then isolates another root', async () => {
    const fixture = await mkTestDir('tao-tooling-program-config-', { location: 'host' })
    try {
      const root = FS.resolvePath('project', fixture)
      const otherRoot = FS.resolvePath('other', fixture)
      const source = FS.resolvePath('Main.js', root)
      const external = FS.resolvePath('shared/options.json', fixture)
      await FS.mkdir(FS.resolvePath('.tao', root))
      await FS.mkdir(FS.resolvePath('.tao', otherRoot))
      await FS.writeText(
        source,
        '/** @param {number} value */\nexport function answer(value) { const unused = 1; return value }\n',
      )
      await FS.writeText(FS.resolvePath('Other.ts', otherRoot), 'export const other: number = 1\n')
      await ensureProjectTypeScriptConfig(root)
      await ensureProjectTypeScriptConfig(otherRoot)
      await FS.writeText(external, '{"compilerOptions":{"noUnusedLocals":false}}\n')
      await FS.writeText(
        FS.resolvePath('tsconfig.json', root),
        '{"extends":["./.tao/cache/typescript/tsconfig.json","../shared/options.json"]}\n',
      )
      const session = new ProjectTypeScriptProgramSession()
      const check = () => checkProjectTypeScriptWithConfigInputs(root, [], [], [], {}, session)
      Expect((await check()).cacheHit).toBe(false)
      Expect((await check()).cacheHit).toBe(true)

      await FS.writeText(external, '{"compilerOptions":{"noUnusedLocals":true}}\n')
      const configEdited = await check()
      Expect(configEdited.cacheHit).toBe(false)
      Expect(configEdited.diagnostics).toEqual(
        (await checkProjectTypeScriptWithConfigInputs(root, [], [], [], {})).diagnostics,
      )
      Expect(configEdited.diagnostics.some(diagnostic => diagnostic.code === 'TS6133')).toBe(true)

      await FS.writeText(external, '\n\n{"compilerOptions":{"noUnusedLocals":true}}\n')
      const configMoved = await check()
      Expect(configMoved.cacheHit).toBe(false)
      Expect(configMoved.diagnostics).toEqual(
        (await checkProjectTypeScriptWithConfigInputs(root, [], [], [], {})).diagnostics,
      )

      await FS.writeText(source, '/** @param {number} value */\nexport function answer(value) { return value }\n')
      const jsEdited = await check()
      Expect(jsEdited.cacheHit).toBe(false)
      Expect(jsEdited.diagnostics).toEqual([])
      await FS.writeText(FS.resolvePath('tsconfig.json', root), '{"compilerOptions":{"strict":false}}\n')
      const invalid = await check()
      Expect(invalid.cacheHit).toBeUndefined()
      Expect(invalid.diagnostics.some(diagnostic => diagnostic.severity === 'error')).toBe(true)
      await FS.writeText(
        FS.resolvePath('tsconfig.json', root),
        '{"extends":["./.tao/cache/typescript/tsconfig.json","../shared/options.json"]}\n',
      )
      Expect((await check()).cacheHit).toBe(false)

      const other = await checkProjectTypeScriptWithConfigInputs(otherRoot, [], [], [], {}, session)
      Expect(other.cacheHit).toBe(false)
      Expect(other.diagnostics).toEqual([])
      Expect((await check()).cacheHit).toBe(false)
    } finally {
      await FS.remove(fixture)
    }
  })

  Test('invalidates on generated contracts, missing imports, new peers, and directory additions', async () => {
    const root = await mkTestDir('tao-tooling-program-observations-', { location: 'host' })
    try {
      const source = FS.resolvePath('Main.ts', root)
      const contract = FS.resolvePath('.tao-ts/Contract.tao.ts', root)
      await FS.mkdir(FS.resolvePath('.tao', root))
      await FS.writeText(source, "import { value } from 'peer/extra'\nexport const output: number = value\n")
      await FS.writeText(contract, 'export const contract: number = 1\n')
      await ensureProjectTypeScriptConfig(root)
      const session = new ProjectTypeScriptProgramSession()
      const check = () => checkProjectTypeScriptWithConfigInputs(root, [contract], [], [], {}, session)
      const parity = async () => {
        const result = await check()
        Expect(result.diagnostics).toEqual(
          (await checkProjectTypeScriptWithConfigInputs(root, [contract], [], [], {})).diagnostics,
        )
        return result
      }
      const missing = await parity()
      Expect(missing.diagnostics.some(diagnostic => diagnostic.code === 'TS2307')).toBe(true)
      Expect((await parity()).cacheHit).toBe(true)

      const peer = FS.resolvePath('node_modules/peer', root)
      await FS.writeText(FS.resolvePath('package.json', peer), '{"name":"peer","exports":{"./extra":"./extra.d.ts"}}\n')
      await FS.writeText(FS.resolvePath('extra.d.ts', peer), 'export declare const value: number\n')
      const installed = await parity()
      Expect(installed.cacheHit).toBe(false)
      Expect(installed.diagnostics).toEqual([])
      Expect((await parity()).cacheHit).toBe(true)

      await FS.writeText(contract, 'export const contract: number = "wrong"\n')
      const changedContract = await parity()
      Expect(changedContract.cacheHit).toBe(false)
      Expect(
        changedContract.diagnostics.some(diagnostic =>
          diagnostic.filePath === contract && diagnostic.code === 'TS2322'
        ),
      ).toBe(true)

      await FS.writeText(FS.resolvePath('package.json', peer), '{"name":"peer","exports":{"./extra":"./other.d.ts"}}\n')
      await FS.writeText(FS.resolvePath('other.d.ts', peer), 'export declare const value: string\n')
      const changedExports = await parity()
      Expect(changedExports.cacheHit).toBe(false)
      Expect(
        changedExports.diagnostics.some(diagnostic => diagnostic.filePath === source && diagnostic.code === 'TS2322'),
      ).toBe(true)

      await FS.remove(peer)
      const removedPeer = await parity()
      Expect(removedPeer.cacheHit).toBe(false)
      Expect(removedPeer.diagnostics.some(diagnostic => diagnostic.code === 'TS2307')).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('tracks array and transitive external extends, including a missing target through recovery', async () => {
    const fixture = await mkTestDir('tao-tooling-config-inputs-', { location: 'host' })
    try {
      const root = FS.resolvePath('project', fixture)
      const first = FS.resolvePath('shared/first.json', fixture)
      const second = FS.resolvePath('shared/second.json', fixture)
      const missing = FS.resolvePath('shared/missing.json', fixture)
      await FS.mkdir(FS.resolvePath('.tao', root))
      await FS.writeText(FS.resolvePath('Main.ts', root), 'export function answer() { const unused = 1; return 42 }\n')
      await ensureProjectTypeScriptConfig(root)
      await FS.writeText(first, '{"extends":"./missing.json"}\n')
      await FS.writeText(second, '{"compilerOptions":{"noUnusedLocals":true}}\n')
      await FS.writeText(
        FS.resolvePath('tsconfig.json', root),
        '{"extends":["./.tao/cache/typescript/tsconfig.json","../shared/first.json","../shared/second.json"]}\n',
      )

      const unavailable = await checkProjectTypeScriptWithConfigInputs(root, [], [], [], {})
      Expect(unavailable.configInputPaths).toContain(first)
      Expect(unavailable.configInputPaths).toContain(second)
      Expect(unavailable.configInputPaths).toContain(missing)
      Expect(unavailable.diagnostics.some(diagnostic => diagnostic.severity === 'error')).toBe(true)

      await FS.writeText(missing, '{}\n')
      const recovered = await checkProjectTypeScriptWithConfigInputs(root, [], [], [], {})
      Expect(recovered.configInputPaths).toContain(missing)
      Expect(recovered.diagnostics.some(diagnostic => diagnostic.code === 'TS6133')).toBe(true)

      await FS.remove(missing)
      const removed = await checkProjectTypeScriptWithConfigInputs(root, [], [], [], {})
      Expect(removed.configInputPaths).toContain(missing)
      Expect(removed.diagnostics.some(diagnostic => diagnostic.severity === 'error')).toBe(true)
    } finally {
      await FS.remove(fixture)
    }
  })

  Test('uses installed host peers, their native subpaths, and project dependencies in that order', async () => {
    const fixture = await mkTestDir('tao-tooling-host-roots-', { location: 'host' })
    try {
      const projectRoot = FS.resolvePath('project', fixture)
      const firstRoot = FS.resolvePath('first/node_modules', fixture)
      const secondRoot = FS.resolvePath('second/node_modules', fixture)
      await FS.mkdir(FS.resolvePath('.tao', projectRoot))
      await FS.writeText(
        FS.resolvePath('Main.ts', projectRoot),
        "import { value } from 'peer/extra'\nexport const output: number = value\n",
      )
      await FS.writeText(FS.resolvePath('unrelated/index.d.ts', firstRoot), 'export declare const value: number\n')
      await FS.writeText(
        FS.resolvePath('peer/package.json', secondRoot),
        '{"name":"peer","exports":{"./extra":"./extra.d.ts"}}\n',
      )
      await FS.writeText(FS.resolvePath('peer/extra.d.ts', secondRoot), 'export declare const value: number\n')
      const options = { hostModuleRoots: [firstRoot, secondRoot] }
      await ensureProjectTypeScriptConfig(projectRoot, options)

      Expect(await checkProjectTypeScript(projectRoot, [], [], [], options)).toEqual([])

      const projectPeer = FS.resolvePath('node_modules/peer', projectRoot)
      await FS.writeText(
        FS.resolvePath('package.json', projectPeer),
        '{"name":"peer","exports":{"./extra":"./extra.d.ts"}}\n',
      )
      await FS.writeText(FS.resolvePath('extra.d.ts', projectPeer), 'export declare const value: string\n')
      await ensureProjectTypeScriptConfig(projectRoot, options)
      const projectDiagnostics = await checkProjectTypeScript(projectRoot, [], [], [], options)
      Expect(projectDiagnostics.some(diagnostic => diagnostic.code === 'TS2322')).toBe(true)

      await FS.writeText(
        FS.resolvePath('tsconfig.json', projectRoot),
        '{"extends":"./.tao/cache/typescript/tsconfig.json","compilerOptions":{"strict":true,"paths":{"peer/extra":["./Override.ts"]}}}\n',
      )
      await FS.writeText(FS.resolvePath('Override.ts', projectRoot), 'export const value: number = 1\n')
      Expect(await checkProjectTypeScript(projectRoot, [], [], [], options)).toEqual([])
    } finally {
      await FS.remove(fixture)
    }
  })

  Test('excludes a nested Tao project from native config and parent checking', async () => {
    const root = await mkTestDir('tao-tooling-nested-typescript-', { location: 'host' })
    try {
      const child = FS.resolvePath('Child', root)
      const broken = FS.resolvePath('Broken.ts', child)
      await FS.mkdir(FS.resolvePath('.tao', root))
      await FS.mkdir(FS.resolvePath('.tao', child))
      await FS.writeText(FS.resolvePath('Good.ts', root), 'export const good: number = 1\n')
      await FS.writeText(broken, 'export const broken: number = "wrong"\n')
      await ensureProjectTypeScriptConfig(root)
      await ensureProjectTypeScriptConfig(child)

      const configPath = FS.resolvePath('tsconfig.json', root)
      const read = ts.readConfigFile(configPath, ts.sys.readFile)
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, configPath)
      Expect(parsed.fileNames).toContain(FS.resolvePath('Good.ts', root))
      Expect(parsed.fileNames).not.toContain(broken)
      Expect(await checkProjectTypeScript(root, [], [], [], {})).toEqual([])
      Expect(
        (await checkProjectTypeScript(child, [], [], [], {})).some(diagnostic =>
          diagnostic.filePath === broken && diagnostic.code === 'TS2322'
        ),
      ).toBe(true)

      const authored = '{"extends":"./.tao/cache/typescript/tsconfig.json","exclude":[]}\n'
      await FS.writeText(configPath, authored)
      Expect(nativeFileNames(root)).toContain(broken)
      Expect(
        (await checkProjectTypeScript(root, [], [], [], {})).some(diagnostic =>
          diagnostic.filePath === configPath && diagnostic.message.includes('nested Tao project')
        ),
      ).toBe(true)
      Expect(await FS.readText(configPath)).toBe(authored)
    } finally {
      await FS.remove(root)
    }
  })

  Test('matches native JavaScript checks and diagnoses an authored strict override', async () => {
    const root = await mkTestDir('tao-tooling-native-parity-', { location: 'host' })
    try {
      const source = FS.resolvePath('Main.js', root)
      const config = FS.resolvePath('tsconfig.json', root)
      await FS.mkdir(FS.resolvePath('.tao', root))
      await FS.writeText(source, 'export function length(value) { return value.length }\n')
      await ensureProjectTypeScriptConfig(root)

      Expect(nativeDiagnostics(root).some(diagnostic => diagnostic.code === 7006)).toBe(true)
      Expect(
        (await checkProjectTypeScript(root, [], [], [], {})).some(diagnostic =>
          diagnostic.filePath === source && diagnostic.code === 'TS7006'
        ),
      ).toBe(true)

      const edited = '{"extends":"./.tao/cache/typescript/tsconfig.json","compilerOptions":{"strict":false}}\n'
      await FS.writeText(config, edited)
      Expect(nativeDiagnostics(root).some(diagnostic => diagnostic.code === 7006)).toBe(false)
      const incompatible = await checkProjectTypeScript(root, [], [], [], {})
      Expect(
        incompatible.some(diagnostic =>
          diagnostic.filePath === config && diagnostic.message.includes('strict must be true')
        ),
      ).toBe(true)
      Expect(await FS.readText(config)).toBe(edited)

      const ignored = FS.resolvePath('Ignored.js', root)
      await FS.writeText(
        source,
        '/** @param {string} value */\nexport function length(value) { return value.length }\n',
      )
      await FS.writeText(ignored, 'export function ignored(value) { return value.length }\n')
      await FS.writeText(
        config,
        '{"extends":"./.tao/cache/typescript/tsconfig.json","compilerOptions":{"types":[],"typeRoots":["./custom-types"]},"exclude":["./Ignored.js"]}\n',
      )
      Expect(nativeFileNames(root)).not.toContain(ignored)
      Expect(nativeDiagnostics(root)).toEqual([])
      Expect(await checkProjectTypeScript(root, [], [], [], {})).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('checks a wrong implementation in native TypeScript and requires contract coverage', async () => {
    const root = await mkTestDir('tao-tooling-native-contract-', { location: 'host' })
    try {
      const contract = FS.resolvePath('.tao-ts/Main.tao.ts', root)
      const config = FS.resolvePath('tsconfig.json', root)
      await FS.mkdir(FS.resolvePath('.tao', root))
      await FS.writeText(
        FS.resolvePath('Words.ts', root),
        'export function CountWords(value: number): number { return value }\n',
      )
      await FS.writeText(
        contract,
        [
          "import * as Sidecar from '../Words'",
          'type Expected = (value: string) => number',
          'Sidecar.CountWords satisfies Expected',
          '',
        ].join('\n'),
      )
      await ensureProjectTypeScriptConfig(root)

      Expect(nativeFileNames(root)).toContain(contract)
      Expect(nativeDiagnostics(root).some(diagnostic => diagnostic.code === 1360)).toBe(true)
      Expect(
        (await checkProjectTypeScript(root, [contract], [], [], {})).some(diagnostic =>
          diagnostic.filePath === contract && diagnostic.code === 'TS1360'
        ),
      ).toBe(true)

      await FS.writeText(config, '{"extends":"./.tao/cache/typescript/tsconfig.json","include":["./Words.ts"]}\n')
      Expect(nativeFileNames(root)).not.toContain(contract)
      Expect(
        (await checkProjectTypeScript(root, [contract], [], [], {})).some(diagnostic =>
          diagnostic.filePath === config && diagnostic.message.includes('omits generated Tao contracts')
        ),
      ).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })
})

function nativeFileNames(root: string): string[] {
  const config = FS.resolvePath('tsconfig.json', root)
  const read = ts.readConfigFile(config, ts.sys.readFile)
  return ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, config).fileNames
}

function nativeDiagnostics(root: string): readonly ts.Diagnostic[] {
  const config = FS.resolvePath('tsconfig.json', root)
  const read = ts.readConfigFile(config, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, config)
  return [...parsed.errors, ...ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, parsed.options))]
}
