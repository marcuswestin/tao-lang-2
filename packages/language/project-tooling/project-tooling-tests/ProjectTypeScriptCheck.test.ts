import { BridgeMetadata } from '@compiler/bridge-metadata'
import { Workspace } from '@compiler/workspace'
import { Assert, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'
import {
  checkProjectTypeScript,
  checkProjectTypeScriptWithConfigInputs,
} from '../project-tooling-src/ProjectTypeScriptCheck'
import { ensureProjectTypeScriptConfig } from '../project-tooling-src/ProjectTypeScriptConfig'

Describe('project TypeScript host resolution', () => {
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
        '{"extends":["./.tao/typescript/tsconfig.json","../shared/first.json","../shared/second.json"]}\n',
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
        '{"extends":"./.tao/typescript/tsconfig.json","compilerOptions":{"strict":true,"paths":{"peer/extra":["./Override.ts"]}}}\n',
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

      const authored = '{"extends":"./.tao/typescript/tsconfig.json","exclude":[]}\n'
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

      const edited = '{"extends":"./.tao/typescript/tsconfig.json","compilerOptions":{"strict":false}}\n'
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
        '{"extends":"./.tao/typescript/tsconfig.json","compilerOptions":{"types":[],"typeRoots":["./custom-types"]},"exclude":["./Ignored.js"]}\n',
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
          "import type * as Sidecar from '../Words'",
          'type Expected = (value: string) => number',
          'export type Check<Actual extends Expected> = Actual',
          'export type CountWordsCheck = Check<typeof Sidecar.CountWords>',
          '',
        ].join('\n'),
      )
      await ensureProjectTypeScriptConfig(root)

      Expect(nativeFileNames(root)).toContain(contract)
      Expect(nativeDiagnostics(root).some(diagnostic => diagnostic.code === 2344)).toBe(true)
      Expect(
        (await checkProjectTypeScript(root, [contract], [], [], {})).some(diagnostic =>
          diagnostic.filePath === contract && diagnostic.code === 'TS2344'
        ),
      ).toBe(true)

      await FS.writeText(config, '{"extends":"./.tao/typescript/tsconfig.json","include":["./Words.ts"]}\n')
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

  Test('maps erased native signature, arity, and return checks to their Tao declarations', async () => {
    await withTaoFiles('tao-tooling-erased-contract-mapping-', {
      'Main.tao': 'action Read(Value text) returns text from ./Native.ts\naction Write(Value text) from ./Native.ts',
      'Native.ts': '',
    }, async (paths, root) => {
      const validation = await (await Workspace.open(root)).validate(paths['Main.tao'])
      Expect(validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      const companion = BridgeMetadata.collect(validation.files, root).find(item =>
        item.sourcePath === paths['Main.tao']
      )
      Assert.defined(companion, 'native bridge companion is generated')
      await FS.writeText(companion.path, companion.code)
      await ensureProjectTypeScriptConfig(root)
      await FS.writeText(
        FS.resolvePath('tsconfig.json', root),
        '{"extends":"./.tao/typescript/tsconfig.json","compilerOptions":{"noUnusedLocals":true,"noUnusedParameters":true}}\n',
      )
      const mappings = companion.sourceMappings.map(mapping => ({
        generatedPath: companion.path,
        generatedRange: mapping.generated,
        sourcePath: companion.sourcePath,
        sourceRange: mapping.source,
      }))
      const readRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 53 } }
      const writeRange = { start: { line: 1, character: 0 }, end: { line: 1, character: 41 } }
      const fixtures = [
        { read: 'export function Read(value: number): string { return String(value) }', ranges: [readRange] },
        { read: 'export function Read(value: string): number { return value.length }', ranges: [readRange, readRange] },
        { read: 'export function Read(): string { return "ok" }', ranges: [readRange] },
        {
          read: 'export function Read(value: string): string { return value }',
          write: 'export function Write(value: string): number { return value.length }',
          ranges: [writeRange, writeRange],
        },
        {
          read: [
            'export function Read(value: string): string',
            'export function Read(value: number): number',
            'export function Read(value: string | number): string | number { return value }',
          ].join('\n'),
          ranges: [readRange],
        },
        { read: 'export async function Read(value: unknown): Promise<"ok"> { void value; return "ok" }', ranges: [] },
      ]
      for (const fixture of fixtures) {
        await FS.writeText(
          paths['Native.ts'],
          `${fixture.read}\n${fixture.write ?? 'export function Write(value: string): void { void value }'}\n`,
        )
        const diagnostics = await checkProjectTypeScript(root, [companion.path], [], mappings, {})
        Expect(
          diagnostics.map(diagnostic => ({
            code: diagnostic.code,
            filePath: diagnostic.filePath,
            range: diagnostic.range,
          })),
        )
          .toEqual(fixture.ranges.map(range => ({ code: 'TS2344', filePath: paths['Main.tao'], range })))
      }
    })
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
